import { describe, expect, it } from 'vitest';
import {
  mergeTextDefaults,
  NO_TEXT_DEFAULTS,
  paragraphsToText,
  plainText,
  readListStyleDefaults,
  readParagraphs,
} from '../src/text';
import { parseXml } from '../src/xml';

const scheme = new Map([['dk1', '#111111']]);

describe('readListStyleDefaults', () => {
  it('reads size and alignment of the first level only', () => {
    const style = parseXml(
      '<a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="2400"/></a:lvl1pPr>' +
        '<a:lvl2pPr algn="r"><a:defRPr sz="1200"/></a:lvl2pPr></a:lstStyle>',
    );
    expect(readListStyleDefaults(style)).toEqual({ sizePt: 24, align: 'center' });
  });

  it.each([
    ['l', 'left'],
    ['r', 'right'],
    ['just', 'justify'],
    ['dist', 'justify'],
  ])('maps algn="%s" to %s', (algn, align) => {
    expect(
      readListStyleDefaults(parseXml(`<a:lstStyle><a:lvl1pPr algn="${algn}"/></a:lstStyle>`)).align,
    ).toBe(align);
  });

  it('gives no defaults for missing or unknown values', () => {
    expect(readListStyleDefaults(undefined)).toEqual(NO_TEXT_DEFAULTS);
    expect(
      readListStyleDefaults(parseXml('<a:lstStyle><a:lvl1pPr algn="thaiDist"/></a:lstStyle>')),
    ).toEqual(NO_TEXT_DEFAULTS);
  });
});

describe('mergeTextDefaults', () => {
  it('fills only the gaps of the primary defaults', () => {
    expect(mergeTextDefaults({ sizePt: 18, align: null }, { sizePt: 32, align: 'right' })).toEqual({
      sizePt: 18,
      align: 'right',
    });
    expect(mergeTextDefaults(NO_TEXT_DEFAULTS, NO_TEXT_DEFAULTS)).toEqual(NO_TEXT_DEFAULTS);
  });
});

describe('readParagraphs', () => {
  it('returns nothing without a text body', () => {
    expect(readParagraphs(undefined, NO_TEXT_DEFAULTS, scheme)).toEqual([]);
  });

  it('reads runs, line breaks and fields with their formatting', () => {
    const body = parseXml(
      '<p:txBody><a:bodyPr/><a:p><a:pPr algn="r"/>' +
        '<a:r><a:rPr sz="1800" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Umsatz</a:t></a:r>' +
        '<a:br/>' +
        '<a:fld type="slidenum"><a:rPr i="true"/><a:t>3</a:t></a:fld>' +
        '<a:endParaRPr sz="1800"/></a:p></p:txBody>',
    );
    expect(readParagraphs(body, { sizePt: 12, align: 'center' }, scheme)).toEqual([
      {
        align: 'right',
        runs: [
          { text: 'Umsatz', sizePt: 18, bold: true, italic: false, color: '#111111' },
          { text: '\n', sizePt: 12, bold: false, italic: false, color: null },
          {
            text: '3',
            sizePt: 12,
            bold: false,
            italic: true,
            color: null,
            volatileField: 'slidenum',
          },
        ],
      },
    ]);
  });

  it('marks slide numbers and dates as volatile and leaves them out of the plain text', () => {
    const body = parseXml(
      '<p:txBody><a:p><a:r><a:t>Folie </a:t></a:r>' +
        '<a:fld type="slidenum"><a:t>3</a:t></a:fld>' +
        '<a:r><a:t> · </a:t></a:r>' +
        '<a:fld type="datetime1"><a:t>17.10.2026</a:t></a:fld>' +
        '<a:fld type="datetime"><a:t>Oktober</a:t></a:fld>' +
        '<a:fld type="other"><a:t>bleibt</a:t></a:fld></a:p></p:txBody>',
    );
    const paragraphs = readParagraphs(body, NO_TEXT_DEFAULTS, scheme);
    expect(paragraphs[0]?.runs.map((run) => run.volatileField)).toEqual([
      undefined,
      'slidenum',
      undefined,
      'datetime1',
      'datetime',
      undefined,
    ]);
    // Shown in the render, but not part of what matching compares.
    expect(paragraphs[0]?.runs.map((run) => run.text).join('')).toBe(
      'Folie 3 · 17.10.2026Oktoberbleibt',
    );
    expect(paragraphsToText(paragraphs)).toBe('Folie  · bleibt');
  });

  it('prefers the shape list style over inherited defaults, then falls back to left', () => {
    const body = parseXml(
      '<p:txBody><a:lstStyle><a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr></a:lstStyle>' +
        '<a:p><a:r><a:t>A</a:t></a:r></a:p></p:txBody>',
    );
    expect(readParagraphs(body, { sizePt: 44, align: 'center' }, scheme)).toEqual([
      {
        align: 'center',
        runs: [{ text: 'A', sizePt: 20, bold: false, italic: false, color: null }],
      },
    ]);
    expect(readParagraphs(body, NO_TEXT_DEFAULTS, scheme)[0]?.align).toBe('left');
  });

  it('keeps empty paragraphs and runs without text', () => {
    const body = parseXml('<p:txBody><a:p/><a:p><a:r><a:rPr b="0"/></a:r></a:p></p:txBody>');
    expect(readParagraphs(body, NO_TEXT_DEFAULTS, scheme)).toEqual([
      { align: 'left', runs: [] },
      {
        align: 'left',
        runs: [{ text: '', sizePt: null, bold: false, italic: false, color: null }],
      },
    ]);
  });
});

describe('paragraphsToText', () => {
  it('joins runs and paragraphs', () => {
    const run = (text: string) => ({ text, sizePt: null, bold: false, italic: false, color: null });
    expect(
      paragraphsToText([
        { align: 'left', runs: [run('Umsatz '), run('2026')] },
        { align: 'left', runs: [] },
        { align: 'left', runs: [run('DACH')] },
      ]),
    ).toBe('Umsatz 2026\n\nDACH');
    expect(paragraphsToText([])).toBe('');
  });
});

describe('plainText', () => {
  it('reads runs, fields and breaks of every paragraph', () => {
    const body = parseXml(
      '<p:text><a:p><a:r><a:t>Bitte </a:t></a:r><a:br/><a:fld><a:t>prüfen</a:t></a:fld>' +
        '<a:pPr/></a:p><a:p><a:r><a:t>Danke</a:t></a:r></a:p></p:text>',
    );
    expect(plainText(body)).toBe('Bitte \nprüfen\nDanke');
  });

  it('is empty without paragraphs', () => {
    expect(plainText(undefined)).toBe('');
    expect(plainText(parseXml('<p:txBody><a:bodyPr/></p:txBody>'))).toBe('');
  });
});
