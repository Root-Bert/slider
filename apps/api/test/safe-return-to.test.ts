import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '../src/routes/auth';

describe('safeReturnTo', () => {
  it('keeps same-origin paths', () => {
    expect(safeReturnTo('/decks?x=1#a')).toBe('/decks?x=1#a');
  });

  it.each([
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
  ])('falls back for %j', (value) => {
    expect(safeReturnTo(value, '/')).toBe('/');
  });
});
