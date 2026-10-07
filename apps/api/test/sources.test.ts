import { describe, expect, it, vi } from 'vitest';
import { parseShareLink, type ParsedShareLink } from '@slider/shared';
import { ApiError } from '../src/http/errors';
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
