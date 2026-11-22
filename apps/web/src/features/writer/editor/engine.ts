import {
  WRITER_PICTURE_TYPES,
  writerFormatOf,
  writerTableGrid,
  writerText,
  type WriterAlign,
  type WriterContent,
  type WriterEditInput,
  type WriterEditResult,
  type WriterFormat,
  type WriterFormatLook,
  type WriterList,
  type WriterOperation,
  type WriterPage,
  type WriterParagraph,
  type WriterParagraphBlock,
  type WriterPicture,
  type WriterStep,
} from '@slider/shared';
import { retryDelay, sendOutcome } from '@/lib/outbox';
import {
  applySteps,
  baseMarks,
  caret,
  cellRange,
  deleteSelection,
  entries,
  find,
  findAll,
  indent,
  inRequests,
  insertParagraphs,
  insertInlinePicture,
  insertPicture,
  insertColumn,
  insertRow,
  insertTable,
  insertText,
  isCollapsed,
  isPicture,
  joinBackward,
  joinForward,
  lengthOf,
  linkAt,
  markers,
  marksAt,
  mergeCells,
  MIN_COLUMN_SHARE,
  ordered,
  paragraphOf,
  removeBlock,
  pictureAt,
  removeColumn,
  removeRow,
  resizePicture,
  alignPicture,
  alignOf,
  replaceRange,
  setAlign,
  addPageAfter,
  moveBlock,
  setFormatLook,
  setLineHeight,
  lineHeightAt,
  lookAt,
  formatSteps,
  type SelectionLook,
  setBreakBefore,
  setColor,
  setColumns,
  setFont,
  setFormat,
  setHighlight,
  setLink,
  setSize,
  settle,
  sliceRuns,
  splitCell,
  splitParagraph,
  stepsBetween,
  protectBlock,
  protectedIds,
  touchesProtected,
  toggleList,
  toggleMark,
  touched,
  withParagraph,
  type Blocks,
  type Edit,
  type Formats,
  type Hit,
  type Marks,
  type Point,
  type Sel,
  type ToggleMark,
} from '../lib/model';
import { metricsOf, PAGE_GAP, pageAt, paginate, type PageMetrics } from '../lib/paginate';
import { pastedParagraphs } from '../lib/paste';
import { FlowView, forgetLineRatios } from '../lib/view';

/*
 * The open document: what it holds, what is selected in it, what was undone, what the server
 * knows of it. It owns the text's elements (`FlowView`) and takes every key itself – the
 * browser shows the caret and the selection, nothing else is left to it. React draws the rest
 * of the page from `state`.
 */

export type WriterMode = 'review' | 'edit';
/** `saved`: the server has it all; `offline`: out of reach, kept and sent later. */
export type WriterSync = 'saved' | 'saving' | 'offline' | 'signedOut';

export interface EngineState {
  blocks: Blocks;
  page: WriterPage;
  formats: Formats;
  metrics: PageMetrics;
  sel: Sel | null;
  focused: boolean;
  mode: WriterMode;
  /** The look of what is typed next, picked with no text selected. */
  pending: Marks | null;
  /** A picture picked by a click. */
  picked: string | null;
  canUndo: boolean;
  canRedo: boolean;
  sync: WriterSync;
  pages: number;
  /** The sheets' height one under the other, in px at 100 %. */
  height: number;
  /** As wide as the sheets – without pages, as the text with its longest line. */
  width: number;
  /** Counts the layouts: what is placed by the text's lines follows it. */
  layout: number;
  /** Keys are being typed: what floats over the text steps aside. */
  typing: boolean;
  printing: boolean;
}

export interface TextChange {
  id: string;
  before: string;
  after: string;
}

export interface EngineOptions {
  content: WriterContent;
  canEdit: boolean;
  pictureUrl: (path: string) => string;
  send: (input: WriterEditInput) => Promise<WriterEditResult>;
  /** The document as the server has it now. */
  refetch: () => Promise<WriterContent>;
  /** No pages (a Markdown file): the text is one surface as tall and wide as it is. */
  pageless?: boolean;
  /** What an edit becomes before it is drawn and sent: what the file can hold (Markdown). */
  normalize?: (edit: Edit) => Edit;
}

/** What the page around the text is told; set anew whenever it draws itself. */
export interface EngineHandlers {
  onRefused: (message: string) => void;
  /** Paragraphs whose words changed: comments standing at them move along. */
  onText: (changes: TextChange[]) => void;
  /** Pictures pasted or dropped in: sent first, then placed with `insertPicture`. */
  onPictures: (files: File[]) => void;
}

interface Snapshot {
  blocks: Blocks;
  page: WriterPage;
  formats: Formats;
  sel: Sel | null;
}

interface Queued {
  id: string;
  operations: WriterOperation[];
  tries: number;
}

const MAX_UNDO = 200;
const TYPING_RUN_MS = 1500;
const SEND_AFTER_MS = 600;
/** How near a column's border the pointer takes it, in pixels. */
const BORDER_GRAB = 4;
const PT_PER_PX = 72 / 96;
/** No picture is dragged narrower than this, in points: its corners stay apart. */
const MIN_PICTURE_PT = 12;

const samePage = (a: WriterPage, b: WriterPage) =>
  a.width === b.width &&
  a.height === b.height &&
  a.marginTop === b.marginTop &&
  a.marginRight === b.marginRight &&
  a.marginBottom === b.marginBottom &&
  a.marginLeft === b.marginLeft &&
  a.numbers === b.numbers &&
  (a.header ?? '') === (b.header ?? '') &&
  (a.footer ?? '') === (b.footer ?? '');

const isPictureFile = (file: File) =>
  (WRITER_PICTURE_TYPES as readonly string[]).includes(file.type);

export class WriterEngine {
  readonly view: FlowView;
  private state: EngineState;
  private readonly listeners = new Set<() => void>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private sentBlocks: Blocks;
  private sentPage: WriterPage;
  private sentFormats: Formats;
  private readonly queue: Queued[] = [];
  private readonly mine = new Set<string>();
  private seq: number;
  private sending = false;
  private unreachable: 'offline' | 'signedOut' | null = null;
  private flushTimer = 0;
  private retryTimer = 0;
  private composing = false;
  private lastTyping = { at: 0, id: '' };
  /** The value being tried through (a font, a size) and where: its tries are one step. */
  private lastTrial = '';
  private host: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private zoom = 1;
  private gone = false;
  handlers: EngineHandlers = { onRefused: () => {}, onText: () => {}, onPictures: () => {} };

  constructor(private readonly options: EngineOptions) {
    const { content } = options;
    this.view = new FlowView({ pictureUrl: options.pictureUrl });
    this.sentBlocks = content.blocks;
    this.sentPage = content.page;
    this.sentFormats = content.formats as Formats;
    this.seq = content.seq;
    this.state = {
      blocks: content.blocks,
      page: content.page,
      formats: content.formats as Formats,
      metrics: metricsOf(content.page),
      sel: null,
      focused: false,
      mode: 'review',
      pending: null,
      picked: null,
      canUndo: false,
      canRedo: false,
      sync: 'saved',
      pages: 1,
      height: metricsOf(content.page).height,
      width: metricsOf(content.page).width,
      layout: 0,
      typing: false,
      printing: false,
    };
  }

  // ── The store React reads ─────────────────────────────────────────────────

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = () => this.state;

  private set(patch: Partial<EngineState>) {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof EngineState)[]) {
      if (this.state[key] !== patch[key]) changed = true;
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  get editable() {
    return this.options.canEdit && this.state.mode === 'edit';
  }

  // ── In the page ───────────────────────────────────────────────────────────

  /** `host` holds the sheets and is as large as they are; `scroller` scrolls them. */
  mount(host: HTMLElement, scroller: HTMLElement) {
    this.host = host;
    this.scroller = scroller;
    this.gone = false;
    const root = this.view.root;
    host.append(root);
    this.placeRoot();
    root.contentEditable = String(this.editable);
    root.addEventListener('beforeinput', this.onBeforeInput);
    root.addEventListener('keydown', this.onKeyDown);
    root.addEventListener('compositionstart', this.onCompositionStart);
    root.addEventListener('compositionend', this.onCompositionEnd);
    root.addEventListener('paste', this.onPaste);
    root.addEventListener('copy', this.onCopy);
    root.addEventListener('cut', this.onCut);
    root.addEventListener('dragstart', this.onDragStart);
    root.addEventListener('dragover', this.onDragOver);
    root.addEventListener('drop', this.onDrop);
    root.addEventListener('focus', this.onFocus);
    root.addEventListener('blur', this.onBlur);
    root.addEventListener('click', this.onClick);
    root.addEventListener('pointerdown', this.onBorderDown);
    root.addEventListener('pointermove', this.onBorderMove);
    root.addEventListener('pointerup', this.onBorderUp);
    root.addEventListener('pointercancel', this.onBorderUp);
    root.addEventListener('pointerleave', this.onBorderLeave);
    root.addEventListener('load', this.onPictureLoad, true);
    const handles = document.createElement('div');
    handles.className = 'writer-handles';
    handles.hidden = true;
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const handle = document.createElement('span');
      handle.dataset.corner = corner;
      handles.append(handle);
    }
    handles.addEventListener('pointerdown', this.onHandleDown);
    handles.addEventListener('pointermove', this.onHandleMove);
    handles.addEventListener('pointerup', this.onHandleUp);
    handles.addEventListener('pointercancel', this.onHandleUp);
    host.append(handles);
    this.handles = handles;
    document.addEventListener('selectionchange', this.onSelectionChange);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('online', this.kick);
    window.addEventListener('focus', this.kick);
    window.addEventListener('beforeprint', this.onBeforePrint);
    window.addEventListener('afterprint', this.onAfterPrint);
    document.fonts.addEventListener('loadingdone', this.onFonts);
    this.render();
  }

  unmount() {
    this.gone = true;
    this.flush();
    const root = this.view.root;
    root.removeEventListener('beforeinput', this.onBeforeInput);
    root.removeEventListener('keydown', this.onKeyDown);
    root.removeEventListener('compositionstart', this.onCompositionStart);
    root.removeEventListener('compositionend', this.onCompositionEnd);
    root.removeEventListener('paste', this.onPaste);
    root.removeEventListener('copy', this.onCopy);
    root.removeEventListener('cut', this.onCut);
    root.removeEventListener('dragstart', this.onDragStart);
    root.removeEventListener('dragover', this.onDragOver);
    root.removeEventListener('drop', this.onDrop);
    root.removeEventListener('focus', this.onFocus);
    root.removeEventListener('blur', this.onBlur);
    root.removeEventListener('click', this.onClick);
    root.removeEventListener('pointerdown', this.onBorderDown);
    root.removeEventListener('pointermove', this.onBorderMove);
    root.removeEventListener('pointerup', this.onBorderUp);
    root.removeEventListener('pointercancel', this.onBorderUp);
    root.removeEventListener('pointerleave', this.onBorderLeave);
    root.removeEventListener('load', this.onPictureLoad, true);
    document.removeEventListener('selectionchange', this.onSelectionChange);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('online', this.kick);
    window.removeEventListener('focus', this.kick);
    window.removeEventListener('beforeprint', this.onBeforePrint);
    window.removeEventListener('afterprint', this.onAfterPrint);
    document.fonts.removeEventListener('loadingdone', this.onFonts);
    window.clearTimeout(this.retryTimer);
    this.handles?.remove();
    this.handles = null;
    this.resizing = null;
    root.remove();
    this.host = null;
    this.scroller = null;
  }

  private placeRoot() {
    const { metrics } = this.state;
    const style = this.view.root.style;
    style.left = `${metrics.left}px`;
    style.top = `${metrics.top}px`;
    // Without pages the text takes the room it needs (`.writer-code`, `.writer-notes`).
    style.width = this.options.pageless
      ? ''
      : `${Math.max(40, metrics.width - metrics.left - metrics.right)}px`;
  }

  private render() {
    if (!this.host) return;
    this.view.render(this.state.blocks, markers(this.state.blocks));
    this.layout();
  }

  /** The text laid out over its pages anew. */
  layout = () => {
    if (!this.host) return;
    if (this.options.pageless) {
      const { metrics } = this.state;
      const root = this.view.root;
      this.set({
        pages: 1,
        height: root.offsetHeight + metrics.top + metrics.bottom,
        width: root.offsetWidth + metrics.left + metrics.right,
        layout: this.state.layout + 1,
      });
      this.markPicked();
      return;
    }
    const { pages, height } = paginate(
      this.view.root,
      this.state.blocks,
      this.state.metrics,
      this.zoom,
    );
    this.set({ pages, height, layout: this.state.layout + 1 });
    this.markPicked();
  };

  get scale() {
    return this.zoom;
  }

  /** How much larger than 100 % the sheets are shown – measures are taken through it. */
  setZoom(zoom: number) {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.layout();
  }

  setMode(mode: WriterMode) {
    const next = mode === 'edit' && !this.options.canEdit ? 'review' : mode;
    this.set({ mode: next, pending: null, typing: false });
    this.view.root.contentEditable = String(this.editable);
    this.pick(null);
  }

  focus() {
    this.view.root.focus({ preventScroll: true });
    if (this.state.sel) this.view.select(this.state.sel);
  }

  /** Where a stretch of the text lies, in the sheets' own px at 100 %. */
  rectsOf(from: Point, to: Point): { left: number; top: number; width: number; height: number }[] {
    const range = this.view.rangeOf(from, to);
    const host = this.host?.getBoundingClientRect();
    if (!range || !host) return [];
    const out: { left: number; top: number; width: number; height: number }[] = [];
    for (const rect of range.getClientRects()) {
      if (rect.width < 0.5 || rect.height < 0.5) continue;
      const next = {
        left: (rect.left - host.left) / this.zoom,
        top: (rect.top - host.top) / this.zoom,
        width: rect.width / this.zoom,
        height: rect.height / this.zoom,
      };
      const last = out.at(-1);
      // Stretches of one line side by side are one box.
      if (
        last &&
        Math.abs(last.top - next.top) < 1 &&
        Math.abs(last.height - next.height) < 1 &&
        next.left <= last.left + last.width + 1
      ) {
        last.width = Math.max(last.width, next.left + next.width - last.left);
      } else out.push(next);
    }
    if (out.length === 0) {
      // Nothing to stand on (no words yet): the paragraph itself.
      const box = this.view.elementOf(from.id)?.getBoundingClientRect();
      if (box) {
        out.push({
          left: (box.left - host.left) / this.zoom,
          top: (box.top - host.top) / this.zoom,
          width: box.width / this.zoom,
          height: box.height / this.zoom,
        });
      }
    }
    return out;
  }

  /** A stretch of the text brought into view, the selection left alone (a hit of the search). */
  showRange(from: Point, to: Point) {
    const scroller = this.scroller;
    const rect = this.view.rangeOf(from, to)?.getBoundingClientRect();
    if (!scroller || !rect) return;
    const frame = scroller.getBoundingClientRect();
    if (rect.top < frame.top + 96 || rect.bottom > frame.bottom - 96) {
      scroller.scrollTop += rect.top - frame.top - frame.height / 3;
    }
  }

  /** Scrolls to a page's top. */
  // ── „Ebenen“ ─────────────────────────────────────────────────────────────

  /** Each block of the text with the page it begins on, from 0, in order. */
  blocksByPage(): { id: string; page: number }[] {
    const origin = this.view.root.getBoundingClientRect().top;
    const { blocks, metrics } = this.state;
    const out: { id: string; page: number }[] = [];
    for (const block of blocks) {
      const element = this.view.elementOf(block.id);
      if (!element) continue;
      const y = (element.getBoundingClientRect().top - origin) / this.zoom;
      out.push({ id: block.id, page: pageAt(y, metrics) });
    }
    return out;
  }

  /** A block picked from its layer: the caret at its start, a picture standing alone picked. */
  selectBlock(id: string) {
    const block = this.state.blocks.find((each) => each.id === id);
    if (!block) return;
    const first = block.type === 'table' ? block.rows[0]?.[0]?.blocks[0] : block;
    if (!first) return;
    this.view.root.focus({ preventScroll: true });
    this.select(caret(first.id, 0));
    this.pick(block.type === 'paragraph' && isPicture(block) ? block.id : null);
  }

  /** A block of the text put before the block now at `to` (`moveBlock`); the caret goes with it. */
  moveBlockTo(id: string, to: number) {
    if (!this.editable) return;
    const blocks = this.state.blocks;
    const next = moveBlock(blocks, id, to);
    if (next === blocks) return;
    this.commit({ blocks: next, sel: this.state.sel ?? caret(id, 0) });
  }

  /** Text taken in the row over the caret (Enter): the keys are the text's now, Tab too. */
  startTyping() {
    if (this.state.focused && !this.state.typing) this.set({ typing: true });
  }

  showPage(index: number) {
    const scroller = this.scroller;
    const host = this.host?.getBoundingClientRect();
    if (!scroller || !host) return;
    const frame = scroller.getBoundingClientRect();
    scroller.scrollTop += host.top + index * this.state.metrics.pitch * this.zoom - frame.top - 24;
  }

  /** The page standing in the upper part of the window. */
  pageInView(): number {
    const scroller = this.scroller;
    const host = this.host?.getBoundingClientRect();
    if (!scroller || !host) return 0;
    const frame = scroller.getBoundingClientRect();
    const y = (frame.top + frame.height / 3 - host.top) / this.zoom;
    const { pitch } = this.state.metrics;
    return Math.max(0, Math.min(this.state.pages - 1, Math.floor(y / pitch)));
  }

  /** Where the selection stands in the window – what floats at it is placed by this. */
  selectionRect(): DOMRect | null {
    const sel = this.state.sel;
    if (!sel) return null;
    const { from, to } = ordered(this.state.blocks, sel);
    const range = this.view.rangeOf(from, to);
    if (!range) return null;
    const rect = range.getBoundingClientRect();
    if (rect.height > 0) return rect;
    const first = range.getClientRects()[0];
    if (first) return first;
    const element = this.view.elementOf(from.id);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return new DOMRect(box.left, box.top, 0, Math.min(box.height, 24 * this.zoom));
  }

  /** The caret brought into view where a key moved it out. */
  private reveal() {
    const scroller = this.scroller;
    const rect = this.selectionRect();
    if (!scroller || !rect) return;
    const frame = scroller.getBoundingClientRect();
    const edge = 72;
    if (rect.bottom > frame.bottom - edge) scroller.scrollTop += rect.bottom - frame.bottom + edge;
    else if (rect.top < frame.top + edge) scroller.scrollTop -= frame.top + edge - rect.top;
  }

  /** A place selected from outside (a hit of the search, a comment's words) and shown. */
  select(sel: Sel, show = true) {
    this.set({ sel, pending: null });
    this.view.select(sel);
    if (!show) return;
    const scroller = this.scroller;
    const rect = this.selectionRect();
    if (!scroller || !rect) return;
    const frame = scroller.getBoundingClientRect();
    if (rect.top < frame.top + 96 || rect.bottom > frame.bottom - 96) {
      scroller.scrollTop += rect.top - frame.top - frame.height / 3;
    }
  }

  // ── Changing the text ─────────────────────────────────────────────────────

  private snapshot(): Snapshot {
    return {
      blocks: this.state.blocks,
      page: this.state.page,
      formats: this.state.formats,
      sel: this.state.sel,
    };
  }

  private tellText(before: Blocks, after: Blocks) {
    if (before === after) return;
    const was = new Map(entries(before).map((entry) => [entry.block.id, entry.block]));
    const changes: TextChange[] = [];
    for (const { block } of entries(after)) {
      const old = was.get(block.id);
      if (!old || old === block) continue;
      const a = writerText(old);
      const b = writerText(block);
      if (a !== b) changes.push({ id: block.id, before: a, after: b });
    }
    if (changes.length > 0) this.handlers.onText(changes);
  }

  /** One edit of this person: undoable, drawn, sent. */
  private commit(edit: Edit | Blocks, kind: 'typing' | 'edit' = 'edit', trial = '') {
    const given: Edit =
      'blocks' in edit
        ? (edit as Edit)
        : { blocks: edit as Blocks, sel: this.state.sel ?? caret('', 0) };
    const next = this.options.normalize ? this.options.normalize(given) : given;
    const before = this.state.blocks;
    // Locked in „Ebenen“: nothing changes it but its unlocking, as on a slide.
    const locked = next.blocks === before ? null : protectedIds(before);
    if (locked?.size && touchesProtected(stepsBetween(before, next.blocks), locked)) {
      this.handlers.onRefused('Gesperrt – in den Ebenen entsperren (⇧⌘L)');
      return;
    }
    if (next.blocks !== before) {
      const now = Date.now();
      const id = next.sel.focus.id;
      const runsOn =
        this.undoStack.length > 0 &&
        ((kind === 'typing' &&
          this.lastTyping.id === id &&
          now - this.lastTyping.at < TYPING_RUN_MS) ||
          (trial !== '' && trial === this.lastTrial));
      this.lastTrial = trial;
      if (!runsOn) {
        this.undoStack.push(this.snapshot());
        if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      }
      this.lastTyping = kind === 'typing' ? { at: now, id } : { at: 0, id: '' };
      this.redoStack = [];
    }
    this.show(next.blocks, next.sel, kind === 'typing');
    this.tellText(before, next.blocks);
    this.scheduleFlush();
  }

  private show(blocks: Blocks, sel: Sel | null, typing = false) {
    const changed = blocks !== this.state.blocks;
    this.set({
      blocks,
      sel,
      pending: typing ? this.state.pending : null,
      typing: typing || (this.state.typing && !changed),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
    if (changed) this.render();
    if (sel && (this.state.focused || document.activeElement === this.view.root)) {
      this.view.select(sel);
      this.reveal();
    }
  }

  undo = () => {
    const back = this.undoStack.pop();
    if (!back) return;
    this.redoStack.push(this.snapshot());
    this.restore(back);
  };

  redo = () => {
    const forth = this.redoStack.pop();
    if (!forth) return;
    this.undoStack.push(this.snapshot());
    this.restore(forth);
  };

  private restore(snapshot: Snapshot) {
    const before = this.state.blocks;
    this.lastTyping = { at: 0, id: '' };
    this.lastTrial = '';
    if (!samePage(snapshot.page, this.state.page)) this.applyPage(snapshot.page);
    // The formats as they were then: the paragraphs of the snapshot wear them already.
    if (snapshot.formats !== this.state.formats) this.set({ formats: snapshot.formats });
    const sel = snapshot.sel
      ? {
          anchor: settle(snapshot.blocks, snapshot.sel.anchor),
          focus: settle(snapshot.blocks, snapshot.sel.focus),
        }
      : null;
    this.show(snapshot.blocks, sel);
    this.set({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
    this.tellText(before, snapshot.blocks);
    this.scheduleFlush();
  }

  /** The selection as it stands in the page right now, else as it last stood in the text. */
  private current(): Sel | null {
    const live = document.activeElement === this.view.root ? this.view.selection() : null;
    return live ?? this.state.sel;
  }

  /** `focus: false` while a field beside the text is typed in or dragged (a colour being mixed). */
  private run(
    change: (blocks: Blocks, sel: Sel) => Edit | Blocks | null,
    focus = true,
    trying?: string,
  ) {
    const sel = this.state.sel;
    if (!sel || !this.editable) return;
    const result = change(this.state.blocks, sel);
    if (focus) this.view.root.focus({ preventScroll: true });
    // Tried through in a field beside the text (`focus: false`): what it was before stays the
    // one step back, however many values were looked at.
    const trial = trying && !focus ? `${trying}:${JSON.stringify(sel)}` : '';
    if (result) this.commit(result, 'edit', trial);
    else if (this.state.sel) this.view.select(this.state.sel);
  }

  private ids(blocks: Blocks, sel: Sel) {
    return touched(blocks, sel).map((block) => block.id);
  }

  toggle(mark: ToggleMark) {
    const sel = this.state.sel;
    if (!sel || !this.editable) return;
    if (isCollapsed(sel)) {
      const block = paragraphOf(this.state.blocks, sel.focus.id);
      if (!block || block.locked) return;
      const marks = this.state.pending ?? marksAt(block, sel.focus.offset);
      const { [mark]: on, ...rest } = marks;
      this.set({ pending: on ? rest : { ...rest, [mark]: true } });
      this.focus();
      return;
    }
    this.run((blocks) => toggleMark(blocks, sel, mark));
  }

  color(color: string | null, focus = true) {
    const sel = this.state.sel;
    if (sel && isCollapsed(sel) && this.editable) {
      const block = paragraphOf(this.state.blocks, sel.focus.id);
      if (!block || block.locked) return;
      const { color: _color, ...rest } = this.state.pending ?? marksAt(block, sel.focus.offset);
      this.set({ pending: color ? { ...rest, color } : rest });
      if (focus) this.focus();
      return;
    }
    this.run((blocks, at) => setColor(blocks, at, color), focus);
  }

  /**
   * The selected words in a font (a family's name) – `null`: their paragraph's own. A caret: what
   * is typed next. `focus: false` while a field is tried through: all of it is one step back.
   */
  font(font: string | null, focus = true) {
    const sel = this.state.sel;
    if (sel && isCollapsed(sel) && this.editable) {
      const block = paragraphOf(this.state.blocks, sel.focus.id);
      if (!block || block.locked) return;
      const { font: _font, ...rest } = this.state.pending ?? marksAt(block, sel.focus.offset);
      this.set({ pending: font && font !== block.look.font ? { ...rest, font } : rest });
      if (focus) this.focus();
      return;
    }
    this.run((blocks, at) => setFont(blocks, at, font), focus, 'font');
  }

  /** The selected words in a size, in points – `null`: their paragraph's own. As `font`. */
  size(size: number | null, focus = true) {
    const sel = this.state.sel;
    if (sel && isCollapsed(sel) && this.editable) {
      const block = paragraphOf(this.state.blocks, sel.focus.id);
      if (!block || block.locked) return;
      const { size: _size, ...rest } = this.state.pending ?? marksAt(block, sel.focus.offset);
      const own = size !== null && Math.abs(size - block.look.size) > 0.01;
      this.set({ pending: own ? { ...rest, size } : rest });
      if (focus) this.focus();
      return;
    }
    this.run((blocks, at) => setSize(blocks, at, size), focus, 'size');
  }

  highlight(color: string | null, focus = true) {
    this.run((blocks, sel) => (isCollapsed(sel) ? null : setHighlight(blocks, sel, color)), focus);
  }

  /** The selected words, or the link the caret stands in, lead to `href` – or nowhere. */
  link(href: string | null) {
    this.run((blocks, sel) => {
      const at = isCollapsed(sel) ? linkAt(blocks, sel.focus)?.sel : sel;
      return at ? setLink(blocks, at, href) : null;
    });
  }

  format(format: WriterFormat) {
    this.run((blocks, sel) => setFormat(blocks, this.ids(blocks, sel), format, this.state.formats));
  }

  align(align: WriterAlign) {
    this.run((blocks, sel) => setAlign(blocks, this.ids(blocks, sel), align));
  }

  /** The selected paragraphs' own line spacing (1 = single), or `null`: as their format says. */
  lineHeight(value: number | null, focus = true) {
    this.run((blocks, sel) => setLineHeight(blocks, this.ids(blocks, sel), value), focus);
  }

  /**
   * The line spacing of the selected paragraphs: `own` what they say themselves (`null`: as the
   * format says), `mixed` that they differ, `shown` the spacing they stand in (`null`: several).
   */
  lineHeightNow(): { own: number | null; mixed: boolean; shown: number | null } {
    const { blocks, sel } = this.state;
    return lineHeightAt(blocks, sel ? this.ids(blocks, sel) : []);
  }

  /** What the selection looks like in full, `null` where its words differ. */
  lookOfSelection(): SelectionLook | null {
    const { blocks, sel, pending } = this.state;
    return sel ? lookAt(blocks, sel, pending) : null;
  }

  /**
   * A format's own look, for the whole document: one step back takes it away again, the others
   * in the document get it as it is sent.
   */
  restyle(format: WriterFormat, change: WriterFormatLook, focus = true) {
    if (!this.editable) return;
    const { blocks, formats, sel } = this.state;
    const next = setFormatLook(blocks, formats, format, change);
    if (next.formats !== formats) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
      this.lastTyping = { at: 0, id: '' };
      this.lastTrial = '';
      this.set({ formats: next.formats });
      this.show(next.blocks, sel);
      this.scheduleFlush();
    }
    if (focus) this.focus();
  }

  /**
   * „An Auswahl anpassen“: the format of the paragraph the selection stands in looks as the
   * selection does – what its words agree on, and the paragraph's own line spacing. What the
   * format now says itself is no word of the text's own any more.
   */
  restyleToSelection(focus = true) {
    const { blocks, sel, pending } = this.state;
    const block = sel && paragraphOf(blocks, sel.focus.id);
    if (!this.editable || !sel || !block) return;
    const format = writerFormatOf(block);
    const worn = lookAt(blocks, sel, pending);
    const change: WriterFormatLook = {
      ...(worn.font !== null && { font: worn.font }),
      ...(worn.size !== null && { size: worn.size }),
      ...(worn.bold !== null && { bold: worn.bold }),
      ...(worn.italic !== null && { italic: worn.italic }),
      ...(worn.color !== null && { color: worn.color }),
      ...(block.lineHeight && { lineHeight: block.lineHeight }),
    };
    const ids = this.ids(blocks, sel).filter((id) => {
      const each = paragraphOf(blocks, id);
      return each && writerFormatOf(each) === format;
    });
    const next = setFormatLook(
      block.lineHeight ? setLineHeight(blocks, ids, null) : blocks,
      this.state.formats,
      format,
      change,
    );
    if (next.formats !== this.state.formats) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
      this.lastTyping = { at: 0, id: '' };
      this.lastTrial = '';
      this.set({ formats: next.formats, pending: null });
      this.show(next.blocks, sel);
      this.scheduleFlush();
    }
    if (focus) this.focus();
  }

  list(kind: WriterList['kind']) {
    this.run((blocks, sel) => toggleList(blocks, this.ids(blocks, sel), kind));
  }

  indent(step: -1 | 1) {
    this.run((blocks, sel) => indent(blocks, this.ids(blocks, sel), step));
  }

  /** What follows the caret starts a new page. */
  pageBreak() {
    this.run((blocks, sel) => {
      const cut = splitParagraph(blocks, sel, this.state.formats);
      const id = cut.sel.focus.id;
      if (find(cut.blocks, id)?.cell) return null;
      return { blocks: setBreakBefore(cut.blocks, id, true), sel: cut.sel };
    });
  }

  /**
   * A blank page after page `index` (from 0), as a slide is put in between two: after the last
   * block that begins on it, what followed starting a page of its own. The caret on the new page.
   */
  addPage(index: number) {
    const root = this.view.root;
    if (!this.editable) return;
    const { blocks, metrics } = this.state;
    const origin = root.getBoundingClientRect().top;
    let after: string | null = null;
    for (const block of blocks) {
      const element = this.view.elementOf(block.id);
      if (!element) continue;
      const y = (element.getBoundingClientRect().top - origin) / this.zoom;
      if (pageAt(y, metrics) > index) break;
      after = block.id;
    }
    if (!after) return;
    root.focus({ preventScroll: true });
    this.commit(addPageAfter(blocks, after, this.state.formats));
    requestAnimationFrame(() => this.showPage(index + 1));
  }

  table(rows: number, columns: number) {
    this.run((blocks, sel) => insertTable(blocks, sel.focus.id, rows, columns, this.state.formats));
  }

  /**
   * The table the caret stands in, and the row; whether its cell reaches over others (`merged`),
   * and whether the selection runs over several cells (`several`).
   */
  cellAt(): {
    tableId: string;
    row: number;
    rows: number;
    columns: number;
    merged: boolean;
    several: boolean;
  } | null {
    const sel = this.state.sel;
    const cell = sel ? find(this.state.blocks, sel.focus.id)?.cell : undefined;
    if (!sel || !cell) return null;
    const own = cell.table.rows[cell.row]?.[cell.col];
    return {
      tableId: cell.table.id,
      row: cell.row,
      rows: cell.table.rows.length,
      columns: cell.table.columns.length,
      merged: (own?.colSpan ?? 1) > 1 || (own?.rowSpan ?? 1) > 1,
      several: !isCollapsed(sel) && (cellRange(this.state.blocks, sel)?.cells.length ?? 0) > 1,
    };
  }

  row(where: 'above' | 'below') {
    const at = this.cellAt();
    if (!at) return;
    this.run((blocks, sel) => {
      const cell = find(blocks, sel.focus.id)?.cell;
      // Below a cell that reaches down: below all of it.
      const down = cell?.table.rows[cell.row]?.[cell.col]?.rowSpan ?? 1;
      return insertRow(
        blocks,
        at.tableId,
        where === 'above' ? at.row - 1 : at.row + down - 1,
        this.state.formats,
      );
    });
  }

  removeRow() {
    const cell = this.cellAt();
    if (!cell) return;
    this.run((blocks) => this.without(removeRow(blocks, cell.tableId, cell.row), cell.tableId));
  }

  column(where: 'before' | 'after') {
    this.run((blocks, sel) => {
      const cell = find(blocks, sel.focus.id)?.cell;
      if (!cell) return null;
      const left = writerTableGrid(cell.table.rows).at[cell.row]?.[cell.col] ?? 0;
      // Right of a cell that reaches across: right of all of it.
      const right = left + (cell.table.rows[cell.row]?.[cell.col]?.colSpan ?? 1) - 1;
      const added = insertColumn(
        blocks,
        cell.table.id,
        where === 'before' ? left - 1 : right,
        this.state.formats,
        where === 'before' ? left : right,
        cell.row,
      );
      return added && (added.sel ? { blocks: added.blocks, sel: added.sel } : added.blocks);
    });
  }

  /** The column the caret stands in goes – the first of them, where its cell reaches across. */
  removeColumn() {
    this.run((blocks, sel) => {
      const cell = find(blocks, sel.focus.id)?.cell;
      if (!cell) return null;
      const grid = writerTableGrid(cell.table.rows);
      const left = grid.at[cell.row]?.[cell.col] ?? 0;
      const next = removeColumn(blocks, cell.table.id, left);
      if (paragraphOf(next, sel.focus.id)) return this.without(next, cell.table.id);
      // The caret's cell went: on in the cell that stands there now, or the one before it.
      const table = next.find((block) => block.id === cell.table.id);
      const now = table?.type === 'table' ? table : null;
      const owner = now
        ? (writerTableGrid(now.rows).owner[Math.min(cell.row, now.rows.length - 1)] ?? [])
        : [];
      const at = owner[Math.min(left, owner.length - 1)];
      const near = at ? now?.rows[at.row]?.[at.index]?.blocks[0] : undefined;
      return near ? { blocks: next, sel: caret(near.id, 0) } : this.without(next, cell.table.id);
    });
  }

  /** The cells the selection runs over become one. */
  mergeCells() {
    this.run((blocks, sel) => mergeCells(blocks, sel));
  }

  /** The merged cell the caret stands in is parted again. */
  splitCell() {
    this.run((blocks, sel) => splitCell(blocks, sel.focus.id, this.state.formats));
  }

  removeTable() {
    const cell = this.cellAt();
    if (!cell) return;
    this.run((blocks) =>
      this.without(removeBlock(blocks, cell.tableId, this.state.formats), cell.tableId),
    );
  }

  /** Blocks after something left them, the caret in what stands nearest. */
  private without(next: Blocks, goneId: string): Edit {
    const blocks = next.length === 0 ? removeBlock(next, '', this.state.formats) : next;
    const sel = this.state.sel;
    if (sel && paragraphOf(blocks, sel.focus.id)) return { blocks, sel: caret(sel.focus.id, 0) };
    const index = this.state.blocks.findIndex((block) => block.id === goneId);
    const list = entries(blocks);
    const near =
      list.find((entry) => entry.top >= index && !entry.block.locked) ??
      list.findLast((entry) => !entry.block.locked) ??
      list[0];
    return { blocks, sel: caret(near?.block.id ?? '', 0) };
  }

  /** In the line at the caret where words stand; in an empty paragraph (or with no caret) alone. */
  insertPicture(picture: WriterPicture) {
    const sel = this.state.sel;
    const after = sel?.focus.id ?? entries(this.state.blocks).at(-1)?.block.id;
    if (!after || !this.editable) return;
    const { blocks, formats } = this.state;
    this.commit(
      (sel && insertInlinePicture(blocks, sel.focus, picture, formats)) ??
        insertPicture(blocks, after, picture, formats),
    );
  }

  /** The room a picture has across the sheet, in points. */
  get contentWidthPt() {
    const { page } = this.state;
    return Math.max(72, page.width - page.marginLeft - page.marginRight);
  }

  setPage(page: WriterPage) {
    if (!this.editable || samePage(page, this.state.page)) return;
    this.undoStack.push(this.snapshot());
    this.redoStack = [];
    this.applyPage(page);
    this.set({ canUndo: true, canRedo: false });
    this.scheduleFlush();
  }

  private applyPage(page: WriterPage) {
    this.set({ page, metrics: metricsOf(page, this.state.printing ? 0 : PAGE_GAP) });
    this.placeRoot();
    this.layout();
  }

  /** One hit of the search swapped for `text`. */
  replace(hit: Hit, text: string) {
    if (!this.editable) return;
    const block = paragraphOf(this.state.blocks, hit.id);
    if (!block || block.locked) return;
    const marks = marksAt(block, hit.start + 1);
    this.commit(
      replaceRange(
        this.state.blocks,
        { id: hit.id, offset: hit.start },
        { id: hit.id, offset: hit.end },
        text === '' ? [] : [{ ...marks, text }],
        this.state.formats,
      ),
    );
  }

  /** Every hit swapped, as one step. How many there were. */
  replaceAll(query: string, text: string): number {
    if (!this.editable) return 0;
    const hits = findAll(this.state.blocks, query).filter(
      (hit) => !paragraphOf(this.state.blocks, hit.id)?.locked,
    );
    if (hits.length === 0) return 0;
    let blocks = this.state.blocks;
    // From the end, so each hit still stands where it was found.
    for (const hit of [...hits].reverse()) {
      const block = paragraphOf(blocks, hit.id);
      if (!block) continue;
      const marks = marksAt(block, hit.start + 1);
      blocks = replaceRange(
        blocks,
        { id: hit.id, offset: hit.start },
        { id: hit.id, offset: hit.end },
        text === '' ? [] : [{ ...marks, text }],
        this.state.formats,
      ).blocks;
    }
    const sel = this.state.sel;
    this.commit({
      blocks,
      sel: sel
        ? { anchor: settle(blocks, sel.focus), focus: settle(blocks, sel.focus) }
        : caret(hits[0]?.id ?? '', 0),
    });
    return hits.length;
  }

  /** Where in its paragraph the picked picture stands in the line; `null`: it stands alone. */
  private pickedOffset: number | null = null;
  private handles: HTMLDivElement | null = null;

  /** A picture picked: the paragraph of one standing alone, or the place of one in a line. */
  private pick(id: string | null, offset: number | null = null) {
    const at = id ? offset : null;
    if (this.state.picked === id && this.pickedOffset === at) return;
    this.pickedOffset = at;
    this.set({ picked: id });
    this.markPicked();
  }

  /** The picked picture as the text has it (its size, a photo's credit). */
  pickedPicture(): WriterPicture | null {
    const id = this.state.picked;
    const block = id ? paragraphOf(this.state.blocks, id) : undefined;
    if (!block) return null;
    return (
      (this.pickedOffset === null ? block.pictures?.[0] : pictureAt(block, this.pickedOffset)) ??
      null
    );
  }

  private pickedImage(): HTMLImageElement | null {
    const id = this.state.picked;
    return id ? this.view.pictureElement(id, this.pickedOffset) : null;
  }

  /** The picked picture wears its frame and its handles – drawn anew, it gets them again. */
  private markPicked() {
    const root = this.view.root;
    for (const marked of root.querySelectorAll<HTMLElement>('[data-picked]')) {
      delete marked.dataset.picked;
    }
    const image = this.pickedImage();
    if (this.state.picked && !image) {
      // It left the text, or other words stand at its place now.
      this.pickedOffset = null;
      this.set({ picked: null });
    }
    const marked = this.pickedOffset === null ? this.view.paragraphOf(image) : image;
    if (marked) marked.dataset.picked = '';
    this.placeHandles();
  }

  private placeHandles() {
    const handles = this.handles;
    const host = this.host?.getBoundingClientRect();
    const image = this.editable ? this.pickedImage()?.getBoundingClientRect() : undefined;
    if (!handles) return;
    if (!host || !image) {
      handles.hidden = true;
      return;
    }
    handles.hidden = false;
    handles.style.left = `${(image.left - host.left) / this.zoom}px`;
    handles.style.top = `${(image.top - host.top) / this.zoom}px`;
    handles.style.width = `${image.width / this.zoom}px`;
    handles.style.height = `${image.height / this.zoom}px`;
  }

  /** The picked picture let go: it stays; the caret stands behind one in a line. */
  leavePicked() {
    const id = this.state.picked;
    if (!id) return;
    const offset = this.pickedOffset;
    this.pick(null);
    this.view.root.focus({ preventScroll: true });
    if (offset !== null) this.select(caret(id, offset + 1), false);
  }

  /** Where the picked picture stands in the window. */
  pickedRect(): DOMRect | null {
    return this.pickedImage()?.getBoundingClientRect() ?? null;
  }

  /** Where the picked picture stands across the sheet. */
  pickedAlign(): WriterAlign | null {
    const id = this.state.picked;
    const block = id ? paragraphOf(this.state.blocks, id) : undefined;
    return block ? alignOf(block) : null;
  }

  alignPicked(align: WriterAlign) {
    const id = this.state.picked;
    if (!id || !this.editable) return;
    const next = alignPicture(this.state.blocks, id, this.pickedOffset, align);
    if (next.blocks === this.state.blocks) return;
    const sel = this.state.sel ?? caret('', 0);
    const moved = (point: Point) => (point.id === id ? { ...point, id: next.id } : point);
    // One standing alone is a new paragraph now: picked on as that one.
    if (next.id !== id) this.set({ picked: next.id });
    this.commit({
      blocks: next.blocks,
      sel: { anchor: moved(sel.anchor), focus: moved(sel.focus) },
    });
  }

  removePicked() {
    const id = this.state.picked;
    if (!id || !this.editable) return;
    const offset = this.pickedOffset;
    const entry = find(this.state.blocks, id);
    if (!entry) return;
    if (offset !== null) {
      this.pick(null);
      this.view.root.focus({ preventScroll: true });
      this.commit(
        replaceRange(
          this.state.blocks,
          { id, offset },
          { id, offset: offset + 1 },
          [],
          this.state.formats,
        ),
      );
      return;
    }
    if (entry.cell) return;
    this.pick(null);
    this.view.root.focus({ preventScroll: true });
    this.commit(this.without(removeBlock(this.state.blocks, id, this.state.formats), id));
  }

  // ── A picture's size ──────────────────────────────────────────────────────

  private resizing: {
    image: HTMLImageElement;
    x: number;
    /** Widths in points: as it was taken, as it is now, the most its line has room for. */
    from: number;
    now: number;
    max: number;
    /** A corner on the left grows it leftwards. */
    sign: -1 | 1;
  } | null = null;

  private onHandleDown = (event: PointerEvent) => {
    const corner = (event.target as HTMLElement).dataset.corner;
    const image = this.pickedImage();
    const handles = this.handles;
    if (!corner || !image || !handles || event.button !== 0 || !this.editable) return;
    // The caret stays where it is: the corner is taken, not a place in the text.
    event.preventDefault();
    event.stopPropagation();
    const paragraph = this.view.paragraphOf(image);
    const style = paragraph ? getComputedStyle(paragraph) : null;
    const room =
      paragraph && style
        ? (paragraph.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) *
          PT_PER_PX
        : this.contentWidthPt;
    const from = (image.getBoundingClientRect().width / this.zoom) * PT_PER_PX;
    this.resizing = {
      image,
      x: event.clientX,
      from,
      now: from,
      max: Math.max(MIN_PICTURE_PT, room),
      sign: corner.endsWith('w') ? -1 : 1,
    };
    handles.setPointerCapture(event.pointerId);
  };

  /** Widths in points a picture's size is caught at (the grid's columns, `Editor`). */
  private snapWidths: readonly number[] = [];

  /** The widths a picture dragged by its corner is caught at – ⌘ held drags freely. */
  setSnapWidths(widths: readonly number[]) {
    this.snapWidths = widths;
  }

  private onHandleMove = (event: PointerEvent) => {
    const drag = this.resizing;
    if (!drag) return;
    const by = ((event.clientX - drag.x) / this.zoom) * PT_PER_PX * drag.sign;
    let now = drag.from + by;
    if (!event.metaKey) {
      // Caught within 6 px on the screen, as a box at a slide's lines; the line's room too.
      const reach = (6 / this.zoom) * PT_PER_PX;
      const near = [...this.snapWidths, drag.max]
        .map((width) => ({ width, off: Math.abs(width - now) }))
        .filter(({ off }) => off <= reach)
        .sort((a, b) => a.off - b.off)[0];
      if (near) now = near.width;
    }
    drag.now = Math.min(drag.max, Math.max(MIN_PICTURE_PT, now));
    // Its height follows by itself: the picture keeps its shape.
    drag.image.style.width = `${drag.now.toFixed(2)}pt`;
    this.placeHandles();
  };

  private onHandleUp = (event: PointerEvent) => {
    const drag = this.resizing;
    const handles = this.handles;
    if (!drag) return;
    this.resizing = null;
    if (handles?.hasPointerCapture(event.pointerId)) handles.releasePointerCapture(event.pointerId);
    const id = this.state.picked;
    const block = id ? paragraphOf(this.state.blocks, id) : undefined;
    const picture =
      block &&
      (this.pickedOffset === null ? block.pictures?.[0] : pictureAt(block, this.pickedOffset));
    if (
      !id ||
      !picture ||
      event.type !== 'pointerup' ||
      !this.editable ||
      Math.abs(drag.now - drag.from) < 0.25
    ) {
      // Let go of where it was taken, nothing happened.
      this.view.redrawAll();
      this.render();
      return;
    }
    const width = Math.round(drag.now * 100) / 100;
    const height = Math.round(((width * picture.height) / picture.width) * 100) / 100;
    const next = resizePicture(this.state.blocks, id, this.pickedOffset, { width, height });
    const sel = this.state.sel ?? caret('', 0);
    const moved = (point: Point) => (point.id === id ? { ...point, id: next.id } : point);
    // One standing alone is a new paragraph now: picked on as that one.
    if (next.id !== id) this.set({ picked: next.id });
    this.commit({
      blocks: next.blocks,
      sel: { anchor: moved(sel.anchor), focus: moved(sel.focus) },
    });
  };

  // ── Keys ──────────────────────────────────────────────────────────────────

  private onBeforeInput = (event: InputEvent) => {
    if (!this.editable) {
      event.preventDefault();
      return;
    }
    const type = event.inputType;
    if (this.composing || type === 'insertCompositionText' || type === 'deleteCompositionText') {
      // A word made of several keys is the browser's until it is done (`compositionend`).
      return;
    }
    event.preventDefault();
    const { blocks, formats } = this.state;
    const sel = this.current();
    if (!sel) return;
    this.pick(null);

    if (type === 'historyUndo') return this.undo();
    if (type === 'historyRedo') return this.redo();
    if (type === 'formatBold') return this.toggle('bold');
    if (type === 'formatItalic') return this.toggle('italic');
    if (type === 'formatUnderline') return this.toggle('underline');
    if (type === 'formatStrikeThrough') return this.toggle('strike');

    if (type === 'insertParagraph') {
      this.commit(splitParagraph(blocks, sel, formats));
      return;
    }
    if (type === 'insertLineBreak') {
      this.commit(insertText(blocks, sel, '\n', formats, this.state.pending ?? undefined));
      return;
    }
    if (type.startsWith('delete')) {
      this.commit(this.deleted(type, sel, event), 'typing');
      return;
    }
    if (type === 'insertFromPaste' || type === 'insertFromDrop' || type === 'insertFromYank') {
      // Told by `paste` and `drop` themselves.
      return;
    }
    if (type.startsWith('insert')) {
      const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
      if (text === '') return;
      // A correction of the system names the word it swaps.
      const target = type === 'insertReplacementText' ? this.targetOf(event) : null;
      const at = target ?? sel;
      const lines = text.split(/\r\n?|\n/);
      if (lines.length > 1) {
        this.commit(insertParagraphs(blocks, at, this.plain(text, at), formats));
        return;
      }
      this.commit(insertText(blocks, at, text, formats, this.state.pending ?? undefined), 'typing');
    }
  };

  private targetOf(event: InputEvent): Sel | null {
    const range = event.getTargetRanges()[0];
    if (!range) return null;
    const anchor = this.view.pointAt(range.startContainer, range.startOffset);
    const focus = this.view.pointAt(range.endContainer, range.endOffset);
    return anchor && focus ? { anchor, focus } : null;
  }

  private deleted(type: string, sel: Sel, event: InputEvent): Edit {
    const { blocks, formats } = this.state;
    if (!isCollapsed(sel)) return deleteSelection(blocks, sel, formats);
    const block = paragraphOf(blocks, sel.focus.id);
    if (!block) return { blocks, sel };
    const backward = type.endsWith('Backward') || type === 'deleteContent';
    // At a paragraph's edge the text says what happens: out of a list, into the one before.
    if (backward && sel.focus.offset === 0) return joinBackward(blocks, block.id, formats);
    if (!backward && sel.focus.offset >= lengthOf(block)) {
      return joinForward(blocks, block.id, formats);
    }
    const target = this.targetOf(event);
    if (target && !isCollapsed(target) && target.anchor.id === target.focus.id) {
      return deleteSelection(blocks, target, formats);
    }
    // No word of the browser's on what goes: one character – a whole one, not half an emoji.
    const text = writerText(block);
    const offset = sel.focus.offset;
    let from = offset;
    let to = offset;
    if (backward) {
      from = offset - 1;
      const low = text.charCodeAt(from);
      if (low >= 0xdc00 && low <= 0xdfff && from > 0) from -= 1;
    } else {
      to = offset + 1;
      const high = text.charCodeAt(offset);
      if (high >= 0xd800 && high <= 0xdbff) to += 1;
    }
    return replaceRange(
      blocks,
      { id: block.id, offset: Math.max(0, from) },
      { id: block.id, offset: Math.min(text.length, to) },
      [],
      formats,
    );
  }

  /** Plain words as paragraphs that look as the place they come to. */
  private plain(text: string, sel: Sel): WriterParagraph[] {
    const { blocks, formats } = this.state;
    const { from } = ordered(blocks, sel);
    const block = paragraphOf(blocks, from.id);
    const { link: _link, ...here } =
      this.state.pending ?? (block ? marksAt(block, from.offset) : baseMarks(formats.text));
    const rest = block && block.kind === 'text' ? here : baseMarks(formats.text);
    return text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line, index) => ({
        kind: 'text' as const,
        ...(index > 0 && block?.list && { list: block.list }),
        runs: line === '' ? [] : [{ ...(index === 0 ? here : rest), text: line }],
      }));
  }

  private onCompositionStart = () => {
    if (!this.editable) return;
    const sel = this.current();
    // What is selected goes first, by the text's own rules; then the browser composes at a caret.
    if (sel && !isCollapsed(sel)) {
      this.commit(deleteSelection(this.state.blocks, sel, this.state.formats));
    }
    this.composing = true;
  };

  private onCompositionEnd = () => {
    if (!this.composing) return;
    this.composing = false;
    // After the browser's own last write.
    queueMicrotask(() => this.readBack());
  };

  /** The paragraph the browser wrote into itself, taken into the text. */
  private readBack() {
    const sel = this.view.selection() ?? this.state.sel;
    if (!sel) return;
    const block = paragraphOf(this.state.blocks, sel.focus.id);
    if (!block || block.locked) return;
    const runs = this.view.read(block);
    if (!runs) return;
    const pending = this.state.pending;
    const before = writerText(block);
    const after = runs.map((run) => run.text).join('');
    let next = runs;
    if (pending && after.length > before.length) {
      // What was composed wears the look picked for it.
      const end = sel.focus.offset;
      const start = Math.max(0, end - (after.length - before.length));
      next = [
        ...sliceRuns(runs, 0, start),
        { ...pending, text: after.slice(start, end) },
        ...sliceRuns(runs, end),
      ];
    }
    const blocks = withParagraph(this.state.blocks, block.id, (each) => ({ ...each, runs: next }));
    this.commit({ blocks, sel: caret(block.id, sel.focus.offset) }, 'typing');
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || this.composing) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    if (key === 'Escape') {
      if (this.state.picked) this.leavePicked();
      else this.view.root.blur();
      return;
    }
    if (!this.editable) return;
    if (this.state.picked && (key === 'Backspace' || key === 'Delete')) {
      event.preventDefault();
      this.removePicked();
      return;
    }
    // ⌥⌘0 … ⌥⌘6: text, heading 1 to 6 – by the key's place, ⌥ changes what it types.
    if (mod && event.altKey && !event.shiftKey && /^Digit[0-6]$/.test(event.code)) {
      event.preventDefault();
      const level = Number(event.code.slice(5));
      this.format(level === 0 ? 'text' : (`heading${level}` as WriterFormat));
      return;
    }
    if (mod && !event.altKey) {
      const lower = key.toLowerCase();
      const act = (job: () => void) => {
        event.preventDefault();
        job();
      };
      if (lower === 'z') return act(event.shiftKey ? this.redo : this.undo);
      if (lower === 'y' && !event.shiftKey) return act(this.redo);
      if (lower === 'b' && !event.shiftKey) return act(() => this.toggle('bold'));
      if (lower === 'i' && !event.shiftKey) return act(() => this.toggle('italic'));
      if (lower === 'u' && !event.shiftKey) return act(() => this.toggle('underline'));
      if (lower === 'x' && event.shiftKey) return act(() => this.toggle('strike'));
      if (event.shiftKey && (event.code === 'Digit8' || key === '8'))
        return act(() => this.list('bullet'));
      if (event.shiftKey && (event.code === 'Digit7' || key === '7'))
        return act(() => this.list('number'));
      if (key === 'Enter') return act(() => this.pageBreak());
      return;
    }
    if (key === 'Tab' && !event.altKey) {
      const sel = this.current();
      if (!sel) return;
      event.preventDefault();
      this.tab(sel, event.shiftKey ? -1 : 1);
    }
  };

  /** ⇥: a list point a level in, a table's next cell, else a tab stop's worth of room. */
  private tab(sel: Sel, step: -1 | 1) {
    const { blocks, formats } = this.state;
    const entry = find(blocks, sel.focus.id);
    if (!entry) return;
    if (entry.cell) {
      const cells = entries(blocks).filter(
        (each) => each.cell?.table.id === entry.cell?.table.id && each.cell?.index === 0,
      );
      const index = cells.findIndex(
        (each) => each.cell?.row === entry.cell?.row && each.cell?.col === entry.cell?.col,
      );
      const next = cells[index + step];
      if (next) {
        this.show(blocks, caret(next.block.id, step > 0 ? 0 : lengthOf(next.block)));
      } else if (step > 0) {
        const added = insertRow(
          blocks,
          entry.cell.table.id,
          entry.cell.table.rows.length - 1,
          formats,
        );
        if (added) this.commit(added);
      }
      return;
    }
    const ids = this.ids(blocks, sel);
    if (entry.block.list) {
      this.commit({ blocks: indent(blocks, ids, step), sel });
      return;
    }
    if (step > 0) this.commit(insertText(blocks, sel, '\t', formats), 'typing');
  }

  // ── Clipboard, pictures ───────────────────────────────────────────────────

  private copied(event: ClipboardEvent): boolean {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !event.clipboardData)
      return false;
    const holder = document.createElement('div');
    holder.append(selection.getRangeAt(0).cloneContents());
    for (const skipped of holder.querySelectorAll('[data-skip]')) skipped.remove();
    event.clipboardData.setData('text/html', holder.innerHTML);
    event.clipboardData.setData('text/plain', selection.toString());
    event.preventDefault();
    return true;
  }

  private onCopy = (event: ClipboardEvent) => {
    this.copied(event);
  };

  private onCut = (event: ClipboardEvent) => {
    if (!this.editable) return;
    const sel = this.current();
    if (!sel || !this.copied(event)) return;
    this.commit(deleteSelection(this.state.blocks, sel, this.state.formats));
  };

  private onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const data = event.clipboardData;
    const sel = this.current();
    if (!this.editable || !data || !sel) return;
    const pictures = [...data.files].filter(isPictureFile);
    if (pictures.length > 0) {
      this.handlers.onPictures(pictures);
      return;
    }
    const html = data.getData('text/html');
    const own = html.includes('data-m=');
    if (!html) {
      const text = data.getData('text/plain');
      if (text !== '') {
        this.commit(
          insertParagraphs(this.state.blocks, sel, this.plain(text, sel), this.state.formats),
        );
      }
      return;
    }
    let pasted = pastedParagraphs(data, this.options.pictureUrl);
    if (pasted.length === 0) return;
    const { blocks, formats } = this.state;
    if (!own) {
      // Another program's text: what its paragraphs are stays, and each looks as that says here.
      const { from } = ordered(blocks, sel);
      const block = paragraphOf(blocks, from.id);
      pasted = pasted.map((paragraph, index) => {
        const into = index === 0 && block && lengthOf(block) > 0 && pasted.length === 1;
        const base = into
          ? (({ link: _link, ...rest }) => rest)(marksAt(block, from.offset))
          : baseMarks(formats[writerFormatOf(paragraph)]);
        return { ...paragraph, runs: paragraph.runs.map((run) => ({ ...base, ...run })) };
      });
    }
    this.commit(insertParagraphs(blocks, sel, pasted, formats));
  };

  private onDragStart = (event: DragEvent) => event.preventDefault();

  private onDragOver = (event: DragEvent) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  };

  private onDrop = (event: DragEvent) => {
    event.preventDefault();
    if (!this.editable) return;
    const pictures = [...(event.dataTransfer?.files ?? [])].filter(isPictureFile);
    if (pictures.length === 0) return;
    event.stopPropagation();
    // Where it was let go of, not where the caret happened to stand.
    const at = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const point = at ? this.view.pointAt(at.startContainer, at.startOffset) : null;
    if (point) this.set({ sel: { anchor: point, focus: point } });
    this.handlers.onPictures(pictures);
  };

  private onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest<HTMLElement>('[data-link]')?.dataset.link;
    if (link && (!this.editable || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      window.open(link, '_blank', 'noopener,noreferrer');
      return;
    }
    if (target instanceof HTMLImageElement && this.editable) {
      const paragraph = this.view.paragraphOf(target);
      const block: WriterParagraphBlock | undefined = paragraph?.dataset.id
        ? paragraphOf(this.state.blocks, paragraph.dataset.id)
        : undefined;
      const alone = Boolean(block && isPicture(block));
      if (block && alone) {
        this.view.root.focus({ preventScroll: true });
        this.pick(block.id);
        return;
      }
      const at = this.view.offsetOf(target);
      if (at && block && !block.locked && pictureAt(block, at.offset)) {
        // One in a line: picked, and selected as the character it is – copied, cut, typed over.
        this.view.root.focus({ preventScroll: true });
        this.select({ anchor: at, focus: { id: at.id, offset: at.offset + 1 } }, false);
        this.pick(at.id, at.offset);
        return;
      }
    }
    this.pick(null);
  };

  // ── A table's columns ─────────────────────────────────────────────────────

  private border: {
    tableId: string;
    table: HTMLTableElement;
    /** The border between column `index` and the one after it. */
    index: number;
    x: number;
    from: readonly number[];
    now: number[];
  } | null = null;

  /** The border between two columns the pointer is on, if it is on one. */
  private borderAt(event: PointerEvent): { table: HTMLTableElement; index: number } | null {
    if (!this.editable || !(event.target instanceof Element)) return null;
    const cell = event.target.closest('td');
    const table = cell?.closest<HTMLTableElement>('table.writer-table');
    const line = cell?.parentElement;
    if (!cell || !table || !line || line.dataset.skip !== undefined) return null;
    const block = this.state.blocks.find((each) => each.id === table.dataset.id);
    if (block?.type !== 'table') return null;
    const rect = cell.getBoundingClientRect();
    const side =
      Math.abs(event.clientX - rect.right) <= BORDER_GRAB
        ? 'right'
        : Math.abs(event.clientX - rect.left) <= BORDER_GRAB
          ? 'left'
          : null;
    if (!side) return null;
    const lines = [...(table.tBodies[0]?.rows ?? [])].filter((each) => !each.dataset.skip);
    const row = lines.indexOf(line as HTMLTableRowElement);
    const column = writerTableGrid(block.rows).at[row]?.[cell.cellIndex];
    if (column === undefined) return null;
    const index = side === 'right' ? column + cell.colSpan - 1 : column - 1;
    return index >= 0 && index < block.columns.length - 1 ? { table, index } : null;
  }

  private onBorderDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.composing) return;
    const at = this.borderAt(event);
    const block = at ? this.state.blocks.find((each) => each.id === at.table.dataset.id) : null;
    if (!at || block?.type !== 'table') return;
    // The caret stays where it is: the border is taken, not a place in the text.
    event.preventDefault();
    this.border = {
      tableId: block.id,
      table: at.table,
      index: at.index,
      x: event.clientX,
      from: block.columns,
      now: [...block.columns],
    };
    this.view.root.dataset.border = 'drag';
    this.view.root.setPointerCapture(event.pointerId);
  };

  private onBorderMove = (event: PointerEvent) => {
    const drag = this.border;
    const root = this.view.root;
    if (!drag) {
      if (event.buttons === 0 && this.borderAt(event)) root.dataset.border = '';
      else delete root.dataset.border;
      return;
    }
    const width = drag.table.getBoundingClientRect().width;
    const left = drag.from[drag.index] ?? 0;
    const right = drag.from[drag.index + 1] ?? 0;
    // Both keep room to stand in – or what little they had.
    const least = Math.min(MIN_COLUMN_SHARE, left, right);
    const by = Math.max(
      least - left,
      Math.min(right - least, width > 0 ? (event.clientX - drag.x) / width : 0),
    );
    drag.now = drag.from.map((share, index) =>
      index === drag.index ? share + by : index === drag.index + 1 ? share - by : share,
    );
    const columns = drag.table.querySelectorAll<HTMLElement>(':scope > colgroup > col');
    drag.now.forEach((share, index) => {
      const column = columns[index];
      if (column) column.style.width = `${(share * 100).toFixed(3)}%`;
    });
  };

  private onBorderUp = (event: PointerEvent) => {
    const drag = this.border;
    if (!drag) return;
    this.border = null;
    const root = this.view.root;
    delete root.dataset.border;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    const next =
      event.type === 'pointerup' && this.editable
        ? setColumns(this.state.blocks, drag.tableId, drag.now)
        : this.state.blocks;
    // One step, however far it was dragged; let go of where it was taken, nothing happened.
    if (next !== this.state.blocks) {
      this.commit({ blocks: next, sel: this.state.sel ?? caret('', 0) });
    } else this.render();
  };

  private onBorderLeave = () => {
    if (!this.border) delete this.view.root.dataset.border;
  };

  /** A picture that arrived has its height: the pages follow. */
  private onPictureLoad = () => this.layout();

  // ── What the page tells ───────────────────────────────────────────────────

  private onSelectionChange = () => {
    if (this.composing) return;
    const selection = document.getSelection();
    if (
      !selection ||
      selection.rangeCount === 0 ||
      !this.view.root.contains(selection.anchorNode)
    ) {
      // Read only, the selection is all that marks a place: gone from the text, gone here.
      if (!this.editable && this.state.sel) this.set({ sel: null });
      return;
    }
    const sel = this.view.selection();
    if (!sel) return;
    const was = this.state.sel;
    if (
      was &&
      was.anchor.id === sel.anchor.id &&
      was.anchor.offset === sel.anchor.offset &&
      was.focus.id === sel.focus.id &&
      was.focus.offset === sel.focus.offset
    )
      return;
    this.set({ sel, pending: null, typing: isCollapsed(sel) ? this.state.typing : false });
    // The caret went on: a picture in a line is picked only while it is what is selected.
    const offset = this.pickedOffset;
    if (offset !== null) {
      const { from, to } = ordered(this.state.blocks, sel);
      const id = this.state.picked;
      if (from.id !== id || to.id !== id || from.offset !== offset || to.offset !== offset + 1) {
        this.pick(null);
      }
    }
  };

  private onFocus = () => this.set({ focused: true });
  private onBlur = () => this.set({ focused: false, typing: false });
  private onPointerMove = () => {
    if (this.state.typing) this.set({ typing: false });
  };
  private onVisibility = () => {
    if (document.visibilityState === 'hidden') this.flush();
    else this.kick();
  };
  private onFonts = () => {
    if (this.composing) return;
    forgetLineRatios();
    this.view.redrawAll();
    const sel = document.activeElement === this.view.root ? this.state.sel : null;
    this.render();
    if (sel) this.view.select(sel);
  };

  private onBeforePrint = () => {
    this.set({ printing: true, metrics: metricsOf(this.state.page, 0) });
    this.zoomBeforePrint = this.zoom;
    this.zoom = 1;
    this.layout();
  };
  private onAfterPrint = () => {
    this.set({ printing: false, metrics: metricsOf(this.state.page) });
    this.zoom = this.zoomBeforePrint;
    // The sheets are drawn at their size again first.
    requestAnimationFrame(this.layout);
  };
  private zoomBeforePrint = 1;

  // ── To the server ─────────────────────────────────────────────────────────

  private syncNow(): WriterSync {
    if (this.unreachable) return this.unreachable;
    const settled =
      this.queue.length === 0 &&
      this.sentBlocks === this.state.blocks &&
      this.sentFormats === this.state.formats &&
      samePage(this.sentPage, this.state.page);
    return settled ? 'saved' : 'saving';
  }

  private scheduleFlush() {
    window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => this.flush(), SEND_AFTER_MS);
    this.set({ sync: this.syncNow() });
  }

  /** What changed since the last sending, queued and on its way. */
  flush() {
    window.clearTimeout(this.flushTimer);
    const { blocks, page, formats } = this.state;
    // A format first: the paragraphs that follow are written into it as it is now.
    const operations = [
      ...formatSteps(this.sentFormats, formats),
      ...stepsBetween(this.sentBlocks, blocks),
    ];
    if (!samePage(this.sentPage, page)) operations.push({ type: 'setPage', page });
    this.sentBlocks = blocks;
    this.sentPage = page;
    this.sentFormats = formats;
    for (const chunk of inRequests(operations)) {
      this.queue.push({ id: crypto.randomUUID(), operations: chunk, tries: 0 });
    }
    void this.pump();
  }

  private kick = () => {
    if (this.queue.length === 0 || this.sending) return;
    window.clearTimeout(this.retryTimer);
    void this.pump();
  };

  private async pump() {
    if (this.sending) return;
    this.sending = true;
    let diverged = false;
    while (this.queue.length > 0) {
      const entry = this.queue[0];
      if (!entry) break;
      entry.tries += 1;
      this.mine.add(entry.id);
      try {
        const result = await this.options.send({
          operations: entry.operations,
          baseSeq: this.seq,
          clientEditId: entry.id,
        });
        this.seq = Math.max(this.seq, result.seq);
        this.queue.shift();
        this.unreachable = null;
        if (result.dropped.length > 0) diverged = true;
      } catch (error) {
        const outcome = sendOutcome(error, entry.tries);
        if (outcome === 'refused') {
          this.queue.shift();
          diverged = true;
          this.handlers.onRefused(error instanceof Error ? error.message : 'Nicht gespeichert');
          continue;
        }
        this.sending = false;
        this.unreachable = outcome === 'signedOut' ? 'signedOut' : 'offline';
        this.set({ sync: this.syncNow() });
        if (outcome !== 'signedOut' && !this.gone) {
          this.retryTimer = window.setTimeout(() => void this.pump(), retryDelay(entry.tries));
        }
        return;
      }
    }
    this.sending = false;
    this.set({ sync: this.syncNow() });
    if (diverged && !this.gone) void this.resync();
  }

  // ── From the server ───────────────────────────────────────────────────────

  /** Someone else's step, done here as the server did it to the file. */
  applyRemote(step: WriterStep) {
    if (step.clientEditId && this.mine.has(step.clientEditId)) {
      this.seq = Math.max(this.seq, step.seq);
      return;
    }
    if (step.seq <= this.seq && step.clientEditId === null) return;
    this.seq = Math.max(this.seq, step.seq);
    const { formats } = this.state;
    // What is typed here and not sent yet is newer than the step, and so is what is on its way.
    const onItsWay = new Set<string>();
    for (const entry of this.queue) {
      for (const op of entry.operations) if (op.type === 'setParagraph') onItsWay.add(op.id);
    }
    const unsent = new Set(onItsWay);
    for (const op of stepsBetween(this.sentBlocks, this.state.blocks)) {
      if (op.type === 'setParagraph') unsent.add(op.id);
    }
    const settledFormats = this.sentFormats === formats;
    const sent = applySteps(this.sentBlocks, step.operations, this.sentFormats, (id) =>
      onItsWay.has(id),
    );
    const here = applySteps(this.state.blocks, step.operations, formats, (id) => unsent.has(id));
    // What can be undone is the others' text as it is now, too – and their formats.
    const through = (snapshot: Snapshot): Snapshot => {
      const then = applySteps(snapshot.blocks, step.operations, snapshot.formats);
      return {
        ...snapshot,
        blocks: then.blocks,
        formats: snapshot.formats === formats ? here.formats : then.formats,
        page: here.page ?? snapshot.page,
      };
    };
    this.undoStack = this.undoStack.map(through);
    this.redoStack = this.redoStack.map(through);
    const untouched = this.sentBlocks === this.state.blocks;
    this.sentBlocks = untouched ? here.blocks : sent.blocks;
    this.sentFormats = settledFormats ? here.formats : sent.formats;
    if (here.formats !== formats) this.set({ formats: here.formats });
    if (here.page) {
      this.sentPage = here.page;
      this.applyPage(here.page);
    }
    this.take(here.blocks);
  }

  /** Blocks that came from the server, the selection kept where its paragraphs still are. */
  private take(blocks: Blocks) {
    if (this.composing) {
      // Not under a word being composed: once it is done, the text is read back and drawn.
      this.set({ blocks });
      return;
    }
    const before = this.state.blocks;
    const sel = this.state.sel;
    const settled = sel
      ? { anchor: settle(blocks, sel.anchor), focus: settle(blocks, sel.focus) }
      : null;
    if (this.state.picked && !paragraphOf(blocks, this.state.picked)) this.pick(null);
    const focused = document.activeElement === this.view.root;
    this.set({ blocks, sel: settled });
    if (blocks !== before) this.render();
    if (settled && focused) this.view.select(settled);
    this.tellText(before, blocks);
    this.set({ sync: this.syncNow() });
  }

  /** Locks the block or unlocks it („Ebenen“, ⇧⌘L): locked, nothing types in, moves or deletes it. */
  setProtect(id: string, protect: boolean) {
    if (!this.editable) return;
    this.commit(protectBlock(this.state.blocks, id, protect));
  }

  /** Where a caret at `point` stands, in the sheets' own px at 100 % (someone else's caret). */
  caretOf(point: Point): { left: number; top: number; height: number } | null {
    const range = this.view.rangeOf(point, point);
    const host = this.host?.getBoundingClientRect();
    if (!range || !host) return null;
    let rect: DOMRect | undefined = range.getClientRects()[0];
    // An empty line has no box of its own: its paragraph's start.
    if (!rect || rect.height < 0.5) rect = this.view.elementOf(point.id)?.getBoundingClientRect();
    if (!rect) return null;
    const line = Math.min(rect.height, 40);
    return {
      left: (rect.left - host.left) / this.zoom,
      top: (rect.top - host.top) / this.zoom,
      height: line / this.zoom,
    };
  }

  /** The text let go of, as Esc does: the format bar steps aside for a panel opened over it. */
  blur() {
    this.view.root.blur();
  }

  /**
   * An earlier version was brought back: the document is read anew and nothing before it can be
   * undone any more – the versions are the way back.
   */
  async restored() {
    this.undoStack = [];
    this.redoStack = [];
    this.set({ canUndo: false, canRedo: false });
    await this.resync();
  }

  /** The document read anew (the line came back, a step did not fit): what is unsent stays. */
  async resync() {
    let content: WriterContent;
    try {
      content = await this.options.refetch();
    } catch {
      return;
    }
    if (this.gone) return;
    const local = [
      ...formatSteps(this.sentFormats, this.state.formats),
      ...stepsBetween(this.sentBlocks, this.state.blocks),
    ];
    const read = content.formats as Formats;
    this.seq = Math.max(this.seq, content.seq);
    this.sentBlocks = content.blocks;
    const pageUnsent = !samePage(this.sentPage, this.state.page);
    this.sentPage = content.page;
    this.sentFormats = read;
    if (!pageUnsent && !samePage(content.page, this.state.page)) this.applyPage(content.page);
    const mine =
      local.length === 0
        ? { blocks: content.blocks, formats: read }
        : applySteps(content.blocks, local, read);
    this.set({ formats: mine.formats });
    this.take(mine.blocks);
    if (local.length > 0 || pageUnsent) this.scheduleFlush();
  }
}
