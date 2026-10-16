import { expect, shot, test } from '../support';

/**
 * Dev login (no login provider): no setup token is printed and nobody is instance admin yet, so
 * the page explains where the link comes from and shows no form.
 */
test('/einrichtung without a setup link', async ({ page }) => {
  await page.goto('/einrichtung');
  await expect(page.getByRole('heading', { level: 1, name: 'Slider einrichten' })).toBeVisible();
  await expect(page.getByText('/einrichtung#token=…')).toBeVisible();
  await expect(page.getByRole('button', { name: /Speichern/ })).toHaveCount(0);
  await shot(page, 'setup');
});

test('/einrichtung with a wrong setup token', async ({ page }) => {
  await page.goto('/einrichtung#token=not-the-real-token');
  await expect(page.getByRole('heading', { level: 1, name: 'Slider einrichten' })).toBeVisible();
  await expect(page.getByText('/einrichtung#token=…')).toBeVisible();
  // The token is taken out of the address bar.
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  const res = await page.request.put('/api/setup', {
    data: { values: {} },
    headers: { 'X-Setup-Token': 'not-the-real-token' },
  });
  expect(res.status()).toBe(403);
});
