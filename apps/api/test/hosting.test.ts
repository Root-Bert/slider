import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { healthSchema } from '@slider/shared';
import { loadConfig, type HostingConfig } from '../src/config';
import { BOOT_ID } from '../src/http/hosting';
import { clientAddress } from '../src/http/rate-limit';
import { createReadyDeck, createTestContext, type TestContext } from './helpers';

const quiet = () => {};
const hosting = (overrides: Partial<HostingConfig> = {}): HostingConfig => ({
  databaseUrl: null,
  webDistDir: null,
  trustProxy: false,
  ...overrides,
});

describe('hosting config', () => {
  it('uses PGlite and no web app by default in development', () => {
    expect(loadConfig({}, quiet).hosting).toEqual(hosting());
  });

  it('serves apps/web/dist in production and reads DATABASE_URL and TRUST_PROXY', () => {
    const config = loadConfig(
      {
        NODE_ENV: 'production',
        SLIDER_URL: 'https://slider.firma.de',
        SLIDER_SECRET: 'x'.repeat(32),
        MS_CLIENT_ID: 'id',
        MS_CLIENT_SECRET: 'secret',
        DATABASE_URL: 'postgres://slider:pw@postgres:5432/slider',
        TRUST_PROXY: '1',
      },
      quiet,
    );
    expect(config.hosting?.databaseUrl).toBe('postgres://slider:pw@postgres:5432/slider');
    expect(config.hosting?.webDistDir).toMatch(/apps[/\\]web[/\\]dist$/);
    expect(config.hosting?.trustProxy).toBe(true);
  });

  it('rejects a DATABASE_URL that is not Postgres', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/x' }, quiet)).toThrow();
  });
});

describe('GET /api/health', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(() => ctx.cleanup());

  it('answers ok when the database responds', async () => {
    const res = await ctx.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, bootId: BOOT_ID });
  });

  it('names this start of the server: the same on every answer, new with the next process', async () => {
    const first = healthSchema.parse(await (await ctx.request('/api/health')).json());
    const second = healthSchema.parse(await (await ctx.request('/api/health')).json());
    expect(first.bootId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.bootId).toBe(first.bootId);
    // A fresh load of the module stands for the restarted process.
    vi.resetModules();
    const restarted = await import('../src/http/hosting');
    expect(restarted.BOOT_ID).not.toBe(first.bootId);
  });
});

describe('web app from the API', () => {
  let ctx: TestContext;
  let dist: string;
  beforeEach(async () => {
    dist = await mkdtemp(path.join(tmpdir(), 'slider-web-dist-'));
    await mkdir(path.join(dist, 'assets'));
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>Slider</title>');
    await writeFile(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    await writeFile(path.join(dist, 'favicon.svg'), '<svg/>');
    ctx = await createTestContext({ config: { hosting: hosting({ webDistDir: dist }) } });
  });
  afterEach(async () => {
    await ctx.cleanup();
    await rm(dist, { recursive: true, force: true });
  });

  it('serves index.html for client-side routes, uncached', async () => {
    // Signed links carry a dot (`<payload>.<signature>`) and are still routes, not files.
    for (const url of ['/', '/d/some-deck?slide=1', '/neu', '/konto-bestaetigen/eyJhIjoxfQ.c2ln-X_9']) {
      const res = await ctx.request(url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toContain('<title>Slider</title>');
    }
  });

  it('serves hashed assets with a long cache and other files with revalidation', async () => {
    const asset = await ctx.request('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const icon = await ctx.request('/favicon.svg');
    expect(icon.headers.get('cache-control')).toBe('no-cache');
  });

  it('compresses the web app and API JSON for clients that accept gzip, never the live stream', async () => {
    const script = `console.log(${JSON.stringify('x'.repeat(5000))})`;
    await writeFile(path.join(dist, 'assets', 'big-abc123.js'), script);
    const gzip = { headers: { 'Accept-Encoding': 'gzip' } };
    const asset = await ctx.request('/assets/big-abc123.js', gzip);
    expect(asset.headers.get('content-encoding')).toBe('gzip');
    expect(asset.headers.get('vary')).toContain('Accept-Encoding');
    const unzipped = new Response(asset.body!.pipeThrough(new DecompressionStream('gzip')));
    expect(await unzipped.text()).toBe(script);

    // Without Accept-Encoding nothing is compressed.
    expect((await ctx.request('/assets/big-abc123.js')).headers.get('content-encoding')).toBeNull();

    const { deckId } = await createReadyDeck(ctx, { slideCount: 40 });
    const slides = await ctx.request(`/api/decks/${deckId}/slides`, gzip);
    expect(slides.headers.get('content-type')).toContain('application/json');
    expect(slides.headers.get('content-encoding')).toBe('gzip');

    const live = await ctx.request(`/api/decks/${deckId}/live`, gzip);
    expect(live.headers.get('content-type')).toContain('text/event-stream');
    expect(live.headers.get('content-encoding')).toBeNull();
    await live.body?.cancel();
  });

  it('answers 404 for missing files instead of index.html', async () => {
    expect((await ctx.request('/assets/index-old.js')).status).toBe(404);
    expect((await ctx.request('/favicon.png')).status).toBe(404);
  });

  it('leaves /api and /files to the API and never escapes the dist folder', async () => {
    const api = await ctx.request('/api/does-not-exist');
    expect(api.status).toBe(404);
    expect(api.headers.get('content-type')).toContain('application/json');
    expect((await ctx.request('/files/nope.svg')).headers.get('content-type')).not.toContain(
      'text/html',
    );
    const escape = await ctx.request('/%2e%2e/%2e%2e/etc/passwd');
    expect(await escape.text()).not.toContain('root:');
  });
});

describe('client address behind a proxy', () => {
  it('uses the right-most X-Forwarded-For entry only when TRUST_PROXY is on', async () => {
    const seen: string[] = [];
    for (const trustProxy of [false, true]) {
      const ctx = await createTestContext({ config: { hosting: hosting({ trustProxy }) } });
      ctx.app.get('/probe', (c) => {
        seen.push(clientAddress(c));
        return c.text('ok');
      });
      await ctx.request('/probe', { headers: { 'X-Forwarded-For': '6.6.6.6, 198.51.100.7' } });
      await ctx.cleanup();
    }
    expect(seen).toEqual(['local', '198.51.100.7']);
  });
});

describe('writes from other origins (CSRF)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(() => ctx.cleanup());

  /** What a `<form enctype="text/plain">` on a sibling subdomain would send. */
  const formPost = (headers: Record<string, string>) =>
    ctx.request('/api/workspaces', {
      method: 'POST',
      body: '{"name":"Gekapert","x":"=1"}',
      headers: { 'Content-Type': 'text/plain', ...headers },
    });

  it('refuses a same-site form post from another host, and creates nothing', async () => {
    const res = await formPost({
      Origin: 'https://evil.bertro.dev',
      'Sec-Fetch-Site': 'same-site',
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
    expect((await formPost({ Origin: 'https://evil.bertro.dev' })).status).toBe(403);
    expect((await formPost({ 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    const list = (await (await ctx.request('/api/workspaces')).json()) as { name: string }[];
    expect(list.map((w) => w.name)).not.toContain('Gekapert');
  });

  it('lets the web app (same origin or WEB_ORIGIN) and non-browser clients through', async () => {
    const blocked = async (res: Response) => (await res.text()).includes('kommt nicht von Slider');
    expect(
      await blocked(
        await formPost({ 'Sec-Fetch-Site': 'same-origin', Origin: 'http://10.0.0.5:8787' }),
      ),
    ).toBe(false);
    expect(
      await blocked(
        await formPost({ Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'same-site' }),
      ),
    ).toBe(false);
    expect(await blocked(await formPost({}))).toBe(false);
    expect((await ctx.request('/api/live/unknown/leave', { method: 'POST' })).status).toBe(204);
    // Reads are never blocked.
    expect(
      (await ctx.request('/api/me', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
    ).toBe(200);
  });
});
