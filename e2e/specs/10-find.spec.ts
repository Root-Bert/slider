import { expect, openDeck, SAMPLE_SLIDES, shot, test, uploadSampleDeck } from '../support';

test('⌘F / Ctrl F searches the review and jumps to the hits (BER-176)', async ({ page }) => {
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  const counter = page.getByRole('textbox', { name: 'Aktuelle Folie, 1 bis 5' });
  await expect(counter).toHaveValue('1');

  await page.keyboard.press('ControlOrMeta+f');
  const find = page.getByRole('textbox', { name: 'In dieser Review suchen' });
  await expect(find).toBeFocused();

  // On the agenda (slide 2) and on slide 3 itself; typing jumps to the first hit.
  await find.fill('nach region');
  const status = page.locator('[data-find-bar] [role="status"]');
  await expect(status).toHaveText(/^1 von \d+$/);
  await expect(counter).toHaveValue('2');
  await expect(page.locator('[data-slide-id] [data-find-outline]')).toBeVisible();
  // Arrows typed in the field stay in it – no slide change.
  await find.press('ArrowRight');
  await expect(counter).toHaveValue('2');
  await shot(page, 'find-bar');

  // ↵ steps on until slide 3, ⇧↵ back.
  await expect
    .poll(async () => {
      await find.press('Enter');
      return counter.inputValue();
    })
    .toBe('3');
  await expect(page.getByRole('img', { name: SAMPLE_SLIDES[2] })).toBeInViewport();
  await find.press('Shift+Enter');
  await expect(counter).toHaveValue('2');

  // A comment hit opens its thread, as a click on its card does; the typing goes on in the bar.
  await find.fill('Vorstand');
  await expect(status).toHaveText(/^1 von \d+$/);
  await expect(page.locator('[data-thread-panel]')).toContainText('Vorstand');
  await expect(find).toBeFocused();
  await shot(page, 'find-bar-comment');

  await find.fill('gibt es nicht');
  await expect(status).toHaveText('Keine Treffer');
  await expect(page.locator('[data-find-outline]')).toHaveCount(0);

  await find.press('Escape');
  await expect(find).toHaveCount(0);
  // The viewer's keys work again.
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveValue('3');
});

test('the find bar fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  await page.keyboard.press('ControlOrMeta+f');
  const find = page.getByRole('textbox', { name: 'In dieser Review suchen' });
  await find.fill('Umsatz');
  const bar = page.locator('[data-find-bar]');
  const box = (await bar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await expect(page.getByRole('button', { name: 'Suche schließen (Esc)' })).toBeInViewport();
  await shot(page, 'find-bar-360');
});
