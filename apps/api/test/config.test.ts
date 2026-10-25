import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasLogin, loadConfig, withStoredSettings } from '../src/config';

const quiet = () => {};
const API_DATA_DIR = fileURLToPath(new URL('../.data', import.meta.url));

describe('loadConfig', () => {
  it('resolves a relative DATA_DIR from the repo root, like the root .env means it', () => {
    expect(loadConfig({ DATA_DIR: 'apps/api/.data' }, quiet).dataDir).toBe(API_DATA_DIR);
    expect(loadConfig({}, quiet).dataDir).toBe(API_DATA_DIR);
  });

  it('imports one deck at a time unless IMPORT_WORKERS says otherwise', () => {
    expect(loadConfig({}, quiet).importWorkers).toBe(1);
    expect(loadConfig({ IMPORT_WORKERS: '3' }, quiet).importWorkers).toBe(3);
    expect(() => loadConfig({ IMPORT_WORKERS: '0' }, quiet)).toThrow();
  });

  it('gives LibreOffice 2 minutes per deck unless LIBREOFFICE_TIMEOUT_MS says otherwise', () => {
    expect(loadConfig({}, quiet).libreOfficeTimeoutMs).toBe(120_000);
    expect(loadConfig({ LIBREOFFICE_TIMEOUT_MS: '600000' }, quiet).libreOfficeTimeoutMs).toBe(
      600_000,
    );
    expect(() => loadConfig({ LIBREOFFICE_TIMEOUT_MS: '500' }, quiet)).toThrow();
  });

  it('gives a PDF 2 minutes (plus a second per page) unless PDF_TIMEOUT_MS says otherwise', () => {
    expect(loadConfig({}, quiet).pdfTimeoutMs).toBe(120_000);
    expect(loadConfig({ PDF_TIMEOUT_MS: '300000' }, quiet).pdfTimeoutMs).toBe(300_000);
    expect(() => loadConfig({ PDF_TIMEOUT_MS: '500' }, quiet)).toThrow();
  });

  it('treats empty keys from .env as unset', () => {
    const config = loadConfig({ SLIDER_SECRET: '', MS_CLIENT_ID: '', MS_CLIENT_SECRET: '' }, quiet);
    expect(config.microsoft).toBeNull();
  });

  it('enables Microsoft only with client id and secret', () => {
    expect(loadConfig({ MS_CLIENT_ID: 'id' }, quiet).microsoft).toBeNull();
    expect(
      loadConfig(
        { MS_CLIENT_ID: 'id', MS_CLIENT_SECRET: 'secret', WEB_ORIGIN: 'https://slider.example' },
        quiet,
      ).microsoft,
    ).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      tenant: 'common',
      redirectUri: 'https://slider.example/api/auth/microsoft/callback',
    });
  });

  it('takes the organisation’s Nextcloud without trailing slash or index.php', () => {
    expect(loadConfig({}, quiet).nextcloud.server).toBeNull();
    expect(
      loadConfig({ NEXTCLOUD_URL: 'https://example.de/nextcloud/index.php/' }, quiet).nextcloud,
    ).toEqual({ server: 'https://example.de/nextcloud', login: null, loginAnyServer: true });
    expect(loadConfig({ NEXTCLOUD_LOGIN_ANY: 'false' }, quiet).nextcloud.loginAnyServer).toBe(
      false,
    );
    expect(() => loadConfig({ NEXTCLOUD_URL: 'ftp://cloud.example.de' }, quiet)).toThrow();
  });

  it('polls linked decks every 2 minutes with a 1 minute debounce by default', () => {
    expect(loadConfig({}, quiet).sync).toEqual({ pollIntervalMs: 60_000, debounceMs: 60_000 });
    expect(
      loadConfig({ SYNC_POLL_INTERVAL_MS: '0', SYNC_DEBOUNCE_MS: '5000' }, quiet).sync,
    ).toEqual({ pollIntervalMs: 0, debounceMs: 5_000 });
    expect(() => loadConfig({ SYNC_POLL_INTERVAL_MS: '5000' }, quiet)).toThrow(
      /SYNC_POLL_INTERVAL_MS/,
    );
  });
  it('uses the free plan (5 people, 3 decks) on the demo unless PLAN_FREE_* says otherwise; 0 = unlimited', () => {
    const demo = (env: NodeJS.ProcessEnv) => loadConfig({ SLIDER_DEMO: 'true', ...env }, quiet);
    const GB2 = 2 * 1024 ** 3;
    expect(demo({}).plans.free).toEqual({ maxMembers: 5, maxDecks: 3, maxStorageBytes: GB2 });
    expect(demo({ PLAN_FREE_MAX_MEMBERS: '25', PLAN_FREE_MAX_DECKS: '0' }).plans.free).toEqual({
      maxMembers: 25,
      maxDecks: null,
      maxStorageBytes: GB2,
    });
    expect(demo({ PLAN_FREE_MAX_MEMBERS: '0', PLAN_FREE_MAX_DECKS: '' }).plans.free).toEqual({
      maxMembers: null,
      maxDecks: 3,
      maxStorageBytes: GB2,
    });
    expect(() => loadConfig({ PLAN_FREE_MAX_DECKS: '-1' }, quiet)).toThrow(/PLAN_FREE_MAX_DECKS/);
  });

  describe('self-hosted vs. demo', () => {
    const prod = (url: string, env: NodeJS.ProcessEnv = {}) =>
      loadConfig(
        { NODE_ENV: 'production', SLIDER_SECRET: 'x'.repeat(32), SLIDER_URL: url, ...env },
        quiet,
      );
    const NONE = { maxMembers: null, maxDecks: null, maxStorageBytes: null };
    const UNLIMITED = { free: NONE, paid: NONE };

    it('runs a self-hosted instance without any limits', () => {
      const config = prod('https://slider.firma.de');
      expect(config.limited).toBe(false);
      expect(config.plans).toEqual(UNLIMITED);
    });

    it('keeps the limits on the hosted demo only, not in development', () => {
      const demo = prod('https://slider.bertro.dev');
      expect(demo.limited).toBe(true);
      expect(demo.plans).toEqual({
        free: { maxMembers: 5, maxDecks: 3, maxStorageBytes: 2 * 1024 ** 3 },
        paid: { maxMembers: 100, maxDecks: null, maxStorageBytes: 100 * 1024 ** 3 },
      });
      expect(loadConfig({}, quiet).limited).toBe(false);
      expect(loadConfig({}, quiet).plans).toEqual(UNLIMITED);
    });

    it('lets SLIDER_DEMO and explicit limits override the detection', () => {
      expect(prod('https://slider.firma.de', { SLIDER_DEMO: 'true' }).limited).toBe(true);
      expect(prod('https://slider.bertro.dev', { SLIDER_DEMO: 'false' }).plans).toEqual(UNLIMITED);
      const capped = prod('https://slider.firma.de', {
        PLAN_FREE_MAX_DECKS: '50',
        MEDIA_QUOTA_BYTES: '1000',
      });
      expect(capped.plans.free).toEqual({ maxMembers: null, maxDecks: 50, maxStorageBytes: 1000 });
      expect(
        prod('https://slider.bertro.dev', { PLAN_FREE_MAX_STORAGE_BYTES: '0' }).plans.free
          .maxStorageBytes,
      ).toBeNull();
    });

    it('takes Stripe only together and only where there are limits', () => {
      const stripe = {
        STRIPE_SECRET_KEY: 'sk_test_1',
        STRIPE_WEBHOOK_SECRET: 'whsec_1',
        STRIPE_PRICE_ID: 'price_1',
      };
      expect(prod('https://slider.bertro.dev', stripe).billing).toEqual({
        secretKey: 'sk_test_1',
        webhookSecret: 'whsec_1',
        priceId: 'price_1',
      });
      expect(prod('https://slider.firma.de', stripe).billing).toBeNull();
      expect(() => prod('https://slider.bertro.dev', { STRIPE_SECRET_KEY: 'sk_test_1' })).toThrow(
        /must be set together/,
      );
    });
  });

  describe('login (BER-129)', () => {
    const SECRET = { SLIDER_SECRET: 'x'.repeat(32), SLIDER_URL: 'https://slider.firma.de' };
    const MS = { MS_CLIENT_ID: 'id', MS_CLIENT_SECRET: 'secret' };

    it('logs in as the dev owner in development until a login provider is configured', () => {
      expect(loadConfig({}, quiet).auth).toEqual({
        devLogin: true,
        signup: 'open',
        signupDomains: [],
        oidc: null,
        google: null,
        sessionTtlDays: 30,
      });
      expect(loadConfig(MS, quiet).auth.devLogin).toBe(false);
      expect(loadConfig({ ...MS, AUTH_DEV_LOGIN: 'true' }, quiet).auth.devLogin).toBe(true);
      expect(loadConfig({ AUTH_DEV_LOGIN: 'false' }, quiet).auth.devLogin).toBe(false);
    });

    it('configures the Google login and Google Drive with it (BER-119)', () => {
      const pair = {
        GOOGLE_CLIENT_ID: '123456-abc.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 's',
      };
      const login = loadConfig(pair, quiet);
      expect(login.auth.google).toMatchObject({
        issuer: 'https://accounts.google.com',
        redirectUri: 'http://localhost:5173/api/auth/google/callback',
      });
      expect(hasLogin(login)).toBe(true);
      expect(login.googleDrive).toEqual({
        clientId: pair.GOOGLE_CLIENT_ID,
        clientSecret: 's',
        redirectUri: 'http://localhost:5173/api/auth/google/callback',
      });
      expect(() => loadConfig({ GOOGLE_CLIENT_ID: 'g-id' }, quiet)).toThrow(/together/);
    });

    it('starts in production without a login (setup page), but never logs in as the dev owner there', () => {
      const bare = loadConfig({ NODE_ENV: 'production', ...SECRET }, quiet);
      expect(hasLogin(bare)).toBe(false);
      expect(bare.auth.devLogin).toBe(false);
      const prod = { NODE_ENV: 'production', ...SECRET, ...MS };
      expect(loadConfig(prod, quiet).auth.devLogin).toBe(false);
      expect(() => loadConfig({ ...prod, AUTH_DEV_LOGIN: 'true' }, quiet)).toThrow(
        /AUTH_DEV_LOGIN/,
      );
    });

    it('configures OIDC with defaults', () => {
      const config = loadConfig(
        {
          OIDC_ISSUER: 'https://auth.firma.de/application/o/slider/',
          OIDC_CLIENT_ID: 'slider',
          OIDC_CLIENT_SECRET: 's',
          WEB_ORIGIN: 'https://slider.firma.de',
        },
        quiet,
      );
      expect(config.auth.oidc).toEqual({
        issuer: 'https://auth.firma.de/application/o/slider',
        clientId: 'slider',
        clientSecret: 's',
        label: 'Weiter mit SSO',
        scopes: 'openid profile email',
        redirectUri: 'https://slider.firma.de/api/auth/oidc/callback',
      });
      expect(config.auth.devLogin).toBe(false);
      expect(() => loadConfig({ OIDC_ISSUER: 'https://auth.firma.de' }, quiet)).toThrow(
        /OIDC_CLIENT_ID/,
      );
    });

    it('configures SMTP only with SMTP_URL and MAIL_FROM together', () => {
      expect(loadConfig({}, quiet).smtp).toBeNull();
      expect(
        loadConfig(
          { SMTP_URL: 'smtps://u:p@mail.firma.de:465', MAIL_FROM: 'Slider <s@firma.de>' },
          quiet,
        ).smtp,
      ).toEqual({ url: 'smtps://u:p@mail.firma.de:465', from: 'Slider <s@firma.de>' });
      expect(() => loadConfig({ SMTP_URL: 'smtps://mail.firma.de' }, quiet)).toThrow(/MAIL_FROM/);
      expect(() => loadConfig({ SMTP_URL: 'mail.firma.de', MAIL_FROM: 'x@y.de' }, quiet)).toThrow(
        /SMTP_URL/,
      );
    });

    it('no longer reads BOOTSTRAP_EMAIL: no error, no admin list, no production warning', () => {
      const warnings: string[] = [];
      const warn = (msg: string) => warnings.push(msg);
      const prod = { NODE_ENV: 'production', ...SECRET, ...MS };
      const config = loadConfig({ ...prod, BOOTSTRAP_EMAIL: 'not an address' }, warn);
      expect(config.auth).not.toHaveProperty('bootstrapEmails');
      expect(warnings).toEqual([]);
      loadConfig(prod, warn);
      expect(warnings).toEqual([]);
    });

    it('parses the sign-up policy', () => {
      expect(
        loadConfig({ SIGNUP: 'domains', SIGNUP_DOMAINS: ' Firma.de, @firma.com ,' }, quiet).auth,
      ).toMatchObject({ signup: 'domains', signupDomains: ['firma.de', 'firma.com'] });
      expect(() => loadConfig({ SIGNUP: 'domains' }, quiet)).toThrow(/SIGNUP_DOMAINS/);
      expect(() => loadConfig({ SIGNUP: 'everyone' }, quiet)).toThrow();
      expect(loadConfig({ SIGNUP: 'open', SESSION_TTL_DAYS: '7' }, quiet).auth).toMatchObject({
        signup: 'open',
        sessionTtlDays: 7,
      });
    });
  });

  describe('self-hosting with one container', () => {
    const PROD = { NODE_ENV: 'production', SLIDER_URL: 'https://slider.firma.de/' };

    it('needs SLIDER_URL in production (WEB_ORIGIN still works) and drops a trailing slash', () => {
      expect(() =>
        loadConfig({ NODE_ENV: 'production', SLIDER_SECRET: 'x'.repeat(32) }, quiet),
      ).toThrow(/SLIDER_URL/);
      const dir = mkdtempSync(path.join(tmpdir(), 'slider-config-'));
      try {
        const config = loadConfig({ ...PROD, DATA_DIR: dir }, quiet);
        expect(config.webOrigin).toBe('https://slider.firma.de');
        expect(
          loadConfig(
            { NODE_ENV: 'production', WEB_ORIGIN: 'https://old.firma.de', DATA_DIR: dir },
            quiet,
          ).webOrigin,
        ).toBe('https://old.firma.de');
        expect(loadConfig({}, quiet).webOrigin).toBe('http://localhost:5173');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('refuses a plain-http SLIDER_URL in production except on localhost (Secure cookies)', () => {
      const prod = (url: string) =>
        loadConfig(
          { NODE_ENV: 'production', SLIDER_SECRET: 'x'.repeat(32), SLIDER_URL: url },
          quiet,
        );
      expect(() => prod('http://192.168.1.10:8787')).toThrow(/https:\/\//);
      expect(() => prod('http://slider.firma.de')).toThrow(/https:\/\//);
      for (const url of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
        expect(prod(url).webOrigin).toBe(url);
      }
      expect(loadConfig({ SLIDER_URL: 'http://192.168.1.10:8787' }, quiet).webOrigin).toBe(
        'http://192.168.1.10:8787',
      );
    });

    it('generates SLIDER_SECRET once into the data folder when it is not set', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'slider-config-'));
      try {
        const first = loadConfig({ ...PROD, DATA_DIR: dir }, quiet).secret;
        expect(first.length).toBeGreaterThanOrEqual(32);
        expect(readFileSync(path.join(dir, 'secret'), 'utf8').trim()).toBe(first);
        expect(statSync(path.join(dir, 'secret')).mode & 0o777).toBe(0o600);
        expect(loadConfig({ ...PROD, DATA_DIR: dir }, quiet).secret).toBe(first);
        expect(
          loadConfig({ ...PROD, DATA_DIR: dir, SLIDER_SECRET: 'y'.repeat(32) }, quiet).secret,
        ).toBe('y'.repeat(32));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('merges settings from the setup page below the environment', () => {
      const env = withStoredSettings(
        { MS_CLIENT_ID: 'env-id', MS_CLIENT_SECRET: '', SIGNUP: 'invite' },
        { MS_CLIENT_ID: 'stored-id', MS_CLIENT_SECRET: 'stored-secret', SIGNUP: 'open' },
      );
      expect(env).toMatchObject({
        MS_CLIENT_ID: 'env-id',
        MS_CLIENT_SECRET: 'stored-secret',
        SIGNUP: 'invite',
      });
    });
  });
});
