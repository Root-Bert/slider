import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const quiet = () => {};
const API_DATA_DIR = fileURLToPath(new URL('../.data', import.meta.url));

describe('loadConfig', () => {
  it('resolves a relative DATA_DIR from the repo root, like the root .env means it', () => {
    expect(loadConfig({ DATA_DIR: 'apps/api/.data' }, quiet).dataDir).toBe(API_DATA_DIR);
    expect(loadConfig({}, quiet).dataDir).toBe(API_DATA_DIR);
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

  it('polls linked decks every 2 minutes with a 1 minute debounce by default', () => {
    expect(loadConfig({}, quiet).sync).toEqual({ pollIntervalMs: 120_000, debounceMs: 60_000 });
    expect(
      loadConfig({ SYNC_POLL_INTERVAL_MS: '0', SYNC_DEBOUNCE_MS: '5000' }, quiet).sync,
    ).toEqual({ pollIntervalMs: 0, debounceMs: 5_000 });
    expect(() => loadConfig({ SYNC_POLL_INTERVAL_MS: '5000' }, quiet)).toThrow(
      /SYNC_POLL_INTERVAL_MS/,
    );
  });
  it('uses the free plan (5 people, 3 decks) unless PLAN_FREE_* says otherwise; 0 = unlimited', () => {
    expect(loadConfig({}, quiet).plans).toEqual({ free: { maxMembers: 5, maxDecks: 3 } });
    expect(
      loadConfig({ PLAN_FREE_MAX_MEMBERS: '25', PLAN_FREE_MAX_DECKS: '0' }, quiet).plans,
    ).toEqual({ free: { maxMembers: 25, maxDecks: null } });
    expect(
      loadConfig({ PLAN_FREE_MAX_MEMBERS: '0', PLAN_FREE_MAX_DECKS: '' }, quiet).plans,
    ).toEqual({ free: { maxMembers: null, maxDecks: 3 } });
    expect(() => loadConfig({ PLAN_FREE_MAX_DECKS: '-1' }, quiet)).toThrow(/PLAN_FREE_MAX_DECKS/);
  });

  describe('login (BER-129)', () => {
    const SECRET = { SLIDER_SECRET: 'x'.repeat(32) };
    const MS = { MS_CLIENT_ID: 'id', MS_CLIENT_SECRET: 'secret' };

    it('logs in as the dev owner in development until a login provider is configured', () => {
      expect(loadConfig({}, quiet).auth).toEqual({
        devLogin: true,
        signup: 'open',
        signupDomains: [],
        oidc: null,
        google: null,
        sessionTtlDays: 30,
        bootstrapEmails: [],
      });
      expect(loadConfig(MS, quiet).auth.devLogin).toBe(false);
      expect(loadConfig({ ...MS, AUTH_DEV_LOGIN: 'true' }, quiet).auth.devLogin).toBe(true);
      expect(loadConfig({ AUTH_DEV_LOGIN: 'false' }, quiet).auth.devLogin).toBe(false);
    });

    it('configures Google with its issuer and the default redirect URI', () => {
      const google = { GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret' };
      const auth = loadConfig(google, quiet).auth;
      expect(auth.devLogin).toBe(false);
      expect(auth.google).toMatchObject({
        issuer: 'https://accounts.google.com',
        clientId: 'g-id',
        scopes: 'openid email profile',
        redirectUri: 'http://localhost:5173/api/auth/google/callback',
      });
      expect(
        loadConfig({ ...google, GOOGLE_REDIRECT_URI: 'https://s.example.com/cb' }, quiet).auth
          .google?.redirectUri,
      ).toBe('https://s.example.com/cb');
      expect(() => loadConfig({ GOOGLE_CLIENT_ID: 'g-id' }, quiet)).toThrow(/GOOGLE_CLIENT_SECRET/);
      expect(
        loadConfig({ NODE_ENV: 'production', ...SECRET, ...google }, quiet).auth.google,
      ).not.toBeNull();
    });

    it('refuses to start in production without a login, and never logs in as the dev owner there', () => {
      expect(() => loadConfig({ NODE_ENV: 'production', ...SECRET }, quiet)).toThrow(
        /No login is configured/,
      );
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

    it('parses BOOTSTRAP_EMAIL and warns loudly in production without it', () => {
      expect(
        loadConfig({ BOOTSTRAP_EMAIL: ' Robert@Q4-Team.de, ops@firma.de ,' }, quiet).auth
          .bootstrapEmails,
      ).toEqual(['robert@q4-team.de', 'ops@firma.de']);
      expect(() => loadConfig({ BOOTSTRAP_EMAIL: 'robert' }, quiet)).toThrow(/BOOTSTRAP_EMAIL/);

      const warnings: string[] = [];
      const warn = (msg: string) => warnings.push(msg);
      const prod = { NODE_ENV: 'production', ...SECRET, ...MS };
      loadConfig(prod, warn);
      expect(warnings.join('\n')).toMatch(/BOOTSTRAP_EMAIL is not set/);
      warnings.length = 0;
      loadConfig({ ...prod, BOOTSTRAP_EMAIL: 'robert@q4-team.de' }, warn);
      expect(warnings).toEqual([]);
      loadConfig({}, warn);
      expect(warnings.join('\n')).not.toMatch(/BOOTSTRAP_EMAIL/);
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
});
