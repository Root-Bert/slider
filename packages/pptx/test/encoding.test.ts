import { afterEach, describe, expect, it, vi } from 'vitest';
import { escapeXml, imageMimeType, num, safeColor, toBase64 } from '../src/render/encoding';

describe('escapeXml', () => {
  it('escapes all five XML special characters', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;',
    );
  });

  it('leaves other text, including umlauts, untouched', () => {
    expect(escapeXml('Größe: 100 %')).toBe('Größe: 100 %');
    expect(escapeXml('')).toBe('');
  });

  it('drops characters XML 1.0 does not allow; vertical tab and form feed become a space', () => {
    const nonCharacters = String.fromCharCode(0xfffe) + 'f' + String.fromCharCode(0xffff);
    expect(escapeXml(`a\u0000b\u0001c\u0008d\u001fe${nonCharacters}g`)).toBe('abcdefg');
    expect(escapeXml('a\u000bb\u000cc')).toBe('a b c');
    expect(escapeXml('tab\tlf\ncr\r')).toBe('tab\tlf\ncr\r');
    expect(escapeXml('lone \ud800 and \udc00 surrogates')).toBe('lone  and  surrogates');
    expect(escapeXml('emoji 😀 stays')).toBe('emoji 😀 stays');
  });

  it('escapes an existing entity again', () => {
    expect(escapeXml('&amp;')).toBe('&amp;amp;');
  });
});

describe('safeColor', () => {
  it('lower-cases plain #rrggbb colours', () => {
    expect(safeColor('#ABCDEF')).toBe('#abcdef');
    expect(safeColor('#0f172a')).toBe('#0f172a');
  });

  it('rejects everything else', () => {
    for (const value of [
      '#abc',
      'abcdef',
      'red',
      'url(x)',
      '#abcdefg',
      '#12345g',
      '',
      null,
      undefined,
    ])
      expect(safeColor(value)).toBeNull();
    expect(safeColor('#abcdef" onload="x')).toBeNull();
  });
});

describe('num', () => {
  it('rounds to at most two decimals without trailing zeros', () => {
    expect(num(2)).toBe('2');
    expect(num(1.5)).toBe('1.5');
    expect(num(1.234)).toBe('1.23');
    expect(num(1.236)).toBe('1.24');
    expect(num(-0.004)).toBe('0');
    expect(num(1920)).toBe('1920');
  });
});

describe('imageMimeType', () => {
  it.each([
    ['ppt/media/image1.png', 'image/png'],
    ['a.JPG', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.gif', 'image/gif'],
    ['a.svg', 'image/svg+xml'],
    ['a.webp', 'image/webp'],
    ['a.bmp', 'image/bmp'],
    ['archive.v2/photo.png', 'image/png'],
  ])('%s → %s', (path, type) => {
    expect(imageMimeType(path)).toBe(type);
  });

  it('skips formats browsers cannot show inside SVG', () => {
    for (const path of ['a.emf', 'a.wmf', 'a.tiff', 'a.png.emf'])
      expect(imageMimeType(path)).toBeNull();
  });

  it('returns null without an extension', () => {
    expect(imageMimeType('ppt/media/image')).toBeNull();
    expect(imageMimeType('')).toBeNull();
  });
});

describe('toBase64', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const bytes = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 31) % 256);

  it('encodes with Buffer in Node', () => {
    expect(toBase64(new TextEncoder().encode('Slider'))).toBe('U2xpZGVy');
    expect(toBase64(new Uint8Array())).toBe('');
  });

  it('only encodes the viewed part of a larger buffer', () => {
    const view = new Uint8Array(new TextEncoder().encode('xxSliderxx').buffer, 2, 6);
    expect(toBase64(view)).toBe('U2xpZGVy');
  });

  it('falls back to btoa in chunks when Buffer is missing', () => {
    const data = bytes(0x8000 * 2 + 17);
    const expected = Buffer.from(data).toString('base64');
    vi.stubGlobal('Buffer', undefined);
    expect(typeof Buffer).toBe('undefined');
    expect(toBase64(data)).toBe(expected);
    expect(toBase64(new TextEncoder().encode('Slider'))).toBe('U2xpZGVy');
  });
});
