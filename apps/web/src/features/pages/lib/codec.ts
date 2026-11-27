import { $convertToMarkdownString, $generateNodesFromMarkdownString } from '@lexical/markdown';
import {
  $createParagraphNode,
  $getRoot,
  $isParagraphNode,
  $setSelection,
  type ElementNode,
  type LexicalNode,
  type NodeKey,
} from 'lexical';
import { $createCalloutNode, $createRawBlockNode, isCalloutTone, type CalloutTone } from './nodes';
import { PAGE_TRANSFORMERS } from './transformers';
import { splitUnits, unitText, type Line, type Unit } from './units';

/*
 * Between a page's Markdown file and the editor. The file is read block by block (`units.ts`);
 * each block becomes one or a few of the editor's nodes, which remember the block they came from
 * and what they said then. Written back, a block whose nodes still say the same goes into the
 * file exactly as it stood – its lines, their ids, the blank lines after it –, only what was
 * changed is written anew (in Lexical's Markdown), and a new block gets new line ids. So a file
 * made elsewhere is never rewritten by opening it, nor by typing in one place of it.
 */

/** An id a line takes on the server (`MARKDOWN_ID` there), as Writer makes them. */
export function newLineId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `p${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('')}`.slice(
    0,
    14,
  );
}

/** One node's Markdown, as the whole document's export writes it. */
export function $markdownOf(node: LexicalNode): string {
  return $convertToMarkdownString(PAGE_TRANSFORMERS, {
    getChildren: () => [node],
  } as unknown as ElementNode);
}

/** The whole page's Markdown (without what is kept beside the editor: the front matter). */
export const $pageMarkdown = () => $convertToMarkdownString(PAGE_TRANSFORMERS);

interface Entry {
  unit: Unit;
  /** Which of the unit's nodes this is, and how many it made. */
  index: number;
  count: number;
  /** What it said when read. */
  baseline: string;
}

/** One block as `$lines` wrote it: its own lines in the output, and the nodes it came from. */
interface Group {
  kind: Unit['kind'];
  start: number;
  end: number;
  nodes: { key: NodeKey; baseline: string }[];
}

const CALLOUT_HEAD = /^\s{0,3}>\s*\[!([A-Z]+)\]\s*$/;

/** A block's nodes; a block the editor would not read back as it is shown kept as written. */
function $nodesOf(unit: Unit): LexicalNode[] {
  const text = unitText(unit);
  if (unit.kind === 'raw' || unit.kind === 'table' || unit.kind === 'diagram' || unit.kind === 'ink') {
    return [$createRawBlockNode(text, unit.kind)];
  }
  if (unit.kind === 'quote') {
    const tone = CALLOUT_HEAD.exec(unit.lines[0]!.text)?.[1];
    if (tone && isCalloutTone(tone)) return [$calloutOf(tone, unit.lines.slice(1))];
  }
  const nodes = $generateNodesFromMarkdownString(text, PAGE_TRANSFORMERS).filter(
    (node) => !($isParagraphNode(node) && node.getTextContentSize() === 0 && node.isEmpty()),
  );
  return nodes.length > 0 ? nodes : [$createRawBlockNode(text, 'raw')];
}

function $calloutOf(tone: CalloutTone, body: readonly Line[]): LexicalNode {
  const callout = $createCalloutNode(tone);
  const inner = body.map((line) => line.text.replace(/^\s{0,3}>\s?/, '')).join('\n');
  if (!inner.trim()) return callout;
  const nodes = $generateNodesFromMarkdownString(inner, PAGE_TRANSFORMERS);
  // Only text inside: anything more stays as it is written.
  if (nodes.length !== 1 || !$isParagraphNode(nodes[0])) {
    return $createRawBlockNode(
      ['> [!' + tone + ']', ...body.map((line) => line.text)].join('\n'),
      'raw',
    );
  }
  callout.append(...(nodes[0] as ElementNode).getChildren());
  return callout;
}

export class PageCodec {
  /** The lines the editor's content stands for: the server's, once what was sent is in. */
  known: Line[] = [];
  private front: Unit | null = null;
  private lead: Line[] = [];
  /** The blocks as the file had them, in its order: who stood right before whom. */
  private units: Unit[] = [];
  private entries = new Map<NodeKey, Entry>();

  /** The front matter's lines (`---` … `---`), kept beside the editor. */
  get frontMatter(): readonly Line[] {
    return this.front?.lines ?? [];
  }

  /** The file's lines a block of the editor stands for, as last read or sent; none for one typed since. */
  linesOf(key: NodeKey): readonly Line[] {
    return this.entries.get(key)?.unit.lines ?? [];
  }

  /** The editor's block a line of the file is shown in (its first node), if any. */
  keyOf(lineId: string): NodeKey | null {
    for (const [key, entry] of this.entries) {
      if (entry.index === 0 && entry.unit.lines.some((line) => line.id === lineId)) return key;
    }
    return null;
  }

  /** The file's lines into the editor (inside `editor.update`). */
  $read(lines: readonly Line[]) {
    const { lead, units } = splitUnits(lines);
    this.front = units[0]?.kind === 'front' ? units.shift()! : null;
    this.lead = lead;
    this.units = units;
    this.entries = new Map();
    const root = $getRoot();
    root.clear();
    for (const unit of units) {
      const nodes = $nodesOf(unit);
      root.append(...nodes);
      nodes.forEach((node, index) =>
        this.entries.set(node.getKey(), {
          unit,
          index,
          count: nodes.length,
          baseline: $markdownOf(node),
        }),
      );
    }
    if (root.getChildrenSize() === 0) root.append($createParagraphNode());
    $setSelection(null);
    this.known = [...lines];
  }

  /** The editor's content as the file's lines (inside a read of the editor). */
  $lines(): Line[] {
    return this.$write().out;
  }

  /**
   * The editor's content as the file's lines, and from now on what the blocks are measured
   * against (inside a read of the editor; once they are sent). Each block written anew becomes a
   * block as it stood – the lines it went out as, their ids –, so typing elsewhere writes it out
   * as it is again, and the next change to it keeps the ids it was sent with (not those it had
   * when the file was read: a line someone else edits meanwhile is not deleted and put in anew).
   */
  $commit(): Line[] {
    const { out, groups, frontLength } = this.$write();
    const units: Unit[] = [];
    const entries = new Map<NodeKey, Entry>();
    groups.forEach((group, index) => {
      // The blank lines up to the next block are its gap: put in between when it was written.
      const unit: Unit = {
        kind: group.kind,
        lines: out.slice(group.start, group.end),
        gap: out.slice(group.end, groups[index + 1]?.start ?? out.length),
      };
      units.push(unit);
      group.nodes.forEach((node, at) =>
        entries.set(node.key, {
          unit,
          index: at,
          count: group.nodes.length,
          baseline: node.baseline,
        }),
      );
    });
    this.lead = out.slice(frontLength, groups[0]?.start ?? out.length);
    this.units = units;
    this.entries = entries;
    this.known = out;
    return out;
  }

  private $write(): { out: Line[]; groups: Group[]; frontLength: number } {
    const out: Line[] = [];
    const groups: Group[] = [];
    const used = new Set<Unit>();
    const separate = () => {
      const last = out.at(-1);
      if (last && last.text.trim() !== '') out.push({ id: newLineId(), text: '' });
    };
    // What went into `out` last: the file's start, a block as it stood, or one written anew. A
    // block that stood right after the one before it in the file follows it as it did – with no
    // blank line put between where the file had none (`## A` over its text, a list after
    // „Intro:“); blank lines are only made around what is written anew.
    let previous: Unit | 'start' | 'new' = 'start';
    const order = new Map(this.units.map((unit, index) => [unit, index]));
    const followsAsBefore = (unit: Unit) => {
      const index = order.get(unit) ?? -1;
      return previous === (index === 0 ? 'start' : this.units[index - 1]);
    };
    if (this.front) out.push(...this.front.lines, ...this.front.gap);
    const frontLength = out.length;
    out.push(...this.lead);
    // A block of several nodes written anew: its blank lines after its last node, not its first.
    let held: { unit: Unit; gap: Line[] } | null = null;
    const release = () => {
      if (held) out.push(...held.gap);
      held = null;
    };
    const children = $getRoot().getChildren();
    for (let at = 0; at < children.length; at += 1) {
      const node = children[at]!;
      const entry = this.entries.get(node.getKey());
      if (held && entry?.unit !== held.unit) release();
      if (entry && entry.index === 0 && !used.has(entry.unit)) {
        const group = children.slice(at, at + entry.count);
        const same =
          group.length === entry.count &&
          group.every((each, index) => {
            const own = this.entries.get(each.getKey());
            return (
              own?.unit === entry.unit && own.index === index && $markdownOf(each) === own.baseline
            );
          });
        if (same) {
          if (!followsAsBefore(entry.unit)) separate();
          groups.push({
            kind: entry.unit.kind,
            start: out.length,
            end: out.length + entry.unit.lines.length,
            nodes: group.map((each) => ({
              key: each.getKey(),
              baseline: this.entries.get(each.getKey())!.baseline,
            })),
          });
          out.push(...entry.unit.lines, ...entry.unit.gap);
          used.add(entry.unit);
          previous = entry.unit;
          at += entry.count - 1;
          continue;
        }
      }
      const markdown = $markdownOf(node);
      // An empty paragraph is nothing in the file.
      if (markdown.trim() === '') continue;
      const reuse: Unit | null =
        entry && entry.index === 0 && !used.has(entry.unit) ? entry.unit : null;
      if (reuse) used.add(reuse);
      separate();
      const texts = markdown.split('\n');
      const ids = reuse ? reusedIds(reuse.lines, texts) : [];
      groups.push({
        kind: entry?.unit.kind ?? 'paragraph',
        start: out.length,
        end: out.length + texts.length,
        nodes: [{ key: node.getKey(), baseline: markdown }],
      });
      texts.forEach((text, index) => out.push({ id: ids[index] ?? newLineId(), text }));
      if (reuse && entry && entry.count > 1) held = { unit: reuse, gap: reuse.gap };
      else if (reuse) out.push(...reuse.gap);
      previous = 'new';
    }
    release();
    return { out, groups, frontLength };
  }
}

/**
 * The ids a block written anew keeps from what it was: a line that still says the same keeps its
 * own (longest common run, so a line put in above the others changes none of them – an edit
 * someone makes there meanwhile is not overwritten), the others take the old ones between the
 * same kept lines in order; what is left over is new (`undefined`).
 */
function reusedIds(old: readonly Line[], texts: readonly string[]): (string | undefined)[] {
  const n = old.length;
  const m = texts.length;
  const ids: (string | undefined)[] = new Array<string | undefined>(m).fill(undefined);
  // Matched pairs (old index, new index), in order; by position alone where it would be too big.
  const pairs: [number, number][] = [];
  if (n * m <= 250_000) {
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1)
      for (let j = m - 1; j >= 0; j -= 1)
        table[i]![j] =
          old[i]!.text === texts[j]
            ? table[i + 1]![j + 1]! + 1
            : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (old[i]!.text === texts[j]) pairs.push([i++, j++]);
      else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
      else j += 1;
    }
  }
  let fromOld = 0;
  let fromNew = 0;
  for (const [i, j] of [...pairs, [n, m] as [number, number]]) {
    // Between two kept lines: the old ids there, by position.
    for (let k = 0; fromNew + k < j && fromOld + k < i; k += 1)
      ids[fromNew + k] = old[fromOld + k]!.id;
    if (i < n) ids[j] = old[i]!.id;
    fromOld = i + 1;
    fromNew = j + 1;
  }
  return ids;
}

/** Whether two runs of lines say the same with the same ids. */
export const sameLines = (a: readonly Line[], b: readonly Line[]) =>
  a.length === b.length &&
  a.every((line, index) => line.id === b[index]!.id && line.text === b[index]!.text);
