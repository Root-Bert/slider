import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, shot, test } from '../support';

/** The API's data folder (`playwright.config.ts`): the server keeps the setup token there. */
const setupToken = () =>
  readFileSync(fileURLToPath(new URL('../.data/setup-token', import.meta.url)), 'utf8').trim();

const TOKEN_TITLE = 'Setup-Token aus dem Server-Log eingeben';

/**
 * Dev login (no login provider): nobody is instance admin, so the page asks for the setup token
 * from the server log – typed in, never part of a URL – and shows no form without it.
 */
test('/einrichtung without the setup token', async ({ page }) => {
  await page.goto('/einrichtung');
  await expect(page.getByRole('heading', { level: 1, name: 'Slider einrichten' })).toBeVisible();
  await expect(page.getByRole('heading', { name: TOKEN_TITLE })).toBeVisible();
  await expect(page.getByText('docker logs slider')).toBeVisible();
  await expect(page.getByRole('button', { name: /Speichern/ })).toHaveCount(0);
  await shot(page, 'setup');
});

/**
 * Without a login provider nobody is signed in: the dev owner is never sent to the setup token
 * (only signed-in accounts of an instance without admin are, `instance_unclaimed`).
 */
test('dev login: the dev owner is not asked for the setup token', async ({ page }) => {
  const me = await page.request.get('/api/me');
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ instanceClaimed: true });
  expect((await page.request.get('/api/decks')).status()).toBe(200);
  await page.goto('/');
  await expect(page).not.toHaveURL(/einrichtung/);
});

test('/einrichtung with a wrong setup token', async ({ page }) => {
  await page.goto('/einrichtung');
  await page.getByRole('textbox', { name: 'Setup-Token', exact: true }).fill('not-the-real-token');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByText(/Der Setup-Token stimmt nicht/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Speichern/ })).toHaveCount(0);
  expect(page.url()).not.toContain('not-the-real-token');
  const res = await page.request.put('/api/setup', {
    data: { values: {} },
    headers: { 'X-Setup-Token': 'not-the-real-token' },
  });
  expect(res.status()).toBe(403);
});

test('/einrichtung with the setup token from the log', async ({ page }) => {
  const token = setupToken();
  await page.goto('/einrichtung');
  await page
    .getByRole('textbox', { name: 'Setup-Token', exact: true })
    .fill(`Setup token: ${token}`);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Microsoft' })).toBeVisible();
  expect(page.url()).not.toContain(token);
  // Kept for the tab: a reload (the restart after saving) stays on the form.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeVisible();
});
