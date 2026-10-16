import { expect, shot, test } from '../support';

test.describe('Reviews home', () => {
  test('opens the personal workspace with an empty review list', async ({ page }) => {
    await page.goto('/');
    // `/` forwards to the last (here: the only) workspace.
    await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Reviews' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Konto: Robert Hofmann' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Noch keine Reviews' })).toBeVisible();
    await expect(page).toHaveTitle(/Slider/);
    await shot(page, 'home');
  });

  test('works at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Reviews' })).toBeVisible();
    // The toolbar button (icon only at this width) and the empty state's button.
    await expect(page.getByRole('button', { name: 'Neue Review' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Neue Review' }).first()).toBeVisible();
    // Nothing sticks out sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, 'home-375');
  });
});
