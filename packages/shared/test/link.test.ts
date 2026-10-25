import { describe, expect, it } from 'vitest';
import {
  linkHasCredentials,
  parseGoogleLink,
  parseNextcloudLink,
  parseShareLink,
  withoutCredentials,
} from '../src/link';

describe('parseShareLink (BER-92 link types)', () => {
  it.each([
    ['https://1drv.ms/p/c/abc123/EaB3kQ', 'onedrive'],
    ['https://onedrive.live.com/edit?id=ABC!123&resid=ABC!123', 'onedrive'],
    ['https://contoso.sharepoint.com/:p:/s/strategie/EaB3kQxyz', 'sharepoint'],
    // A PDF shared from SharePoint, and a PDF behind a plain link.
    ['https://contoso.sharepoint.com/:b:/s/strategie/EaB3kQpdf', 'sharepoint'],
    // Word, Excel and pictures shared from SharePoint: the import turns them into a deck.
    ['https://contoso.sharepoint.com/:w:/s/team/EaB3kQdoc', 'sharepoint'],
    ['https://contoso.sharepoint.com/:x:/s/team/EaB3kQxls', 'sharepoint'],
    ['https://contoso-my.sharepoint.com/:i:/g/personal/robert/EaB3kQimg', 'sharepoint'],
    ['https://example.com/decks/Keynote%20Export.pdf', 'url'],
    ['https://contoso-my.sharepoint.com/:p:/g/personal/robert/EaB3kQ', 'sharepoint'],
    ['https://contoso.sharepoint.com/sites/x/_layouts/15/Doc.aspx?sourcedoc={guid}', 'sharepoint'],
    ['https://contoso.sharepoint.com/sites/x/Shared%20Documents/Q4.pptx', 'sharepoint'],
    ['https://example.com/files/deck.pptx', 'url'],
    ['https://cdn.example.com/Decks/Q4%20Strategie.PPTX?v=2', 'url'],
    ['https://raw.githubusercontent.com/org/repo/main/test.pptx', 'url'],
    ['https://cloud.example.de/s/Ab3dEf9GhJkLmNo', 'nextcloud'],
    ['https://cloud.example.de/index.php/s/Ab3dEf9GhJkLmNo/download', 'nextcloud'],
    ['https://example.de/nextcloud/index.php/f/4711', 'nextcloud'],
    ['https://cloud.example.de/apps/files/files/4711?dir=/Decks&openfile=true', 'nextcloud'],
    ['https://cloud.example.de/apps/files/?dir=/Decks&fileid=4711', 'nextcloud'],
    ['https://example.com/s/deck.pptx', 'url'], // a file name, not a share token
  ])('recognises %s as %s', (url, kind) => {
    expect(parseShareLink(url)?.kind).toBe(kind);
  });

  it.each([
    'not a url',
    'http://1drv.ms/p/c/abc', // no TLS
    'https://contoso.sharepoint.com/sites/team', // a site, no file
    'https://contoso.sharepoint.com/:ww:/s/team/doc', // no share link
    'https://evil.com/?q=sharepoint.com/:p:/',
    'https://sharepoint.com.evil.com/:p:/x',
    'https://docs.google.com/presentation/d/abc',
    'http://example.com/deck.pptx', // no TLS
    'https://example.com/page.html',
    'https://example.com/deck.ppt',
    'https://example.com/?file=deck.pptx', // the file name must be the path
    'https://contoso.sharepoint.com/sites/x/Shared%20Documents/Notes.docx',
    'http://cloud.example.de/s/Ab3dEf9GhJkLmNo', // no TLS
    'https://cloud.example.de/f/abc', // file ids are numbers
    'https://cloud.example.de/apps/files/?dir=/Decks', // a folder
  ])('rejects %s', (url) => {
    expect(parseShareLink(url)).toBeNull();
  });

  it('takes plain http only from the organisation’s own Nextcloud', () => {
    const options = { trustedNextcloud: 'http://cloud.intranet:8080/nextcloud' };
    expect(
      parseShareLink('http://cloud.intranet:8080/nextcloud/s/Ab3dEf9GhJkLmNo', options)?.kind,
    ).toBe('nextcloud');
    expect(parseShareLink('http://cloud.intranet:8080/nextcloud/f/4711', options)?.kind).toBe(
      'nextcloud',
    );
    // Another origin, a file there that is no Nextcloud link, or no trusted server: https only.
    expect(parseShareLink('http://cloud.intranet/nextcloud/s/Ab3dEf9GhJkLmNo', options)).toBeNull();
    expect(parseShareLink('http://evil.example/s/Ab3dEf9GhJkLmNo', options)).toBeNull();
    expect(parseShareLink('http://cloud.intranet:8080/deck.pptx', options)).toBeNull();
    expect(parseShareLink('http://cloud.intranet:8080/s/Ab3dEf9GhJkLmNo')).toBeNull();
    expect(
      parseShareLink('http://cloud.intranet:8080/s/Ab3dEf9GhJkLmNo', { trustedNextcloud: null }),
    ).toBeNull();
  });

  it('lets the browser through any http link that looks like Nextcloud – the server decides', () => {
    const options = { allowHttpNextcloud: true };
    expect(parseShareLink('http://cloud.intranet:8080/s/Ab3dEf9GhJkLmNo', options)?.kind).toBe(
      'nextcloud',
    );
    expect(parseShareLink('http://cloud.intranet/apps/files/files/4711', options)?.kind).toBe(
      'nextcloud',
    );
    // Everything else stays https-only.
    expect(parseShareLink('http://example.com/deck.pptx', options)).toBeNull();
    expect(parseShareLink('http://1drv.ms/p/c/abc', options)).toBeNull();
  });

  it.each([
    'https://user:secret@example.com/deck.pptx',
    'https://user@example.com/deck.pptx',
    'https://:secret@example.com/deck.pptx',
    'https://robert:pw@cloud.example.de/s/Ab3dEf9GhJkLmNo',
    'https://a:b@contoso.sharepoint.com/:p:/s/strategie/EaB3kQxyz',
    'https://a:b@1drv.ms/p/c/abc',
    'https://a:b@docs.google.com/presentation/d/1AbCdEfGhIjKlMnOp/edit',
  ])('refuses %s: the user name or password would be stored and shown', (url) => {
    expect(parseShareLink(url)).toBeNull();
    expect(linkHasCredentials(url)).toBe(true);
  });

  it('refuses credentials in http Nextcloud links too', () => {
    const url = 'http://admin:pw@cloud.intranet:8080/nextcloud/s/Ab3dEf9GhJkLmNo';
    const trustedNextcloud = 'http://cloud.intranet:8080/nextcloud';
    expect(parseShareLink(url, { trustedNextcloud })).toBeNull();
    expect(parseShareLink(url, { allowHttpNextcloud: true })).toBeNull();
    expect(linkHasCredentials(url)).toBe(true);
  });

  it('sees no credentials in ordinary links or text', () => {
    expect(linkHasCredentials('https://example.com/deck.pptx')).toBe(false);
    expect(linkHasCredentials('https://example.com/user:pw/deck.pptx')).toBe(false);
    expect(linkHasCredentials('https://example.com/deck.pptx?login=a@b')).toBe(false);
    expect(linkHasCredentials('not a url')).toBe(false);
  });

  it('drops the user name and password of a stored link for showing it', () => {
    expect(withoutCredentials('https://a:b@cloud.example.com/s/Ab3dEf9GhJkLmNo')).toBe(
      'https://cloud.example.com/s/Ab3dEf9GhJkLmNo',
    );
    expect(withoutCredentials('https://admin@firma.sharepoint.com/:p:/s/x/Ea')).toBe(
      'https://firma.sharepoint.com/:p:/s/x/Ea',
    );
    expect(withoutCredentials('https://1drv.ms/p/c/abc123/EaB3kQ')).toBe(
      'https://1drv.ms/p/c/abc123/EaB3kQ',
    );
    expect(withoutCredentials('not a url')).toBe('not a url');
  });

  it('tolerates surrounding whitespace from copy & paste', () => {
    expect(parseShareLink('  https://1drv.ms/p/c/abc  \n')?.host).toBe('1drv.ms');
  });

  it('takes Nextcloud links apart, keeping the path Nextcloud runs under', () => {
    expect(parseNextcloudLink(new URL('https://example.de/nextcloud/index.php/s/Tok3n'))).toEqual({
      base: 'https://example.de/nextcloud',
      share: 'Tok3n',
    });
    expect(parseNextcloudLink(new URL('https://cloud.example.de/f/4711'))).toEqual({
      base: 'https://cloud.example.de',
      fileId: '4711',
    });
    expect(
      parseNextcloudLink(new URL('https://cloud.example.de/apps/files/files/12?dir=/')),
    ).toEqual({ base: 'https://cloud.example.de', fileId: '12' });
  });
});

describe('parseGoogleLink (BER-119)', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

  it.each([
    [`https://docs.google.com/presentation/d/${ID}/edit?usp=sharing`, true],
    [`https://docs.google.com/presentation/d/${ID}`, true],
    [`https://docs.google.com/presentation/u/0/d/${ID}/edit#slide=id.p`, true],
    [`https://drive.google.com/file/d/${ID}/view?usp=drive_link`, false],
    [`https://drive.google.com/open?id=${ID}`, false],
  ])('reads %s', (url, slides) => {
    expect(parseGoogleLink(new URL(url))).toEqual({ fileId: ID, slides });
    expect(parseShareLink(url)?.kind).toBe('google');
  });

  it.each([
    'https://docs.google.com/presentation/d/e/2PACX-1vT/pub',
    `https://docs.google.com/document/d/${ID}/edit`,
    'https://drive.google.com/drive/folders/abc',
    `http://docs.google.com/presentation/d/${ID}/edit`,
  ])('ignores %s', (url) => {
    expect(parseShareLink(url)?.kind).not.toBe('google');
  });
});
