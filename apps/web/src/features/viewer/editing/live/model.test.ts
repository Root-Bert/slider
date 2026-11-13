import {
  coverCrop,
  findElement,
  focusOf,
  NO_EFFECTS,
  withChildren,
  type EditableElement,
  type LiveParagraph,
  type LiveTextStyle,
} from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { listLabels, listNumber } from '@slider/shared/live-text';
import {
  addedElement,
  addedTurned,
  applyToElement,
  commonList,
  copiedElement,
  commonValue,
  formatRange,
  groupedElement,
  liveFromRich,
  maxCornerRadius,
  newPartIds,
  paragraphRange,
  plainParagraph,
  richFromLive,
  styleAt,
  withGroupIn,
  wordAt,
} from './model';
import { insertEach } from '../insert-image';
import { pastedOf, pastedParagraphs, pastedTextBox } from '../paste';
import { boxCss } from './css';
import { editorFonts } from './fonts';

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

    // A caret formats its word, or the paragraph's next text on an empty line.
    const words = [paragraph(['eins zwei drei']), paragraph()];
    const caret = (p: number, offset: number) => ({
      start: { paragraph: p, offset },
      end: { paragraph: p, offset },
    });
    expect(texts(formatRange(words, caret(0, 6), { italic: true }))[0]).toEqual([
      ['eins ', false, false],
      ['zwei', false, true],
      [' drei', false, false],
    ]);
    const empty = formatRange(words, caret(1, 0), { size: 40 });
    expect(empty[1]?.mark.size).toBe(40);
    expect(wordAt('a-b c', 1)).toEqual([0, 3]);
  });

  it('formats across paragraphs, everything without a range, and reads the style before a point', () => {
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
    expect(
      paragraphRange(paragraphs, null, { align: 'center' }).every((p) => p.align === 'center'),
    ).toBe(true);

    // Lists: numbered paragraphs count on per level, the buttons toggle, ⇥ goes a level deeper.
    const lines = [paragraph(['a']), paragraph(['b']), paragraph(['c']), paragraph(['d'])];
    const numbered = paragraphRange(lines, null, { list: 'number', lineSpacing: 1.5 });
    expect(commonList(numbered)).toBe('number');
    const second = { start: { paragraph: 2, offset: 0 }, end: { paragraph: 2, offset: 0 } };
    const deeper = paragraphRange(numbered, second, { levelBy: 1 });
    expect(listLabels(deeper)).toEqual(['1.', '2.', '1.', '3.']);
    expect(deeper[2]).toMatchObject({ level: 2, marginLeft: 54, bullet: { at: 27, width: 27 } });
    expect(richFromLive(deeper)[2]).toMatchObject({
      list: { kind: 'number', level: 2 },
      lineSpacing: { type: 'proportional', value: 1.5 },
    });
    const bullets = paragraphRange(deeper, null, { list: 'bullet' });
    expect(listLabels(bullets)).toEqual(['•', '•', '–', '•']);
    expect(paragraphRange(bullets, null, { list: null }).map((p) => p.bullet)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(listNumber(28, 'a')).toBe('ab');
    expect(listNumber(14, 'I')).toBe('XIV');

    const styled = [paragraph(['ab', { bold: true }], ['cd'])];
    expect(styleAt(styled, { paragraph: 0, offset: 0 }).bold).toBe(true);
    expect(styleAt(styled, { paragraph: 0, offset: 2 }).bold).toBe(true);
    expect(styleAt(styled, { paragraph: 0, offset: 3 }).bold).toBe(false);
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
    rotation: 0,
    look: { fill: null, fills: [], fillAspect: null, stroke: null, effects: NO_EFFECTS },
    tilt: null,
    flip: null,
    paragraphs: ['Alt'],
    movable: true,
    resizable: true,
    live: {
      fill: null,
      stroke: null,
      padding: { top: 3, right: 7, bottom: 3, left: 7 },
      verticalAlign: 'top',
      autoGrow: false,
      placeholder: false,
      paragraphs: [{ ...paragraph(['Alt']), spaceBefore: 6, bullet: null }],
    },
  };

  it('keeps each paragraph’s look for new text, and moves, restyles, deletes and adds elements', async () => {
    const rich = richFromLive([paragraph(['Neu', { bold: true }]), paragraph()]);
    expect(rich[1]?.runs).toEqual([{ ...style(), text: '' }]);
    // New text is offered Office's twins under their own names, never Microsoft's (a Calibri
    // text keeps its name: the picker shows it as the current one).
    const offered = editorFonts();
    for (const free of [
      'Carlito',
      'Caladea',
      'Liberation Sans',
      'Liberation Serif',
      'Liberation Mono',
    ])
      expect(offered).toContain(free);
    for (const office of ['Calibri', 'Cambria', 'Arial', 'Times New Roman', 'Courier New'])
      expect(offered).not.toContain(office);
    const next = applyToElement(element, {
      type: 'setRichText',
      elementId: 'sl1',
      paragraphs: rich,
    });
    expect(next?.paragraphs).toEqual(['Neu', '']);
    expect(next?.live?.paragraphs.map((p) => p.spaceBefore)).toEqual([6, 6]);
    expect(next?.live?.paragraphs[0]?.runs[0]?.bold).toBe(true);
    expect(liveFromRich([], rich)[0]?.lineSpacing).toEqual({ type: 'proportional', value: 1 });

    // Moves, restyles and deletes; an added text box grows with its text.
    const box = { x: 0.2, y: 0.3, w: 0.1, h: 0.1 };
    expect(applyToElement(element, { type: 'setBox', elementId: 'sl1', box })?.bbox).toEqual(box);
    expect(
      applyToElement(element, { type: 'setShapeStyle', elementId: 'sl1', fill: '#ABCDEF' })?.live
        ?.fill,
    ).toBe('#abcdef');
    // A plain text box set at its bottom (the 3 × 3 grid): drawn there at once.
    expect(
      applyToElement(element, { type: 'setShapeStyle', elementId: 'sl1', verticalAlign: 'bottom' })
        ?.live,
    ).toMatchObject({ verticalAlign: 'bottom', fill: null, stroke: null });
    expect(applyToElement(element, { type: 'deleteElement', elementId: 'sl1' })).toBeNull();
    // Locked at once – unlocked, as the file reads it back: no `locked` at all.
    const locked = applyToElement(element, { type: 'setLocked', elementId: 'sl1', locked: true });
    expect(locked?.locked).toBe(true);
    expect(applyToElement(locked!, { type: 'setLocked', elementId: 'sl1', locked: false })).toEqual(
      element,
    );
    // A browser-drawn box rounded at once – its drawing too, not only the panel's number.
    const box2 = { ...element, cornerRadius: 0, paint: { outline: 'rect' as const, radius: 0 } };
    expect(
      applyToElement(box2, { type: 'setCornerRadius', elementId: 'sl1', radius: 9 }),
    ).toMatchObject({ cornerRadius: 9, paint: { outline: 'rect', radius: 9 } });
    // Resized, its radius stays the share of the shorter side the file keeps (no jump on the
    // answer); the panel rounds at most half that side, as the server does.
    const round = { ...box2, cornerRadius: 9, paint: { outline: 'rect' as const, radius: 9 } };
    expect(
      applyToElement(round, {
        type: 'setBox',
        elementId: 'sl1',
        box: { ...element.bbox, h: 0.1 },
      }),
    ).toMatchObject({ cornerRadius: 4.5, paint: { radius: 4.5 } });
    expect(maxCornerRadius(element.bbox, { width: 28, height: 15.75 })).toBeCloseTo(
      ((0.2 * 15.75) / 2) * (72 / 2.54),
      6,
    );
    // A picture filled or stretched at once; a 2:1 picture in a square frame shows its middle half,
    // zoomed in twice on its left edge a quarter of it.
    const photo = {
      ...element,
      kind: 'image' as const,
      live: null,
      picture: { src: 'Pictures/a.png', aspect: 2, fit: 'stretch' as const, focus: null },
    };
    const filled = applyToElement(photo, {
      type: 'setImageFit',
      elementId: 'sl1',
      fit: 'fill',
      focus: { x: 0, y: 0.5, zoom: 2 },
    });
    expect(filled?.picture).toMatchObject({ fit: 'fill', focus: { x: 0, y: 0.5, zoom: 2 } });
    expect(
      applyToElement(filled!, { type: 'setImageFit', elementId: 'sl1', fit: 'stretch' })?.picture,
    ).toMatchObject({ fit: 'stretch', focus: null });
    expect(coverCrop(2, 1)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(coverCrop(2, 1, { x: 0, y: 0.5, zoom: 2 })).toEqual({ x: 0, y: 0.25, w: 0.25, h: 0.5 });
    expect(focusOf(2, 1, { x: 0, y: 0.25, w: 0.25, h: 0.5 })).toEqual({
      x: 0.125,
      y: 0.5,
      zoom: 2,
    });
    const added = addedElement(
      {
        type: 'addElement',
        pageId: 'sl1',
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
    // Made lower (fitted to its text, sized between guides) it is drawn as low, typed in too:
    // LibreOffice takes the box's own height as its least, not the one it was drawn at.
    const lower = applyToElement(added, {
      type: 'setBox',
      elementId: 'sl-new',
      box: { x: 0, y: 0, w: 0.5, h: 0.04 },
    })!;
    expect(boxCss(lower, lower.live!)).toMatchObject({ minHeight: '4%' });
    expect(boxCss(lower, lower.live!).height).toBeUndefined();
    // Pasted from outside (BER-202): a picture wins, but text an office app put beside its own
    // picture of it is meant as text; text alone becomes a text box.
    const png = new File([''], 'a.png', { type: 'image/png' });
    expect(pastedOf({ images: [png], text: '', html: '<img src="x">' })?.kind).toBe('images');
    expect(pastedOf({ images: [png], text: 'a.png', html: '' })?.kind).toBe('images');
    expect(pastedOf({ images: [png], text: 'Umsatz 2026', html: '<table><td>Umsatz' })).toEqual({
      kind: 'text',
      text: 'Umsatz 2026',
    });
    expect(pastedOf({ images: [], text: 'a\r\nb', html: '' })).toEqual({
      kind: 'text',
      text: 'a\nb',
    });
    expect(pastedOf({ images: [], text: ' \n ', html: '' })).toBeNull();
    // Each line a paragraph in the slide's style, blank ends dropped, cut at what a box takes.
    const pasted = pastedParagraphs('\n\nEins  \n\nZwei\n\n', style());
    expect(pasted.cut).toBe(false);
    expect(pasted.paragraphs.map((p) => p.runs.map((run) => run.text).join(''))).toEqual([
      'Eins',
      '',
      'Zwei',
    ]);
    expect(pasted.paragraphs[0]?.runs[0]).toEqual({ ...style(), text: 'Eins' });
    expect(pastedParagraphs('x'.repeat(6000), style()).cut).toBe(true);
    expect(pastedParagraphs('a\n'.repeat(300), style()).paragraphs).toHaveLength(200);
    // As wide as its line, in the slide's middle; a long one wraps at 80 % of the slide.
    const page = { width: 28, height: 15.75 };
    const tenPx = (line: string) => line.length * 10;
    const short = pastedTextBox(pasted.paragraphs.slice(0, 1), style(), page, undefined, tenPx);
    expect(short.w).toBeCloseTo((40 * (2.54 / 96) * 1.05 + 0.5) / 28);
    expect(short.x + short.w / 2).toBeCloseTo(0.5);
    expect(short.y + short.h / 2).toBeCloseTo(0.5);
    const long = pastedParagraphs('Wort '.repeat(200), style()).paragraphs;
    const wrapped = pastedTextBox(long, style(), page, undefined, tenPx);
    expect(wrapped.w).toBeCloseTo(0.8);
    expect(wrapped.h).toBeGreaterThan(short.h * 5);
    expect(wrapped.y).toBeGreaterThanOrEqual(0);
    // Pictures pasted or dropped together: each a step aside of the one before, as far down.
    const steps: { x: number; y: number }[] = [];
    const two = [new File([], 'a.png'), new File([], 'b.png')];
    await insertEach(two, { x: 0.5, y: 0.5 }, 0.02, page, async (_, at) => {
      steps.push(at);
      return true;
    });
    expect(steps[0]).toEqual({ x: 0.5, y: 0.5 });
    expect(steps[1]!.x).toBeCloseTo(0.52);
    expect((steps[1]!.y - 0.5) * page.height).toBeCloseTo(0.02 * page.width);
    // A drawn frame turned before it was filled: added, then turned in the same step.
    const image = {
      type: 'addImage' as const,
      pageId: 'p1',
      elementId: 'sl-pic',
      box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      imageId: null,
    };
    expect(addedTurned(image, 0)).toEqual([image]);
    expect(addedTurned(image, 30)).toEqual([
      image,
      { type: 'setBox', elementId: 'sl-pic', box: image.box, rotation: 30 },
    ]);
    const fresh = { ...element, id: 'sl2' };
    // Grouped before the server answers: the box round them, moved only, its elements named.
    const grouped = groupedElement(
      { type: 'groupElements', elementIds: ['sl1', 'sl2'], newElementId: 'slg1' },
      [element, { ...fresh, bbox: { ...element.bbox, x: element.bbox.x + 0.1 } }],
      16 / 9,
    );
    expect(grouped).toMatchObject({ kind: 'group', resizable: false, members: ['sl1', 'sl2'] });
    expect(grouped.bbox.w).toBeCloseTo(element.bbox.w + 0.1, 6);
    // ⌘G in it (entered): a group in the group at once, where the topmost of them was.
    const third = { ...element, id: 'sl3' };
    const outer = { ...grouped, children: [...grouped.children!, third] };
    const nested = withGroupIn(
      outer,
      { type: 'groupElements', elementIds: ['sl3', 'sl1'], newElementId: 'slg2' },
      16 / 9,
    );
    expect(nested.children?.map((child) => child.id)).toEqual(['sl2', 'slg2']);
    expect(nested.children?.[1]?.children?.map((child) => child.id)).toEqual(['sl1', 'sl3']);
    expect(nested.bbox.w).toBeCloseTo(outer.bbox.w, 6);
    const deeper = withGroupIn(
      { ...outer, id: 'slg0', children: [nested] },
      { type: 'groupElements', elementIds: ['sl1', 'sl3'], newElementId: 'slg3' },
    );
    expect(findElement(deeper.children!, 'slg3')?.children?.map((child) => child.id)).toEqual([
      'sl1',
      'sl3',
    ]);
    // Copied (⌘V, ⌘D): its parts at any depth under the ids the file gives them then.
    let n = 0;
    const partIds = newPartIds(nested, () => `slnew${(n += 1)}`)!;
    expect(partIds).toEqual({ sl2: 'slnew1', slg2: 'slnew2', sl1: 'slnew3', sl3: 'slnew4' });
    const copy = copiedElement(nested, 'slcopy', nested.bbox, partIds);
    expect(withChildren([copy]).map((part) => part.id)).toEqual([
      'slcopy',
      ...Object.values(partIds),
    ]);
    expect(copy.members).toEqual(['slnew1', 'slnew2']);
    expect(newPartIds(element, () => 'x')).toBeUndefined();
  });
});
