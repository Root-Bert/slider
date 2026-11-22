import { describe, expect, it } from 'vitest';
import { fromText } from './paste';
import type { WriterBlock, WriterLook, WriterParagraphBlock } from '@slider/shared';
import { movedAnchor, WRITER_FORMATS } from '@slider/shared';
import {
  applySteps,
  caret,
  cellRange,
  deleteSelection,
  entries,
  findAll,
  fontAt,
  formatSteps,
  lineHeightAt,
  lookAt,
  setFormatLook,
  setLineHeight,
  indent,
  insertParagraphs,
  countWords,
  insertInlinePicture,
  insertPicture,
  insertColumn,
  insertRow,
  insertTable,
  insertText,
  joinBackward,
  joinForward,
  markers,
  mergeCells,
  paragraphOf,
  pictureAt,
  resizePicture,
  alignPicture,
  removeColumn,
  removeRow,
  setColumns,
  setFont,
  setFormat,
  setLink,
  setSize,
  sizeAt,
  splitCell,
  splitParagraph,
  stepsBetween,
  toggleList,
  toggleMark,
  type Blocks,
  type Formats,
  type Sel,
  moveBlock,
  protectBlock,
  protectedIds,
  touchesProtected,
} from './model';

const look = (over: Partial<WriterLook> = {}): WriterLook => ({
  font: 'Literata',
  size: 11,
  color: '#1a1a1a',
  bold: false,
  italic: false,
  lineHeight: 1.4,
  spaceBefore: 0,
  spaceAfter: 8,
  indentLeft: 0,
  indentRight: 0,
  indentFirst: 0,
  align: 'left',
  ...over,
});
const formats = Object.fromEntries(
  WRITER_FORMATS.map((format) => [
    format,
    look(format.startsWith('heading') || format === 'title' ? { bold: true, size: 20 } : {}),
  ]),
) as Formats;

const p = (id: string, text: string, over: Partial<WriterParagraphBlock> = {}): WriterBlock => ({
  type: 'paragraph',
  id,
  kind: 'text',
  runs: text ? [{ text }] : [],
  look: formats.text,
  ...over,
});
const words = (blocks: Blocks) =>
  entries(blocks).map(({ block }) => block.runs.map((run) => run.text).join(''));
const range = (a: string, from: number, b: string, to: number): Sel => ({
  anchor: { id: a, offset: from },
  focus: { id: b, offset: to },
});
/** What the server (and everyone else with it open) makes of the steps: the same blocks. */
const sent = (before: Blocks, after: Blocks) => {
  const steps = stepsBetween(before, after);
  const there = applySteps(before, steps, formats).blocks;
  expect(JSON.parse(JSON.stringify(there))).toEqual(JSON.parse(JSON.stringify(after)));
  return steps;
};

describe('the document in the editor', () => {
  it('is edited as blocks and told to the server as the steps between two of its states – and back, for undo', () => {
    const start: Blocks = [
      p('a', 'Titel', {
        kind: 'heading',
        level: 1,
        look: formats.heading1,
        runs: [{ text: 'Titel', bold: true }],
      }),
      p('b', 'Hallo Welt'),
      p('c', 'Ende'),
    ];

    // Typing looks as its place does; over a selection it takes its place.
    let now = insertText(start, caret('b', 5), ' schöne', formats);
    expect(words(now.blocks)[1]).toBe('Hallo schöne Welt');
    expect(now.sel.focus).toEqual({ id: 'b', offset: 12 });
    expect(sent(start, now.blocks)).toHaveLength(1);
    const typedInHeading = insertText(start, caret('a', 5), '!', formats);
    expect(paragraphOf(typedInHeading.blocks, 'a')?.runs).toEqual([{ text: 'Titel!', bold: true }]);

    // A mark on part of a paragraph parts its text; taken off, it is one stretch again.
    const bold = toggleMark(now.blocks, range('b', 0, 'b', 5), 'bold');
    expect(paragraphOf(bold, 'b')?.runs).toEqual([
      { text: 'Hallo', bold: true },
      { text: ' schöne Welt' },
    ]);
    expect(paragraphOf(toggleMark(bold, range('b', 0, 'b', 5), 'bold'), 'b')?.runs).toHaveLength(1);
    const linked = setLink(bold, range('b', 6, 'b', 12), 'https://example.org');
    expect(paragraphOf(linked, 'b')?.runs[2]).toMatchObject({
      link: 'https://example.org',
      underline: true,
    });
    // Behind a link the text is no link.
    expect(
      paragraphOf(insertText(linked, caret('b', 12), '!', formats).blocks, 'b')?.runs[3],
    ).toEqual({
      text: '! Welt',
    });
    sent(now.blocks, linked);

    // ↵ parts a paragraph, after a heading comes text; ⌫ at the start joins them again.
    const split = splitParagraph(linked, caret('b', 5), formats);
    expect(words(split.blocks)).toEqual(['Titel', 'Hallo', ' schöne Welt', 'Ende']);
    const steps = sent(linked, split.blocks);
    expect(steps.map((step) => step.type)).toEqual(['setParagraph', 'insertParagraph']);
    const afterHeading = splitParagraph(start, caret('a', 5), formats);
    expect(paragraphOf(afterHeading.blocks, afterHeading.sel.focus.id)).toMatchObject({
      kind: 'text',
      runs: [],
    });
    const above = splitParagraph(start, caret('b', 0), formats);
    expect(above.sel.focus).toEqual({ id: 'b', offset: 0 });
    expect(words(above.blocks)).toEqual(['Titel', '', 'Hallo Welt', 'Ende']);
    const joined = joinBackward(split.blocks, split.sel.focus.id, formats);
    expect(words(joined.blocks)).toEqual(words(linked));
    expect(joined.sel.focus).toEqual({ id: 'b', offset: 5 });
    sent(split.blocks, joined.blocks);
    expect(words(joinForward(start, 'b', formats).blocks)).toEqual(['Titel', 'Hallo WeltEnde']);

    // A stretch over paragraphs goes; the two ends become one.
    const cut = deleteSelection(start, range('a', 2, 'c', 2), formats);
    expect(words(cut.blocks)).toEqual(['Tide']);
    expect(
      sent(start, cut.blocks)
        .map((step) => step.type)
        .sort(),
    ).toEqual(['remove', 'remove', 'setParagraph']);

    // Formats: what looked as the old one says looks as the new one says.
    const heading = setFormat(bold, ['b'], 'heading2', formats);
    expect(paragraphOf(heading, 'b')).toMatchObject({ kind: 'heading', level: 2 });
    expect(paragraphOf(heading, 'b')?.runs).toEqual([{ text: 'Hallo schöne Welt', bold: true }]);
    sent(bold, heading);

    // Lists: numbers count through, start anew after other text, a level in and out.
    let list = toggleList(start, ['b', 'c'], 'number');
    list = indent(list, ['c'], 1);
    expect([...markers(list)]).toEqual([
      ['b', '1.'],
      ['c', '1.'],
    ]);
    expect([...markers(indent(list, ['c'], -1)).values()]).toEqual(['1.', '2.']);
    sent(start, list);
    const leftList = splitParagraph(toggleList(start, ['c'], 'bullet'), caret('c', 4), formats);
    const out = splitParagraph(leftList.blocks, leftList.sel, formats);
    expect(paragraphOf(out.blocks, out.sel.focus.id)?.list).toBeUndefined();
    expect(paragraphOf(toggleList(list, ['b', 'c'], 'number'), 'b')?.list).toBeUndefined();

    // A table with rows; a picture; several paragraphs pasted – each told as steps.
    const table = insertTable(start, 'c', 2, 2, formats);
    expect(table.blocks.at(-1)?.type).toBe('paragraph');
    const tableId = table.blocks[3]?.id ?? '';
    const filled = insertText(table.blocks, table.sel, 'Zelle', formats);
    const more = insertRow(filled.blocks, tableId, 0, formats);
    expect(more).not.toBeNull();
    const rows = removeRow(more?.blocks ?? [], tableId, 0);
    sent(start, filled.blocks);
    sent(filled.blocks, more?.blocks ?? []);
    sent(more?.blocks ?? [], rows);
    // Cells merged: the first reaches over the others and holds what they held; a row longer
    // it makes it longer, a row out of it shorter; parted, every place has a cell again.
    const grid = insertTable(start, 'c', 3, 3, formats);
    const gridId = grid.blocks[3]?.id ?? '';
    const at = entries(grid.blocks).flatMap((entry) => (entry.cell ? [entry.block.id] : []));
    const lettered = insertText(
      insertText(grid.blocks, caret(at[0] ?? '', 0), 'A', formats).blocks,
      caret(at[4] ?? '', 0),
      'E',
      formats,
    ).blocks;
    const spans = (blocks: Blocks) => {
      const found = blocks.find((block) => block.id === gridId);
      return found?.type === 'table'
        ? found.rows.map((row) =>
            row.map(
              (cell) => `${words(cell.blocks).join('+')}${cell.colSpan ?? 1}${cell.rowSpan ?? 1}`,
            ),
          )
        : [];
    };
    expect(cellRange(lettered, range(at[0] ?? '', 0, at[1] ?? '', 0))?.cells).toHaveLength(2);
    expect(mergeCells(lettered, caret(at[0] ?? '', 0))).toBeNull();
    const merged = mergeCells(lettered, range(at[4] ?? '', 1, at[0] ?? '', 0));
    expect(spans(merged?.blocks ?? [])).toEqual([['A+E22', '11'], ['11'], ['11', '11', '11']]);
    expect(sent(lettered, merged?.blocks ?? []).map((step) => step.type)).toEqual(['setCells']);
    sent(merged?.blocks ?? [], lettered);
    // A selection that touches a merged cell takes all of it.
    expect(
      cellRange(merged?.blocks ?? [], range(at[0] ?? '', 0, at[8] ?? '', 0))?.cells,
    ).toHaveLength(6);
    const longer = insertRow(merged?.blocks ?? [], gridId, 0, formats);
    expect(spans(longer?.blocks ?? [])).toEqual([
      ['A+E23', '11'],
      ['11'],
      ['11'],
      ['11', '11', '11'],
    ]);
    sent(merged?.blocks ?? [], longer?.blocks ?? []);
    const shorter = removeRow(longer?.blocks ?? [], gridId, 0);
    expect(spans(shorter)).toEqual([['A+E22', '11'], ['11'], ['11', '11', '11']]);
    sent(longer?.blocks ?? [], shorter);
    const parted = splitCell(shorter, at[0] ?? '', formats);
    expect(spans(parted?.blocks ?? [])).toEqual([
      ['A+E11', '11', '11'],
      ['11', '11', '11'],
      ['11', '11', '11'],
    ]);
    expect(splitCell(parted?.blocks ?? [], at[0] ?? '', formats)).toBeNull();
    sent(shorter, parted?.blocks ?? []);
    // Several edits in one go – merged and parted again, a row come – are still told right.
    sent(lettered, parted?.blocks ?? []);
    sent(parted?.blocks ?? [], lettered);
    sent(lettered, longer?.blocks ?? []);
    // A column's width is a step of its own.
    const wide = setColumns(lettered, gridId, [2, 1, 1]);
    expect(sent(lettered, wide)).toEqual([
      { type: 'setColumns', tableId: gridId, columns: [0.5, 0.25, 0.25] },
    ]);
    expect(setColumns(wide, gridId, [0.5, 0.25, 0.25])).toEqual(wide);
    // A column comes and goes: in a plain table, through a merged cell, and each way back.
    const shares = (blocks: Blocks) => {
      const found = blocks.find((block) => block.id === gridId);
      return found?.type === 'table' ? found.columns.map((share) => Number(share.toFixed(3))) : [];
    };
    const fourth = insertColumn(wide, gridId, -1, formats, 0, 1);
    expect(shares(fourth?.blocks ?? [])).toEqual([0.333, 0.333, 0.167, 0.167]);
    expect(spans(fourth?.blocks ?? [])[1]).toEqual(['11', '11', 'E11', '11']);
    expect(
      entries(fourth?.blocks ?? []).find((entry) => entry.block.id === fourth?.sel?.focus.id)?.cell,
    ).toMatchObject({
      row: 1,
      col: 0,
    });
    const told = sent(wide, fourth?.blocks ?? []);
    expect(told.map((step) => step.type)).toEqual(['setCells']);
    expect(told[0]).toHaveProperty('columns');
    sent(fourth?.blocks ?? [], wide);
    const within = insertColumn(merged?.blocks ?? [], gridId, 0, formats);
    expect(spans(within?.blocks ?? [])).toEqual([
      ['A+E32', '11'],
      ['11'],
      ['11', '11', '11', '11'],
    ]);
    expect(shares(within?.blocks ?? [])).toEqual([0.25, 0.25, 0.25, 0.25]);
    sent(merged?.blocks ?? [], within?.blocks ?? []);
    sent(within?.blocks ?? [], merged?.blocks ?? []);
    const narrow = removeColumn(merged?.blocks ?? [], gridId, 1);
    expect(spans(narrow)).toEqual([['A+E12', '11'], ['11'], ['11', '11']]);
    expect(shares(narrow)).toEqual([0.5, 0.5]);
    sent(merged?.blocks ?? [], narrow);
    sent(narrow, merged?.blocks ?? []);
    const headless = removeColumn(lettered, gridId, 0);
    expect(spans(headless)).toEqual([
      ['11', '11'],
      ['E11', '11'],
      ['11', '11'],
    ]);
    sent(lettered, headless);
    sent(headless, lettered);
    // A cell that reaches down over a row whose only own cell goes takes the row with it.
    const tall = mergeCells(lettered, range(at[0] ?? '', 0, at[3] ?? '', 0));
    const both = mergeCells(tall?.blocks ?? [], range(at[1] ?? '', 0, at[4] ?? '', 0))?.blocks;
    expect(spans(both ?? [])).toEqual([['A12', 'E12', '11'], ['11'], ['11', '11', '11']]);
    const flat = removeColumn(both ?? [], gridId, 2);
    expect(spans(flat)).toEqual([
      ['A11', 'E11'],
      ['11', '11'],
    ]);
    sent(both ?? [], flat);
    sent(flat, both ?? []);
    const one = removeColumn(removeColumn(lettered, gridId, 0), gridId, 0);
    expect(shares(one)).toEqual([1]);
    expect(removeColumn(one, gridId, 0)).toEqual(one);

    // Across cells only the words go.
    const cells = entries(filled.blocks).filter((entry) => entry.cell);
    const across = deleteSelection(
      filled.blocks,
      range(cells[0]?.block.id ?? '', 1, cells[3]?.block.id ?? '', 0),
      formats,
    );
    expect(entries(across.blocks).filter((entry) => entry.cell)).toHaveLength(4);
    expect(words(across.blocks)[3]).toBe('Z');

    const picture = insertPicture(
      start,
      'b',
      { path: 'Pictures/a.png', width: 100, height: 50 },
      formats,
    );
    expect(sent(start, picture.blocks).map((step) => step.type)).toEqual(['insertPicture']);
    // „Ebenen“: a block put elsewhere is one step, the others stay where they are.
    const lifted = moveBlock(picture.blocks, picture.blocks[0]!.id, picture.blocks.length);
    expect(lifted.at(-1)?.id).toBe(picture.blocks[0]!.id);
    expect(sent(picture.blocks, lifted).map((step) => step.type)).toEqual(['moveBlock']);
    expect(sent(lifted, picture.blocks)).toHaveLength(1);
    expect(moveBlock(picture.blocks, picture.blocks[1]!.id, 2)).toBe(picture.blocks);
    // Locked (⇧⌘L): one step there and back; what changes it then is refused, its unlocking not.
    const first = picture.blocks[0]!.id;
    const locked = protectBlock(picture.blocks, first, true);
    expect(sent(picture.blocks, locked)).toEqual([
      { type: 'protectBlock', id: first, protect: true },
    ]);
    expect(protectBlock(locked, first, true)).toBe(locked);
    // Locked before it was sent: put there, then locked.
    const newPicture = picture.blocks.find(
      (block) => block.type === 'paragraph' && block.pictures,
    )!;
    expect(
      sent(start, protectBlock(picture.blocks, newPicture.id, true)).map((step) => step.type),
    ).toEqual(['insertPicture', 'protectBlock']);
    const ids = protectedIds(locked);
    expect(touchesProtected(stepsBetween(locked, moveBlock(locked, first, 3)), ids)).toBe(true);
    expect(touchesProtected(stepsBetween(locked, picture.blocks), ids)).toBe(false);
    // ⌫ below a picture takes it out; undoing puts it back.
    const gone = joinBackward(picture.blocks, 'c', formats);
    expect(gone.blocks).toHaveLength(3);
    sent(gone.blocks, picture.blocks);

    {
      // A picture in a line is one character of it: typed around, removed like a letter, never
      // one with its neighbours – and what is typed beside it looks as the words do.
      const shown = { path: 'Pictures/a.png', width: 100, height: 50 };
      expect(insertInlinePicture([p('e', '')], { id: 'e', offset: 0 }, shown, formats)).toBeNull();
      const boldStart: Blocks = [
        p('a', 'Hallo Welt', { runs: [{ text: 'Hallo Welt', bold: true }] }),
      ];
      const inLine = insertInlinePicture(boldStart, { id: 'a', offset: 5 }, shown, formats);
      if (!inLine) throw new Error('no picture');
      expect(inLine.sel).toEqual(caret('a', 6));
      expect(paragraphOf(inLine.blocks, 'a')?.runs).toEqual([
        { text: 'Hallo', bold: true },
        { text: '\uFFFC', picture: shown },
        { text: ' Welt', bold: true },
      ]);
      expect(sent(boldStart, inLine.blocks).map((step) => step.type)).toEqual(['setParagraph']);
      const twice = insertInlinePicture(inLine.blocks, { id: 'a', offset: 6 }, shown, formats);
      expect(paragraphOf(twice?.blocks ?? [], 'a')?.runs).toHaveLength(4);
      const lineOf = (blocks: Blocks) => paragraphOf(blocks, 'a') as WriterParagraphBlock;
      expect(pictureAt(lineOf(inLine.blocks), 5)).toEqual(shown);
      expect(pictureAt(lineOf(inLine.blocks), 4)).toBeUndefined();
      const besides = insertText(inLine.blocks, caret('a', 6), 'x', formats);
      expect(lineOf(besides.blocks).runs.at(-1)).toEqual({ text: 'x Welt', bold: true });
      const bolder = toggleMark(inLine.blocks, range('a', 0, 'a', 11), 'italic');
      expect(lineOf(bolder).runs[1]).toEqual({ text: '\uFFFC', picture: shown });
      const sized = resizePicture(inLine.blocks, 'a', 5, { width: 50, height: 25 });
      expect(pictureAt(lineOf(sized.blocks), 5)).toEqual({ ...shown, width: 50, height: 25 });
      expect(sent(inLine.blocks, sized.blocks).map((step) => step.type)).toEqual(['setParagraph']);
      sent(sized.blocks, inLine.blocks);
      const parted = splitParagraph(inLine.blocks, caret('a', 5), formats);
      sent(inLine.blocks, parted.blocks);
      const taken = joinBackward(inLine.blocks, 'a', formats);
      expect(taken.blocks).toEqual(inLine.blocks);
      const less = deleteSelection(inLine.blocks, range('a', 5, 'a', 6), formats);
      expect(lineOf(less.blocks).runs).toEqual([{ text: 'Hallo Welt', bold: true }]);
      expect(countWords(inLine.blocks)).toBe(2);
      expect(findAll(inLine.blocks, 'Welt')[0]).toEqual({ id: 'a', start: 7, end: 11 });
      // The one standing alone is sized as a new paragraph in its place.
      const standing =
        entries(picture.blocks).find((entry) => entry.block.pictures)?.block.id ?? '';
      const alone = resizePicture(picture.blocks, standing, null, { width: 60, height: 30 });
      expect(alone.blocks).toHaveLength(4);
      expect(paragraphOf(alone.blocks, alone.id)?.pictures).toEqual([
        { path: 'Pictures/a.png', width: 60, height: 30 },
      ]);
      expect(
        sent(picture.blocks, alone.blocks)
          .map((step) => step.type)
          .sort(),
      ).toEqual(['insertPicture', 'remove']);
      // Centred the same way: a new paragraph, the file told where it stands.
      const centred = alignPicture(picture.blocks, standing, null, 'center');
      expect(paragraphOf(centred.blocks, centred.id)?.align).toBe('center');
      expect(sent(picture.blocks, centred.blocks)).toContainEqual(
        expect.objectContaining({ type: 'insertPicture', id: centred.id, align: 'center' }),
      );
      expect(alignPicture(centred.blocks, centred.id, null, 'center').blocks).toBe(centred.blocks);
    }

    {
      // A font and a size set by hand are marks like a colour: on the selected words, read back
      // as the one value they wear (`null`: several), dropped where they are the paragraph's own.
      const all = range('b', 0, 'b', 10);
      const big = setSize(
        setFont(start, range('b', 0, 'b', 5), 'Inter'),
        range('b', 0, 'b', 5),
        20,
      );
      expect(paragraphOf(big, 'b')?.runs).toEqual([
        { text: 'Hallo', font: 'Inter', size: 20 },
        { text: ' Welt' },
      ]);
      expect(sent(start, big).map((step) => step.type)).toEqual(['setParagraph']);
      expect([fontAt(big, range('b', 0, 'b', 5)), sizeAt(big, range('b', 1, 'b', 4))]).toEqual([
        'Inter',
        20,
      ]);
      expect([fontAt(big, all), sizeAt(big, all)]).toEqual([null, null]);
      expect([fontAt(big, range('b', 5, 'b', 10)), sizeAt(big, range('b', 5, 'b', 10))]).toEqual([
        formats.text.font,
        formats.text.size,
      ]);
      // A caret: as the letter before it – or what is about to be typed.
      expect([fontAt(big, caret('b', 3)), sizeAt(big, caret('b', 3))]).toEqual(['Inter', 20]);
      expect(sizeAt(big, caret('b', 8))).toBe(formats.text.size);
      expect(sizeAt(big, caret('b', 8), { size: 30 })).toBe(30);
      expect(fontAt(big, caret('b', 3), {})).toBe(formats.text.font);
      const typed = insertText(big, caret('b', 10), '!', formats, { font: 'Inter', size: 30 });
      expect(paragraphOf(typed.blocks, 'b')?.runs.at(-1)).toEqual({
        text: '!',
        font: 'Inter',
        size: 30,
      });
      // The paragraph's own, said by name or as `null`: no mark.
      expect(setSize(setFont(big, all, null), all, null)).toEqual(start);
      expect(setSize(setFont(big, all, formats.text.font), all, formats.text.size)).toEqual(start);
    }

    {
      // A format's own look, for the whole document: its paragraphs follow, text that was bold
      // as the format was is as the format is now, a font set by hand that the format now says
      // itself is no mark any more. Sent as one step of the format before the paragraphs; a
      // second client reaches the same text and the same formats, and back for undo.
      const worn = setSize(
        setFont(
          [
            ...start,
            p('h', 'Noch ein Titel', {
              kind: 'heading',
              level: 1,
              look: formats.heading1,
              runs: [
                { text: 'Noch ', bold: true },
                { text: 'ein Titel', bold: true, font: 'Arial' },
              ],
            }),
          ],
          range('a', 0, 'a', 5),
          'Inter',
        ),
        range('a', 0, 'a', 5),
        30,
      );
      expect(lookAt(worn, range('a', 0, 'a', 5))).toEqual({
        font: 'Inter',
        size: 30,
        bold: true,
        italic: false,
        color: formats.heading1.color,
      });
      expect(lookAt(worn, range('a', 0, 'h', 9))).toMatchObject({
        font: null,
        size: null,
        bold: null,
      });
      const change = { font: 'Inter', size: 30, bold: false, lineHeight: 1.15 };
      const styled = setFormatLook(worn, formats, 'heading1', change);
      expect(styled.formats.heading1).toEqual({ ...formats.heading1, ...change });
      expect(styled.formats.text).toBe(formats.text);
      expect(paragraphOf(styled.blocks, 'a')).toMatchObject({
        look: styled.formats.heading1,
        runs: [{ text: 'Titel' }],
      });
      expect(paragraphOf(styled.blocks, 'h')?.runs).toEqual([
        { text: 'Noch ' },
        { text: 'ein Titel', font: 'Arial' },
      ]);
      expect(paragraphOf(styled.blocks, 'b')).toBe(paragraphOf(worn, 'b'));
      expect(setFormatLook(worn, formats, 'heading1', { size: formats.heading1.size })).toEqual({
        blocks: worn,
        formats,
      });
      const steps = [...formatSteps(formats, styled.formats), ...stepsBetween(worn, styled.blocks)];
      expect(steps[0]).toEqual({ type: 'setFormatLook', format: 'heading1', look: change });
      const there = applySteps(worn, steps, formats);
      expect(there.formats).toEqual(styled.formats);
      expect(JSON.parse(JSON.stringify(there.blocks))).toEqual(
        JSON.parse(JSON.stringify(styled.blocks)),
      );
      const back = applySteps(
        styled.blocks,
        [...formatSteps(styled.formats, formats), ...stepsBetween(styled.blocks, worn)],
        styled.formats,
      );
      expect(back.formats).toEqual(formats);
      expect(JSON.parse(JSON.stringify(back.blocks))).toEqual(JSON.parse(JSON.stringify(worn)));

      // Line spacing of a paragraph's own: over its format's, `null` takes it away again.
      const wide = setLineHeight(start, ['b', 'c'], 2);
      expect(paragraphOf(wide, 'b')).toMatchObject({ lineHeight: 2, look: formats.text });
      expect(sent(start, wide)).toMatchObject([
        { type: 'setParagraph', id: 'b', paragraph: { lineHeight: 2 } },
        { type: 'setParagraph', id: 'c', paragraph: { lineHeight: 2 } },
      ]);
      expect(lineHeightAt(wide, ['b', 'c'])).toEqual({ own: 2, mixed: false, shown: 2 });
      expect(lineHeightAt(wide, ['a', 'b'])).toEqual({ own: null, mixed: true, shown: null });
      expect(lineHeightAt(start, ['b'])).toEqual({ own: null, mixed: false, shown: 1.4 });
      expect(setLineHeight(wide, ['b', 'c'], null)).toEqual(start);
      sent(wide, start);
      // A spacing of its own stays under a new format and under the format's new look.
      expect(paragraphOf(setFormat(wide, ['b'], 'quote', formats), 'b')?.lineHeight).toBe(2);
    }

    const pasted = insertParagraphs(
      start,
      caret('b', 5),
      [
        { kind: 'text', runs: [{ text: ' eins' }] },
        { kind: 'heading', level: 2, runs: [{ text: 'Zwei', bold: true }] },
        { kind: 'text', list: { kind: 'bullet', level: 0 }, runs: [{ text: 'drei' }] },
      ],
      formats,
    );
    expect(words(pasted.blocks)).toEqual(['Titel', 'Hallo eins', 'Zwei', 'drei Welt', 'Ende']);
    sent(start, pasted.blocks);

    // Undo is the older state: the steps back are the ones that unmake the edit.
    now = pasted;
    sent(now.blocks, start);
    sent(rows, start);

    // Steps of someone else leave what is being typed here.
    const theirs = applySteps(
      start,
      [
        { type: 'setParagraph', id: 'b', paragraph: { kind: 'text', runs: [{ text: 'Ihres' }] } },
        { type: 'setParagraph', id: 'c', paragraph: { kind: 'quote', runs: [{ text: 'Zitat' }] } },
        { type: 'remove', id: 'weg' },
      ],
      formats,
      (id) => id === 'b',
    );
    expect(words(theirs.blocks)).toEqual(['Titel', 'Hallo Welt', 'Zitat']);
    expect(findAll(start, 'el')).toEqual([
      { id: 'a', start: 3, end: 5 },
      { id: 'b', start: 7, end: 9 },
    ]);

    // A comment through two paragraphs stays at its words: typing before it moves its start,
    // typing in its last paragraph before its end stretches it, typing behind it leaves it.
    const through = {
      paragraphId: 'a',
      start: 2,
      end: 5,
      quote: 'tel',
      to: { paragraphId: 'b', offset: 5 },
    };
    expect(
      movedAnchor(through, (id) =>
        id === 'a'
          ? { before: 'Titel', after: 'Ein Titel' }
          : id === 'b'
            ? { before: 'Hallo Welt', after: 'Hallo, du Welt!' }
            : undefined,
      ),
    ).toEqual({ ...through, start: 6, end: 9, to: { paragraphId: 'b', offset: 5 } });
    expect(
      movedAnchor(through, (id) =>
        id === 'b' ? { before: 'Hallo Welt', after: 'Oh Hallo Welt' } : undefined,
      ).to,
    ).toEqual({ paragraphId: 'b', offset: 8 });
    expect(movedAnchor(through, () => undefined)).toBe(through);

    // Plain words pasted: a paragraph per line, whatever the line ends were.
    expect(fromText('eins\r\n\r\nzwei\rdrei')).toEqual([
      { kind: 'text', runs: [{ text: 'eins' }] },
      { kind: 'text', runs: [] },
      { kind: 'text', runs: [{ text: 'zwei' }] },
      { kind: 'text', runs: [{ text: 'drei' }] },
    ]);
  });
});
