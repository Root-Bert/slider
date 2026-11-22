import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { WriterOperation, WriterParagraphBlock } from '@slider/shared';
import { blankOdt, isOdtBytes, OdtDocument, OdtError } from '../src';

const paragraph = (document: OdtDocument, id: string) => {
  const found = document
    .blocks()
    .flatMap((block) =>
      block.type === 'paragraph'
        ? [block]
        : block.rows.flatMap((row) => row.flatMap((cell) => cell.blocks)),
    )
    .find((block) => block.id === id);
  if (!found) throw new Error(`no paragraph ${id}`);
  return found;
};
const words = (block: WriterParagraphBlock) => block.runs.map((run) => run.text).join('');

describe('a text document', () => {
  it('reads as paragraphs with ids and writes steps back into the file: formats, lists, tables, the page – the rest stays', async () => {
    const bytes = await blankOdt(new Date(0), { template: 'report', title: 'Bericht' });
    expect(isOdtBytes(bytes)).toBe(true);
    const document = await OdtDocument.open(bytes);
    expect(document.page()).toMatchObject({ numbers: false });
    expect(document.page().width).toBeCloseTo(595.3, 0);
    expect(document.blocks().map((block) => block.id)).toEqual([
      'w1',
      'w2',
      'w3',
      'w4',
      'w5',
      'w6',
      'w7',
      'w8',
      'w9',
    ]);
    expect(paragraph(document, 'w1')).toMatchObject({ kind: 'title', look: { size: 28 } });
    expect(paragraph(document, 'w2')).toMatchObject({ kind: 'heading', level: 1 });
    expect(document.formats().quote).toMatchObject({ italic: true });

    const operations: WriterOperation[] = [
      {
        type: 'setParagraph',
        id: 'w3',
        paragraph: {
          kind: 'text',
          runs: [
            { text: 'Hallo ' },
            { text: 'fett', bold: true },
            { text: '  und ' },
            { text: 'Link', link: 'https://example.org' },
            { text: ' Ende ' },
          ],
        },
      },
      {
        type: 'insertParagraph',
        id: 'a1',
        afterId: 'w3',
        paragraph: { kind: 'text', list: { kind: 'bullet', level: 0 }, runs: [{ text: 'Eins' }] },
      },
      {
        type: 'insertParagraph',
        id: 'a2',
        afterId: 'a1',
        paragraph: {
          kind: 'text',
          list: { kind: 'bullet', level: 1 },
          runs: [{ text: 'Zwei', italic: true, color: '#aa0000' }],
        },
      },
      {
        type: 'insertParagraph',
        id: 'a3',
        afterId: 'a2',
        paragraph: { kind: 'text', list: { kind: 'number', level: 0 }, runs: [{ text: 'Drei' }] },
      },
      // In the middle of a list: the list parts there.
      {
        type: 'insertParagraph',
        id: 'a4',
        afterId: 'a1',
        paragraph: { kind: 'quote', align: 'center', runs: [{ text: 'Zitat', italic: true }] },
      },
      {
        type: 'insertTable',
        id: 't1',
        afterId: 'a3',
        cells: [
          ['c1', 'c2'],
          ['c3', 'c4'],
        ],
      },
      {
        type: 'setParagraph',
        id: 'c1',
        paragraph: { kind: 'text', runs: [{ text: 'Zelle', highlight: '#ffff00' }] },
      },
      {
        type: 'setParagraph',
        id: 'c2',
        paragraph: { kind: 'preformatted', runs: [{ text: 'const a = 1;' }] },
      },
      { type: 'insertRow', tableId: 't1', after: 1, cells: ['c5', 'c6'] },
      { type: 'removeRow', tableId: 't1', row: 1 },
      { type: 'setParagraph', id: 'gone', paragraph: { kind: 'text', runs: [] } },
      { type: 'remove', id: 'w5' },
      {
        type: 'setParagraph',
        id: 'w4',
        paragraph: {
          kind: 'heading',
          level: 3,
          breakBefore: true,
          runs: [{ text: 'Neue Seite', bold: true }],
        },
      },
      {
        type: 'setPage',
        page: {
          ...document.page(),
          numbers: true,
          marginLeft: 85,
          header: 'Angebot Müller',
          footer: 'Vertraulich',
        },
      },
    ];
    // What names a paragraph that is gone is left out; the others go in.
    expect(document.apply(operations)).toEqual([10]);
    expect(document.changed).toBe(true);
    expect(() =>
      document.apply([
        { type: 'insertParagraph', id: 'a1', paragraph: { kind: 'text', runs: [] } },
      ]),
    ).toThrow(OdtError);

    const written = await document.toBytes();
    const again = await OdtDocument.open(written);
    expect(again.page()).toMatchObject({
      numbers: true,
      header: 'Angebot Müller',
      footer: 'Vertraulich',
    });
    expect(again.page().marginLeft).toBeCloseTo(85, 0);
    // The number goes, the foot's words stay; the head's words go, and with them the head.
    again.apply([{ type: 'setPage', page: { ...again.page(), numbers: false, header: '' } }]);
    expect(again.page()).toMatchObject({ numbers: false, footer: 'Vertraulich' });
    expect(again.page().header).toBeUndefined();
    again.apply([{ type: 'setPage', page: { ...again.page(), numbers: true, footer: '' } }]);
    expect(again.page()).toMatchObject({ numbers: true });
    expect(again.page().footer).toBeUndefined();
    expect(again.blocks().map((block) => block.id)).toEqual([
      'w1',
      'w2',
      'w3',
      'a1',
      'a4',
      'a2',
      'a3',
      't1',
      'w4',
      'w6',
      'w7',
      'w8',
      'w9',
    ]);
    const third = paragraph(again, 'w3');
    expect(words(third)).toBe('Hallo fett  und Link Ende ');
    // „Ebenen“: a table and a paragraph put elsewhere, as they are.
    const order = again.blocks().map((block) => block.id);
    again.apply([
      { type: 'moveBlock', id: 't1', beforeId: 'w1' },
      { type: 'moveBlock', id: 'w2', afterId: order.at(-1)! },
    ]);
    const restacked = await OdtDocument.open(await again.toBytes());
    expect(restacked.blocks().map((block) => block.id)).toEqual([
      't1',
      ...order.filter((id) => id !== 't1' && id !== 'w2'),
      'w2',
    ]);
    // Locked („Ebenen“, ⇧⌘L): a protected section of its own each, as LibreOffice protects; nothing
    // changes or moves it, what is put beside it stays outside; unlocked, its section goes.
    const empty = { kind: 'text' as const, runs: [{ text: '' }] };
    expect(
      restacked.apply([
        { type: 'protectBlock', id: 't1', protect: true },
        { type: 'protectBlock', id: 'w2', protect: true },
        { type: 'setParagraph', id: 'w2', paragraph: { kind: 'text', runs: [{ text: 'Nein' }] } },
        { type: 'moveBlock', id: 't1', afterId: 'w1' },
        { type: 'setColumns', tableId: 't1', columns: [0.2, 0.8] },
        { type: 'insertParagraph', id: 'n1', afterId: 't1', paragraph: empty },
      ]),
    ).toEqual([2, 3, 4]);
    const locked = await OdtDocument.open(await restacked.toBytes());
    expect(locked.blocks().slice(0, 2)).toMatchObject([{ id: 't1', protect: true }, { id: 'n1' }]);
    expect(locked.blocks()[1]?.protect).toBeUndefined();
    expect(paragraph(locked, 'w2')).toMatchObject({
      protect: true,
      runs: [{ text: words(paragraph(again, 'w2')) }],
    });
    locked.apply([{ type: 'protectBlock', id: 'w2', protect: false }]);
    const unlocked = await OdtDocument.open(await locked.toBytes());
    expect(paragraph(unlocked, 'w2').protect).toBeUndefined();
    expect(unlocked.blocks()[0]?.protect).toBe(true);
    expect(third.runs[1]).toMatchObject({ text: 'fett', bold: true });
    expect(third.runs[3]).toMatchObject({ link: 'https://example.org', underline: true });
    expect(paragraph(again, 'a1').list).toEqual({ kind: 'bullet', level: 0 });
    expect(paragraph(again, 'a2')).toMatchObject({
      list: { kind: 'bullet', level: 1 },
      runs: [{ italic: true, color: '#aa0000' }],
    });
    expect(paragraph(again, 'a3').list).toEqual({ kind: 'number', level: 0 });
    expect(paragraph(again, 'a4')).toMatchObject({ kind: 'quote', align: 'center' });
    expect(paragraph(again, 'a4').list).toBeUndefined();
    expect(paragraph(again, 'w4')).toMatchObject({ kind: 'heading', level: 3, breakBefore: true });
    const table = again.blocks().find((block) => block.type === 'table');
    expect(
      table?.type === 'table' && table.rows.map((row) => row.map((cell) => cell.blocks[0]?.id)),
    ).toEqual([
      ['c1', 'c2'],
      ['c5', 'c6'],
    ]);
    expect(paragraph(again, 'c1').runs[0]).toMatchObject({ highlight: '#ffff00' });
    // LibreOffice's own styles beyond headings: added on demand, read back as their kind.
    expect(paragraph(again, 'c2').kind).toBe('preformatted');
    expect(again.formats().preformatted.font).toBe('Liberation Mono');
    expect(again.formats()).toMatchObject({ subtitle: { size: 15 }, caption: { italic: true } });
    expect(again.text()).toContain('Neue Seite');

    // Cells merged and parted again, a row through a merged cell, the columns' widths: the
    // paragraphs move as they are, the cells reached over are written as covered ones.
    const shapeOf = (document: OdtDocument) => {
      const found = document.blocks().find((block) => block.type === 'table');
      if (found?.type !== 'table') throw new Error('no table');
      return {
        columns: found.columns.map((share) => Number(share.toFixed(2))),
        rows: found.rows.map((row) =>
          row.map((cell) =>
            [
              cell.blocks.map((block) => block.id).join('+'),
              cell.colSpan ?? 1,
              cell.rowSpan ?? 1,
            ].join(' '),
          ),
        ),
      };
    };
    expect(
      again.apply([
        { type: 'setColumns', tableId: 't1', columns: [0.25, 0.75] },
        {
          type: 'setCells',
          tableId: 't1',
          rows: [[{ ids: ['c1', 'c2'], colSpan: 2 }], [{ ids: ['c5'] }, { ids: ['c6'] }]],
        },
      ]),
    ).toEqual([]);
    const merged = await OdtDocument.open(await again.toBytes());
    expect(shapeOf(merged)).toEqual({
      columns: [0.25, 0.75],
      rows: [['c1+c2 2 1'], ['c5 1 1', 'c6 1 1']],
    });
    expect(paragraph(merged, 'c1').runs[0]).toMatchObject({ text: 'Zelle', highlight: '#ffff00' });
    const mergedXml = await (
      await JSZip.loadAsync(await merged.toBytes())
    )
      .file('content.xml')
      ?.async('string');
    expect(mergedXml).toContain('table:number-columns-spanned="2"');
    expect(mergedXml?.match(/<table:covered-table-cell\/>/g)).toHaveLength(1);
    expect(mergedXml).toContain('style:column-width="3.876cm"');
    // Down the first column instead, a new row through it, and the first cell parted again.
    expect(
      merged.apply([
        {
          type: 'setCells',
          tableId: 't1',
          rows: [
            [{ ids: ['c1'], rowSpan: 3 }, { ids: ['c2'] }],
            [{ ids: ['n1'] }],
            [{ ids: ['c6', 'c5'] }],
          ],
        },
        { type: 'setParagraph', id: 'n1', paragraph: { kind: 'text', runs: [{ text: 'Neu' }] } },
      ]),
    ).toEqual([]);
    const down = await OdtDocument.open(await merged.toBytes());
    expect(shapeOf(down).rows).toEqual([['c1 1 3', 'c2 1 1'], ['n1 1 1'], ['c6+c5 1 1']]);
    expect(words(paragraph(down, 'n1'))).toBe('Neu');
    // What does not fit the table is refused, and nothing of it is written.
    expect(() =>
      down.apply([{ type: 'setCells', tableId: 't1', rows: [[{ ids: ['c1'] }]] }]),
    ).toThrow(OdtError);
    expect(() => down.apply([{ type: 'setColumns', tableId: 't1', columns: [1, 1, 1] }])).toThrow(
      OdtError,
    );
    expect(
      down.apply([
        {
          type: 'setCells',
          tableId: 't1',
          rows: [
            [{ ids: ['c1'] }, { ids: ['c2'] }],
            [{ ids: ['n2'] }, { ids: ['c6', 'c5'] }],
          ],
        },
      ]),
    ).toEqual([]);
    expect(shapeOf(await OdtDocument.open(await down.toBytes())).rows).toEqual([
      ['c1 1 1', 'c2 1 1'],
      ['n2 1 1', 'c6+c5 1 1'],
    ]);
    // A column comes: the step says how many there are now – and one goes again, with its cell.
    expect(() =>
      down.apply([
        {
          type: 'setCells',
          tableId: 't1',
          rows: [[{ ids: ['c1'] }, { ids: ['k1'] }, { ids: ['c2'] }], [{ ids: ['n2'] }]],
          columns: [1, 1, 2],
        },
      ]),
    ).toThrow(OdtError);
    const three = [
      [{ ids: ['c1'] }, { ids: ['k1'] }, { ids: ['c2'] }],
      [{ ids: ['n2'], colSpan: 2 }, { ids: ['c6', 'c5'] }],
    ];
    expect(() => down.apply([{ type: 'setCells', tableId: 't1', rows: three }])).toThrow(OdtError);
    down.apply([{ type: 'setCells', tableId: 't1', rows: three, columns: [1, 1, 2] }]);
    const widerBytes = await down.toBytes();
    expect(shapeOf(await OdtDocument.open(widerBytes))).toEqual({
      columns: [0.25, 0.25, 0.5],
      rows: [
        ['c1 1 1', 'k1 1 1', 'c2 1 1'],
        ['n2 2 1', 'c6+c5 1 1'],
      ],
    });
    const widerXml = await (await JSZip.loadAsync(widerBytes)).file('content.xml')?.async('string');
    expect(widerXml?.match(/<table:table-column /g)).toHaveLength(3);
    expect(widerXml?.match(/<table:covered-table-cell\/>/g)).toHaveLength(1);
    down.apply([
      {
        type: 'setCells',
        tableId: 't1',
        rows: [
          [{ ids: ['c1'] }, { ids: ['c2'] }],
          [{ ids: ['n2'] }, { ids: ['c6', 'c5'] }],
        ],
        columns: [1, 3],
      },
    ]);
    const narrowBytes = await down.toBytes();
    expect(shapeOf(await OdtDocument.open(narrowBytes))).toEqual({
      columns: [0.25, 0.75],
      rows: [
        ['c1 1 1', 'c2 1 1'],
        ['n2 1 1', 'c6+c5 1 1'],
      ],
    });
    const narrowXml = await (
      await JSZip.loadAsync(narrowBytes)
    )
      .file('content.xml')
      ?.async('string');
    expect(narrowXml?.match(/<table:table-column /g)).toHaveLength(2);
    expect(narrowXml).not.toContain('k1');
    expect(narrowXml).not.toContain('covered-table-cell');

    // A picture goes into the file and is handed out again; nothing else is.
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const path = await again.addPicture(png, 'image/png');
    const credit = {
      name: 'Ana Berg',
      profileUrl: 'https://unsplash.com/@ana?utm_source=slider&utm_medium=referral',
      photoUrl: 'https://unsplash.com/photos/abc?utm_source=slider&utm_medium=referral',
    };
    expect(
      again.apply([
        {
          type: 'insertPicture',
          id: 'p1',
          afterId: 'w9',
          picture: { path, width: 100, height: 50, credit },
          align: 'center',
        },
      ]),
    ).toEqual([]);
    const withPicture = await OdtDocument.open(await again.toBytes());
    // A photo service's photo names who took it in the file, as on a slide; centred it stays so.
    expect(paragraph(withPicture, 'p1')).toMatchObject({
      locked: true,
      align: 'center',
      pictures: [{ path, credit }],
    });
    expect((await withPicture.picture(path))?.mimeType).toBe('image/png');
    expect(await withPicture.picture('content.xml')).toBeNull();

    {
      // A picture in a line is one character of it: written as a frame standing as a character,
      // read back as that; one the file brought keeps its own frame – name, style – through
      // retyping, resizing and its paragraph being parted.
      const inLine = { text: '\uFFFC', picture: { path, width: 40, height: 20 } };
      expect(
        withPicture.apply([
          {
            type: 'setParagraph',
            id: 'w9',
            paragraph: {
              kind: 'text',
              runs: [{ text: 'vor ' }, inLine, { text: ' nach', bold: true }],
            },
          },
        ]),
      ).toEqual([]);
      const lineBytes = await withPicture.toBytes();
      const lineXml =
        (await (await JSZip.loadAsync(lineBytes)).file('content.xml')?.async('string')) ?? '';
      const named = lineXml.replace(
        /<draw:frame (?=[^>]*as-char[^>]*svg:width="1\.411cm")/,
        '<draw:frame draw:style-name="fr9" svg:title="Eigen" ',
      );
      expect(named).toContain('fr9');
      const lineZip = await JSZip.loadAsync(lineBytes);
      lineZip.file('content.xml', named);
      const line = await OdtDocument.open(await lineZip.generateAsync({ type: 'uint8array' }));
      const read = paragraph(line, 'w9');
      expect(read.locked).toBeUndefined();
      expect(read.pictures).toBeUndefined();
      expect(read.runs.map((run) => [run.text, run.picture?.path, run.bold ?? false])).toEqual([
        ['vor ', undefined, false],
        ['\uFFFC', path, false],
        [' nach', undefined, true],
      ]);
      expect(read.runs[1]?.picture?.width).toBeCloseTo(40, 1);
      expect(
        line.apply([
          {
            type: 'setParagraph',
            id: 'w9',
            paragraph: { kind: 'text', runs: [{ text: 'davor ' }] },
          },
          {
            type: 'insertParagraph',
            id: 'p2',
            afterId: 'w9',
            paragraph: {
              kind: 'text',
              runs: [{ ...inLine, picture: { path, width: 80, height: 40 } }, { text: ' danach' }],
            },
          },
        ]),
      ).toEqual([]);
      const movedBytes = await line.toBytes();
      const movedXml =
        (await (await JSZip.loadAsync(movedBytes)).file('content.xml')?.async('string')) ?? '';
      expect(movedXml.match(/<draw:frame [^>]*fr9[^>]*>/)?.[0]).toMatch(/svg:width="2\.822cm"/);
      expect(movedXml.match(/as-char/g)).toHaveLength(2);
      const moved = await OdtDocument.open(movedBytes);
      expect(words(paragraph(moved, 'p2'))).toBe('\uFFFC danach');
      // Not a picture of this file, or more than the one character: refused.
      expect(() =>
        moved.apply([
          {
            type: 'setParagraph',
            id: 'w9',
            paragraph: {
              kind: 'text',
              runs: [
                {
                  text: '\uFFFC',
                  picture: { path: 'Pictures/../content.xml', width: 1, height: 1 },
                },
              ],
            },
          },
        ]),
      ).toThrow('Dieses Bild ist nicht im Dokument.');

      // A font and a size set by hand: written into the stretch's style, a font the file did not
      // name yet declared – read back the same; the paragraph's own write no style at all.
      const own = paragraph(moved, 'w9').look;
      const runs = [
        { text: 'gross', font: 'Comic Neue', size: 21.5 },
        { text: ' eigen', font: own.font, size: own.size },
        { text: ' fett', bold: true, size: 9 },
      ];
      expect(
        moved.apply([{ type: 'setParagraph', id: 'w9', paragraph: { kind: 'text', runs } }]),
      ).toEqual([]);
      const fontBytes = await moved.toBytes();
      const fontXml =
        (await (await JSZip.loadAsync(fontBytes)).file('content.xml')?.async('string')) ?? '';
      expect(fontXml).toMatch(
        /<office:font-face-decls>.*<style:font-face style:name="Comic Neue" svg:font-family="&apos;Comic Neue&apos;"\/>.*<\/office:font-face-decls>\s*<office:automatic-styles>/s,
      );
      expect(fontXml).toMatch(/style:font-name="Comic Neue"[^>]*fo:font-size="21\.5pt"/);
      expect(fontXml).toMatch(/style:font-size-asian="21\.5pt"/);
      expect(fontXml).toMatch(/>gross<\/text:span><text:s\/>eigen<text:span/);
      const fonts = await OdtDocument.open(fontBytes);
      expect(paragraph(fonts, 'w9').runs.map(({ style: _style, ...run }) => run)).toEqual([
        { text: 'gross', font: 'Comic Neue', size: 21.5 },
        { text: ' eigen' },
        { text: ' fett', bold: true, size: 9 },
      ]);
      // Set back to the paragraph's own: no font, no size is left on the words.
      expect(
        fonts.apply([
          {
            type: 'setParagraph',
            id: 'w9',
            paragraph: { kind: 'text', runs: [{ text: 'gross eigen fett' }] },
          },
        ]),
      ).toEqual([]);
      const plain = paragraph(await OdtDocument.open(await fonts.toBytes()), 'w9');
      expect(plain.runs).toEqual([{ text: 'gross eigen fett' }]);
    }

    // A file of another program: its paragraphs get ids, the same ones each time it is read.
    const foreign = new JSZip();
    foreign.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    foreign.file(
      'content.xml',
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Eins <text:span>zwei</text:span><text:s text:c="2"/>drei</text:p><text:list><text:list-item><text:p>Punkt</text:p></text:list-item></text:list><text:p><text:date>heute</text:date></text:p></office:text></office:body></office:document-content>',
    );
    const other = await OdtDocument.open(await foreign.generateAsync({ type: 'uint8array' }));
    // Its merged cells read as merged: the covered ones are no cells, the columns still count.
    const cellXml = (inner: string) =>
      `<table:table-cell ${inner}><text:p>x</text:p></table:table-cell>`;
    foreign.file(
      'content.xml',
      `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><office:body><office:text><table:table table:name="T"><table:table-column table:number-columns-repeated="3"/><table:table-row>${cellXml('table:number-columns-spanned="2"')}<table:covered-table-cell/>${cellXml('table:number-rows-spanned="2"')}</table:table-row><table:table-row>${cellXml('')}${cellXml('')}<table:covered-table-cell/></table:table-row></table:table><text:p/></office:text></office:body></office:document-content>`,
    );
    const spans = await OdtDocument.open(await foreign.generateAsync({ type: 'uint8array' }));
    const read = spans.blocks()[0];
    expect(read?.type === 'table' && read.columns).toHaveLength(3);
    expect(
      read?.type === 'table' &&
        read.rows.map((row) => row.map((cell) => [cell.colSpan ?? 1, cell.rowSpan ?? 1])),
    ).toEqual([
      [
        [2, 1],
        [1, 2],
      ],
      [
        [1, 1],
        [1, 1],
      ],
    ]);
    expect(other.blocks().map((block) => block.id)).toEqual(['w1', 'w2', 'w3']);
    expect(words(paragraph(other, 'w1'))).toBe('Eins zwei  drei');
    expect(paragraph(other, 'w2').list).toEqual({ kind: 'bullet', level: 0 });
    // A date the program fills in: shown, never rewritten by hand.
    expect(paragraph(other, 'w3')).toMatchObject({ locked: true });
    await expect(OdtDocument.open(new Uint8Array([1, 2, 3]))).rejects.toThrow(OdtError);

    // A format's own look, for the whole document: written into the file's named style, the
    // paragraphs of the format follow – one with a line spacing of its own keeps it.
    {
      const fresh = await OdtDocument.open(
        await blankOdt(new Date(0), { template: 'report', title: 'Bericht' }),
      );
      const before = fresh.formats();
      const look = {
        font: 'Fira Sans',
        size: 17,
        bold: false,
        italic: true,
        color: '#224466',
        lineHeight: 1.5,
        spaceBefore: 20,
        spaceAfter: 4,
      };
      expect(
        fresh.apply([
          { type: 'setFormatLook', format: 'heading1', look },
          { type: 'setFormatLook', format: 'heading5', look: { size: 9 } },
          {
            type: 'setParagraph',
            id: 'w3',
            paragraph: { kind: 'text', lineHeight: 2, runs: [{ text: 'Weit' }] },
          },
          {
            type: 'setParagraph',
            id: 'w2',
            paragraph: {
              kind: 'heading',
              level: 1,
              lineHeight: 1.15,
              runs: [
                { text: 'Eng', italic: true },
                { text: ' fett', bold: true, italic: true },
              ],
            },
          },
        ]),
      ).toEqual([]);
      const read = await OdtDocument.open(await fresh.toBytes());
      const formats = read.formats();
      expect(formats.heading1).toMatchObject(look);
      expect(formats.heading5.size).toBe(9);
      expect(formats.heading5.bold).toBe(before.heading5.bold);
      expect(formats.heading2).toEqual(before.heading2);
      expect(formats.text).toEqual(before.text);
      // Its own spacing is the paragraph's word; its look stays the format's.
      expect(paragraph(read, 'w3')).toMatchObject({ lineHeight: 2 });
      expect(paragraph(read, 'w3').look.lineHeight).toBe(before.text.lineHeight);
      const head = paragraph(read, 'w2');
      expect(head.lineHeight).toBeCloseTo(1.15, 2);
      expect(head.look).toMatchObject({ ...look });
      expect(head.runs.map(({ style: _style, ...run }) => run)).toEqual([
        { text: 'Eng', italic: true },
        { text: ' fett', bold: true, italic: true },
      ]);
      const xml = await (
        await JSZip.loadAsync(await read.toBytes())
      )
        .file('styles.xml')
        ?.async('string');
      expect(xml).toMatch(
        /<style:font-face style:name="Fira Sans" svg:font-family="(&apos;|')Fira Sans/,
      );
      expect(xml).toMatch(/style:name="Heading_20_1"[^>]*>.*?style:font-name-asian="Fira Sans"/s);
      // „Wie das Format“: its own spacing goes, the format's shows again.
      expect(
        read.apply([
          { type: 'setParagraph', id: 'w3', paragraph: { kind: 'text', runs: [{ text: 'Weit' }] } },
        ]),
      ).toEqual([]);
      const plain = await OdtDocument.open(await read.toBytes());
      expect(paragraph(plain, 'w3').lineHeight).toBeUndefined();
      expect(plain.formats().heading1).toMatchObject(look);
    }
  });
});
