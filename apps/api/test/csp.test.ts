import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { CONTENT_SECURITY_POLICY, describeCspReports } from '../src/http/csp';
import { silentLogger, type Logger } from '../src/logger';
import { createTestContext, type TestContext } from './helpers';

const REPORT_ONLY = 'content-security-policy-report-only';

describe('Content Security Policy of the web app', () => {
  let ctx: TestContext;
  let dist: string;
  beforeEach(async () => {
    dist = await mkdtemp(path.join(tmpdir(), 'slider-web-dist-'));
    await mkdir(path.join(dist, 'assets'));
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>Slider</title>');
    await writeFile(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    ctx = await createTestContext({
      config: { hosting: { databaseUrl: null, webDistDir: dist, trustProxy: false } },
    });
  });
  afterEach(async () => {
    await ctx.cleanup();
    await rm(dist, { recursive: true, force: true });
  });

  it('is sent report-only with the HTML, not with scripts or the API', async () => {
    for (const url of ['/', '/index.html', '/d/some-deck']) {
      const res = await ctx.request(url);
      expect(res.headers.get(REPORT_ONLY)).toBe(CONTENT_SECURITY_POLICY);
      expect(res.headers.get('content-security-policy')).toBeNull();
      expect(res.headers.get('reporting-endpoints')).toBe('csp="/api/csp-report"');
    }
    expect((await ctx.request('/assets/index-abc123.js')).headers.get(REPORT_ONLY)).toBeNull();
    expect((await ctx.request('/api/me')).headers.get(REPORT_ONLY)).toBeNull();
  });

  it('allows only the app itself and the OneDrive picker', () => {
    const directives = new Map(
      CONTENT_SECURITY_POLICY.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]),
    );
    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('frame-src')).toEqual([
      'https://onedrive.live.com',
      'https://*.sharepoint.com',
    ]);
    expect(directives.get('report-uri')).toEqual(['/api/csp-report']);
  });
});

describe('POST /api/csp-report', () => {
  let ctx: TestContext;
  let warn: MockInstance<Logger['warn']>;
  beforeEach(async () => {
    ctx = await createTestContext();
    warn = vi.spyOn(silentLogger, 'warn');
  });
  afterEach(async () => {
    warn.mockRestore();
    await ctx.cleanup();
  });

  const post = (type: string, body: unknown, headers: Record<string, string> = {}) =>
    ctx.request('/api/csp-report', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'Content-Type': type, ...headers },
    });

  const legacy = {
    'csp-report': {
      'document-uri': 'https://slider.example/join/secret-token?x=1',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example/x.js?user=robert@example.com',
      'source-file': 'https://slider.example/assets/index-abc.js?v=1',
      'line-number': 12,
      disposition: 'report',
    },
  };

  it('logs a report-uri report without paths, tokens or query strings', async () => {
    // Browsers post reports without the app's Origin – the CSRF guard lets them through.
    const res = await post('application/csp-report', legacy, {
      Origin: 'null',
      'Sec-Fetch-Site': 'cross-site',
    });
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(
      'CSP: script-src-elem would block https://evil.example on /join/… from https://slider.example/assets/index-abc.js:12',
    );
  });

  it('logs Reporting API batches (application/reports+json)', async () => {
    const res = await post('application/reports+json', [
      {
        type: 'csp-violation',
        url: 'https://slider.example/neu',
        body: {
          documentURL: 'https://slider.example/neu',
          effectiveDirective: 'frame-src',
          blockedURL: 'https://login.microsoftonline.com/common/oauth2',
          disposition: 'report',
        },
      },
      { type: 'deprecation', body: { id: 'x' } },
      {
        type: 'csp-violation',
        body: {
          effectiveDirective: 'style-src-attr',
          blockedURL: 'inline',
          disposition: 'enforce',
        },
      },
    ]);
    expect(res.status).toBe(204);
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      'CSP: frame-src would block https://login.microsoftonline.com on /neu',
      'CSP: style-src-attr blocked inline on (unknown page)',
    ]);
  });

  it('refuses other content, malformed JSON and bodies over 16 KB', async () => {
    expect((await post('text/plain', legacy)).status).toBe(400);
    expect((await post('application/csp-report', '{nope')).status).toBe(400);
    const huge = { 'csp-report': { ...legacy['csp-report'], padding: 'x'.repeat(17 * 1024) } };
    expect((await post('application/csp-report', huge)).status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs at most a few violations per request', () => {
    expect(describeCspReports(Array.from({ length: 50 }, () => legacy))).toHaveLength(5);
    expect(describeCspReports({ 'csp-report': { 'effective-directive': 'x\ny' } })).toEqual([]);
  });

  it('rate-limits each client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++)
      statuses.push((await post('application/csp-report', legacy)).status);
    expect(statuses.slice(0, 30).every((status) => status === 204)).toBe(true);
    expect(statuses[30]).toBe(429);
    ctx.clock.advance(60_000);
    expect((await post('application/csp-report', legacy)).status).toBe(204);
  });
});
