import type { EditableElement, LiveParagraph, LiveTextStyle } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import {
  addedElement,
  alignRange,
  applyToElement,
  commonValue,
  formatRange,
  liveFromRich,
  plainParagraph,
  richFromLive,
  styleAt,
  wordAt,
} from './model';

const style = (over: Partial<LiveTextStyle> = {}): LiveTextStyle => ({
  font: 'Calibri',
  size: 20,
  color: '#000000',
  bold: false,
  italic: false,
  underline: false,
  ...over,
});

const paragraph = (...runs: [string, Partial<LiveTextStyle>?][]): LiveParagraph => ({
  ...plainParagraph(style()),
  runs: runs.map(([text, over]) => ({ ...style(over), text })),
});

const texts = (paragraphs: LiveParagraph[]) =>
  paragraphs.map((p) => p.runs.map((run) => [run.text, run.bold, run.italic]));

describe('formatting a stretch of text', () => {
  it('splits runs at the selection and joins equal neighbours', () => {
    const paragraphs = [paragraph(['Hallo Welt'])];
    const bold = formatRange(
      paragraphs,
      { start: { paragraph: 0, offset: 6 }, end: { paragraph: 0, offset: 10 } },
      { bold: true },
    );
    expect(texts(bold)).toEqual([
      [
        ['Hallo ', false, false],
        ['Welt', true, false],
      ],
    ]);
    const plain = formatRange(
      bold,
      { start: { paragraph: 0, offset: 0 }, end: { paragraph: 0, offset: 10 } },
      { bold: false },
    );
    expect(texts(plain)).toEqual([[['Hallo Welt', false, false]]]);
  });

  it('formats the word at a caret, or the paragraph’s next text on an empty line', () => {
    const paragraphs = [paragraph(['eins zwei drei']), paragraph()];
    const caret = (p: number, offset: number) => ({
      start: { paragraph: p, offset },
      end: { paragraph: p, offset },
    });
    expect(texts(formatRange(paragraphs, caret(0, 6), { italic: true }))[0]).toEqual([
      ['eins ', false, false],
      ['zwei', false, true],
      [' drei', false, false],
    ]);
    const empty = formatRange(paragraphs, caret(1, 0), { size: 40 });
    expect(empty[1]?.mark.size).toBe(40);
    expect(wordAt('a-b c', 1)).toEqual([0, 3]);
  });

  it('formats across paragraphs and everything without a range', () => {
    const paragraphs = [paragraph(['ab']), paragraph(['cd']), paragraph(['ef'])];
    const across = formatRange(
      paragraphs,
      { start: { paragraph: 0, offset: 1 }, end: { paragraph: 1, offset: 1 } },
      { bold: true },
    );
    expect(texts(across)).toEqual([
      [
        ['a', false, false],
        ['b', true, false],
      ],
      [
        ['c', true, false],
        ['d', false, false],
      ],
      [['ef', false, false]],
    ]);
    const all = formatRange(paragraphs, null, { color: '#ff0000' });
    expect(commonValue(all, 'color')).toBe('#ff0000');
    expect(commonValue(across, 'bold')).toBeNull();
    expect(alignRange(paragraphs, null, 'center').every((p) => p.align === 'center')).toBe(true);
  });

  it('reads the style at a point from the character before it', () => {
    const paragraphs = [paragraph(['ab', { bold: true }], ['cd'])];
    expect(styleAt(paragraphs, { paragraph: 0, offset: 0 }).bold).toBe(true);
    expect(styleAt(paragraphs, { paragraph: 0, offset: 2 }).bold).toBe(true);
    expect(styleAt(paragraphs, { paragraph: 0, offset: 3 }).bold).toBe(false);
  });
});

describe('the editor’s changes before the server answers', () => {
  const element: EditableElement = {
    id: 'sl1',
    kind: 'text',
    name: 'Title 1',
    role: 'title',
    credit: null,
    bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
    paragraphs: ['Alt'],
    movable: true,
    resizable: true,
    live: {
      fill: null,
      stroke: null,
      padding: { top: 3, right: 7, bottom: 3, left: 7 },
      verticalAlign: 'top',
      autoGrow: false,
      minHeight: null,
      placeholder: false,
      paragraphs: [{ ...paragraph(['Alt']), spaceBefore: 6, bullet: null }],
    },
  };

  it('keeps each paragraph’s look for the new text', () => {
    const rich = richFromLive([paragraph(['Neu', { bold: true }]), paragraph()]);
    expect(rich[1]?.runs).toEqual([{ ...style(), text: '' }]);
    const next = applyToElement(element, {
      type: 'setRichText',
      elementId: 'sl1',
      paragraphs: rich,
    });
    expect(next?.paragraphs).toEqual(['Neu', '']);
    expect(next?.live?.paragraphs.map((p) => p.spaceBefore)).toEqual([6, 6]);
    expect(next?.live?.paragraphs[0]?.runs[0]?.bold).toBe(true);
    expect(liveFromRich([], rich)[0]?.lineSpacing).toEqual({ type: 'proportional', value: 1 });
  });

  it('moves, restyles and deletes', () => {
    const box = { x: 0.2, y: 0.3, w: 0.1, h: 0.1 };
    expect(applyToElement(element, { type: 'setBox', elementId: 'sl1', box })?.bbox).toEqual(box);
    expect(
      applyToElement(element, { type: 'setShapeStyle', elementId: 'sl1', fill: '#ABCDEF' })?.live
        ?.fill,
    ).toBe('#abcdef');
    expect(applyToElement(element, { type: 'deleteElement', elementId: 'sl1' })).toBeNull();
  });

  it('adds a text box that grows with its text', () => {
    const added = addedElement(
      {
        type: 'addElement',
        slideIndex: 0,
        elementId: 'sl-new',
        kind: 'text',
        box: { x: 0, y: 0, w: 0.5, h: 0.1 },
        fill: null,
        stroke: null,
        paragraphs: [{ align: 'left', runs: [{ ...style(), text: '' }] }],
      },
      { width: 28, height: 15.75 },
    );
    expect(added.live).toMatchObject({ autoGrow: true, verticalAlign: 'top' });
    expect(added.live?.minHeight).toBeCloseTo(15.75 * 0.1 * (72 / 2.54), 3);
  });
});
