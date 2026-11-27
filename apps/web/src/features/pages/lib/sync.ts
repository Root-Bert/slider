import type {
  WriterBlock,
  WriterContent,
  WriterEditInput,
  WriterEditResult,
  WriterLook,
  WriterParagraphBlock,
  WriterStep,
} from '@slider/shared';
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  CLEAR_HISTORY_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { applySteps, inRequests, stepsBetween } from '@/features/writer';
import { retryDelay, sendOutcome } from '@/lib/outbox';
import { PageCodec, sameLines } from './codec';
import type { Line } from './units';

/*
 * A page open: its Markdown file as the server keeps it (a line a paragraph, Writer's
 * `MarkdownDocument`), the editor showing it, and between them the steps. What is typed is sent
 * 600 ms after the last change as the steps between the lines last sent and the lines now (only
 * the blocks changed – `codec.ts`); the same edit sent again is written once (`clientEditId`).
 * Someone else's steps come over the document's live stream; the editor is read anew from the
 * file once nothing of one's own is waiting – what one typed stays, the server put both together
 * line by line.
 */

export type PageSyncState = 'saved' | 'saving' | 'offline' | 'signedOut';

export interface PageSyncOptions {
  send: (input: WriterEditInput) => Promise<WriterEditResult>;
  refetch: () => Promise<WriterContent>;
  onState: (state: PageSyncState) => void;
  onRefused: (message: string) => void;
}

const FLUSH_MS = 600;

const linesOf = (blocks: readonly WriterBlock[]): Line[] =>
  blocks.flatMap((block) =>
    block.type === 'paragraph'
      ? [{ id: block.id, text: block.runs.map((run) => run.text).join('') }]
      : [],
  );

interface Entry {
  id: string;
  operations: WriterEditInput['operations'];
  tries: number;
}

export class PageSync {
  readonly codec = new PageCodec();
  /** The file's lines as the server has them, what one sent included. */
  private raw: WriterParagraphBlock[];
  private look: WriterLook;
  private readonly formats: WriterContent['formats'];
  private seq: number;
  /** The steps already in `raw` past what was read (one's own answered, others' come in). */
  private readonly applied = new Set<number>();
  private floor: number;
  private wantResync = false;
  private queue: Entry[] = [];
  private readonly mine = new Set<string>();
  private sending = false;
  private timer = 0;
  private retryTimer = 0;
  private stale = false;
  private gone = false;
  /** Typed since the last send (`changed`): only then is there anything to send. */
  private typed = false;
  private state: PageSyncState = 'saved';

  constructor(
    private readonly editor: LexicalEditor,
    content: WriterContent,
    private readonly options: PageSyncOptions,
  ) {
    this.raw = content.blocks.filter(
      (block): block is WriterParagraphBlock => block.type === 'paragraph',
    );
    this.formats = content.formats;
    this.look = content.formats.text;
    this.seq = content.seq;
    this.floor = content.seq;
  }

  /** The file into the editor, as it is now. */
  load() {
    const lines = linesOf(this.raw);
    this.editor.update(
      () => {
        const at = this.$caret();
        this.codec.$read(lines);
        if (at) this.$restore(at);
      },
      { tag: 'page-load', discrete: true },
    );
    // What was undoable belonged to the content before: undone now it would undo the others' too.
    this.editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  }

  /** Something was typed: sent once it rests. */
  changed() {
    this.typed = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** What is typed and not yet sent, now (leaving Bearbeiten, leaving the page). */
  flush() {
    window.clearTimeout(this.timer);
    if (this.gone) return;
    // Nothing typed since the last send: opening, reading, leaving write nothing (and a reader is
    // never refused for steps they did not make).
    if (!this.typed) {
      if (this.stale && !this.busy) this.reload();
      return;
    }
    this.typed = false;
    const before = this.codec.known;
    // The lines now, and the blocks measured against them from here on (`$commit`).
    const next = this.editor.getEditorState().read(() => this.codec.$commit());
    if (sameLines(next, before)) {
      if (this.stale && !this.busy) this.reload();
      return;
    }
    const ops = stepsBetween(this.blocks(before), this.blocks(next));
    if (ops.length === 0) return;
    this.raw = this.paragraphs(applySteps(this.raw, ops, this.formats).blocks);
    for (const operations of inRequests(ops)) {
      this.queue.push({ id: crypto.randomUUID(), operations, tries: 0 });
    }
    void this.pump();
  }

  get busy() {
    return this.sending || this.queue.length > 0;
  }

  get syncState() {
    return this.state;
  }

  /** Someone else's step (or one's own coming back). */
  remote(step: WriterStep) {
    this.seq = Math.max(this.seq, step.seq);
    if (step.clientEditId && this.mine.has(step.clientEditId)) return;
    if (step.seq <= this.floor || this.applied.has(step.seq)) return;
    this.applied.add(step.seq);
    this.raw = this.paragraphs(applySteps(this.raw, step.operations, this.formats).blocks);
    this.stale = true;
    this.settle();
  }

  /** The line came back, or a step did not fit: the file read anew; what is unsent stays. */
  async resync() {
    // What is on its way first: read anew after, with it in.
    if (this.busy) {
      this.wantResync = true;
      return;
    }
    this.wantResync = false;
    let content: WriterContent;
    try {
      content = await this.options.refetch();
    } catch {
      return;
    }
    if (this.gone) return;
    if (this.busy) {
      this.wantResync = true;
      return;
    }
    this.raw = this.paragraphs(content.blocks);
    this.seq = Math.max(this.seq, content.seq);
    this.floor = content.seq;
    this.applied.clear();
    this.stale = true;
    this.settle();
  }

  dispose() {
    this.flush();
    this.gone = true;
    window.clearTimeout(this.timer);
    // A retry waiting (offline) keeps going: what was typed is still sent once back (`pump`).
  }

  // ── Inside ────────────────────────────────────────────────────────────────

  /** Read anew from the file once nothing of one's own is on its way or waiting. */
  private settle() {
    if (this.busy) return;
    if (this.typed) {
      // Typed meanwhile: sent first, read anew after.
      this.flush();
      return;
    }
    this.reload();
  }

  private reload() {
    this.stale = false;
    if (sameLines(linesOf(this.raw), this.codec.known)) return;
    this.load();
  }

  private blocks(lines: readonly Line[]): WriterParagraphBlock[] {
    const was = new Map(this.raw.map((block) => [block.id, block]));
    return lines.map((line) => {
      const old = was.get(line.id);
      if (old && old.runs.map((run) => run.text).join('') === line.text) return old;
      return {
        type: 'paragraph',
        id: line.id,
        kind: 'text',
        runs: line.text ? [{ text: line.text }] : [],
        look: this.look,
      };
    });
  }

  private paragraphs(blocks: readonly WriterBlock[]): WriterParagraphBlock[] {
    return blocks.filter((block): block is WriterParagraphBlock => block.type === 'paragraph');
  }

  private set(state: PageSyncState) {
    if (state === this.state) return;
    this.state = state;
    this.options.onState(state);
  }

  private async pump() {
    if (this.sending) return;
    this.sending = true;
    this.set('saving');
    let diverged = false;
    // Left meanwhile (the page closed): what was typed is still sent.
    while (this.queue.length > 0) {
      const entry = this.queue[0]!;
      entry.tries += 1;
      this.mine.add(entry.id);
      try {
        const result = await this.options.send({
          operations: entry.operations,
          baseSeq: this.seq,
          clientEditId: entry.id,
        });
        this.seq = Math.max(this.seq, result.seq);
        this.applied.add(result.seq);
        this.queue.shift();
        if (result.dropped.length > 0) diverged = true;
      } catch (error) {
        const outcome = sendOutcome(error, entry.tries);
        if (outcome === 'refused') {
          this.queue.shift();
          diverged = true;
          if (!this.gone) {
            this.options.onRefused(error instanceof Error ? error.message : 'Nicht gespeichert');
          }
          continue;
        }
        this.sending = false;
        this.set(outcome === 'signedOut' ? 'signedOut' : 'offline');
        if (outcome !== 'signedOut') {
          this.retryTimer = window.setTimeout(() => void this.pump(), retryDelay(entry.tries));
        }
        return;
      }
    }
    this.sending = false;
    if (this.gone) return;
    this.set('saved');
    if (diverged || this.wantResync) void this.resync();
    else if (this.stale) this.settle();
  }

  /** Where the caret stands: its block's place and how far into its text. */
  private $caret(): { block: number; offset: number } | null {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    const anchor = selection.anchor.getNode();
    const top = anchor.getTopLevelElement();
    if (!top) return null;
    const block = top.getIndexWithinParent();
    // How far into the block: the text before the caret inside it.
    let offset = 0;
    for (const text of top.getAllTextNodes()) {
      if (text.is(anchor)) {
        offset += selection.anchor.offset;
        break;
      }
      offset += text.getTextContentSize();
    }
    return { block, offset };
  }

  private $restore(at: { block: number; offset: number }) {
    const root = $getRoot();
    const top = root.getChildAtIndex(Math.min(at.block, root.getChildrenSize() - 1));
    if (!$isElementNode(top)) {
      $setSelection(null);
      return;
    }
    let left = at.offset;
    for (const text of top.getAllTextNodes()) {
      const size = text.getTextContentSize();
      if (left <= size) {
        text.select(left, left);
        return;
      }
      left -= size;
    }
    top.selectEnd();
  }
}
