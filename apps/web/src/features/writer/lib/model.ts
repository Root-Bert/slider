import {
  MAX_LIST_LEVEL,
  WRITER_PICTURE_CHAR,
  MAX_TABLE_GRID_COLUMNS,
  MAX_WRITER_OPERATIONS,
  writerFormatOf,
  writerTableGrid,
  writerText,
  type WriterAlign,
  type WriterBlock,
  type WriterFormat,
  type WriterFormatLook,
  WRITER_FORMAT_LOOK_KEYS,
  WRITER_FORMATS,
  type WriterList,
  type WriterLook,
  type WriterOperation,
  type WriterPage,
  type WriterParagraph,
  type WriterParagraphBlock,
  type WriterPicture,
  type WriterRun,
  type WriterTableBlock,
  type WriterTableCell,
} from '@slider/shared';

/*
 * The document as the editor holds it: the blocks the server read from the file, never changed
 * in place – every edit answers a new list that shares what it left alone. What goes to the
 * server is told by comparing two such lists (`stepsBetween`), so undo is nothing but an older
 * list, and typing is sent as the paragraphs it left behind.
 */

export type Blocks = readonly WriterBlock[];
export type Formats = Record<WriterFormat, WriterLook>;
export type Marks = Omit<WriterRun, 'text'>;

/** A place in the text: a paragraph and how many characters into it. */
export interface Point {
  id: string;
  offset: number;
}
/** From where the selection was started to where it ends; equal: the caret. */
export interface Sel {
  anchor: Point;
  focus: Point;
}
export interface Edit {
  blocks: Blocks;
  sel: Sel;
}

export const caret = (id: string, offset: number): Sel => ({
  anchor: { id, offset },
  focus: { id, offset },
});
export const isCollapsed = (sel: Sel) =>
  sel.anchor.id === sel.focus.id && sel.anchor.offset === sel.focus.offset;

/** An id the file takes (`xml:id`): made here, so a paragraph is the same one on both sides. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `p${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('')}`.slice(
    0,
    14,
  );
}

// ── Reading order ───────────────────────────────────────────────────────────

/** Where a paragraph stands: in the text itself, or in a table's cell. */
export interface Entry {
  block: WriterParagraphBlock;
  /** Index of its block (or its table) in the text. */
  top: number;
  cell?: { table: WriterTableBlock; row: number; col: number; index: number };
}

/** Every paragraph in reading order, the cells' among them. */
export function entries(blocks: Blocks): Entry[] {
  const list: Entry[] = [];
  blocks.forEach((block, top) => {
    if (block.type === 'paragraph') list.push({ block, top });
    else
      block.rows.forEach((row, rowIndex) =>
        row.forEach((cell, col) =>
          cell.blocks.forEach((each, index) =>
            list.push({ block: each, top, cell: { table: block, row: rowIndex, col, index } }),
          ),
        ),
      );
  });
  return list;
}

/** What two paragraphs share when one may run into the other: the text, or one cell. */
const containerOf = (entry: Entry) =>
  entry.cell ? `${entry.cell.table.id}:${entry.cell.row}:${entry.cell.col}` : '';

export const find = (blocks: Blocks, id: string): Entry | undefined =>
  entries(blocks).find((entry) => entry.block.id === id);

export const paragraphOf = (blocks: Blocks, id: string) => find(blocks, id)?.block;

export const lengthOf = (block: WriterParagraphBlock) =>
  block.runs.reduce((sum, run) => sum + run.text.length, 0);

/** Start and end of a selection in reading order. */
export function ordered(blocks: Blocks, sel: Sel): { from: Point; to: Point } {
  if (sel.anchor.id === sel.focus.id) {
    return sel.anchor.offset <= sel.focus.offset
      ? { from: sel.anchor, to: sel.focus }
      : { from: sel.focus, to: sel.anchor };
  }
  for (const entry of entries(blocks)) {
    if (entry.block.id === sel.anchor.id) return { from: sel.anchor, to: sel.focus };
    if (entry.block.id === sel.focus.id) return { from: sel.focus, to: sel.anchor };
  }
  return { from: sel.anchor, to: sel.focus };
}

/** The paragraphs a selection touches, in reading order. */
export function touched(blocks: Blocks, sel: Sel): WriterParagraphBlock[] {
  const { from, to } = ordered(blocks, sel);
  const list = entries(blocks);
  const start = list.findIndex((entry) => entry.block.id === from.id);
  const end = list.findIndex((entry) => entry.block.id === to.id);
  if (start < 0 || end < 0) return [];
  return list.slice(start, end + 1).map((entry) => entry.block);
}

// ── Runs ────────────────────────────────────────────────────────────────────

const MARK_KEYS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'highlight',
  'link',
  'font',
  'size',
  'style',
] as const satisfies readonly (keyof Marks)[];

export const marksOf = ({ text: _text, ...marks }: WriterRun): Marks => marks;

const samePicture = (a: WriterPicture | undefined, b: WriterPicture | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.path === b.path &&
    a.width === b.width &&
    a.height === b.height);

export function sameMarks(a: Marks, b: Marks): boolean {
  return (
    MARK_KEYS.every((key) => (a[key] || undefined) === (b[key] || undefined)) &&
    samePicture(a.picture, b.picture)
  );
}

/** Without what says nothing (`bold: false`), so equal looks are equal objects' worth. */
function tidy(marks: Marks): Marks {
  const out: Record<string, unknown> = {};
  for (const key of MARK_KEYS) if (marks[key]) out[key] = marks[key];
  if (marks.picture) out.picture = marks.picture;
  return out as Marks;
}

/** Neighbours of one look become one stretch; nothing of no text stays. A picture stays one of its own. */
export function normalize(runs: readonly WriterRun[]): WriterRun[] {
  const out: WriterRun[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const last = out.at(-1);
    if (last && !last.picture && !run.picture && sameMarks(last, run)) last.text += run.text;
    else out.push({ ...tidy(marksOf(run)), text: run.text });
  }
  return out;
}

export function sliceRuns(runs: readonly WriterRun[], start: number, end = Infinity): WriterRun[] {
  const out: WriterRun[] = [];
  let at = 0;
  for (const run of runs) {
    const next = at + run.text.length;
    if (next > start && at < end) {
      out.push({ ...run, text: run.text.slice(Math.max(0, start - at), end - at) });
    }
    at = next;
    if (at >= end) break;
  }
  return out;
}

/** The look a paragraph's format gives text that says nothing else: marks state what is. */
export const baseMarks = (look: WriterLook): Marks => ({
  ...(look.bold && { bold: true }),
  ...(look.italic && { italic: true }),
});

/**
 * How what is typed at `offset` looks: as the character before it (the one after it at the
 * start). At a link's end the link is over – its colour and line with it. A picture in the line
 * says nothing of it: the words around it do.
 */
export function marksAt(block: WriterParagraphBlock, offset: number): Marks {
  if (block.runs.some((run) => run.picture)) {
    // The words alone, the place counted in them.
    let before = 0;
    let at = 0;
    for (const run of block.runs) {
      const length = Math.max(0, Math.min(run.text.length, offset - at));
      if (!run.picture) before += length;
      at += run.text.length;
    }
    return marksAt({ ...block, runs: block.runs.filter((run) => !run.picture) }, before);
  }
  let at = 0;
  for (let index = 0; index < block.runs.length; index += 1) {
    const run = block.runs[index];
    if (!run) continue;
    const next = at + run.text.length;
    if (offset > at && offset <= next) {
      const marks = marksOf(run);
      const following = block.runs[index + 1];
      if (marks.link && offset === next && following?.link !== marks.link) {
        const { link: _link, underline: _underline, color: _color, style: _style, ...rest } = marks;
        return rest;
      }
      return marks;
    }
    at = next;
  }
  const first = block.runs[0];
  if (first) {
    const { link: _link, ...rest } = marksOf(first);
    return first.link ? { ...baseMarks(block.look) } : rest;
  }
  return baseMarks(block.look);
}

// ── Changing blocks ─────────────────────────────────────────────────────────

/** A paragraph swapped for what `change` makes of it, wherever it stands. */
export function withParagraph(
  blocks: Blocks,
  id: string,
  change: (block: WriterParagraphBlock) => WriterParagraphBlock,
): Blocks {
  return blocks.map((block) => {
    if (block.type === 'paragraph') return block.id === id ? change(block) : block;
    if (!block.rows.some((row) => row.some((cell) => cell.blocks.some((each) => each.id === id))))
      return block;
    return {
      ...block,
      rows: block.rows.map((row) =>
        row.map((cell) =>
          cell.blocks.some((each) => each.id === id)
            ? { ...cell, blocks: cell.blocks.map((each) => (each.id === id ? change(each) : each)) }
            : cell,
        ),
      ),
    };
  });
}

/** The list a paragraph lies in – the text's or its cell's – swapped for what `change` makes. */
function withContainer(
  blocks: Blocks,
  entry: Entry,
  change: (list: readonly WriterBlock[]) => readonly WriterBlock[],
): Blocks {
  const cell = entry.cell;
  if (!cell) return change(blocks);
  return blocks.map((block) =>
    block.type === 'table' && block.id === cell.table.id
      ? {
          ...block,
          rows: block.rows.map((row, rowIndex) =>
            rowIndex !== cell.row
              ? row
              : row.map((each, col) =>
                  col !== cell.col
                    ? each
                    : { ...each, blocks: change(each.blocks) as WriterParagraphBlock[] },
                ),
          ),
        }
      : block,
  );
}

export const emptyParagraph = (formats: Formats, id = newId()): WriterParagraphBlock => ({
  type: 'paragraph',
  id,
  kind: 'text',
  runs: [],
  look: formats.text,
});

/** A picture standing alone: the one locked paragraph the editor can take out and put back. */
export const isPicture = (block: WriterBlock): block is WriterParagraphBlock =>
  block.type === 'paragraph' &&
  block.locked === true &&
  block.pictures?.length === 1 &&
  lengthOf(block) === 0;

/** Whether the editor writes this paragraph's text. */
export const isTypable = (block: WriterBlock): block is WriterParagraphBlock =>
  block.type === 'paragraph' && !block.locked;

/**
 * The stretch from `from` to `to` (in reading order) swapped for `insert`. Within the text or
 * one cell the paragraphs between go and the two ends become one; across cells only the words
 * go and every cell stays. What the editor does not write stays where it is.
 */
export function replaceRange(
  blocks: Blocks,
  from: Point,
  to: Point,
  insert: readonly WriterRun[],
  formats: Formats,
): Edit {
  const list = entries(blocks);
  const a = list.findIndex((entry) => entry.block.id === from.id);
  const b = list.findIndex((entry) => entry.block.id === to.id);
  const first = list[a];
  const last = list[b];
  if (!first || !last || b < a) return { blocks, sel: caret(from.id, from.offset) };
  const added = insert.reduce((sum, run) => sum + run.text.length, 0);

  if (a === b) {
    if (first.block.locked) return { blocks, sel: caret(from.id, from.offset) };
    const next = withParagraph(blocks, from.id, (block) => ({
      ...block,
      runs: normalize([
        ...sliceRuns(block.runs, 0, from.offset),
        ...insert,
        ...sliceRuns(block.runs, to.offset),
      ]),
    }));
    return { blocks: next, sel: caret(from.id, from.offset + added) };
  }

  if (containerOf(first) !== containerOf(last)) {
    // Across cells: the words go, the cells and their paragraphs stay.
    let next = blocks;
    for (let index = a; index <= b; index += 1) {
      const entry = list[index];
      if (!entry || entry.block.locked) continue;
      const start = index === a ? from.offset : 0;
      const end = index === b ? to.offset : Infinity;
      next = withParagraph(next, entry.block.id, (block) => ({
        ...block,
        runs: normalize([
          ...sliceRuns(block.runs, 0, start),
          ...(index === a ? insert : []),
          ...sliceRuns(block.runs, end),
        ]),
      }));
    }
    return {
      blocks: next,
      sel: caret(from.id, first.block.locked ? from.offset : from.offset + added),
    };
  }

  let at: Point = { id: from.id, offset: from.offset + added };
  const next = withContainer(blocks, first, (container) => {
    const start = container.findIndex((block) => block.id === from.id);
    const end = container.findIndex((block) => block.id === to.id);
    const head = container[start] as WriterParagraphBlock;
    const tail = container[end] as WriterParagraphBlock;
    const between = container.slice(start + 1, end).filter(
      // A table or a picture goes with the stretch; what the editor cannot write back stays.
      (block) => block.type === 'paragraph' && block.locked && !isPicture(block),
    );
    const headGoes = isPicture(head) && from.offset === 0;
    const tailGoes = isPicture(tail) && to.offset >= lengthOf(tail);
    const out: WriterBlock[] = container.slice(0, start);
    if (!head.locked && !tail.locked && between.length === 0) {
      out.push({
        ...head,
        runs: normalize([
          ...sliceRuns(head.runs, 0, from.offset),
          ...insert,
          ...sliceRuns(tail.runs, to.offset),
        ]),
      });
    } else {
      if (!head.locked) {
        out.push({
          ...head,
          runs: normalize([...sliceRuns(head.runs, 0, from.offset), ...insert]),
        });
      } else if (!headGoes) out.push(head);
      out.push(...between);
      if (!tail.locked) {
        const runs = normalize([
          ...(head.locked ? insert : []),
          ...sliceRuns(tail.runs, to.offset),
        ]);
        out.push({ ...tail, runs });
        if (head.locked) at = { id: tail.id, offset: added };
      } else if (!tailGoes) out.push(tail);
    }
    out.push(...container.slice(end + 1));
    if (out.length === 0) {
      const blank = emptyParagraph(formats);
      at = { id: blank.id, offset: 0 };
      out.push(blank);
    } else if (!out.some((block) => block.id === at.id)) {
      const near = out[Math.min(start, out.length - 1)];
      if (near?.type === 'paragraph') at = { id: near.id, offset: 0 };
    }
    return out;
  });
  return { blocks: next, sel: caret(at.id, at.offset) };
}

/** What is selected, gone. */
export function deleteSelection(blocks: Blocks, sel: Sel, formats: Formats): Edit {
  if (isCollapsed(sel)) return { blocks, sel };
  const { from, to } = ordered(blocks, sel);
  return replaceRange(blocks, from, to, [], formats);
}

/** Text typed or pasted over the selection, looking as `marks` say (else as its place does). */
export function insertText(
  blocks: Blocks,
  sel: Sel,
  text: string,
  formats: Formats,
  marks?: Marks,
): Edit {
  const { from, to } = ordered(blocks, sel);
  const block = paragraphOf(blocks, from.id);
  if (!block || block.locked) return { blocks, sel };
  const look = marks ?? marksAt(block, from.offset);
  return replaceRange(blocks, from, to, text === '' ? [] : [{ ...look, text }], formats);
}

/**
 * ↵: the paragraph parts at the caret. After a heading comes text; an empty point of a list
 * steps out of it; at a paragraph's start a new one opens above it, so the paragraph (and the
 * comments at its words) stays the one it was.
 */
export function splitParagraph(blocks: Blocks, sel: Sel, formats: Formats): Edit {
  const cut = isCollapsed(sel) ? { blocks, sel } : deleteSelection(blocks, sel, formats);
  const point = cut.sel.focus;
  const entry = find(cut.blocks, point.id);
  if (!entry || entry.block.locked) return cut;
  const block = entry.block;
  const length = lengthOf(block);

  if (block.list && length === 0) {
    const list: WriterList | undefined =
      block.list.level > 0 ? { ...block.list, level: block.list.level - 1 } : undefined;
    return {
      blocks: withParagraph(cut.blocks, block.id, ({ list: _list, ...rest }) =>
        list ? { ...rest, list } : rest,
      ),
      sel: cut.sel,
    };
  }

  const { breakBefore: _break, ...shape } = block;
  const id = newId();
  if (point.offset === 0 && length > 0) {
    const above: WriterParagraphBlock = { ...shape, id, runs: [] };
    return {
      blocks: withContainer(cut.blocks, entry, (container) =>
        container.flatMap((each) => (each.id === block.id ? [above, each] : [each])),
      ),
      sel: caret(block.id, 0),
    };
  }
  const afterHeading =
    point.offset >= length && (block.kind === 'heading' || block.kind === 'title');
  const below: WriterParagraphBlock = afterHeading
    ? { ...emptyParagraph(formats, id), ...(block.list && { list: block.list }) }
    : { ...shape, id, runs: normalize(sliceRuns(block.runs, point.offset)) };
  return {
    blocks: withContainer(cut.blocks, entry, (container) =>
      container.flatMap((each) =>
        each.id === block.id
          ? [{ ...block, runs: normalize(sliceRuns(block.runs, 0, point.offset)) }, below]
          : [each],
      ),
    ),
    sel: caret(id, 0),
  };
}

/** The paragraph before `id` in its text or cell, if it is one. */
function neighbour(blocks: Blocks, id: string, step: -1 | 1) {
  const entry = find(blocks, id);
  if (!entry) return undefined;
  const container = entry.cell
    ? (entry.cell.table.rows[entry.cell.row]?.[entry.cell.col]?.blocks ?? [])
    : blocks;
  const index = container.findIndex((block) => block.id === id);
  return { entry, other: container[index + step] };
}

/**
 * ⌫ at a paragraph's start: a list point steps out of its list; else the paragraph runs into
 * the one before it. A picture before it goes; a table or what the editor does not write stays.
 */
export function joinBackward(blocks: Blocks, id: string, formats: Formats): Edit {
  const here = neighbour(blocks, id, -1);
  if (!here || here.entry.block.locked) return { blocks, sel: caret(id, 0) };
  const block = here.entry.block;
  if (block.list) {
    return {
      blocks: withParagraph(blocks, id, ({ list: _list, ...rest }) => rest),
      sel: caret(id, 0),
    };
  }
  const before = here.other;
  if (!before) {
    // Nothing above: a heading that is empty becomes text again.
    if (block.kind !== 'text' && lengthOf(block) === 0) {
      return { blocks: setFormat(blocks, [id], 'text', formats), sel: caret(id, 0) };
    }
    return { blocks, sel: caret(id, 0) };
  }
  if (before.type === 'table') return { blocks, sel: caret(id, 0) };
  if (before.locked) {
    if (!isPicture(before)) return { blocks, sel: caret(id, 0) };
    return {
      blocks: withContainer(blocks, here.entry, (container) =>
        container.filter((each) => each.id !== before.id),
      ),
      sel: caret(id, 0),
    };
  }
  const length = lengthOf(before);
  // An empty paragraph above just goes: the one below stays itself, its comments with it.
  if (length === 0 && !before.breakBefore) {
    return {
      blocks: withContainer(blocks, here.entry, (container) =>
        container.filter((each) => each.id !== before.id),
      ),
      sel: caret(id, 0),
    };
  }
  return {
    blocks: withContainer(blocks, here.entry, (container) =>
      container.flatMap((each) =>
        each.id === id
          ? []
          : each.id === before.id
            ? [{ ...before, runs: normalize([...before.runs, ...block.runs]) }]
            : [each],
      ),
    ),
    sel: caret(before.id, length),
  };
}

/** Entf at a paragraph's end: the next one runs into it. */
export function joinForward(blocks: Blocks, id: string, formats: Formats): Edit {
  const here = neighbour(blocks, id, 1);
  const block = here?.entry.block;
  if (!here || !block || block.locked) return { blocks, sel: caret(id, 0) };
  const length = lengthOf(block);
  const after = here.other;
  if (!after || after.type === 'table') return { blocks, sel: caret(id, length) };
  if (after.locked) {
    if (!isPicture(after)) return { blocks, sel: caret(id, length) };
    return {
      blocks: withContainer(blocks, here.entry, (container) =>
        container.filter((each) => each.id !== after.id),
      ),
      sel: caret(id, length),
    };
  }
  if (length === 0 && !block.breakBefore && !block.list) {
    return {
      blocks: withContainer(blocks, here.entry, (container) =>
        container.filter((each) => each.id !== id),
      ),
      sel: caret(after.id, 0),
    };
  }
  void formats;
  return {
    blocks: withContainer(blocks, here.entry, (container) =>
      container.flatMap((each) =>
        each.id === after.id
          ? []
          : each.id === id
            ? [{ ...block, runs: normalize([...block.runs, ...after.runs]) }]
            : [each],
      ),
    ),
    sel: caret(id, length),
  };
}

// ── Looks ───────────────────────────────────────────────────────────────────

export type ToggleMark = 'bold' | 'italic' | 'underline' | 'strike';

/** Whether all of the selected text wears the mark. */
export function hasMark(blocks: Blocks, sel: Sel, mark: ToggleMark): boolean {
  const { from, to } = ordered(blocks, sel);
  const list = touched(blocks, sel).filter((block) => !block.locked);
  let any = false;
  for (const block of list) {
    const runs = sliceRuns(
      block.runs,
      block.id === from.id ? from.offset : 0,
      block.id === to.id ? to.offset : Infinity,
    );
    for (const run of runs) {
      if (run.text === '' || run.picture) continue;
      any = true;
      if (!run[mark]) return false;
    }
  }
  return any;
}

/** `change` on every stretch of the selected text. */
export function mapSelection(
  blocks: Blocks,
  sel: Sel,
  change: (marks: Marks, block: WriterParagraphBlock) => Marks,
): Blocks {
  const { from, to } = ordered(blocks, sel);
  let next = blocks;
  for (const block of touched(blocks, sel)) {
    if (block.locked) continue;
    const start = block.id === from.id ? from.offset : 0;
    const end = block.id === to.id ? to.offset : Infinity;
    next = withParagraph(next, block.id, (each) => ({
      ...each,
      runs: normalize([
        ...sliceRuns(each.runs, 0, start),
        ...sliceRuns(each.runs, start, end).map((run) =>
          // A picture has no look to change.
          run.picture ? run : { ...tidy(change(marksOf(run), each)), text: run.text },
        ),
        ...sliceRuns(each.runs, end),
      ]),
    }));
  }
  return next;
}

export function toggleMark(blocks: Blocks, sel: Sel, mark: ToggleMark): Blocks {
  const on = !hasMark(blocks, sel, mark);
  // A link keeps its line.
  return mapSelection(blocks, sel, (marks) =>
    mark === 'underline' && marks.link ? marks : { ...marks, [mark]: on },
  );
}

/** A colour of the text, or `null`: the paragraph's own. */
export const setColor = (blocks: Blocks, sel: Sel, color: string | null) =>
  mapSelection(blocks, sel, ({ color: _color, ...marks }) =>
    color && !marks.link ? { ...marks, color } : marks.link ? { ...marks, color: _color } : marks,
  );

/** A font of the text (a family's name), or `null`: the paragraph format's own. */
export const setFont = (blocks: Blocks, sel: Sel, font: string | null) =>
  mapSelection(blocks, sel, ({ font: _font, ...marks }, block) =>
    font && font !== block.look.font ? { ...marks, font } : marks,
  );

/** A size of the text in points, or `null`: the paragraph format's own. */
export const setSize = (blocks: Blocks, sel: Sel, size: number | null) =>
  mapSelection(blocks, sel, ({ size: _size, ...marks }, block) =>
    size && Math.abs(size - block.look.size) > 0.01 ? { ...marks, size } : marks,
  );

/**
 * What the selection wears of `read`: the one value all of its words have, `null` where they
 * differ. A caret: what the next typed letter would wear (`pending`, else the place's marks).
 */
function wornAt<T>(
  blocks: Blocks,
  sel: Sel,
  pending: Marks | null | undefined,
  read: (marks: Marks, look: WriterLook) => T,
): T | null {
  const { from, to } = ordered(blocks, sel);
  const first = paragraphOf(blocks, sel.focus.id);
  if (!first) return null;
  if (isCollapsed(sel)) {
    return read(pending ?? marksAt(first, sel.focus.offset), first.look);
  }
  const found = new Set<T>();
  for (const block of touched(blocks, sel)) {
    const runs = sliceRuns(
      block.runs,
      block.id === from.id ? from.offset : 0,
      block.id === to.id ? to.offset : Infinity,
    );
    for (const run of runs) {
      if (run.text === '' || run.picture) continue;
      found.add(read(run, block.look));
    }
  }
  if (found.size === 0) return read(marksAt(first, sel.focus.offset), first.look);
  return found.size === 1 ? ([...found][0] as T) : null;
}

/** The font the selection is in (its own, else its paragraph's); `null`: several. */
export const fontAt = (blocks: Blocks, sel: Sel, pending?: Marks | null): string | null =>
  wornAt(blocks, sel, pending, (marks, look) => marks.font ?? look.font);

/** The size the selection is in, in points (its own, else its paragraph's); `null`: several. */
export const sizeAt = (blocks: Blocks, sel: Sel, pending?: Marks | null): number | null =>
  wornAt(blocks, sel, pending, (marks, look) => marks.size ?? look.size);

export const setHighlight = (blocks: Blocks, sel: Sel, highlight: string | null) =>
  mapSelection(blocks, sel, ({ highlight: _highlight, ...marks }) =>
    highlight ? { ...marks, highlight } : marks,
  );

export const LINK_COLOR = '#003399';

/** The selected words lead to `href`, or (`null`) nowhere any more. */
export function setLink(blocks: Blocks, sel: Sel, href: string | null): Blocks {
  return mapSelection(blocks, sel, (marks) => {
    if (href) return { ...marks, link: href, underline: true, color: LINK_COLOR };
    if (!marks.link) return marks;
    const { link: _link, underline: _underline, color: _color, style: _style, ...rest } = marks;
    return rest;
  });
}

/** The stretch of one link around `point`, if it stands in one. */
export function linkAt(blocks: Blocks, point: Point): { href: string; sel: Sel } | null {
  const block = paragraphOf(blocks, point.id);
  if (!block) return null;
  let at = 0;
  const spans: { start: number; end: number; href: string }[] = [];
  for (const run of block.runs) {
    const end = at + run.text.length;
    const last = spans.at(-1);
    if (run.link) {
      if (last?.href === run.link && last.end === at) last.end = end;
      else spans.push({ start: at, end, href: run.link });
    }
    at = end;
  }
  const hit = spans.find((span) => point.offset >= span.start && point.offset <= span.end);
  return hit
    ? {
        href: hit.href,
        sel: {
          anchor: { id: block.id, offset: hit.start },
          focus: { id: block.id, offset: hit.end },
        },
      }
    : null;
}

const shapeOf = (format: WriterFormat): Pick<WriterParagraph, 'kind' | 'level'> =>
  format.startsWith('heading')
    ? { kind: 'heading', level: Number(format.slice(7)) }
    : { kind: format as Exclude<WriterParagraph['kind'], 'heading'> };

/**
 * „Absatzformat“: the paragraphs become `format`. Text that looked as the old format says
 * (a heading's bold) looks as the new one says; what was set by hand stays.
 */
export function setFormat(
  blocks: Blocks,
  ids: readonly string[],
  format: WriterFormat,
  formats: Formats,
): Blocks {
  const look = formats[format];
  let next = blocks;
  for (const id of ids) {
    next = withParagraph(next, id, (block) => {
      if (block.locked || writerFormatOf(block) === format) return block;
      const { level: _level, kind: _kind, ...rest } = block;
      return {
        ...rest,
        ...shapeOf(format),
        look,
        runs: normalize(
          block.runs.map((run) => ({
            ...run,
            bold: Boolean(run.bold) === block.look.bold ? look.bold : run.bold,
            italic: Boolean(run.italic) === block.look.italic ? look.italic : run.italic,
          })),
        ),
      } as WriterParagraphBlock;
    });
  }
  return next;
}

export function setAlign(blocks: Blocks, ids: readonly string[], align: WriterAlign): Blocks {
  let next = blocks;
  for (const id of ids) {
    next = withParagraph(next, id, (block) => {
      if (block.locked) return block;
      const { align: _align, ...rest } = block;
      // As its format says needs no word of its own.
      return align === block.look.align ? rest : { ...rest, align };
    });
  }
  return next;
}

export const alignOf = (block: WriterParagraphBlock): WriterAlign =>
  block.align ?? block.look.align;

/** A line spacing of the paragraphs' own (1 = single), or `null`: as their format says. */
export function setLineHeight(
  blocks: Blocks,
  ids: readonly string[],
  value: number | null,
): Blocks {
  let next = blocks;
  for (const id of ids) {
    next = withParagraph(next, id, (block) => {
      if (block.locked || (block.lineHeight ?? null) === value) return block;
      const { lineHeight: _lineHeight, ...rest } = block;
      return value === null ? rest : { ...rest, lineHeight: value };
    });
  }
  return next;
}

/** The line spacing a paragraph is set in: its own, else its format's. */
export const lineHeightOf = (block: WriterParagraphBlock): number =>
  block.lineHeight ?? block.look.lineHeight;

/**
 * What the paragraphs say of their line spacing themselves: `own` is the one value they all
 * have (`null`: as the format says), `mixed` that they differ; `shown` the spacing they stand
 * in, `null` where it differs.
 */
export function lineHeightAt(
  blocks: Blocks,
  ids: readonly string[],
): { own: number | null; mixed: boolean; shown: number | null } {
  const list = ids.flatMap((id) => paragraphOf(blocks, id) ?? []);
  const own = new Set(list.map((block) => block.lineHeight ?? null));
  const shown = new Set(list.map(lineHeightOf));
  return {
    own: own.size === 1 ? ([...own][0] ?? null) : null,
    mixed: own.size > 1,
    shown: shown.size === 1 ? ([...shown][0] ?? null) : null,
  };
}

const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 0.005
    : typeof a === 'string' && typeof b === 'string'
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;

/** What of `change` says something the look does not say already. */
function newIn(look: WriterLook, change: WriterFormatLook): WriterFormatLook {
  const out: Record<string, unknown> = {};
  for (const key of WRITER_FORMAT_LOOK_KEYS) {
    const value = change[key];
    if (value !== undefined && !sameValue(look[key], value)) out[key] = value;
  }
  return out as WriterFormatLook;
}

/**
 * A format's own look changed, for the whole document: every paragraph of the format follows
 * where it looked as the format said (one with a spacing or a size of its own in the file keeps
 * it). Text that was bold or slanted as the format was is so as the format is now; a font, a
 * size, a colour set by hand that the format now says itself is no word of the text's own.
 */
export function setFormatLook(
  blocks: Blocks,
  formats: Formats,
  format: WriterFormat,
  change: WriterFormatLook,
): { blocks: Blocks; formats: Formats } {
  const old = formats[format];
  const fresh = newIn(old, change);
  if (Object.keys(fresh).length === 0) return { blocks, formats };
  const next = { ...formats, [format]: { ...old, ...fresh } };
  const restyle = (block: WriterParagraphBlock): WriterParagraphBlock => {
    if (writerFormatOf(block) !== format) return block;
    const follows: Record<string, unknown> = {};
    for (const key of WRITER_FORMAT_LOOK_KEYS) {
      if (fresh[key] !== undefined && sameValue(block.look[key], old[key]))
        follows[key] = fresh[key];
    }
    if (Object.keys(follows).length === 0) return block;
    const was = block.look;
    const look = { ...was, ...follows } as WriterLook;
    const runs = block.locked
      ? block.runs
      : normalize(
          block.runs.map((run) => {
            if (run.picture) return run;
            const { font, size, color, ...rest } = run;
            return {
              ...rest,
              bold: Boolean(run.bold) === was.bold ? look.bold : run.bold,
              italic: Boolean(run.italic) === was.italic ? look.italic : run.italic,
              ...(font && font !== look.font && { font }),
              ...(size && Math.abs(size - look.size) > 0.01 && { size }),
              // A link's colour is the link's.
              ...(color && (run.link || !sameValue(color, look.color)) && { color }),
            };
          }),
        );
    return { ...block, look, runs };
  };
  const walk = (list: readonly WriterBlock[]): WriterBlock[] =>
    list.map((block) =>
      block.type === 'paragraph'
        ? restyle(block)
        : {
            ...block,
            rows: block.rows.map((row) =>
              row.map((cell) => ({ ...cell, blocks: cell.blocks.map(restyle) })),
            ),
          },
    );
  return { blocks: walk(blocks), formats: next };
}

/** The steps that make the formats `after` out of `before`: what each says anew. */
export function formatSteps(before: Formats, after: Formats): WriterOperation[] {
  if (before === after) return [];
  const ops: WriterOperation[] = [];
  for (const format of WRITER_FORMATS) {
    const look = newIn(before[format], after[format]);
    if (Object.keys(look).length > 0) ops.push({ type: 'setFormatLook', format, look });
  }
  return ops;
}

/** What the selection looks like, each on its own; `null` where its words differ. */
export interface SelectionLook {
  font: string | null;
  size: number | null;
  bold: boolean | null;
  italic: boolean | null;
  color: string | null;
}

export const lookAt = (blocks: Blocks, sel: Sel, pending?: Marks | null): SelectionLook => ({
  font: fontAt(blocks, sel, pending),
  size: sizeAt(blocks, sel, pending),
  bold: wornAt(blocks, sel, pending, (marks) => Boolean(marks.bold)),
  italic: wornAt(blocks, sel, pending, (marks) => Boolean(marks.italic)),
  color: wornAt(blocks, sel, pending, (marks, look) => marks.color ?? look.color),
});

/** Points or numbers on, or – all of them wearing it already – off. */
export function toggleList(
  blocks: Blocks,
  ids: readonly string[],
  kind: WriterList['kind'],
): Blocks {
  const typable = ids
    .map((id) => paragraphOf(blocks, id))
    .filter((block): block is WriterParagraphBlock => Boolean(block && !block.locked));
  const off = typable.length > 0 && typable.every((block) => block.list?.kind === kind);
  let next = blocks;
  for (const { id } of typable) {
    next = withParagraph(next, id, ({ list, ...rest }) =>
      off ? rest : { ...rest, list: { kind, level: list?.level ?? 0 } },
    );
  }
  return next;
}

/** A list point a level in or out. */
export function indent(blocks: Blocks, ids: readonly string[], step: -1 | 1): Blocks {
  let next = blocks;
  for (const id of ids) {
    next = withParagraph(next, id, (block) => {
      if (block.locked || !block.list) return block;
      const level = Math.min(MAX_LIST_LEVEL, Math.max(0, block.list.level + step));
      return level === block.list.level ? block : { ...block, list: { ...block.list, level } };
    });
  }
  return next;
}

export function setBreakBefore(blocks: Blocks, id: string, on: boolean): Blocks {
  return withParagraph(blocks, id, ({ breakBefore: _break, ...rest }) =>
    on ? { ...rest, breakBefore: true } : rest,
  );
}

// ── Whole blocks ────────────────────────────────────────────────────────────

/** The block of the text a paragraph belongs to: itself, or the table it stands in. */
/**
 * A blank page after the block `afterId` (one in the text, not in a table): an empty paragraph
 * opening a page, and what followed it opening one again – the caret on the blank page.
 */
export function addPageAfter(blocks: Blocks, afterId: string, formats: Formats): Edit {
  const page: WriterParagraphBlock = { ...emptyParagraph(formats), breakBefore: true };
  const index = blocks.findIndex((each) => each.id === afterId);
  const next: WriterBlock[] = [...blocks.slice(0, index + 1), page];
  const following = blocks[index + 1];
  if (following?.type === 'paragraph') next.push({ ...following, breakBefore: true });
  // A table opens no page itself: an empty line does it before it.
  else if (following) next.push({ ...emptyParagraph(formats), breakBefore: true }, following);
  next.push(...blocks.slice(index + 2));
  return { blocks: next, sel: caret(page.id, 0) };
}

export const topOf = (blocks: Blocks, id: string): WriterBlock | undefined => {
  const direct = blocks.find((block) => block.id === id);
  if (direct) return direct;
  const entry = find(blocks, id);
  return entry ? blocks[entry.top] : undefined;
};

function insertAfterTop(blocks: Blocks, id: string, added: WriterBlock[]): Blocks {
  const top = topOf(blocks, id);
  if (!top) return [...blocks, ...added];
  return blocks.flatMap((block) => (block.id === top.id ? [block, ...added] : [block]));
}

const emptyCell = (formats: Formats): WriterTableCell => ({ blocks: [emptyParagraph(formats)] });

/** A table under the paragraph the caret stands in; text goes on below it. */
export function insertTable(
  blocks: Blocks,
  afterId: string,
  rows: number,
  columns: number,
  formats: Formats,
): Edit {
  const table: WriterTableBlock = {
    type: 'table',
    id: newId(),
    columns: Array.from({ length: columns }, () => 1 / columns),
    rows: Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => emptyCell(formats)),
    ),
  };
  const top = topOf(blocks, afterId);
  const last = blocks.at(-1);
  const needsLine = !top || last?.id === top.id;
  const next = insertAfterTop(blocks, afterId, [
    table,
    ...(needsLine ? [emptyParagraph(formats)] : []),
  ]);
  const first = table.rows[0]?.[0]?.blocks[0];
  return { blocks: next, sel: caret(first?.id ?? afterId, 0) };
}

const withTable = (
  blocks: Blocks,
  tableId: string,
  change: (table: WriterTableBlock) => WriterTableBlock | null,
): Blocks =>
  blocks.flatMap((block) => {
    if (block.id !== tableId || block.type !== 'table') return [block];
    const next = change(block);
    return next ? [next] : [];
  });

const spanned = (cell: WriterTableCell, colSpan: number, rowSpan: number): WriterTableCell => ({
  blocks: cell.blocks,
  ...(colSpan > 1 && { colSpan }),
  ...(rowSpan > 1 && { rowSpan }),
});

/** No cell reaches over another: every row holds a cell for every column. */
const isPlain = (table: WriterTableBlock) =>
  table.rows.every(
    (row) =>
      row.length === table.columns.length &&
      row.every((cell) => (cell.colSpan ?? 1) === 1 && (cell.rowSpan ?? 1) === 1),
  );

/**
 * A row under row `after` (-1: above the first), as wide as the table. A cell that reaches from
 * above it to below it grows by the row; the others get a cell of their own.
 */
export function insertRow(
  blocks: Blocks,
  tableId: string,
  after: number,
  formats: Formats,
): Edit | null {
  const table = blocks.find((block) => block.id === tableId);
  if (table?.type !== 'table') return null;
  const grid = writerTableGrid(table.rows);
  const grown = new Set<WriterTableCell>();
  const row: WriterTableCell[] = [];
  for (let column = 0; column < table.columns.length; column += 1) {
    const up = grid.owner[after]?.[column];
    const down = grid.owner[after + 1]?.[column];
    const through = up && down && up.row === down.row && up.index === down.index;
    const cell = through ? table.rows[up.row]?.[up.index] : undefined;
    if (cell) grown.add(cell);
    else row.push(emptyCell(formats));
  }
  const first = row[0]?.blocks[0];
  if (!first) return null;
  const kept = table.rows.map((each) =>
    each.some((cell) => grown.has(cell))
      ? each.map((cell) =>
          grown.has(cell) ? spanned(cell, cell.colSpan ?? 1, (cell.rowSpan ?? 1) + 1) : cell,
        )
      : each,
  );
  const rows = [...kept.slice(0, after + 1), row, ...kept.slice(after + 1)];
  return {
    blocks: blocks.map((block) => (block.id === tableId ? { ...table, rows } : block)),
    sel: caret(first.id, 0),
  };
}

/**
 * A row gone – the table with it when it was the last. A cell reaching through the row loses
 * it; one that starts in it goes on in the row below, with what it holds.
 */
export function removeRow(blocks: Blocks, tableId: string, row: number): Blocks {
  return withTable(blocks, tableId, (table) => {
    if (!table.rows[row]) return table;
    const grid = writerTableGrid(table.rows);
    const shrunk = new Set<WriterTableCell>();
    for (const owner of grid.owner[row] ?? []) {
      const cell = owner ? table.rows[owner.row]?.[owner.index] : undefined;
      if (cell && (cell.rowSpan ?? 1) > 1) shrunk.add(cell);
    }
    const less = (cell: WriterTableCell) =>
      shrunk.has(cell) ? spanned(cell, cell.colSpan ?? 1, (cell.rowSpan ?? 1) - 1) : cell;
    // The cells of the row below, with the ones that come down to it, in their columns' order.
    const below = [
      ...(table.rows[row] ?? []).flatMap((cell, index) =>
        shrunk.has(cell) ? [{ cell: less(cell), column: grid.at[row]?.[index] ?? 0 }] : [],
      ),
      ...(table.rows[row + 1] ?? []).map((cell, index) => ({
        cell,
        column: grid.at[row + 1]?.[index] ?? 0,
      })),
    ].sort((a, b) => a.column - b.column);
    const rows = table.rows.flatMap((each, index) =>
      index === row
        ? []
        : index === row + 1
          ? [below.map((entry) => entry.cell)]
          : [each.some((cell) => shrunk.has(cell)) ? each.map(less) : each],
    );
    return rows.length === 0 ? null : { ...table, rows };
  });
}

/**
 * A column right of column `after` (-1: left of the first), as wide as column `beside`; the
 * others give way, the table stays as wide as it is. A cell that reaches from left of it to
 * right of it grows by the column; every other row gets a cell of its own. The caret goes to
 * the new cell of row `row`.
 */
export function insertColumn(
  blocks: Blocks,
  tableId: string,
  after: number,
  formats: Formats,
  beside = Math.max(0, after),
  row = 0,
): { blocks: Blocks; sel: Sel | null } | null {
  const table = blocks.find((block) => block.id === tableId);
  if (table?.type !== 'table' || table.columns.length >= MAX_TABLE_GRID_COLUMNS) return null;
  const grid = writerTableGrid(table.rows);
  const grown = new Set<WriterTableCell>();
  const added: (WriterTableCell | undefined)[] = [];
  const rows = table.rows.map((cells, rowIndex) => {
    const left = grid.owner[rowIndex]?.[after];
    const right = grid.owner[rowIndex]?.[after + 1];
    const through = left && right && left.row === right.row && left.index === right.index;
    const wide = through ? table.rows[left.row]?.[left.index] : undefined;
    if (wide) {
      grown.add(wide);
      return cells;
    }
    const cell = emptyCell(formats);
    added[rowIndex] = cell;
    const at = cells.findIndex((_, index) => (grid.at[rowIndex]?.[index] ?? 0) > after);
    return at < 0 ? [...cells, cell] : [...cells.slice(0, at), cell, ...cells.slice(at)];
  });
  const share = table.columns[beside] ?? 1 / (table.columns.length + 1);
  const columns = [...table.columns.slice(0, after + 1), share, ...table.columns.slice(after + 1)];
  const total = columns.reduce((sum, each) => sum + each, 0);
  const next: WriterTableBlock = {
    ...table,
    columns: columns.map((each) => each / total),
    rows: rows.map((cells) =>
      cells.some((cell) => grown.has(cell))
        ? cells.map((cell) =>
            grown.has(cell) ? spanned(cell, (cell.colSpan ?? 1) + 1, cell.rowSpan ?? 1) : cell,
          )
        : cells,
    ),
  };
  const first = (added[row] ?? added.find(Boolean))?.blocks[0];
  const placed = blocks.map((block) => (block.id === tableId ? next : block));
  return { blocks: placed, sel: first ? caret(first.id, 0) : null };
}

/**
 * A column gone – never the last one. A cell reaching over the column loses it; one that stood
 * in it alone goes with what it holds. The columns left share the table's width as before.
 */
export function removeColumn(blocks: Blocks, tableId: string, column: number): Blocks {
  return withTable(blocks, tableId, (table) => {
    if (table.columns.length <= 1 || table.columns[column] === undefined) return table;
    const grid = writerTableGrid(table.rows);
    const rows = table.rows.map((cells, rowIndex) =>
      cells.flatMap((cell, index) => {
        const left = grid.at[rowIndex]?.[index] ?? 0;
        const span = cell.colSpan ?? 1;
        if (column < left || column >= left + span) return [cell];
        return span > 1 ? [spanned(cell, span - 1, cell.rowSpan ?? 1)] : [];
      }),
    );
    // A row all of whose own cells stood in the column: the cells reaching through it lose it.
    for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
      if ((rows[rowIndex]?.length ?? 0) > 0) continue;
      for (let above = 0; above < rowIndex; above += 1) {
        rows[above] = (rows[above] ?? []).map((cell) =>
          above + (cell.rowSpan ?? 1) > rowIndex
            ? spanned(cell, cell.colSpan ?? 1, (cell.rowSpan ?? 1) - 1)
            : cell,
        );
      }
      rows.splice(rowIndex, 1);
    }
    const columns = table.columns.filter((_, index) => index !== column);
    const total = columns.reduce((sum, each) => sum + each, 0);
    return { ...table, columns: columns.map((each) => each / total), rows };
  });
}

/** The cells a selection runs over: the smallest block of whole cells that holds both its ends. */
export interface CellRange {
  table: WriterTableBlock;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** The cells in it, in reading order. */
  cells: WriterTableCell[];
}

export function cellRange(blocks: Blocks, sel: Sel): CellRange | null {
  const a = find(blocks, sel.anchor.id)?.cell;
  const b = find(blocks, sel.focus.id)?.cell;
  if (!a || !b || a.table.id !== b.table.id) return null;
  const table = a.table;
  const grid = writerTableGrid(table.rows);
  const box = { top: Infinity, left: Infinity, bottom: -1, right: -1 };
  const take = (row: number, index: number) => {
    const cell = table.rows[row]?.[index];
    const column = grid.at[row]?.[index];
    if (!cell || column === undefined) return;
    box.top = Math.min(box.top, row);
    box.left = Math.min(box.left, column);
    box.bottom = Math.max(box.bottom, row + (cell.rowSpan ?? 1) - 1);
    box.right = Math.max(box.right, column + (cell.colSpan ?? 1) - 1);
  };
  take(a.row, a.col);
  take(b.row, b.col);
  // A merged cell that lies partly in the block is taken whole, till nothing sticks out.
  for (let grew = true; grew;) {
    const was = { ...box };
    for (let row = box.top; row <= box.bottom; row += 1) {
      for (let column = box.left; column <= box.right; column += 1) {
        const owner = grid.owner[row]?.[column];
        if (owner) take(owner.row, owner.index);
      }
    }
    grew =
      was.top !== box.top ||
      was.left !== box.left ||
      was.bottom !== box.bottom ||
      was.right !== box.right;
  }
  if (box.bottom < 0) return null;
  const cells: WriterTableCell[] = [];
  for (let row = box.top; row <= box.bottom; row += 1) {
    for (let column = box.left; column <= box.right; column += 1) {
      const owner = grid.owner[row]?.[column];
      // A hole in the table: nothing to merge over.
      if (!owner) return null;
      const cell = table.rows[owner.row]?.[owner.index];
      if (cell && !cells.includes(cell)) cells.push(cell);
    }
  }
  return { table, ...box, cells };
}

/**
 * The cells the selection runs over become one: the first of them, reaching over the others,
 * holding what all of them held – empty paragraphs left out.
 */
export function mergeCells(blocks: Blocks, sel: Sel): Edit | null {
  const range = cellRange(blocks, sel);
  const first = range?.cells[0];
  if (!range || !first || range.cells.length < 2) return null;
  const gone = new Set(range.cells.slice(1));
  const held = range.cells
    .flatMap((cell) => cell.blocks)
    .filter((block) => !isTypable(block) || lengthOf(block) > 0);
  const content = held.length > 0 ? held : first.blocks.slice(0, 1);
  const merged = spanned(
    { blocks: content },
    range.right - range.left + 1,
    range.bottom - range.top + 1,
  );
  const rows = range.table.rows.map((row) =>
    row.some((cell) => cell === first || gone.has(cell))
      ? row.flatMap((cell) => (cell === first ? [merged] : gone.has(cell) ? [] : [cell]))
      : row,
  );
  const at = content.at(-1);
  return {
    blocks: withTable(blocks, range.table.id, (table) => ({ ...table, rows })),
    sel: caret(at?.id ?? sel.focus.id, at ? lengthOf(at) : 0),
  };
}

/** A merged cell parted again: it keeps what it holds, the places it reached over get cells of their own. */
export function splitCell(blocks: Blocks, id: string, formats: Formats): Edit | null {
  const at = find(blocks, id)?.cell;
  const cell = at?.table.rows[at.row]?.[at.col];
  if (!at || !cell || ((cell.colSpan ?? 1) === 1 && (cell.rowSpan ?? 1) === 1)) return null;
  const grid = writerTableGrid(at.table.rows);
  const left = grid.at[at.row]?.[at.col] ?? 0;
  const rows = at.table.rows.map((row, rowIndex) => {
    if (rowIndex < at.row || rowIndex >= at.row + (cell.rowSpan ?? 1)) return row;
    const placed = row.map((each, index) => ({
      cell: each === cell ? spanned(each, 1, 1) : each,
      column: grid.at[rowIndex]?.[index] ?? 0,
    }));
    for (let column = left; column < left + (cell.colSpan ?? 1); column += 1) {
      if (rowIndex !== at.row || column !== left) placed.push({ cell: emptyCell(formats), column });
    }
    return placed.sort((a, b) => a.column - b.column).map((entry) => entry.cell);
  });
  return {
    blocks: withTable(blocks, at.table.id, (table) => ({ ...table, rows })),
    sel: caret(id, 0),
  };
}

/** The share of the table's width a column may not go below. */
export const MIN_COLUMN_SHARE = 0.03;

/** The columns' widths, as shares of the table's that add up to 1. */
export function setColumns(blocks: Blocks, tableId: string, columns: readonly number[]): Blocks {
  const total = columns.reduce((sum, share) => sum + share, 0);
  return withTable(blocks, tableId, (table) =>
    columns.length !== table.columns.length ||
    !(total > 0) ||
    columns.every((share, index) => Math.abs(share / total - (table.columns[index] ?? 0)) < 1e-4)
      ? table
      : { ...table, columns: columns.map((share) => share / total) },
  );
}

type CellShape = Extract<WriterOperation, { type: 'setCells' }>['rows'][number][number];

/**
 * A table's cells laid out as `rows` say – as the server does it to the file: a paragraph a cell
 * names moves to it, with the unnamed ones standing behind it; a name the table does not know
 * is a new, empty paragraph; a cell none of whose paragraphs is named goes.
 */
function shapeCells(
  table: WriterTableBlock,
  rows: readonly (readonly CellShape[])[],
  blank: (id: string) => WriterParagraphBlock,
): WriterTableBlock {
  const wanted = new Set(rows.flatMap((row) => row.flatMap((cell) => cell.ids)));
  const known = new Set<string>();
  const groups = new Map<string, { blocks: WriterParagraphBlock[]; placed: boolean }>();
  for (const row of table.rows) {
    for (const cell of row) {
      let group: { blocks: WriterParagraphBlock[]; placed: boolean } | null = null;
      const ahead: WriterParagraphBlock[] = [];
      for (const block of cell.blocks) {
        known.add(block.id);
        if (wanted.has(block.id)) {
          group = { blocks: [...ahead.splice(0), block], placed: false };
          groups.set(block.id, group);
        } else if (group) group.blocks.push(block);
        else ahead.push(block);
      }
    }
  }
  return {
    ...table,
    rows: rows.map((row) =>
      row.map((cell) => {
        const blocks: WriterParagraphBlock[] = [];
        for (const id of cell.ids) {
          const group = groups.get(id);
          if (group && !group.placed) {
            group.placed = true;
            blocks.push(...group.blocks);
          } else if (!group && !known.has(id)) blocks.push(blank(id));
        }
        return spanned({ blocks }, cell.colSpan ?? 1, cell.rowSpan ?? 1);
      }),
    ),
  };
}

/** A block of the text gone; the text never stays without a paragraph. */
export function removeBlock(blocks: Blocks, id: string, formats: Formats): Blocks {
  const next = blocks.filter((block) => block.id !== id);
  return next.length === 0 ? [emptyParagraph(formats)] : next;
}

export function insertPicture(
  blocks: Blocks,
  afterId: string,
  picture: WriterPicture,
  formats: Formats,
): Edit {
  const block: WriterParagraphBlock = {
    ...emptyParagraph(formats),
    locked: true,
    pictures: [picture],
  };
  const top = topOf(blocks, afterId);
  const needsLine = !top || blocks.at(-1)?.id === top.id;
  const line = emptyParagraph(formats);
  const next = insertAfterTop(blocks, afterId, [block, ...(needsLine ? [line] : [])]);
  const index = next.findIndex((each) => each.id === block.id);
  const below = next[index + 1];
  return {
    blocks: next,
    sel: caret(below?.type === 'paragraph' ? below.id : afterId, 0),
  };
}

/**
 * A picture in the line at `at`, like a letter – only where words stand already (`null` else:
 * in an empty paragraph it stands alone, see `insertPicture`).
 */
export function insertInlinePicture(
  blocks: Blocks,
  at: Point,
  picture: WriterPicture,
  formats: Formats,
): Edit | null {
  const block = paragraphOf(blocks, at.id);
  if (!block || block.locked || lengthOf(block) === 0) return null;
  return replaceRange(blocks, at, at, [{ text: WRITER_PICTURE_CHAR, picture }], formats);
}

/** The picture standing at `offset` of a paragraph's line, if one does. */
export function pictureAt(block: WriterParagraphBlock, offset: number): WriterPicture | undefined {
  let at = 0;
  for (const run of block.runs) {
    if (at === offset && run.picture) return run.picture;
    at += run.text.length;
    if (at > offset) break;
  }
  return undefined;
}

/**
 * A picture's size set: the one in the line at `offset`, or (`null`) the one standing alone –
 * that one is taken out and put back as a new paragraph, the only way the file is told.
 * Answers the blocks and the paragraph the picture stands in now.
 */
/** A block of the text locked or unlocked, as a slide's element („Ebenen“, ⇧⌘L). */
export function protectBlock(blocks: Blocks, id: string, protect: boolean): Blocks {
  if (!blocks.some((block) => block.id === id && Boolean(block.protect) !== protect)) return blocks;
  return blocks.map((block) => {
    if (block.id !== id) return block;
    const { protect: _was, ...rest } = block;
    return (protect ? { ...rest, protect: true } : rest) as WriterBlock;
  });
}

/** What nothing changes while locked: the locked blocks, and the paragraphs in a locked table. */
export function protectedIds(blocks: Blocks): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (!block.protect) continue;
    ids.add(block.id);
    if (block.type === 'table') {
      for (const row of block.rows)
        for (const cell of row) for (const each of cell.blocks) ids.add(each.id);
    }
  }
  return ids;
}

/** Whether steps change something locked (anything but its unlocking). */
export const touchesProtected = (ops: readonly WriterOperation[], ids: ReadonlySet<string>) =>
  ops.some((op) => {
    if (op.type === 'protectBlock') return false;
    const target = 'tableId' in op ? op.tableId : 'id' in op ? op.id : undefined;
    return target !== undefined && ids.has(target);
  });

/**
 * Where a picture stands across the sheet: one standing alone becomes a new paragraph (as when
 * it is resized – the file's frame is written anew), one in a line aligns its paragraph.
 */
export function alignPicture(
  blocks: Blocks,
  id: string,
  offset: number | null,
  align: WriterAlign,
): { blocks: Blocks; id: string } {
  const block = paragraphOf(blocks, id);
  if (!block) return { blocks, id };
  if (offset !== null) return { blocks: setAlign(blocks, [id], align), id };
  if (!isPicture(block) || alignOf(block) === align) return { blocks, id };
  const next = newId();
  return {
    blocks: withParagraph(blocks, id, (each) => {
      const { align: _align, ...rest } = each;
      return align === each.look.align ? { ...rest, id: next } : { ...rest, id: next, align };
    }),
    id: next,
  };
}

export function resizePicture(
  blocks: Blocks,
  id: string,
  offset: number | null,
  size: { width: number; height: number },
): { blocks: Blocks; id: string } {
  const block = paragraphOf(blocks, id);
  if (!block) return { blocks, id };
  if (offset === null) {
    const picture = block.pictures?.[0];
    if (!isPicture(block) || !picture) return { blocks, id };
    if (picture.width === size.width && picture.height === size.height) return { blocks, id };
    const next = newId();
    return {
      blocks: withParagraph(blocks, id, (each) => ({
        ...each,
        id: next,
        pictures: [{ ...picture, ...size }],
      })),
      id: next,
    };
  }
  const picture = pictureAt(block, offset);
  if (!picture || block.locked) return { blocks, id };
  if (picture.width === size.width && picture.height === size.height) return { blocks, id };
  return {
    blocks: withParagraph(blocks, id, (each) => ({
      ...each,
      runs: [
        ...sliceRuns(each.runs, 0, offset),
        {
          ...sliceRuns(each.runs, offset, offset + 1)[0],
          text: WRITER_PICTURE_CHAR,
          picture: { ...picture, ...size },
        },
        ...sliceRuns(each.runs, offset + 1),
      ],
    })),
    id,
  };
}

/**
 * Paragraphs brought along (pasted, dropped) at the selection: the first runs on in the
 * paragraph the caret stands in, the others follow as paragraphs of their own, and what stood
 * behind the caret closes the last.
 */
export function insertParagraphs(
  blocks: Blocks,
  sel: Sel,
  pasted: readonly WriterParagraph[],
  formats: Formats,
): Edit {
  const [first, ...rest] = pasted;
  if (!first) return { blocks, sel };
  const { from, to } = ordered(blocks, sel);
  const target = paragraphOf(blocks, from.id);
  if (!target || target.locked) return { blocks, sel };
  if (rest.length === 0) return replaceRange(blocks, from, to, first.runs, formats);

  const cut = replaceRange(blocks, from, to, [], formats);
  const at = cut.sel.focus;
  const entry = find(cut.blocks, at.id);
  if (!entry || entry.block.locked) return cut;
  const block = entry.block;
  const tail = sliceRuns(block.runs, at.offset);
  // Into an empty paragraph the first one comes as it is, its format with it.
  const takesShape = lengthOf(block) === 0;
  const head: WriterParagraphBlock = takesShape
    ? shaped({ ...block }, first, formats)
    : { ...block, runs: normalize([...sliceRuns(block.runs, 0, at.offset), ...first.runs]) };
  const added = rest.map((paragraph) => shaped(emptyParagraph(formats), paragraph, formats));
  const last = added.at(-1);
  if (!last) return cut;
  const offset = lengthOf(last);
  added[added.length - 1] = { ...last, runs: normalize([...last.runs, ...tail]) };
  return {
    blocks: withContainer(cut.blocks, entry, (container) =>
      container.flatMap((each) => (each.id === block.id ? [head, ...added] : [each])),
    ),
    sel: caret(last.id, offset),
  };
}

function shaped(
  block: WriterParagraphBlock,
  paragraph: WriterParagraph,
  formats: Formats,
): WriterParagraphBlock {
  const { level: _level, align: _align, list: _list, breakBefore: _break, ...rest } = block;
  return {
    ...rest,
    kind: paragraph.kind,
    ...(paragraph.kind === 'heading' && { level: paragraph.level ?? 1 }),
    ...(paragraph.align && { align: paragraph.align }),
    ...(paragraph.list && { list: paragraph.list }),
    look: formats[writerFormatOf(paragraph)],
    runs: normalize(paragraph.runs),
  };
}

// ── What goes to the server ─────────────────────────────────────────────────

const shapeFor = (block: WriterParagraphBlock): WriterParagraph => ({
  kind: block.kind,
  ...(block.kind === 'heading' && { level: block.level ?? 1 }),
  ...(block.align && { align: block.align }),
  ...(block.list && { list: block.list }),
  ...(block.breakBefore && { breakBefore: true }),
  ...(block.lineHeight && { lineHeight: block.lineHeight }),
  runs: normalize(block.runs),
});

function sameParagraph(a: WriterParagraphBlock, b: WriterParagraphBlock): boolean {
  if (a === b) return true;
  if (
    a.kind !== b.kind ||
    (a.level ?? 1) !== (b.level ?? 1) ||
    a.align !== b.align ||
    a.list?.kind !== b.list?.kind ||
    a.list?.level !== b.list?.level ||
    Boolean(a.breakBefore) !== Boolean(b.breakBefore) ||
    a.lineHeight !== b.lineHeight
  )
    return false;
  const x = normalize(a.runs);
  const y = normalize(b.runs);
  return (
    x.length === y.length &&
    x.every((run, index) => {
      const other = y[index];
      return other !== undefined && run.text === other.text && sameMarks(run, other);
    })
  );
}

const isBlank = (block: WriterParagraphBlock) =>
  block.kind === 'text' &&
  !block.align &&
  !block.list &&
  !block.breakBefore &&
  block.runs.length === 0;

type Place = { afterId: string } | { beforeId: string } | Record<string, never>;

/** The paragraphs of one text or cell: what left, what came, what changed. */
function containerSteps(
  before: readonly WriterBlock[],
  after: readonly WriterBlock[],
  ops: WriterOperation[],
) {
  const was = new Map(before.map((block) => [block.id, block]));
  const now = new Set(after.map((block) => block.id));
  for (const block of before) if (!now.has(block.id)) ops.push({ type: 'remove', id: block.id });
  const stay = staying(before, after);

  after.forEach((block, index) => {
    const old = was.get(block.id);
    if (old) {
      const lock = Boolean(block.protect) !== Boolean(old.protect);
      // Unlocked before it changes, locked after.
      if (lock && !block.protect) ops.push({ type: 'protectBlock', id: block.id, protect: false });
      // Put elsewhere („Ebenen“): beside the one before it now, else before the next that stays.
      const moved = !stay.has(block.id);
      if (moved) {
        const previous = after[index - 1];
        const next = after.slice(index + 1).find((each) => stay.has(each.id));
        ops.push({
          type: 'moveBlock',
          id: block.id,
          ...(previous ? { afterId: previous.id } : next ? { beforeId: next.id } : {}),
        });
      }
      if (block.type === 'paragraph' && old.type === 'paragraph') {
        // Out of a list in the file, a list's point says again that it is one.
        if (!block.locked && (!sameParagraph(old, block) || (moved && block.list))) {
          ops.push({ type: 'setParagraph', id: block.id, paragraph: shapeFor(block) });
        }
      } else if (block.type === 'table' && old.type === 'table' && block !== old) {
        tableSteps(old, block, ops);
      }
      if (lock && block.protect) ops.push({ type: 'protectBlock', id: block.id, protect: true });
      return;
    }
    const previous = after[index - 1];
    // The first of its text: before the next one that is there already.
    const next = after.slice(index + 1).find((each) => was.has(each.id));
    const place: Place = previous ? { afterId: previous.id } : next ? { beforeId: next.id } : {};
    if (block.type === 'table') {
      ops.push({
        type: 'insertTable',
        id: block.id,
        ...place,
        cells: block.rows.map((row) => row.map((cell) => cell.blocks[0]?.id ?? newId())),
      });
      for (const row of block.rows) for (const cell of row) cellSteps(cell, ops);
    } else if (isPicture(block) && block.pictures?.[0]) {
      ops.push({
        type: 'insertPicture',
        id: block.id,
        ...place,
        picture: block.pictures[0],
        ...(block.align && { align: block.align }),
      });
    } else if (!block.locked) {
      ops.push({ type: 'insertParagraph', id: block.id, ...place, paragraph: shapeFor(block) });
    }
    // Locked before it was sent: locked once it is there.
    if (block.protect) ops.push({ type: 'protectBlock', id: block.id, protect: true });
  });
}

/**
 * The blocks that kept their order from `before` to `after` – the longest run of them; the others
 * were put elsewhere.
 */
function staying(before: readonly WriterBlock[], after: readonly WriterBlock[]): Set<string> {
  const at = new Map(before.map((block, index) => [block.id, index]));
  const kept = after.filter((block) => at.has(block.id));
  // Longest increasing run of their old places (patience sorting).
  const tails: number[] = [];
  const links: number[] = [];
  kept.forEach((block, index) => {
    const place = at.get(block.id)!;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (at.get(kept[tails[middle]!]!.id)! < place) low = middle + 1;
      else high = middle;
    }
    links[index] = low > 0 ? tails[low - 1]! : -1;
    tails[low] = index;
  });
  const stay = new Set<string>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = links[index]!) {
    stay.add(kept[index]!.id);
  }
  return stay;
}

/**
 * A block of the text put `step` blocks up (-1) or down (1), or – `to` – before the block now at
 * that index („Ebenen“). The text's own blocks only, not a cell's.
 */
export function moveBlock(blocks: Blocks, id: string, to: number): Blocks {
  const from = blocks.findIndex((block) => block.id === id);
  if (from < 0) return blocks;
  const slot = Math.max(0, Math.min(blocks.length, to));
  if (slot === from || slot === from + 1) return blocks;
  const block = blocks[from]!;
  const rest = blocks.filter((each) => each.id !== id);
  const at = slot > from ? slot - 1 : slot;
  return [...rest.slice(0, at), block, ...rest.slice(at)];
}

/** A cell that is new: its first paragraph came with it, empty – the rest is told here. */
function cellSteps(cell: WriterTableCell, ops: WriterOperation[]) {
  cell.blocks.forEach((block, index) => {
    const previous = cell.blocks[index - 1];
    if (index === 0) {
      if (!isBlank(block)) {
        ops.push({ type: 'setParagraph', id: block.id, paragraph: shapeFor(block) });
      }
    } else if (previous && !block.locked) {
      ops.push({
        type: 'insertParagraph',
        id: block.id,
        afterId: previous.id,
        paragraph: shapeFor(block),
      });
    }
  });
}

const rowKey = (row: readonly WriterTableCell[]) => row[0]?.blocks[0]?.id ?? '';

function tableSteps(before: WriterTableBlock, after: WriterTableBlock, ops: WriterOperation[]) {
  const home = new Map<string, WriterTableCell>();
  for (const row of before.rows)
    for (const cell of row) for (const block of cell.blocks) home.set(block.id, cell);
  // Paragraphs of one cell now in two, or of two in one: cells were merged or parted on the way.
  const into = new Map<WriterTableCell, WriterTableCell>();
  const moved = after.rows.some((row) =>
    row.some((cell) => {
      const from = new Set<WriterTableCell>();
      for (const block of cell.blocks) {
        const old = home.get(block.id);
        if (old) from.add(old);
      }
      if (from.size > 1) return true;
      for (const old of from) {
        if (into.has(old) && into.get(old) !== cell) return true;
        into.set(old, cell);
      }
      return false;
    }),
  );
  const columns = before.columns.length !== after.columns.length;
  if (isPlain(before) && isPlain(after) && !moved && !columns) rowSteps(before, after, ops);
  else cellsSteps(before, after, home, ops);
  if (
    before.columns.length === after.columns.length &&
    before.columns.some((share, index) => share !== after.columns[index])
  ) {
    ops.push({ type: 'setColumns', tableId: after.id, columns: [...after.columns] });
  }
}

/** A table with merged cells: how its cells lie now, in one step – then what changed in them. */
function cellsSteps(
  before: WriterTableBlock,
  after: WriterTableBlock,
  home: ReadonlyMap<string, WriterTableCell>,
  ops: WriterOperation[],
) {
  const rows = after.rows.map((row) =>
    row.map((cell) => {
      const stayed = cell.blocks.flatMap((block) => (home.has(block.id) ? [block.id] : []));
      return {
        ids: stayed.length > 0 ? stayed : [cell.blocks[0]?.id ?? newId()],
        ...(cell.colSpan && cell.colSpan > 1 && { colSpan: cell.colSpan }),
        ...(cell.rowSpan && cell.rowSpan > 1 && { rowSpan: cell.rowSpan }),
      };
    }),
  );
  const look = after.rows.flat()[0]?.blocks[0]?.look ?? before.rows.flat()[0]?.blocks[0]?.look;
  if (!look) return;
  const shaped = shapeCells(before, rows, (id) => ({
    type: 'paragraph',
    id,
    kind: 'text',
    runs: [],
    look,
  }));
  const same =
    shaped.rows.length === before.rows.length &&
    shaped.rows.every((row, rowIndex) => {
      const old = before.rows[rowIndex] ?? [];
      return (
        row.length === old.length &&
        row.every((cell, index) => {
          const was = old[index];
          return (
            was !== undefined &&
            (cell.colSpan ?? 1) === (was.colSpan ?? 1) &&
            (cell.rowSpan ?? 1) === (was.rowSpan ?? 1) &&
            cell.blocks.length === was.blocks.length &&
            cell.blocks.every((block, at) => block.id === was.blocks[at]?.id)
          );
        })
      );
    });
  // A column came or went: the step says how many there are now, and how wide.
  const columns = before.columns.length !== after.columns.length;
  if (!same || columns) {
    ops.push({
      type: 'setCells',
      tableId: after.id,
      rows,
      ...(columns && { columns: [...after.columns] }),
    });
  }
  after.rows.forEach((row, rowIndex) => {
    row.forEach((cell, index) => {
      const old = shaped.rows[rowIndex]?.[index];
      if (old) containerSteps(old.blocks, cell.blocks, ops);
    });
  });
}

function rowSteps(before: WriterTableBlock, after: WriterTableBlock, ops: WriterOperation[]) {
  const kept = new Set(after.rows.map(rowKey));
  const was = new Map(before.rows.map((row) => [rowKey(row), row]));
  // From the bottom, so each number still names the row it meant.
  for (let index = before.rows.length - 1; index >= 0; index -= 1) {
    const row = before.rows[index];
    if (row && !kept.has(rowKey(row)))
      ops.push({ type: 'removeRow', tableId: after.id, row: index });
  }
  after.rows.forEach((row, index) => {
    const old = was.get(rowKey(row));
    if (!old) {
      ops.push({
        type: 'insertRow',
        tableId: after.id,
        after: index - 1,
        cells: row.map((cell) => cell.blocks[0]?.id ?? newId()),
      });
      for (const cell of row) cellSteps(cell, ops);
      return;
    }
    row.forEach((cell, col) => {
      const oldCell = old[col];
      if (oldCell && oldCell !== cell) containerSteps(oldCell.blocks, cell.blocks, ops);
    });
  });
}

/** The steps that make `after` of `before` – what one edit (or undoing it) sends. */
export function stepsBetween(before: Blocks, after: Blocks): WriterOperation[] {
  if (before === after) return [];
  const ops: WriterOperation[] = [];
  containerSteps(before, after, ops);
  return ops;
}

/** As many steps as one request takes. */
export function inRequests(ops: readonly WriterOperation[]): WriterOperation[][] {
  const out: WriterOperation[][] = [];
  for (let index = 0; index < ops.length; index += MAX_WRITER_OPERATIONS) {
    out.push(ops.slice(index, index + MAX_WRITER_OPERATIONS));
  }
  return out;
}

// ── What comes from the server ──────────────────────────────────────────────

function fromShape(
  paragraph: WriterParagraph,
  id: string,
  formats: Formats,
  old?: WriterParagraphBlock,
): WriterParagraphBlock {
  const format = writerFormatOf(paragraph);
  return {
    type: 'paragraph',
    id,
    kind: paragraph.kind,
    ...(paragraph.kind === 'heading' && { level: paragraph.level ?? 1 }),
    ...(paragraph.align && { align: paragraph.align }),
    ...(paragraph.list && { list: paragraph.list }),
    ...(paragraph.breakBefore && { breakBefore: true }),
    ...(paragraph.lineHeight && { lineHeight: paragraph.lineHeight }),
    runs: normalize(paragraph.runs),
    // Its own look where the format stayed (an indent of the file's); else the format's.
    look: old && writerFormatOf(old) === format ? old.look : formats[format],
  };
}

function placeIn(
  blocks: Blocks,
  place: { afterId?: string | undefined; beforeId?: string | undefined },
  added: WriterBlock,
): Blocks | null {
  const ref = place.afterId ?? place.beforeId;
  if (!ref) return [...blocks, added];
  const put = (list: readonly WriterBlock[]) =>
    list.flatMap((block) =>
      block.id !== ref ? [block] : place.afterId ? [block, added] : [added, block],
    );
  if (blocks.some((block) => block.id === ref)) return put(blocks);
  const entry = find(blocks, ref);
  if (!entry?.cell || added.type !== 'paragraph') return null;
  return withContainer(blocks, entry, put);
}

/**
 * Someone else's steps, done to these blocks as the server did them to the file. A step whose
 * paragraph is not there (any more) is left out; `keep` names paragraphs whose text here is
 * newer than the step and stays.
 */
export function applySteps(
  blocks: Blocks,
  ops: readonly WriterOperation[],
  formats: Formats,
  keep: (id: string) => boolean = () => false,
): { blocks: Blocks; page?: WriterPage; formats: Formats } {
  let next = blocks;
  let page: WriterPage | undefined;
  const known = () => new Set(entries(next).map((entry) => entry.block.id));
  for (const op of ops) {
    if (op.type === 'setPage') page = op.page;
    else if (op.type === 'setFormatLook') {
      // What follows in the same step is read in the format as it is now.
      ({ blocks: next, formats } = setFormatLook(next, formats, op.format, op.look));
    } else if (op.type === 'setParagraph') {
      if (keep(op.id)) continue;
      next = withParagraph(next, op.id, (block) =>
        block.locked ? block : fromShape(op.paragraph, op.id, formats, block),
      );
    } else if (op.type === 'insertParagraph') {
      if (known().has(op.id)) continue;
      next = placeIn(next, op, fromShape(op.paragraph, op.id, formats)) ?? next;
    } else if (op.type === 'protectBlock') {
      next = protectBlock(next, op.id, op.protect);
    } else if (op.type === 'moveBlock') {
      const block = next.find((each) => each.id === op.id);
      if (!block) continue;
      next =
        placeIn(
          next.filter((each) => each !== block),
          op,
          block,
        ) ?? next;
    } else if (op.type === 'insertPicture') {
      if (known().has(op.id)) continue;
      const block: WriterParagraphBlock = {
        ...emptyParagraph(formats, op.id),
        locked: true,
        pictures: [op.picture],
        ...(op.align && { align: op.align }),
      };
      next = placeIn(next, op, block) ?? next;
    } else if (op.type === 'insertTable') {
      if (next.some((block) => block.id === op.id)) continue;
      const columns = op.cells[0]?.length ?? 1;
      const table: WriterTableBlock = {
        type: 'table',
        id: op.id,
        columns: Array.from({ length: columns }, () => 1 / columns),
        rows: op.cells.map((row) => row.map((id) => ({ blocks: [emptyParagraph(formats, id)] }))),
      };
      next = placeIn(next, op, table) ?? next;
    } else if (op.type === 'insertRow') {
      next = next.map((block) => {
        if (block.id !== op.tableId || block.type !== 'table') return block;
        const row = op.cells.map((id) => ({ blocks: [emptyParagraph(formats, id)] }));
        return {
          ...block,
          rows: [...block.rows.slice(0, op.after + 1), row, ...block.rows.slice(op.after + 1)],
        };
      });
    } else if (op.type === 'removeRow') {
      next = removeRow(next, op.tableId, op.row);
    } else if (op.type === 'setCells') {
      next = withTable(next, op.tableId, (table) => ({
        ...shapeCells(table, op.rows, (id) => emptyParagraph(formats, id)),
        ...(op.columns && { columns: op.columns }),
      }));
    } else if (op.type === 'setColumns') {
      next = withTable(next, op.tableId, (table) =>
        op.columns.length === table.columns.length ? { ...table, columns: op.columns } : table,
      );
    } else {
      // A paragraph or a table gone – from the text, or from its cell.
      if (next.some((block) => block.id === op.id)) {
        next = next.filter((block) => block.id !== op.id);
      } else {
        const entry = find(next, op.id);
        if (entry) {
          next = withContainer(next, entry, (container) =>
            container.length > 1 ? container.filter((block) => block.id !== op.id) : container,
          );
        }
      }
    }
  }
  if (next.length === 0) next = [emptyParagraph(formats)];
  return page ? { blocks: next, page, formats } : { blocks: next, formats };
}

/** A place that is still there after the blocks changed: itself, or the nearest paragraph. */
export function settle(blocks: Blocks, point: Point, fallback?: string): Point {
  const block = paragraphOf(blocks, point.id);
  if (block) return { id: block.id, offset: Math.min(point.offset, lengthOf(block)) };
  const other = (fallback && paragraphOf(blocks, fallback)) || entries(blocks)[0]?.block;
  return { id: other?.id ?? '', offset: 0 };
}

// ── Searching ───────────────────────────────────────────────────────────────

export interface Hit {
  id: string;
  start: number;
  end: number;
}

/** Every place `query` stands, upper and lower case alike. */
export function findAll(blocks: Blocks, query: string): Hit[] {
  const needle = query.toLowerCase();
  if (needle === '') return [];
  const hits: Hit[] = [];
  for (const { block } of entries(blocks)) {
    const text = writerText(block).toLowerCase();
    let at = text.indexOf(needle);
    while (at >= 0) {
      hits.push({ id: block.id, start: at, end: at + needle.length });
      at = text.indexOf(needle, at + needle.length);
    }
  }
  return hits;
}

/** How many words the text has. */
export function countWords(blocks: Blocks): number {
  let count = 0;
  for (const { block } of entries(blocks)) {
    // A picture in the line is no word.
    count += writerText(block)
      .replaceAll(WRITER_PICTURE_CHAR, ' ')
      .split(/\s+/u)
      .filter(Boolean).length;
  }
  return count;
}

/** The list marker each list paragraph of the text wears, numbers counted through. */
export function markers(blocks: readonly WriterBlock[]): Map<string, string> {
  const out = new Map<string, string>();
  const BULLETS = ['•', '◦', '▪'];
  const mark = (list: readonly WriterBlock[]) => {
    let counts: number[] = [];
    for (const block of list) {
      if (block.type === 'table') {
        counts = [];
        for (const row of block.rows) for (const cell of row) mark(cell.blocks);
        continue;
      }
      if (!block.list) {
        counts = [];
        continue;
      }
      const { kind, level } = block.list;
      counts = counts.slice(0, level + 1);
      if (kind === 'number') {
        counts[level] = (counts[level] ?? 0) + 1;
        out.set(block.id, `${counts[level]}.`);
      } else {
        // Points do not count; numbers below them start anew.
        counts[level] = 0;
        out.set(block.id, BULLETS[level % BULLETS.length] ?? '•');
      }
    }
  };
  mark(blocks);
  return out;
}
