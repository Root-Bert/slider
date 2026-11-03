import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * The editor against a real LibreOffice (`bun run e2e:live`): what the default suite cannot see,
 * since it turns LibreOffice off – the editor itself, its pictures drawn anew after each edit, and
 * whether the screen ever shows a stale or empty frame meanwhile (`live/flicker.spec.ts`). Not part
 * of `bun run e2e`: it needs `soffice` (LIBREOFFICE_PATH, else the macOS app) and takes a minute.
 * Its own ports and data folder, so neither `bun run dev` nor `bun run e2e` is touched.
 *
 * Bundle mode (`bun run e2e:live:bundle`, `E2E_BUNDLE=1`): no Vite – apps/web is built and the API
 * serves it, with its service worker (only production builds register one): a deck opened once
 * reopens offline and stays editable (`live/offline.spec.ts`).
 */
const API_PORT = 28787;
const WEB_PORT = 25173;
const BUNDLE = !!process.env.E2E_BUNDLE;
const API_ORIGIN = `http://localhost:${API_PORT}`;
const WEB_ORIGIN = BUNDLE ? API_ORIGIN : `http://localhost:${WEB_PORT}`;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const dataDir = fileURLToPath(new URL('./.live-data', import.meta.url));
const SOFFICE =
  process.env.LIBREOFFICE_PATH ?? '/Applications/LibreOffice.app/Contents/MacOS/soffice';

export default defineConfig({
  testDir: './live',
  outputDir: './.live-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    baseURL: WEB_ORIGIN,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    viewport: { width: 1280, height: 800 },
    // A control not found fails fast, not at the test's end.
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        ...(process.env.CI ? {} : { channel: 'chrome' }),
        launchOptions: { args: ['--no-proxy-server'] },
      },
    },
  ],
  webServer: [
    {
      command: [
        `rm -rf "${dataDir}"`,
        ...(BUNDLE ? ['bun run --cwd apps/web vite build --logLevel warn'] : []),
        'bun apps/api/src/server.ts',
      ].join(' && '),
      cwd: repoRoot,
      url: `${API_ORIGIN}/api/health`,
      reuseExistingServer: false,
      timeout: BUNDLE ? 240_000 : 90_000,
      stdout: 'ignore',
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        DATA_DIR: dataDir,
        SLIDER_SECRET: randomBytes(32).toString('base64url'),
        WEB_ORIGIN,
        AUTH_DEV_LOGIN: 'true',
        LIBREOFFICE_PATH: SOFFICE,
        ...(BUNDLE ? { WEB_DIST_DIR: 'apps/web/dist' } : {}),
      },
    },
    ...(BUNDLE
      ? []
      : [
          {
            command: `bun run --cwd apps/web vite --port ${WEB_PORT} --strictPort`,
            cwd: repoRoot,
            url: WEB_ORIGIN,
            reuseExistingServer: false,
            timeout: 60_000,
            env: { SLIDER_API_URL: API_ORIGIN },
          },
        ]),
  ],
});
