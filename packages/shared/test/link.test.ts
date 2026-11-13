import { describe, expect, it } from 'vitest';
import {
  linkHasCredentials,
  parseNextcloudLink,
  parseShareLink,
  withoutCredentials,
} from '../src/link';
import { stockLink } from '../src/editing';

describe('parseShareLink (BER-92 link types)', () => {
  const recognised: [string, string][] = [
    ['https://example.com/decks/Keynote%20Export.pdf', 'url'],
    ['https://example.com/files/deck.pptx', 'url'],
    ['https://cdn.example.com/Decks/Q4%20Strategie.PPTX?v=2', 'url'],
    ['https://raw.githubusercontent.com/org/repo/main/test.pptx', 'url'],
    ['https://cloud.example.de/s/Ab3dEf9GhJkLmNo', 'nextcloud'],
    ['https://cloud.example.de/index.php/s/Ab3dEf9GhJkLmNo/download', 'nextcloud'],
    ['https://example.de/nextcloud/index.php/f/4711', 'nextcloud'],
    ['https://cloud.example.de/apps/files/files/4711?dir=/Decks&openfile=true', 'nextcloud'],
    ['https://cloud.example.de/apps/files/?dir=/Decks&fileid=4711', 'nextcloud'],
    ['https://example.com/s/deck.pptx', 'url'], // a file name, not a share token
  ];
  const rejected = [
    'not a url',
    // OneDrive, SharePoint and Google links: Slider no longer reads files there.
    'https://1drv.ms/p/c/abc123/EaB3kQ',
    'https://onedrive.live.com/edit?id=ABC!123&resid=ABC!123',
    'https://contoso.sharepoint.com/:p:/s/strategie/EaB3kQxyz',
    'https://contoso.sharepoint.com/sites/x/_layouts/15/Doc.aspx?sourcedoc={guid}',
    'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/view',
    'http://example.com/deck.pptx', // no TLS
    'https://example.com/page.html',
    'https://example.com/deck.ppt',
    'https://example.com/?file=deck.pptx', // the file name must be the path
    'https://contoso.sharepoint.com/sites/x/Shared%20Documents/Notes.docx',
    'http://cloud.example.de/s/Ab3dEf9GhJkLmNo', // no TLS
    'https://cloud.example.de/f/abc', // file ids are numbers
    'https://cloud.example.de/apps/files/?dir=/Decks', // a folder
  ];

  it('recognises each kind of share link and rejects everything else', () => {
    for (const [url, kind] of recognised) expect(parseShareLink(url)?.kind, url).toBe(kind);
    for (const url of rejected) expect(parseShareLink(url), url).toBeNull();
    // Surrounding whitespace from copy & paste is tolerated.
    expect(parseShareLink('  https://example.com/files/deck.pptx  \n')?.host).toBe('example.com');
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
    // The browser lets any http link that looks like Nextcloud through – the server decides.
    const loose = { allowHttpNextcloud: true };
    expect(parseShareLink('http://cloud.intranet:8080/s/Ab3dEf9GhJkLmNo', loose)?.kind).toBe(
      'nextcloud',
    );
    expect(parseShareLink('http://cloud.intranet/apps/files/files/4711', loose)?.kind).toBe(
      'nextcloud',
    );
    // Everything else stays https-only.
    expect(parseShareLink('http://example.com/deck.pptx', loose)).toBeNull();
  });

  it('refuses links with a user name or password – they would be stored and shown', () => {
    // A photo credit from someone's edit step links nowhere but https.
    expect(stockLink('javascript:alert(1)', 'pexels')).toBe('https://www.pexels.com/');
    expect(stockLink('https://unsplash.com/@a')).toBe(
      'https://unsplash.com/@a?utm_source=Slider&utm_medium=referral',
    );
    for (const url of [
      'https://user:secret@example.com/deck.pptx',
      'https://user@example.com/deck.pptx',
      'https://:secret@example.com/deck.pptx',
      'https://robert:pw@cloud.example.de/s/Ab3dEf9GhJkLmNo',
    ]) {
      expect(parseShareLink(url), url).toBeNull();
      expect(linkHasCredentials(url), url).toBe(true);
    }
    // In http Nextcloud links too.
    const url = 'http://admin:pw@cloud.intranet:8080/nextcloud/s/Ab3dEf9GhJkLmNo';
    const trustedNextcloud = 'http://cloud.intranet:8080/nextcloud';
    expect(parseShareLink(url, { trustedNextcloud })).toBeNull();
    expect(parseShareLink(url, { allowHttpNextcloud: true })).toBeNull();
    expect(linkHasCredentials(url)).toBe(true);
    // Ordinary links or text have none.
    expect(linkHasCredentials('https://example.com/deck.pptx')).toBe(false);
    expect(linkHasCredentials('https://example.com/user:pw/deck.pptx')).toBe(false);
    expect(linkHasCredentials('https://example.com/deck.pptx?login=a@b')).toBe(false);
    expect(linkHasCredentials('not a url')).toBe(false);
    // A stored link is shown without them.
    expect(withoutCredentials('https://a:b@cloud.example.com/s/Ab3dEf9GhJkLmNo')).toBe(
      'https://cloud.example.com/s/Ab3dEf9GhJkLmNo',
    );
    expect(withoutCredentials('https://example.com/files/deck.pptx')).toBe(
      'https://example.com/files/deck.pptx',
    );
    expect(withoutCredentials('not a url')).toBe('not a url');
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
