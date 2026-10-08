import { describe, expect, it, vi } from 'vitest';
import { parseShareLink, type ParsedShareLink } from '@slider/shared';
import { ApiError } from '../src/http/errors';
import { SourceChangedError } from '../src/sources/errors';
import { extractOneDriveItem, parseOneDriveItem, shareIdFor } from '../src/sources/microsoft-graph';
import {
  isPptxBytes,
  isPublicAddress,
  parseContentDispositionFileName,
  type FetchLike,
  type LookupAll,
  type SafeFetchOptions,
} from '../src/sources/safe-fetch';
import { createSourceAdapters } from '../src/sources/source-adapter';
import { MICROSOFT_TEST_CONFIG, publicLookup } from './helpers';

const PPTX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const MAX_BYTES = 1024;
const context = { userId: 'user-1' };

const link = (url: string): ParsedShareLink => {
  const parsed = parseShareLink(url);
  if (!parsed) throw new Error(`Not a link: ${url}`);
  return parsed;
};

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (status = 200) =>
  new Response('<html>Anmelden</html>', { status, headers: { 'content-type': 'text/html' } });

/** Routes requests by URL prefix; records every call. */
function mockFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = vi.fn<FetchLike>(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const match = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => url.startsWith(prefix));
    if (!match) throw new Error(`Unexpected request: ${url}`);
    return routes[match]!(init);
  });
  return { fetch, calls };
}

function adapters({
  fetch,
  token = 'access-token' as string | null,
  configured = true,
  lookup = publicLookup,
}: {
  fetch: FetchLike;
  token?: string | null;
  configured?: boolean;
  lookup?: LookupAll;
}) {
  const getAccessToken = vi.fn(async () => token);
  const sources = createSourceAdapters({
    config: { maxUploadBytes: MAX_BYTES, microsoft: configured ? MICROSOFT_TEST_CONFIG : null },
    tokens: { getAccessToken },
    fetch,
    lookup,
  });
  return { sources, getAccessToken };
}

async function apiErrorOf(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof ApiError)) throw new Error(`Expected an ApiError, got ${String(error)}`);
  return error;
}

describe('isPptxBytes', () => {
  it('accepts the ZIP local file header only', () => {
    expect(isPptxBytes(PPTX)).toBe(true);
    expect(isPptxBytes(new TextEncoder().encode('<html>'))).toBe(false);
    expect(isPptxBytes(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(false); // legacy .ppt
    expect(isPptxBytes(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

describe('parseContentDispositionFileName', () => {
  it('prefers the RFC 5987 filename*', () => {
    expect(
      parseContentDispositionFileName(
        `attachment; filename="Q4 Strategie.pptx"; filename*=UTF-8''Q4%20Strat%C3%A9gie.pptx`,
      ),
    ).toBe('Q4 Stratégie.pptx');
  });

  it('reads a quoted or bare filename', () => {
    expect(parseContentDispositionFileName('attachment; filename="Deck.pptx"')).toBe('Deck.pptx');
    expect(parseContentDispositionFileName('attachment; filename=Deck.pptx')).toBe('Deck.pptx');
    expect(parseContentDispositionFileName('inline')).toBeNull();
    expect(parseContentDispositionFileName(null)).toBeNull();
  });
});

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    // The URL parser rewrites [::ffff:127.0.0.1] to the hex form.
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '::ffff:a00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::7f00:1',
    '::ffff:0:7f00:1',
    '64:ff9b::7f00:1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b:1::808:808',
    '2002:7f00:1::1',
    '2002:a00:1::',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    'fec0::1',
    'ff02::1',
    'fe80::1%en0',
  ])('blocks %s', (address) => expect(isPublicAddress(address)).toBe(false));

  it.each([
    '140.82.112.3',
    '203.0.113.10',
    '2606:4700::1111',
    '::ffff:8c52:7003',
    '64:ff9b::8c52:7003',
    '2002:8c52:7003::1',
  ])('allows %s', (address) => expect(isPublicAddress(address)).toBe(true));
});

describe('OneDrive item ids', () => {
  it('reads resid from a redirect URL', () => {
    expect(
      parseOneDriveItem(
        new URL('https://onedrive.live.com/redir?resid=ABC123!s1a2b3c4d5e6f&authkey=xyz'),
      ),
    ).toEqual({ driveId: 'ABC123', itemId: 'ABC123!s1a2b3c4d5e6f' });
  });

  it('reads cid + id from a migrated link', () => {
    expect(
      parseOneDriveItem(
        new URL('https://onedrive.live.com/?cid=abc123&id=ABC123!s1a2b3c4&migratedtospo=true'),
      ),
    ).toEqual({ driveId: 'abc123', itemId: 'ABC123!s1a2b3c4' });
  });

  it('looks inside nested redirect parameters', () => {
    const inner = 'https://onedrive.live.com/redir?resid=D1!s99';
    expect(
      parseOneDriveItem(
        new URL(`https://login.live.com/login.srf?ru=${encodeURIComponent(inner)}`),
      ),
    ).toEqual({ driveId: 'D1', itemId: 'D1!s99' });
  });

  it('follows a 1drv.ms redirect chain by hand until a hop carries the ids', async () => {
    const { fetch, calls } = mockFetch({
      'https://1drv.ms/p/c/abc123/EXAMPLE': () =>
        redirect('https://onedrive.live.com/view?x=1', 301),
      'https://onedrive.live.com/view': () =>
        redirect('https://onedrive.live.com/redir?resid=ABC123!s1a2b3c4d5e6f&authkey=k'),
    });
    const http: SafeFetchOptions = { fetch, lookup: publicLookup, maxBytes: MAX_BYTES };
    const item = await extractOneDriveItem(new URL('https://1drv.ms/p/c/abc123/EXAMPLE'), http);
    expect(item).toEqual({ driveId: 'ABC123', itemId: 'ABC123!s1a2b3c4d5e6f' });
    // The URL with the ids is never requested – it is only read from the Location header.
    expect(calls.map((call) => call.url)).toEqual([
      'https://1drv.ms/p/c/abc123/EXAMPLE',
      'https://onedrive.live.com/view?x=1',
    ]);
    expect(calls.every((call) => call.init?.redirect === 'manual')).toBe(true);
  });
});

describe('OneDriveAdapter', () => {
  const graphItem = {
    id: 'ABC123!s1a2b3c4d5e6f',
    name: 'Q4 Strategie.pptx',
    size: 6,
    cTag: 'ctag-1',
    eTag: 'etag-1',
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    parentReference: { driveId: 'abc123' },
    '@microsoft.graph.downloadUrl': 'https://public.files.1drv.com/y4m-download',
  };
  const shareLink = 'https://onedrive.live.com/redir?resid=ABC123!s1a2b3c4d5e6f&authkey=x';

  it('resolves the drive item through Graph with the bearer token and downloads it', async () => {
    const { fetch, calls } = mockFetch({
      'https://graph.microsoft.com/v1.0/drives/ABC123/items/ABC123!s1a2b3c4d5e6f': () =>
        json(graphItem),
      'https://public.files.1drv.com/': () => new Response(PPTX),
    });
    const { sources } = adapters({ fetch });
    const remote = await sources.onedrive.resolve(link(shareLink), context);
    expect(remote).toMatchObject({
      ref: 'drives/abc123/items/ABC123!s1a2b3c4d5e6f',
      fileName: 'Q4 Strategie.pptx',
      changeToken: 'ctag-1',
    });
    const graphCall = calls[0]!;
    expect(new Headers(graphCall.init?.headers).get('authorization')).toBe('Bearer access-token');

    expect(await sources.onedrive.download(remote, context)).toEqual(PPTX);
    const download = calls[1]!;
    expect(download.url).toBe('https://public.files.1drv.com/y4m-download');
    expect(new Headers(download.init?.headers).get('authorization')).toBeNull();
  });

  it.each([
    [403, 'source_forbidden'],
    [404, 'source_not_found'],
  ])('maps Graph %i to %s', async (status, code) => {
    const { fetch } = mockFetch({
      'https://graph.microsoft.com/': () => json({ error: { code: 'x' } }, status),
    });
    const { sources } = adapters({ fetch });
    expect((await apiErrorOf(sources.onedrive.resolve(link(shareLink), context))).code).toBe(code);
  });

  it('refreshes the token once after a 401, then asks for a new login', async () => {
    const { fetch } = mockFetch({ 'https://graph.microsoft.com/': () => json({}, 401) });
    const { sources, getAccessToken } = adapters({ fetch });
    const error = await apiErrorOf(sources.onedrive.resolve(link(shareLink), context));
    expect(error.code).toBe('microsoft_login_required');
    expect(getAccessToken).toHaveBeenLastCalledWith('user-1', { forceRefresh: true });
  });

  it('rejects files that are not .pptx', async () => {
    const { fetch } = mockFetch({
      'https://graph.microsoft.com/': () => json({ ...graphItem, name: 'Alt.ppt' }),
    });
    const { sources } = adapters({ fetch });
    expect((await apiErrorOf(sources.onedrive.resolve(link(shareLink), context))).code).toBe(
      'not_a_powerpoint',
    );
  });

  it('asks for a login without any request when the person has no token', async () => {
    const { fetch } = mockFetch({});
    const { sources } = adapters({ fetch, token: null });
    const error = await apiErrorOf(
      sources.onedrive.resolve(link('https://1drv.ms/p/c/x/y'), context),
    );
    expect(error.code).toBe('microsoft_login_required');
    expect(error.extra.loginUrl).toBe(
      `/api/auth/microsoft/login?returnTo=${encodeURIComponent('/neu?link=https%3A%2F%2F1drv.ms%2Fp%2Fc%2Fx%2Fy')}`,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('explains the missing setup when Microsoft is not configured', async () => {
    const { fetch } = mockFetch({});
    const { sources } = adapters({ fetch, configured: false });
    const error = await apiErrorOf(
      sources.onedrive.resolve(link('https://1drv.ms/p/c/x/y'), context),
    );
    expect(error.code).toBe('microsoft_not_configured');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('SharePointAdapter', () => {
  const sharingUrl = 'https://contoso.sharepoint.com/:p:/s/team/EabcDEF?e=x1';

  it('downloads "Anyone with the link" files anonymously with download=1', async () => {
    const { fetch, calls } = mockFetch({
      'https://contoso.sharepoint.com/': () =>
        new Response(PPTX, {
          headers: { 'content-disposition': 'attachment; filename="Team.pptx"', etag: '"e1"' },
        }),
    });
    const { sources, getAccessToken } = adapters({ fetch });
    const remote = await sources.sharepoint.resolve(link(sharingUrl), context);
    expect(new URL(calls[0]!.url).searchParams.get('download')).toBe('1');
    expect(remote).toMatchObject({ fileName: 'Team.pptx', ref: sharingUrl, changeToken: '"e1"' });
    expect(await sources.sharepoint.download(remote, context)).toEqual(PPTX);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('falls back to Graph /shares when the anonymous attempt hits the login page', async () => {
    const { fetch, calls } = mockFetch({
      'https://contoso.sharepoint.com/': () =>
        redirect('https://login.microsoftonline.com/common/oauth2/authorize?x=1'),
      'https://login.microsoftonline.com/': () => html(),
      'https://graph.microsoft.com/v1.0/shares/': () =>
        json({
          id: '01ITEM',
          name: 'Team.pptx',
          size: 6,
          eTag: 'etag-2',
          file: {},
          parentReference: { driveId: 'b!drive' },
          '@microsoft.graph.downloadUrl':
            'https://contoso.sharepoint.com/_layouts/15/download.aspx?t=1',
        }),
    });
    const { sources } = adapters({ fetch });
    const remote = await sources.sharepoint.resolve(link(sharingUrl), context);
    expect(remote).toMatchObject({ ref: 'drives/b!drive/items/01ITEM', changeToken: 'etag-2' });
    const sharesCall = calls.find((call) => call.url.includes('/shares/'))!;
    expect(sharesCall.url).toBe(
      `https://graph.microsoft.com/v1.0/shares/${shareIdFor(sharingUrl)}/driveItem`,
    );
    expect(shareIdFor(sharingUrl)).toMatch(/^u![A-Za-z0-9_-]+$/);
  });

  it('reports microsoft_not_configured (not a 500) when the anonymous attempt fails', async () => {
    const { fetch } = mockFetch({ 'https://contoso.sharepoint.com/': () => html(403) });
    const { sources } = adapters({ fetch, configured: false });
    expect((await apiErrorOf(sources.sharepoint.resolve(link(sharingUrl), context))).code).toBe(
      'microsoft_not_configured',
    );
  });
});

describe('DirectUrlAdapter', () => {
  it('honours Content-Disposition and keeps the bytes from resolve', async () => {
    const { fetch, calls } = mockFetch({
      'https://example.com/': () =>
        new Response(PPTX, {
          headers: {
            'content-disposition': `attachment; filename*=UTF-8''Kampagne%20Fr%C3%BChjahr.pptx`,
            'last-modified': 'Tue, 06 Oct 2026 10:00:00 GMT',
          },
        }),
    });
    const { sources } = adapters({ fetch });
    const remote = await sources.url.resolve(
      link('https://example.com/download/deck.pptx'),
      context,
    );
    expect(remote).toMatchObject({
      fileName: 'Kampagne Frühjahr.pptx',
      sizeBytes: PPTX.byteLength,
      changeToken: 'Tue, 06 Oct 2026 10:00:00 GMT',
    });
    expect(await sources.url.download(remote, context)).toEqual(PPTX);
    expect(calls).toHaveLength(1);
  });

  it('follows redirects and names the file after the final URL', async () => {
    const { fetch } = mockFetch({
      'https://github.com/': () =>
        redirect('https://raw.githubusercontent.com/o/r/main/Board%20Deck.pptx'),
      'https://raw.githubusercontent.com/': () => new Response(PPTX),
    });
    const { sources } = adapters({ fetch });
    const remote = await sources.url.resolve(
      link('https://github.com/o/r/raw/main/x.pptx'),
      context,
    );
    expect(remote.fileName).toBe('Board Deck.pptx');
    expect(remote.ref).toBe('https://raw.githubusercontent.com/o/r/main/Board%20Deck.pptx');
  });

  it('rejects an HTML page behind a .pptx URL', async () => {
    const { fetch } = mockFetch({ 'https://example.com/': () => html() });
    const { sources } = adapters({ fetch });
    expect(
      (await apiErrorOf(sources.url.resolve(link('https://example.com/a.pptx'), context))).code,
    ).toBe('not_a_powerpoint');
  });

  it('rejects bytes without the PK header', async () => {
    const { fetch } = mockFetch({ 'https://example.com/': () => new Response('not a zip') });
    const { sources } = adapters({ fetch });
    expect(
      (await apiErrorOf(sources.url.resolve(link('https://example.com/a.pptx'), context))).code,
    ).toBe('not_a_powerpoint');
  });

  it('stops oversized downloads (declared and streamed)', async () => {
    const big = new Uint8Array(MAX_BYTES + 1);
    big.set(PPTX);
    const declared = mockFetch({
      'https://example.com/': () =>
        new Response(big, { headers: { 'content-length': String(big.byteLength) } }),
    });
    expect(
      (
        await apiErrorOf(
          adapters({ fetch: declared.fetch }).sources.url.resolve(
            link('https://example.com/a.pptx'),
            context,
          ),
        )
      ).code,
    ).toBe('file_too_large');

    const streamed = mockFetch({
      'https://example.com/': () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(big);
              controller.close();
            },
          }),
        ),
    });
    expect(
      (
        await apiErrorOf(
          adapters({ fetch: streamed.fetch }).sources.url.resolve(
            link('https://example.com/a.pptx'),
            context,
          ),
        )
      ).code,
    ).toBe('file_too_large');
  });

  it('refuses private addresses without fetching', async () => {
    const { fetch } = mockFetch({});
    const { sources } = adapters({ fetch, lookup: async () => [{ address: '10.0.0.5' }] });
    for (const url of [
      'https://intranet.example/x.pptx',
      'https://127.0.0.1/x.pptx',
      'https://localhost:8787/x.pptx',
      'https://[::ffff:127.0.0.1]/x.pptx',
      'https://[::ffff:169.254.169.254]/latest.pptx',
      'https://[64:ff9b::7f00:1]/x.pptx',
    ]) {
      const error = await apiErrorOf(sources.url.resolve(link(url), context));
      expect(error.code).toBe('unsupported_link');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses redirects to private addresses', async () => {
    const { fetch, calls } = mockFetch({
      'https://example.com/': () => redirect('https://169.254.169.254/latest/meta-data.pptx'),
    });
    const { sources } = adapters({ fetch });
    expect(
      (await apiErrorOf(sources.url.resolve(link('https://example.com/a.pptx'), context))).code,
    ).toBe('unsupported_link');
    expect(calls).toHaveLength(1);
  });

  it('gives up after too many redirects', async () => {
    let hop = 0;
    const { fetch } = mockFetch({
      'https://example.com/': () => redirect(`https://example.com/${++hop}.pptx`),
    });
    const { sources } = adapters({ fetch });
    expect(
      (await apiErrorOf(sources.url.resolve(link('https://example.com/a.pptx'), context))).code,
    ).toBe('source_unreachable');
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});

describe('re-sync of stored references (BER-107)', () => {
  const sharingUrl = 'https://contoso.sharepoint.com/:p:/s/team/EabcDEF?e=x1';
  const stored = { ref: sharingUrl, fileName: 'Team.pptx', sizeBytes: 0, changeToken: null };

  it('downloads an anonymous SharePoint ref again with download=1, not through Graph', async () => {
    const { fetch, calls } = mockFetch({
      'https://contoso.sharepoint.com/': (init) =>
        init?.method === 'HEAD'
          ? new Response(null, { headers: { etag: '"e2"' } })
          : new Response(PPTX, { headers: { etag: '"e2"' } }),
    });
    const { sources, getAccessToken } = adapters({ fetch });
    expect(await sources.sharepoint.download(stored, context)).toEqual(PPTX);
    expect(await sources.sharepoint.getChangeToken(stored, context)).toBe('"e2"');
    expect(calls.every((call) => new URL(call.url).searchParams.get('download') === '1')).toBe(
      true,
    );
    expect(calls.some((call) => call.url.includes('graph.microsoft.com'))).toBe(false);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('falls back to Graph when the SharePoint link is no longer public', async () => {
    const { fetch } = mockFetch({
      'https://contoso.sharepoint.com/:p:/': () => new Response(null, { status: 403 }),
      'https://graph.microsoft.com/v1.0/shares/': () =>
        json({
          id: '01ITEM',
          name: 'Team.pptx',
          cTag: 'ctag-7',
          file: {},
          parentReference: { driveId: 'b!drive' },
          '@microsoft.graph.downloadUrl':
            'https://contoso.sharepoint.com/_layouts/15/download.aspx',
        }),
      'https://contoso.sharepoint.com/_layouts/': () => new Response(PPTX),
    });
    const { sources } = adapters({ fetch });
    expect(await sources.sharepoint.getChangeToken(stored, context)).toBe('ctag-7');
    expect(await sources.sharepoint.download(stored, context)).toEqual(PPTX);
  });

  it('returns an empty token when a direct URL does not support HEAD', async () => {
    const { fetch } = mockFetch({
      'https://example.com/': (init) =>
        init?.method === 'HEAD' ? new Response(null, { status: 405 }) : new Response(PPTX),
    });
    const { sources } = adapters({ fetch });
    const file = {
      ref: 'https://example.com/deck.pptx',
      fileName: 'deck.pptx',
      sizeBytes: 0,
      changeToken: null,
    };
    expect(await sources.url.getChangeToken(file, context)).toBe('');
  });

  it('asks Graph for a fresh download URL of a OneDrive item', async () => {
    const { fetch, calls } = mockFetch({
      'https://graph.microsoft.com/v1.0/drives/': () =>
        json({
          id: 'i1',
          name: 'Q4.pptx',
          file: {},
          '@microsoft.graph.downloadUrl': 'https://dl.example.com/f',
        }),
      'https://dl.example.com/': () => new Response(PPTX),
    });
    const { sources } = adapters({ fetch });
    const file = {
      ref: 'drives/d1/items/i1',
      fileName: 'Q4.pptx',
      sizeBytes: 0,
      changeToken: null,
    };
    expect(await sources.onedrive.download(file, context)).toEqual(PPTX);
    expect(calls[0]?.url).toBe('https://graph.microsoft.com/v1.0/drives/d1/items/i1');
  });
});

describe('Office PDF export (BER-94)', () => {
  const PDF = new TextEncoder().encode('%PDF-1.7 rendered by Office');
  const item = {
    ref: 'drives/d1/items/i1',
    fileName: 'Deck.pptx',
    sizeBytes: 0,
    changeToken: null,
  };

  it('follows Graph’s redirect to the converted file without sending the token there', async () => {
    const { fetch, calls } = mockFetch({
      'https://graph.microsoft.com/v1.0/drives/d1/items/i1/content?format=pdf': () =>
        redirect('https://public.dm.files.1drv.com/converted.pdf'),
      'https://public.dm.files.1drv.com/': () => new Response(PDF),
    });
    const { sources } = adapters({ fetch });
    expect(await sources.onedrive.exportPdf!(item, context)).toEqual(PDF);
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer access-token');
    expect(new Headers(calls[1]?.init?.headers).get('authorization')).toBeNull();
  });

  it('exports an anonymous SharePoint link through Graph /shares', async () => {
    const sharingUrl = 'https://contoso.sharepoint.com/:p:/s/team/EabcDEF?e=x1';
    const { fetch, calls } = mockFetch({
      'https://graph.microsoft.com/v1.0/shares/': () =>
        redirect('https://contoso.sharepoint.com/_layouts/15/converted.pdf'),
      'https://contoso.sharepoint.com/_layouts/': () => new Response(PDF),
    });
    const { sources } = adapters({ fetch });
    const file = { ...item, ref: sharingUrl };
    expect(await sources.sharepoint.exportPdf!(file, context)).toEqual(PDF);
    expect(calls[0]?.url).toBe(
      `https://graph.microsoft.com/v1.0/shares/${shareIdFor(sharingUrl)}/driveItem/content?format=pdf`,
    );
  });

  it('rejects a conversion error and anything that is not a PDF', async () => {
    const failing = mockFetch({
      'https://graph.microsoft.com/': () => new Response(null, { status: 406 }),
    });
    expect(
      (
        await apiErrorOf(
          adapters({ fetch: failing.fetch }).sources.onedrive.exportPdf!(item, context),
        )
      ).code,
    ).toBe('source_unreachable');
    const notPdf = mockFetch({ 'https://graph.microsoft.com/': () => html() });
    expect(
      (
        await apiErrorOf(
          adapters({ fetch: notPdf.fetch }).sources.onedrive.exportPdf!(item, context),
        )
      ).code,
    ).toBe('source_unreachable');
  });
});

describe('editing through Graph (BER-128)', () => {
  const file = { ref: 'drives/d1/items/i1', fileName: 'Q4.pptx', sizeBytes: 0, changeToken: null };
  const item = {
    id: 'i1',
    name: 'Q4.pptx',
    eTag: '"{ETAG},3"',
    cTag: '"c:{ETAG},3"',
    file: {},
    parentReference: { driveId: 'd1' },
    '@microsoft.graph.downloadUrl': 'https://public.files.1drv.com/y4m-edit',
  };

  it('reads the newest file with its eTag and uploads guarded by If-Match with a write token', async () => {
    const { fetch, calls } = mockFetch({
      'https://graph.microsoft.com/v1.0/drives/d1/items/i1/content': () =>
        json({ ...item, eTag: '"{ETAG},4"', cTag: '"c:{ETAG},4"' }),
      'https://graph.microsoft.com/v1.0/drives/d1/items/i1': () => json(item),
      'https://public.files.1drv.com/': () => new Response(PPTX),
    });
    const { sources, getAccessToken } = adapters({ fetch });

    const editable = await sources.onedrive.openForEdit!(file, context);
    expect(editable).toEqual({ ref: 'drives/d1/items/i1', eTag: '"{ETAG},3"', bytes: PPTX });

    const edited = new Uint8Array([...PPTX, 0x01]);
    expect(await sources.onedrive.replace!(editable, edited, context)).toBe('"c:{ETAG},4"');
    const upload = calls.at(-1)!;
    expect(upload.init?.method).toBe('PUT');
    expect(new Headers(upload.init?.headers).get('if-match')).toBe('"{ETAG},3"');
    expect(new Uint8Array(await new Response(upload.init?.body).arrayBuffer())).toEqual(edited);
    expect(getAccessToken).toHaveBeenLastCalledWith('user-1', {
      forceRefresh: false,
      access: 'write',
    });
  });

  it('refuses to overwrite a newer save (412) and reports a missing write right', async () => {
    let status = 412;
    const { fetch } = mockFetch({
      'https://graph.microsoft.com/v1.0/drives/d1/items/i1/content': () => json({}, status),
    });
    const { sources } = adapters({ fetch });
    const editable = { ref: 'drives/d1/items/i1', eTag: '"old"', bytes: PPTX };

    await expect(sources.onedrive.replace!(editable, PPTX, context)).rejects.toBeInstanceOf(
      SourceChangedError,
    );
    status = 403;
    expect((await apiErrorOf(sources.onedrive.replace!(editable, PPTX, context))).code).toBe(
      'source_forbidden',
    );
  });

  it('asks for a login when there is no write token', async () => {
    const { fetch } = mockFetch({});
    const { sources } = adapters({ fetch, token: null });
    const editable = { ref: 'drives/d1/items/i1', eTag: '"e"', bytes: PPTX };
    expect((await apiErrorOf(sources.onedrive.replace!(editable, PPTX, context))).code).toBe(
      'microsoft_login_required',
    );
  });

  it('resolves an anonymous SharePoint ref to its drive item before editing', async () => {
    const sharingUrl = 'https://contoso.sharepoint.com/:p:/s/team/EabcDEF?e=x1';
    const { fetch, calls } = mockFetch({
      [`https://graph.microsoft.com/v1.0/shares/${shareIdFor(sharingUrl)}/driveItem`]: () =>
        json({ ...item, name: 'Team.pptx' }),
      'https://graph.microsoft.com/v1.0/drives/d1/items/i1': () => json(item),
      'https://public.files.1drv.com/': () => new Response(PPTX),
    });
    const { sources } = adapters({ fetch });

    const editable = await sources.sharepoint.openForEdit!({ ...file, ref: sharingUrl }, context);

    expect(editable.ref).toBe('drives/d1/items/i1');
    expect(calls.map((call) => new URL(call.url).hostname)).not.toContain('contoso.sharepoint.com');
  });
});
