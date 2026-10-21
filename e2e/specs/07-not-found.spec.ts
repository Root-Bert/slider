import { expect, shot, test } from '../support';

test('unknown address shows the 404 page', async ({ page }) => {
  await page.goto('/gibt-es-nicht');
  await expect(page.getByRole('heading', { level: 1, name: 'Seite nicht gefunden' })).toBeVisible();
  await shot(page, 'not-found');
  await page.getByRole('button', { name: 'Zu meinen Reviews' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reviews' })).toBeVisible();
});

test.describe('unknown deck', () => {
  // The deck request itself answers 404 – the browser logs that failed fetch.
  test.use({ allowConsoleErrors: [/status of 404/] });

  test('shows a not-found state instead of crashing', async ({ page }) => {
    await page.goto('/d/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Das hat nicht geklappt');
    await shot(page, 'deck-not-found');
  });
});
