import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke suite: the API (dev login, fresh PGlite data folder) and the Vite dev server
 * on their own ports, so a running `bun run dev` (5173/8787) is never touched.
 *
 *   bun run e2e                 # all specs
 *   bun run e2e:bundle          # the same specs against the production build, served by the API
 *   E2E_SHOTS=1 bun run e2e     # plus full-page screenshots (folder: E2E_SHOTS_DIR)
 *
 * Bundle mode (`E2E_BUNDLE=1`) runs no Vite: it builds apps/web, and the API serves apps/web/dist
 * itself (WEB_DIST_DIR) like the container does – built chunks, lazy routes, the SPA fallback and
 * the document headers the API sets. Only the dev login stays (NODE_ENV=development).
 */
const API_PORT = 18787;
const WEB_PORT = 15173;
const BUNDLE = !!process.env.E2E_BUNDLE;
const API_ORIGIN = `http://localhost:${API_PORT}`;
const WEB_ORIGIN = BUNDLE ? API_ORIGIN : `http://localhost:${WEB_PORT}`;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const dataDir = fileURLToPath(new URL('./.data', import.meta.url));
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './specs',
  outputDir: './.results',
  // One instance, one dev owner: the specs share state, so they run one after another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: '.report' }]] : 'list',
  use: {
    baseURL: WEB_ORIGIN,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Locally the installed Google Chrome; CI installs Playwright's chromium.
      use: {
        ...devices['Desktop Chrome'],
        ...(CI ? {} : { channel: 'chrome' }),
        // Only localhost is visited; without this, Chrome's proxy auto-detection can stall the
        // first navigation for a minute on some machines.
        launchOptions: { args: ['--no-proxy-server'] },
      },
    },
  ],
  webServer: [
    {
      // Every run starts on an empty instance. (Wiped here, not at the top of this file: the
      // config is evaluated again in every worker, while the server is already running.)
      command: [
        `rm -rf "${dataDir}"`,
        ...(BUNDLE ? ['bun run --cwd apps/web vite build --logLevel warn'] : []),
        'bun apps/api/src/server.ts',
      ].join(' && '),
      cwd: repoRoot,
      url: `${API_ORIGIN}/api/health`,
      reuseExistingServer: false,
      timeout: BUNDLE ? 240_000 : 60_000,
      // Request logs stay quiet; warnings and errors (stderr) show up in the test output.
      stdout: 'ignore',
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        DATA_DIR: dataDir,
        // Fresh per run: the data folder is wiped anyway, so nothing signed outlives it.
        SLIDER_SECRET: randomBytes(32).toString('base64url'),
        WEB_ORIGIN,
        AUTH_DEV_LOGIN: 'true',
        SYNC_POLL_INTERVAL_MS: '0',
        // Deterministic and fast: the built-in SVG preview, even where LibreOffice is installed.
        LIBREOFFICE_PATH: '/nonexistent/soffice',
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
