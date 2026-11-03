import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { LiveParagraph, LiveTextStyle } from '../src/editing';
import {
  applyLiveChange,
  DEFAULT_STYLE,
  fromBase64,
  PARAGRAPH_MARK,
  indexOfPoint,
  liveTextDoc,
  liveTextOf,
  pointOfIndex,
  readLiveText,
  rebaseLive,
  toBase64,
  typedParagraphs,
} from '../src/live-text';

const style = (over: Partial<LiveTextStyle> = {}): LiveTextStyle => ({
  font: 'Calibri',
  size: 20,
  color: '#1f2937',
  bold: false,
  italic: false,
  underline: false,
  ...over,
});

const paragraph = (
  runs: [string, Partial<LiveTextStyle>?][],
  over: Partial<LiveParagraph> = {},
): LiveParagraph => ({
  runs: runs.map(([text, look]) => ({ ...style(look), text })),
  mark: style(runs.at(-1)?.[1]),
  align: 'left',
  fontIndependent: true,
  lineSpacing: { type: 'proportional', value: 1 },
  spaceBefore: 0,
  spaceAfter: 6,
  marginLeft: 0,
  indent: 0,
  level: 0,
  bullet: null,
  ...over,
});

const texts = (paragraphs: readonly LiveParagraph[]) =>
  paragraphs.map((item) => item.runs.map((run) => run.text).join(''));

/** Two editors typing in one text, their updates going through like the server passes them on. */
function pair(start: readonly LiveParagraph[]) {
  const { doc: server } = liveTextDoc(start);
  const join = () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server));
    return doc;
  };
  return { server, a: join(), b: join() };
}

/** Sends what `from` has that `to` does not (one update each way is what the wire carries). */
const sync = (from: Y.Doc, to: Y.Doc) =>
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));

describe('typing together in one text', () => {
  const start = [
    paragraph([['Umsatz '], ['2026', { bold: true }]], { align: 'center' }),
    paragraph([['Zweite Zeile']], {
      bullet: { char: '•', font: null, size: 1, color: '#000000', at: 0, width: 18 },
    }),
  ];

  it('reads back the paragraphs it was given, looks and styles included', () => {
    const { doc } = liveTextDoc(start);
    expect(readLiveText(liveTextOf(doc), start[0]!)).toEqual(start);
    // A new text box's text is Inter, as blank decks name it – not an office default.
    expect(DEFAULT_STYLE.font).toBe('Inter');
  });

  it('merges two people typing at once in the same paragraph – nothing is lost', () => {
    const { a, b } = pair(start);
    const fallback = start[0]!;
    // A types at the end of the first paragraph, B at its start – at the same time.
    applyLiveChange(liveTextOf(a), [
      paragraph([['Umsatz '], ['2026!', { bold: true }]], { align: 'center' }),
      start[1]!,
    ]);
    applyLiveChange(liveTextOf(b), [
      paragraph([['Q4 Umsatz '], ['2026', { bold: true }]], { align: 'center' }),
      start[1]!,
    ]);
    sync(a, b);
    sync(b, a);
    const merged = readLiveText(liveTextOf(a), fallback);
    expect(readLiveText(liveTextOf(b), fallback)).toEqual(merged);
    expect(texts(merged)).toEqual(['Q4 Umsatz 2026!', 'Zweite Zeile']);
    // Each keeps its style: the bold year with its mark, the bullet with its paragraph.
    expect(merged[0]!.runs).toEqual([
      { ...style(), text: 'Q4 Umsatz ' },
      { ...style({ bold: true }), text: '2026!' },
    ]);
    expect(merged[1]!.bullet?.char).toBe('•');
  });

  it('merges a new paragraph of one with typing of the other', () => {
    const { a, b } = pair(start);
    // A splits the first paragraph (Enter after „Umsatz“), B types into the second.
    applyLiveChange(liveTextOf(a), [
      paragraph([['Umsatz']], { align: 'center' }),
      paragraph([[' '], ['2026', { bold: true }]], { align: 'center' }),
      start[1]!,
    ]);
    applyLiveChange(liveTextOf(b), [
      start[0]!,
      paragraph([['Zweite Zeile, ergänzt']], { bullet: start[1]!.bullet }),
    ]);
    sync(a, b);
    sync(b, a);
    expect(texts(readLiveText(liveTextOf(b), start[0]!))).toEqual([
      'Umsatz',
      ' 2026',
      'Zweite Zeile, ergänzt',
    ]);
  });

  it('writes only what changed: typing one character is one insert', () => {
    const { doc } = liveTextDoc(start);
    const text = liveTextOf(doc);
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update));
    const typed = [
      paragraph([['Umsatz! '], ['2026', { bold: true }]], { align: 'center' }),
      start[1]!,
    ];
    applyLiveChange(text, typed);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.byteLength).toBeLessThan(200);
    expect(readLiveText(text, start[0]!)).toEqual(typed);
    // Another look (no longer centred): the paragraph's mark is written anew, its text stays.
    applyLiveChange(text, [{ ...typed[0]!, align: 'left' }, start[1]!]);
    expect(readLiveText(text, start[0]!)[0]).toMatchObject({ align: 'left' });
    expect(texts(readLiveText(text, start[0]!))[0]).toBe('Umsatz! 2026');
  });

  it('keeps a caret on its character while others type before it', () => {
    const { a, b } = pair(start);
    const textA = liveTextOf(a);
    // A's caret after „Zweite“ in the second paragraph.
    const at = indexOfPoint(textA, { paragraph: 1, offset: 6 });
    const caret = Y.createRelativePositionFromTypeIndex(textA, at);
    const encoded = toBase64(Y.encodeRelativePosition(caret));
    // B adds a paragraph in front of everything.
    applyLiveChange(liveTextOf(b), [paragraph([['Neu']]), ...start]);
    sync(b, a);
    const moved = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(fromBase64(encoded)),
      a,
    );
    expect(pointOfIndex(textA, moved!.index)).toEqual({ paragraph: 2, offset: 6 });
  });

  it('counts characters outside the BMP as their UTF-16 units, like the browser', () => {
    const emoji = [paragraph([['Hi 👋 du']])];
    const text = liveTextOf(liveTextDoc(emoji).doc);
    applyLiveChange(text, [paragraph([['Hi 👋👋 du']])]);
    expect(texts(readLiveText(text, emoji[0]!))).toEqual(['Hi 👋👋 du']);
    expect(pointOfIndex(text, indexOfPoint(text, { paragraph: 0, offset: 5 }))).toEqual({
      paragraph: 0,
      offset: 5,
    });
  });
});

describe('formatting together', () => {
  const start = [paragraph([['Umsatz im Jahr']])];
  const fallback = start[0]!;
  const runs = (doc: Y.Doc) =>
    readLiveText(liveTextOf(doc), fallback)[0]!.runs.map((run) => ({
      text: run.text,
      bold: run.bold,
      italic: run.italic,
    }));

  it('formats the characters that stay – nothing is deleted or written again', () => {
    const { doc } = liveTextDoc(start);
    const text = liveTextOf(doc);
    const deltas: unknown[] = [];
    text.observe((event) => deltas.push(...event.delta));
    applyLiveChange(text, [paragraph([['Umsatz '], ['im', { bold: true }], [' Jahr']])]);
    expect(deltas).toEqual([{ retain: 8 }, { retain: 2, attributes: { bold: true } }]);
  });

  it('gives both when one makes a word bold and the other italic at the same moment', () => {
    const { a, b } = pair(start);
    applyLiveChange(liveTextOf(a), [paragraph([['Umsatz '], ['im', { bold: true }], [' Jahr']])]);
    applyLiveChange(liveTextOf(b), [paragraph([['Umsatz '], ['im', { italic: true }], [' Jahr']])]);
    sync(a, b);
    sync(b, a);
    const expected = [
      { text: 'Umsatz ', bold: false, italic: false },
      { text: 'im', bold: true, italic: true },
      { text: ' Jahr', bold: false, italic: false },
    ];
    expect(runs(a)).toEqual(expected);
    expect(runs(b)).toEqual(expected);
  });

  it('keeps typing where it was typed while the other formats around it', () => {
    const { a, b } = pair(start);
    applyLiveChange(liveTextOf(a), [paragraph([['Umsatz im Jahr', { bold: true }]])]);
    applyLiveChange(liveTextOf(b), [paragraph([['Umsatz im alten Jahr']])]);
    sync(a, b);
    sync(b, a);
    expect(texts(readLiveText(liveTextOf(a), fallback))).toEqual(['Umsatz im alten Jahr']);
    expect(texts(readLiveText(liveTextOf(b), fallback))).toEqual(['Umsatz im alten Jahr']);
    expect(runs(a)).toEqual(runs(b));
  });

  it('aligns a paragraph while the other types in it', () => {
    const { a, b } = pair(start);
    applyLiveChange(liveTextOf(a), [paragraph([['Umsatz im Jahr']], { align: 'right' })]);
    applyLiveChange(liveTextOf(b), [paragraph([['Umsatz im Jahr 2026']])]);
    sync(a, b);
    sync(b, a);
    for (const doc of [a, b]) {
      const [only] = readLiveText(liveTextOf(doc), fallback);
      expect(only).toMatchObject({ align: 'right' });
      expect(texts([only!])).toEqual(['Umsatz im Jahr 2026']);
    }
  });

  it('reads what it cannot make sense of (the others wrote it) as the paragraph has it', () => {
    const text = liveTextOf(liveTextDoc(start).doc);
    text.format(1, 3, { bold: 'yes', size: -1, font: 7, 'p.lineSpacing': '{nope' });
    text.format(0, 1, { 'p.lineSpacing': '{nope', 'p.align': 'sideways' });
    expect(readLiveText(text, fallback)).toEqual(start);
  });
});

describe('the start of a text', () => {
  const start = [paragraph([['Titel']])];

  it('is the same document wherever it is made: editor and server merge as one', () => {
    const server = liveTextDoc(start);
    const editor = liveTextDoc(start);
    expect(editor.start).toBe(server.start);
    // The editor types before it joined; then the two meet.
    applyLiveChange(liveTextOf(editor.doc), [paragraph([['Titel neu']])]);
    sync(editor.doc, server.doc);
    sync(server.doc, editor.doc);
    expect(texts(readLiveText(liveTextOf(server.doc), start[0]!))).toEqual(['Titel neu']);
    expect(texts(readLiveText(liveTextOf(editor.doc), start[0]!))).toEqual(['Titel neu']);
  });

  it('is another for other paragraphs', () => {
    expect(liveTextDoc([paragraph([['Titel!']])]).start).not.toBe(liveTextDoc(start).start);
  });

  it('carries over what was typed on another start: nothing either typed is lost', () => {
    const base = [paragraph([['Umsatz im Jahr']])];
    const fallback = base[0]!;
    const rebase = (mine: string, theirs: string) =>
      texts(rebaseLive(base, [paragraph([[mine]])], [paragraph([[theirs]])], fallback));
    // Apart: both.
    expect(rebase('Umsatz im Jahr 2026', 'Der Umsatz im Jahr')).toEqual([
      'Der Umsatz im Jahr 2026',
    ]);
    // At the same place: both, theirs first.
    expect(rebase('Umsatz im Jahr 2026', 'Umsatz im Jahr 2025')).toEqual([
      'Umsatz im Jahr 2025 2026',
    ]);
    // Deleted by one, typed into by the other: what was typed stays.
    expect(rebase('Jahr', 'Umsatz XX im Jahr')).toEqual(['XX Jahr']);
    // Several changes on each side.
    expect(rebase('Der Umsatz im Jahr!', 'Umsatz in dem Jahr')).toEqual([
      'Der Umsatz in dem Jahr!',
    ]);
    // The same change on both: once.
    expect(rebase('Umsatz im Jahr 2026', 'Umsatz im Jahr 2026')).toEqual(['Umsatz im Jahr 2026']);
    expect(rebaseLive(base, base, [paragraph([['x']])], fallback)).toEqual([paragraph([['x']])]);
  });
});

describe('deleting a paragraph', () => {
  it('takes its own mark with it – the next keeps its look, also one the other gives it meanwhile', () => {
    const start = [
      paragraph([['eins']]),
      paragraph([['zwei']], { align: 'center' }),
      paragraph([['drei']], { align: 'justify' }),
    ];
    const { a, b } = pair(start);
    const fallback = start[0]!;
    applyLiveChange(liveTextOf(a), [start[0]!, start[2]!]);
    applyLiveChange(liveTextOf(b), [
      start[0]!,
      start[1]!,
      paragraph([['drei']], { align: 'right' }),
    ]);
    sync(a, b);
    sync(b, a);
    for (const doc of [a, b]) {
      const paragraphs = readLiveText(liveTextOf(doc), fallback);
      expect(texts(paragraphs)).toEqual(['eins', 'drei']);
      expect(paragraphs[1]).toMatchObject({ align: 'right' });
    }
  });
});

describe('a text that lost its first paragraph mark', () => {
  it('heals with the next change, and places stay where they are read', () => {
    const start = [paragraph([['']]), paragraph([['def']])];
    const { doc } = liveTextDoc(start);
    const text = liveTextOf(doc);
    // Both deleted the first mark (joined the paragraphs) while one typed into the first.
    text.delete(0, 1);
    text.insert(0, 'X');
    const read = readLiveText(text, start[0]!);
    expect(texts(read)).toEqual(['X', 'def']);
    expect(pointOfIndex(text, indexOfPoint(text, { paragraph: 0, offset: 1 }))).toEqual({
      paragraph: 0,
      offset: 1,
    });
    expect(indexOfPoint(text, { paragraph: 0, offset: 1 })).toBe(1);
    applyLiveChange(text, [paragraph([['XY']]), read[1]!]);
    expect(texts(readLiveText(text, start[0]!))).toEqual(['XY', 'def']);
    expect(text.toString().startsWith(PARAGRAPH_MARK)).toBe(true);
  });
});

describe('a first paragraph deleted while the other types in it', () => {
  it('puts the lost mark back with the next keys – two at once, nothing written twice', () => {
    const start = [paragraph([['First line']]), paragraph([['Second']])];
    const { a, b } = pair(start);
    const fallback = start[0]!;
    // A deletes the first paragraph, B types into it – at the same time.
    applyLiveChange(liveTextOf(a), [start[1]!]);
    applyLiveChange(liveTextOf(b), [paragraph([['First line!']]), start[1]!]);
    sync(a, b);
    sync(b, a);
    // Each types once more before hearing of the other's key.
    const read = readLiveText(liveTextOf(a), fallback);
    applyLiveChange(liveTextOf(a), [read[0]!, paragraph([['SecondA']])]);
    applyLiveChange(liveTextOf(b), [read[0]!, paragraph([['SecondB']])]);
    sync(a, b);
    sync(b, a);
    expect(liveTextOf(a).toString()).toBe(liveTextOf(b).toString());
    const merged = texts(readLiveText(liveTextOf(a), fallback));
    expect(merged.join('|').match(/Second/g)).toHaveLength(1);
    expect(merged.at(-1)).toMatch(/^Second[AB]{2}$/);
  });
});

describe('carrying over onto text formatted meanwhile', () => {
  it('keeps typing where it was typed and the look the other gave it', () => {
    const base = [paragraph([['hello world']])];
    const theirs = [paragraph([['hello', { bold: true }], [' world']])];
    const mine = [paragraph([['heXllo world']])];
    const merged = rebaseLive(base, mine, theirs, base[0]!);
    expect(texts(merged)).toEqual(['heXllo world']);
    expect(merged[0]!.runs.map((run) => [run.text, run.bold])).toEqual([
      ['he', true],
      ['X', false],
      ['llo', true],
      [' world', false],
    ]);
  });
});

describe('the paragraphs typing starts from', () => {
  it('is one empty paragraph for a shape without any text', () => {
    expect(typedParagraphs({ paragraphs: [], placeholder: false })).toHaveLength(1);
  });
});

describe('changes in several places at once', () => {
  const plain = (...lines: string[]) => lines.map((line) => paragraph([[line]]));

  it('applies any change exactly – runs of the same character included', () => {
    const cases: [string[], string[]][] = [
      [
        ['aaa', 'a'],
        ['aba', ''],
      ],
      [['1000 2020'], ['2020 1000']],
      [
        ['abab', 'ba'],
        ['ba', 'abab'],
      ],
    ];
    // And every pair of short texts over a small alphabet.
    const words = ['', 'a', 'b', 'aa', 'ab', 'ba', 'aab', 'aba', 'bab', 'aaa'];
    for (const x of words)
      for (const y of words)
        cases.push([
          [x, y],
          [y, x, x],
        ]);
    for (const [from, to] of cases) {
      const { doc } = liveTextDoc(plain(...from));
      const text = liveTextOf(doc);
      applyLiveChange(text, plain(...to));
      expect(texts(readLiveText(text, paragraph([['']])))).toEqual(to);
    }
  });
});

describe('carrying over typing that went out already', () => {
  it('keeps the longer when one side typed on after what both have', () => {
    const base = [paragraph([['Hallo']])];
    const saved = [paragraph([['Hallo Welt']])];
    const typedOn = [paragraph([['Hallo Welt!']])];
    expect(texts(rebaseLive(base, typedOn, saved, base[0]!))).toEqual(['Hallo Welt!']);
    expect(texts(rebaseLive(base, saved, typedOn, base[0]!))).toEqual(['Hallo Welt!']);
  });
});
