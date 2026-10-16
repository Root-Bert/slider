import { describe, expect, it } from 'vitest';
import { tokenizeBody } from './comment-body';

describe('tokenizeBody', () => {
  it('returns plain text as one token', () => {
    expect(tokenizeBody('Hallo Welt')).toEqual([{ type: 'text', text: 'Hallo Welt' }]);
  });

  it('recognises known full names as mentions, longest first', () => {
    expect(tokenizeBody('@Robert Hofmann kannst du?', ['Robert', 'Robert Hofmann'])).toEqual([
      { type: 'mention', text: '@Robert Hofmann' },
      { type: 'text', text: ' kannst du?' },
    ]);
  });

  it('falls back to single-word mentions and ignores e-mail addresses', () => {
    expect(tokenizeBody('mail@host.de @Lena')).toEqual([
      { type: 'text', text: 'mail@host.de ' },
      { type: 'mention', text: '@Lena' },
    ]);
  });

  it('parses bold and links, keeping trailing punctuation outside the link', () => {
    expect(tokenizeBody('Siehe **hier**: https://example.com/a.')).toEqual([
      { type: 'text', text: 'Siehe ' },
      { type: 'bold', text: 'hier' },
      { type: 'text', text: ': ' },
      { type: 'link', text: 'https://example.com/a', href: 'https://example.com/a' },
      { type: 'text', text: '.' },
    ]);
  });

  it('never produces links for non-http schemes', () => {
    const tokens = tokenizeBody('javascript:alert(1) <img src=x onerror=alert(1)>');
    expect(tokens.every((token) => token.type === 'text')).toBe(true);
  });
});
