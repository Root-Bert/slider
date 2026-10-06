import { describe, expect, it } from 'vitest';
import { parseShareLink } from '../src/link';

describe('parseShareLink (BER-92 link types)', () => {
  it.each([
    ['https://1drv.ms/p/c/abc123/EaB3kQ', 'onedrive'],
    ['https://onedrive.live.com/edit?id=ABC!123&resid=ABC!123', 'onedrive'],
    ['https://contoso.sharepoint.com/:p:/s/strategie/EaB3kQxyz', 'sharepoint'],
    ['https://contoso-my.sharepoint.com/:p:/g/personal/robert/EaB3kQ', 'sharepoint'],
    ['https://contoso.sharepoint.com/sites/x/_layouts/15/Doc.aspx?sourcedoc={guid}', 'sharepoint'],
  ])('recognises %s as %s', (url, kind) => {
    expect(parseShareLink(url)?.kind).toBe(kind);
  });

  it.each([
    'not a url',
    'http://1drv.ms/p/c/abc', // no TLS
    'https://contoso.sharepoint.com/:w:/s/team/doc', // Word, not PowerPoint
    'https://evil.com/?q=sharepoint.com/:p:/',
    'https://sharepoint.com.evil.com/:p:/x',
    'https://docs.google.com/presentation/d/abc',
  ])('rejects %s', (url) => {
    expect(parseShareLink(url)).toBeNull();
  });

  it('tolerates surrounding whitespace from copy & paste', () => {
    expect(parseShareLink('  https://1drv.ms/p/c/abc  \n')?.host).toBe('1drv.ms');
  });
});
