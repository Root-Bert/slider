import { expect, shot, test, uploadSampleDeck } from '../support';

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

  test('a box dragged over empty space selects the decks it touches', async ({ page }) => {
    const deck = await uploadSampleDeck(page);
    await page.goto('/');
    const card = page.locator(`[data-deck-id="${deck.id}"]`);
    await expect(card).toBeVisible();
    const rect = (await card.boundingBox())!;

    // From the empty space above and left of the card onto its middle.
    await page.mouse.move(rect.x - 12, rect.y - 12);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 8 });
    const box = page.locator('[data-selection-box]');
    await expect(box).toBeVisible();
    const drawn = (await box.boundingBox())!;
    expect(drawn.width).toBeCloseTo(rect.width / 2 + 12, 0);
    expect(drawn.height).toBeCloseTo(rect.height / 2 + 12, 0);
    await page.mouse.up();

    await expect(box).toHaveCount(0);
    await expect(page.getByText('1 ausgewählt')).toBeVisible();
  });
});
