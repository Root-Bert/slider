import { describe, expect, it } from 'vitest';
import { fnv1a32, normaliseText, textHash } from '../src/hash';

describe('fnv1a32', () => {
  it('always returns 8 lower-case hex digits', () => {
    for (const text of ['', 'a', 'Folie 1', 'x'.repeat(10_000)])
      expect(fnv1a32(text)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('hashes the UTF-8 bytes, so umlauts differ from their ASCII spelling', () => {
    expect(fnv1a32('ä')).not.toBe(fnv1a32('a'));
    expect(fnv1a32('Größe')).toBe(fnv1a32('Größe'));
    expect(fnv1a32('Größe')).not.toBe(fnv1a32('Grösse'));
  });

  it('is case sensitive on its own', () => {
    expect(fnv1a32('A')).not.toBe(fnv1a32('a'));
  });
});

describe('normaliseText', () => {
  it('collapses every kind of whitespace and trims', () => {
    expect(normaliseText('\n\t A  B\r\n')).toBe('a b');
    expect(normaliseText('   ')).toBe('');
  });

  it('lower-cases umlauts', () => {
    expect(normaliseText('ÜBERSICHT')).toBe('übersicht');
  });
});

describe('textHash', () => {
  it('ignores cosmetic edits but not changed words', () => {
    expect(textHash('Umsatz  nach\nRegion')).toBe(textHash('umsatz nach region'));
    expect(textHash('Umsatz nach Region')).not.toBe(textHash('Umsatz nach Land'));
    expect(textHash('')).toBe(fnv1a32(''));
  });
});
