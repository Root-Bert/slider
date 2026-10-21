import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, apiRequest, uploadWithProgress } from './api-client';

afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('apiRequest', () => {
  it('prefixes the path, sends JSON and parses the answer', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { ok: true }));
    vi.stubGlobal('fetch', fetch);
    await expect(api.post('/decks', { name: 'A' })).resolves.toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/decks');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: '{"name":"A"}',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
  });

  it('sends FormData as it is, without a JSON content type', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, {}));
    vi.stubGlobal('fetch', fetch);
    const form = new FormData();
    await api.post('/upload', form);
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe(form);
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('resolves undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api.delete('/decks/1')).resolves.toBeUndefined();
  });

  it('throws the API error with code, message and login URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(403, {
          error: { code: 'microsoft_login_required', message: 'Bitte anmelden', loginUrl: '/x' },
        }),
      ),
    );
    const error = await apiRequest('/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'microsoft_login_required',
      message: 'Bitte anmelden',
      loginUrl: '/x',
    });
  });

  it('sends a signed-in account to the setup token while the instance has no admin', async () => {
    const unclaimed = () =>
      json(403, { error: { code: 'instance_unclaimed', message: 'Noch kein Admin.' } });
    const assign = vi.fn();
    const location = { pathname: '/d/deck-1', assign };
    vi.stubGlobal('window', { location });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(unclaimed())),
    );
    await expect(api.get('/decks/deck-1')).rejects.toMatchObject({ code: 'instance_unclaimed' });
    expect(assign).toHaveBeenCalledWith('/einrichtung');

    // Already there: no reload loop.
    assign.mockClear();
    location.pathname = '/einrichtung';
    await expect(api.get('/decks')).rejects.toBeInstanceOf(ApiError);
    expect(assign).not.toHaveBeenCalled();
  });

  it('falls back to a generic error for non-JSON failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 500 })));
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 500,
      code: 'internal',
      message: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
    });
  });

  it('explains a reverse proxy’s HTML 413 and 502–504', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 413 })));
    await expect(api.post('/x', new FormData())).rejects.toMatchObject({
      status: 413,
      code: 'file_too_large',
      message: expect.stringContaining('client_max_body_size'),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 504 })));
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 504,
      message: expect.stringContaining('nicht erreichbar'),
    });
  });

  it('answers 404 without a request for paths with dot segments', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(json(200, {})));
    vi.stubGlobal('fetch', fetch);
    for (const deckId of [
      '../workspaces/w1',
      '%2e%2e/x',
      '.%2E',
      'a/./b',
      '..\\x',
      '.\t./workspaces/x',
      '.\n%2e/x',
    ]) {
      await expect(api.post(`/decks/${deckId}/comments`, {})).rejects.toMatchObject({
        status: 404,
        code: 'not_found',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
    await api.get('/nextcloud/c1/files?path=%2F..%2Fa');
    await api.get('/decks/d.1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('turns a 2xx that is not JSON into an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
    await expect(api.get('/x')).rejects.toMatchObject({ name: 'ApiError', code: 'internal' });
  });

  it('reports a network failure as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 0,
      message: 'Keine Verbindung zum Server.',
    });
  });
});

describe('uploadWithProgress', () => {
  class FakeXhr {
    static last: FakeXhr;
    upload: { onprogress?: (event: Partial<ProgressEvent>) => void } = {};
    status = 0;
    response: unknown = null;
    responseType = '';
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    open = vi.fn();
    send = vi.fn();
    abort = vi.fn(() => this.onabort?.());
    constructor() {
      FakeXhr.last = this;
    }
  }

  it('reports progress and resolves with the JSON body', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const onProgress = vi.fn();
    const done = uploadWithProgress('/upload', new FormData(), onProgress);
    const xhr = FakeXhr.last;
    expect(xhr.open).toHaveBeenCalledWith('POST', '/api/upload');
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 2, total: 0 });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(0.25);
    xhr.status = 201;
    xhr.response = { id: 'd1' };
    xhr.onload?.();
    await expect(done).resolves.toEqual({ id: 'd1' });
  });

  it('rejects with the API error or a generic one', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const failed = uploadWithProgress('/upload', new FormData(), () => undefined);
    Object.assign(FakeXhr.last, {
      status: 413,
      response: { error: { code: 'file_too_large', message: 'Zu groß' } },
    });
    FakeXhr.last.onload?.();
    await expect(failed).rejects.toMatchObject({ status: 413, message: 'Zu groß' });

    const broken = uploadWithProgress('/upload', new FormData(), () => undefined);
    Object.assign(FakeXhr.last, { status: 500, response: null });
    FakeXhr.last.onload?.();
    await expect(broken).rejects.toMatchObject({ status: 500, code: 'internal' });

    // A 2xx whose body wasn't JSON: `response` is null.
    const html = uploadWithProgress('/upload', new FormData(), () => undefined);
    Object.assign(FakeXhr.last, { status: 200, response: null });
    FakeXhr.last.onload?.();
    await expect(html).rejects.toMatchObject({ status: 200, code: 'internal' });

    // nginx's HTML 413 (client_max_body_size, 1 MB by default): `response` is null.
    const proxied = uploadWithProgress('/upload', new FormData(), () => undefined);
    Object.assign(FakeXhr.last, { status: 413, response: null });
    FakeXhr.last.onload?.();
    await expect(proxied).rejects.toMatchObject({
      status: 413,
      code: 'file_too_large',
      message: expect.stringContaining('Upload-Limit des Reverse-Proxys'),
    });
  });

  it('aborts with an AbortError', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const controller = new AbortController();
    const upload = uploadWithProgress(
      '/upload',
      new FormData(),
      () => undefined,
      controller.signal,
    );
    controller.abort();
    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });

    const early = uploadWithProgress('/upload', new FormData(), () => undefined, controller.signal);
    await expect(early).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last.send).not.toHaveBeenCalled();
  });
});
