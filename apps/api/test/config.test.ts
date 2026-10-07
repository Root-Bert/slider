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
});
