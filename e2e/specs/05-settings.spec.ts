import { expect, shot, test } from '../support';

test('account page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Konto: Robert Hofmann' }).click();
  await page.getByRole('button', { name: 'Konto & Anmeldung' }).click();
  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Konto & Anmeldung' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Robert Hofmann');
  await expect(page.getByRole('textbox', { name: 'E-Mail' })).toHaveValue('robert@example.org');
  await expect(page.getByRole('region', { name: 'Passkeys' })).toBeVisible();
  await shot(page, 'account');
});

test('preferences page keeps a changed setting', async ({ page }) => {
  await page.goto('/einstellungen');
  await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
  const colors = page.getByRole('radiogroup', { name: /^Deine Farbe/ });
  await expect(colors.getByRole('radio', { name: 'Rot' })).toBeChecked();
  await colors.getByRole('radio', { name: 'Blau' }).click();
  await expect(colors.getByRole('radio', { name: 'Blau' })).toBeChecked();
  await expect
    .poll(async () => {
      const me = (await (await page.request.get('/api/me')).json()) as {
        user?: { color?: string };
      };
      return me.user?.color;
    })
    .toBe('blue');
  await page.reload();
  await expect(colors.getByRole('radio', { name: 'Blau' })).toBeChecked();
  await shot(page, 'preferences');
  // Back to the default, so other specs see the dev owner as before.
  await colors.getByRole('radio', { name: 'Rot' }).click();
  await expect(colors.getByRole('radio', { name: 'Rot' })).toBeChecked();
});

test('workspace settings page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
  await page.goto(`${new URL(page.url()).pathname}/einstellungen`);
  await expect(page.getByRole('heading', { level: 1, name: 'Meine Organisation' })).toBeVisible();
  await expect(page).toHaveTitle('Einstellungen | Meine Organisation | Slider');
  await shot(page, 'workspace-settings');
});
