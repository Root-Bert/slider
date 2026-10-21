import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/http/errors';
import {
  assertPublicHttpsUrl,
  fetchHop,
  fileNameFor,
  isHtmlResponse,
  isPdfBytes,
  readBodyCapped,
  redirectTarget,
  type LookupAll,
} from '../src/sources/safe-fetch';
import { publicLookup } from './helpers';

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ApiError ? error.code : String(error);
  }
  return 'resolved';
};

describe('assertPublicHttpsUrl', () => {
  it('accepts https URLs whose host resolves to public addresses only', async () => {
    await expect(
      assertPublicHttpsUrl(new URL('https://example.com/a.pptx'), publicLookup),
    ).resolves.toEqual([{ address: '203.0.113.10' }]);
  });

  it('refuses plain http and localhost without asking DNS', async () => {
    const lookup: LookupAll = async () => {
      throw new Error('DNS must not be asked');
    };
    for (const url of ['http://example.com/', 'https://localhost/', 'https://api.localhost/']) {
      expect(await codeOf(assertPublicHttpsUrl(new URL(url), lookup))).toBe('unsupported_link');
    }
  });

  it('judges IP literals directly, IPv6 in brackets included', async () => {
    const lookup: LookupAll = async () => {
      throw new Error('DNS must not be asked');
    };
    expect(await codeOf(assertPublicHttpsUrl(new URL('https://127.0.0.1/'), lookup))).toBe(
      'unsupported_link',
    );
    expect(await codeOf(assertPublicHttpsUrl(new URL('https://[::1]/'), lookup))).toBe(
      'unsupported_link',
    );
    expect(await codeOf(assertPublicHttpsUrl(new URL('https://203.0.113.10/'), lookup))).toBe(
      'resolved',
    );
  });

  it('refuses hosts with any private address, or none at all', async () => {
    const mixed: LookupAll = async () => [{ address: '203.0.113.10' }, { address: '10.0.0.1' }];
    const none: LookupAll = async () => [];
    expect(await codeOf(assertPublicHttpsUrl(new URL('https://x.example/'), mixed))).toBe(
      'unsupported_link',
    );
    expect(await codeOf(assertPublicHttpsUrl(new URL('https://x.example/'), none))).toBe(
      'unsupported_link',
    );
  });

  it('reports hosts that do not resolve as not found', async () => {
    const failing: LookupAll = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await codeOf(assertPublicHttpsUrl(new URL('https://nope.example/'), failing))).toBe(
      'source_not_found',
    );
  });
});

describe('fetchHop', () => {
  const options = (fetch: (input: string | URL, init?: RequestInit) => Promise<Response>) => ({
    fetch,
    lookup: publicLookup,
    maxBytes: 1024,
  });

  it('never follows redirects itself and always sets a deadline', async () => {
    let seen: RequestInit | undefined;
    await fetchHop(
      new URL('https://example.com/'),
      options(async (_input, init) => {
        seen = init;
        return new Response('ok');
      }),
    );
    expect(seen?.redirect).toBe('manual');
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps network failures and timeouts to source_unreachable', async () => {
    const failing = options(async () => {
      throw new TypeError('fetch failed');
    });
    const timeout = options(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect(await codeOf(fetchHop(new URL('https://example.com/'), failing))).toBe(
      'source_unreachable',
    );
    await expect(fetchHop(new URL('https://example.com/'), timeout)).rejects.toThrow(
      'Der Server hinter dem Link antwortet nicht.',
    );
  });
});

describe('fetchHop address pinning', () => {
  const recording = () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetch = async (input: string | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init });
      return new Response('ok');
    };
    return { seen, fetch };
  };
  const tlsOf = (init?: RequestInit) =>
    (init as { tls?: { serverName?: string; checkServerIdentity?: unknown } } | undefined)?.tls;

  it('connects to the checked address, naming the host in Host and TLS', async () => {
    const { seen, fetch } = recording();
    const lookup: LookupAll = async () => [{ address: '2001:4860::8888' }, { address: '8.8.8.8' }];
    await fetchHop(
      new URL('https://cloud.example.de:8443/a?b=1'),
      { fetch, lookup, maxBytes: 1024, pin: true },
      { headers: { Authorization: 'Basic x' } },
    );
    expect(seen[0]?.url).toBe('https://8.8.8.8:8443/a?b=1'); // IPv4 first
    const headers = new Headers(seen[0]?.init?.headers);
    expect(headers.get('host')).toBe('cloud.example.de:8443');
    expect(headers.get('authorization')).toBe('Basic x');
    expect(tlsOf(seen[0]?.init)?.serverName).toBe('cloud.example.de');
    expect(tlsOf(seen[0]?.init)?.checkServerIdentity).toBeTypeOf('function');
  });

  it('brackets IPv6 addresses', async () => {
    const { seen, fetch } = recording();
    const lookup: LookupAll = async () => [{ address: '2001:4860::8888' }];
    await fetchHop(new URL('https://example.com/x'), { fetch, lookup, maxBytes: 1, pin: true });
    expect(seen[0]?.url).toBe('https://[2001:4860::8888]/x');
  });

  it('leaves IP literals, trusted servers and injected fetches alone', async () => {
    const { seen, fetch } = recording();
    await fetchHop(new URL('https://203.0.113.10/x'), {
      fetch,
      lookup: publicLookup,
      maxBytes: 1,
      pin: true,
    });
    await fetchHop(new URL('http://cloud.intranet/x'), {
      fetch,
      lookup: publicLookup,
      maxBytes: 1,
      pin: true,
      trusted: () => true,
    });
    await fetchHop(new URL('https://example.com/x'), { fetch, lookup: publicLookup, maxBytes: 1 });
    expect(seen.map((s) => s.url)).toEqual([
      'https://203.0.113.10/x',
      'http://cloud.intranet/x',
      'https://example.com/x',
    ]);
    expect(seen.every((s) => tlsOf(s.init) === undefined)).toBe(true);
  });
});

describe('redirectTarget', () => {
  const from = new URL('https://example.com/dir/file');
  const redirect = (status: number, location?: string) =>
    new Response(null, { status, headers: location ? { location } : {} });

  it('resolves relative locations against the current URL', () => {
    expect(redirectTarget(redirect(302, '../other'), from)?.href).toBe('https://example.com/other');
    expect(redirectTarget(redirect(301, 'https://cdn.example/x'), from)?.href).toBe(
      'https://cdn.example/x',
    );
  });

  it('is null for non-redirects, 304 and a missing or broken location', () => {
    expect(redirectTarget(new Response('ok'), from)).toBeNull();
    expect(redirectTarget(redirect(304, '/x'), from)).toBeNull();
    expect(redirectTarget(redirect(302), from)).toBeNull();
    expect(redirectTarget(redirect(302, 'http://[broken'), from)).toBeNull();
  });
});

describe('readBodyCapped', () => {
  const streamOf = (chunks: Uint8Array[], fail = false) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        if (fail) controller.error(new Error('connection reset'));
        else controller.close();
      },
    });

  it('joins the chunks of a body within the cap', async () => {
    const bytes = await readBodyCapped(
      new Response(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])])),
      3,
    );
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(await readBodyCapped(new Response(null), 3)).toEqual(new Uint8Array());
  });

  it('stops at a declared or streamed size over the cap', async () => {
    const declared = new Response('12345', { headers: { 'content-length': '5' } });
    expect(await codeOf(readBodyCapped(declared, 4))).toBe('file_too_large');
    const streamed = new Response(streamOf([new Uint8Array(3), new Uint8Array(3)]));
    expect(await codeOf(readBodyCapped(streamed, 4))).toBe('file_too_large');
  });

  it('reports a broken stream as unreachable', async () => {
    const broken = new Response(streamOf([new Uint8Array(1)], true));
    await expect(readBodyCapped(broken, 10)).rejects.toThrow(
      'Die Datei konnte nicht vollständig geladen werden.',
    );
  });
});

describe('content checks', () => {
  it('isPdfBytes looks for %PDF', () => {
    expect(isPdfBytes(new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(isPdfBytes(new TextEncoder().encode('%PD'))).toBe(false);
    expect(isPdfBytes(new TextEncoder().encode('<html>'))).toBe(false);
  });

  it('isHtmlResponse reads the content type, case-insensitively', () => {
    expect(
      isHtmlResponse(new Response('', { headers: { 'content-type': 'Text/HTML; charset=utf-8' } })),
    ).toBe(true);
    expect(
      isHtmlResponse(
        new Response(new Uint8Array(), { headers: { 'content-type': 'application/octet-stream' } }),
      ),
    ).toBe(false);
  });
});

describe('fileNameFor', () => {
  const url = (path: string) => new URL(`https://example.com${path}`);
  const withHeader = (value: string) =>
    new Response('', { headers: { 'content-disposition': value } });

  it('prefers the header, then the decoded last path segment', () => {
    expect(fileNameFor(withHeader('attachment; filename="Q3.pptx"'), url('/x/y.pptx'))).toBe(
      'Q3.pptx',
    );
    expect(fileNameFor(new Response(''), url('/files/Gro%C3%9Fe%20Pr%C3%A4si.pptx'))).toBe(
      'Große Präsi.pptx',
    );
  });

  it('always ends in .pptx and never contains slashes', () => {
    expect(fileNameFor(new Response(''), url('/download.php'))).toBe('download.pptx');
    expect(fileNameFor(new Response(''), url('/Deck.PPTX'))).toBe('Deck.PPTX');
    expect(fileNameFor(withHeader('attachment; filename="a/b\\\\c.pptx"'), url('/'))).toBe(
      'abc.pptx',
    );
  });

  it('falls back to Präsentation.pptx and keeps undecodable segments raw', () => {
    expect(fileNameFor(new Response(''), url('/'))).toBe('Präsentation.pptx');
    expect(fileNameFor(new Response(''), url('/bad%E0name.pptx'))).toBe('bad%E0name.pptx');
  });
});
