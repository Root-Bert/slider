import { expect, test } from '../support';

// Only in bundle mode (`bun run e2e:bundle`): the API serves the production build itself, as in
// the container. Under the Vite dev server these headers do not exist on the document.
test.skip(!process.env.E2E_BUNDLE, 'needs the production build served by the API');

test('the API serves the built app with its document headers', async ({ page }) => {
  // A deep link: only the SPA fallback answers it with index.html.
  const response = await page.goto('/einstellungen');
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  // The OneDrive picker is a popup that talks back through `window.opener`.
  expect(headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
  expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-content-type-options']).toBe('nosniff');

  // Hashed chunks from the build, not Vite's unbundled modules.
  const scripts = await page
    .locator('script[type="module"][src]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src') ?? ''));
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts) expect(src).toMatch(/^\/assets\/[\w-]+\.js$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
