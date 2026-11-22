import { WRITER_FORMATS, type WriterLook, type WriterParagraphBlock } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { anchorToRaw, anchorToView, notesEdit, readMarkdown, writeMarkdown } from './markdown';
import type { Formats } from './model';

const look: WriterLook = {
  font: 'Inter Variable',
  size: 12,
  color: '#000000',
  bold: false,
  italic: false,
  lineHeight: 1.5,
  spaceBefore: 0,
  spaceAfter: 0,
  indentLeft: 0,
  indentRight: 0,
  indentFirst: 0,
  align: 'left',
};
const formats = Object.fromEntries(WRITER_FORMATS.map((format) => [format, look])) as Formats;
formats.preformatted = { ...look, font: 'Menlo' };
const paragraph = (
  id: string,
  runs: WriterParagraphBlock['runs'],
  kind: WriterParagraphBlock['kind'] = 'text',
): WriterParagraphBlock => ({ type: 'paragraph', id, kind, runs, look });

const FILE = [
  '---',
  'title: x',
  '---',
  '',
  'Setext',
  '======',
  '',
  'Some *it*, **bold**, `code`, [link](https://a.b) and a_b_c.',
  'wrapped on',
  '',
  '- one',
  '- two',
  '  - nested',
  '1. first',
  '',
  '> quoted',
  '> more',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '',
  '***',
  'end',
];

describe('Markdown rendered', () => {
  it('reads the file as Markdown, writes back only what changed, keeps comments at their words', () => {
    const lines = FILE.map((text, index) => ({ id: `L${index + 1}`, text }));
    const read = readMarkdown(lines, formats);
    const shape = read.blocks.map((block) =>
      [
        block.id,
        block.kind,
        block.level ?? '',
        block.list?.level ?? '',
        block.locked ? 'L' : '',
      ].join(' '),
    );
    expect(shape).toEqual([
      'L1 text   L',
      'L5 heading 1  ',
      'L8 text   ',
      'L11 text  0 ',
      'L12 text  0 ',
      'L13 text  1 ',
      'L14 text  0 ',
      'L16 quote   ',
      'L20 preformatted   ',
      'L23 text   L',
      'L26 text   L',
      'L27 text   ',
    ]);
    const text = read.blocks[2]!;
    expect(text.runs).toEqual([
      { text: 'Some ' },
      { text: 'it', italic: true },
      { text: ', ' },
      { text: 'bold', bold: true },
      { text: ', ' },
      { text: 'code', font: 'Menlo' },
      { text: ', ' },
      { text: 'link', link: 'https://a.b' },
      { text: ' and a_b_c. wrapped on' },
    ]);
    expect(read.blocks[1]!.runs).toEqual([{ text: 'Setext', bold: true }]);

    // Nothing changed: the file as it was, byte for byte.
    expect(writeMarkdown(read, read.blocks, formats)).toEqual(lines);

    // Changed: an item, the wrapped paragraph (one line now), a heading, two new blocks.
    const blocks = read.blocks.map((block) =>
      block.id === 'L12'
        ? { ...block, runs: [{ text: 'zwei *x*' }] }
        : block.id === 'L8'
          ? { ...block, runs: [{ text: 'New ' }, { text: 'para', bold: true }] }
          : block.id === 'L5'
            ? { ...block, runs: [{ text: 'Titel', bold: true }] }
            : block,
    );
    blocks.push(
      paragraph('pa', [{ text: '# not a heading' }]),
      paragraph('pb', [{ text: 'x = 1' }], 'preformatted'),
    );
    const written = writeMarkdown(read, blocks, formats);
    expect(written.map((line) => `${line.id}:${line.text}`)).toEqual([
      'L1:---',
      'L2:title: x',
      'L3:---',
      'L4:',
      'L5:Titel',
      'L6:======',
      'L7:',
      'L8:New **para**',
      'L10:',
      'L11:- one',
      'L12:- zwei \\*x\\*',
      'L13:  - nested',
      'L14:1. first',
      ...FILE.slice(14).map((each, index) => `L${index + 15}:${each}`),
      'pa.b:',
      'pa:\\# not a heading',
      'pb.b:',
      'pb.f:```',
      'pb:x = 1',
      'pb.e:```',
    ]);
    const again = readMarkdown(written, formats);
    expect(again.blocks.find((block) => block.id === 'pa')?.runs).toEqual([
      { text: '# not a heading' },
    ]);

    // A comment on „bold“ in the file stands on „bold“ rendered, and back.
    const col = FILE[7]!.indexOf('bold');
    const anchor = { paragraphId: 'L8', start: col, end: col + 4, quote: 'bold' };
    const shown = anchorToView(read, anchor)!;
    expect(shown).toMatchObject({ paragraphId: 'L8', start: 9, end: 13 });
    expect(anchorToRaw(read, lines, shown)).toEqual(anchor);

    // `## ` typed at a paragraph's start makes it a heading, as Notion does.
    const typed = notesEdit(
      {
        blocks: [paragraph('a', [{ text: '## ' }])],
        sel: { anchor: { id: 'a', offset: 3 }, focus: { id: 'a', offset: 3 } },
      },
      formats,
    );
    expect(typed.blocks[0]).toMatchObject({ kind: 'heading', level: 2, runs: [] });
    expect(typed.sel.focus).toEqual({ id: 'a', offset: 0 });
  });
});
