import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type HostingConfig } from '../src/config';
import { clientAddress } from '../src/http/rate-limit';
import { createTestContext, type TestContext } from './helpers';

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
    expect(await res.json()).toEqual({ ok: true });
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
    for (const url of ['/', '/d/some-deck?slide=1', '/neu']) {
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

  it('answers 404 for missing files instead of index.html', async () => {
    expect((await ctx.request('/assets/index-old.js')).status).toBe(404);
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
