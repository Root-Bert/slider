import { describe, expect, it } from 'vitest';
import { MarkdownDocument, OdtError } from '../src';

describe('a Markdown file', () => {
  it('is its lines: steps change them, the rest stays byte for byte, ids come along or are counted', () => {
    const bytes = new TextEncoder().encode('﻿# Titel\r\n\r\nText ohne Ende');
    const file = MarkdownDocument.open(bytes);
    expect(file.ids()).toEqual(['L1', 'L2', 'L3']);
    expect(file.blocks().map((block) => block.type === 'paragraph' && block.runs)).toEqual([
      [{ text: '# Titel' }],
      [],
      [{ text: 'Text ohne Ende' }],
    ]);
    expect(file.page().numbers).toBe(false);
    // Untouched, it is the same file.
    expect(file.toBytes()).toEqual(bytes);
    expect(file.changed).toBe(false);

    const dropped = file.apply([
      {
        type: 'setParagraph',
        id: 'L3',
        paragraph: { kind: 'text', runs: [{ text: 'Neu\nzeile' }] },
      },
      {
        type: 'insertParagraph',
        id: 'pa1',
        afterId: 'L1',
        paragraph: { kind: 'text', runs: [{ text: '- a' }] },
      },
      {
        type: 'insertParagraph',
        id: 'pa2',
        afterId: 'gone',
        paragraph: { kind: 'text', runs: [] },
      },
      { type: 'moveBlock', id: 'L2', beforeId: 'L1' },
      { type: 'setPage', page: { ...file.page(), numbers: true } },
      { type: 'remove', id: 'nope' },
    ]);
    expect(dropped).toEqual([2, 4, 5]);
    expect(file.changed).toBe(true);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(file.toBytes())).toBe(
      '﻿\r\n# Titel\r\n- a\r\nNeu zeile',
    );
    expect(file.ids()).toEqual(['L2', 'L1', 'pa1', 'L3']);
    expect(() =>
      file.apply([{ type: 'insertParagraph', id: 'L1', paragraph: { kind: 'text', runs: [] } }]),
    ).toThrow(OdtError);

    // Read again with its ids it keeps them; with ids that do not fit, it counts.
    const again = MarkdownDocument.open(file.toBytes(), file.ids());
    expect(again.ids()).toEqual(['L2', 'L1', 'pa1', 'L3']);
    expect(MarkdownDocument.open(file.toBytes(), ['x']).ids()).toEqual(['L1', 'L2', 'L3', 'L4']);
    // The last line stays; a file that is not UTF-8 is not read.
    const one = MarkdownDocument.open(new Uint8Array());
    expect(one.apply([{ type: 'remove', id: 'L1' }])).toEqual([0]);
    expect(() => MarkdownDocument.open(new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(OdtError);
  });
});
