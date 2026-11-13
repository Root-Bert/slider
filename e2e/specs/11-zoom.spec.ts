import type { Page } from '@playwright/test';
import { expect, openDeck, SAMPLE_SLIDES, shot, test, uploadSampleDeck } from '../support';

test('Space twice takes a zoomed slide to 100 % and back', async ({ page }) => {
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  const slide = page.getByRole('img', { name: SAMPLE_SLIDES[0] });
  await expect(slide).toBeInViewport();

  // The live split and its virtual window settle in the same frame, also on a fast release.
  const handle = page.getByRole('separator', { name: 'Größe von Folien und Kommentarbereich' });
  const group = page.getByRole('group', { name: /^Folie 1 von 5/ });
  const originalH = (await group.boundingBox())!.height;
  await handle.focus();
  await handle.press('ArrowDown');
  await expect.poll(async () => (await group.boundingBox())!.height).toBe(originalH + 24);
  await handle.press('ArrowUp');
  await expect.poll(async () => (await group.boundingBox())!.height).toBe(originalH);
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 80, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await group.boundingBox())!.height).toBe(originalH + 80);
  await expect(page.getByRole('textbox', { name: 'Aktuelle Folie, 1 bis 5' })).toHaveValue('1');
  await expect(slide).toBeInViewport();
  await shot(page, 'timeline-resize');
  await handle.press('Enter');
  await expect.poll(async () => (await group.boundingBox())!.height).toBe(originalH);
  const box = (await slide.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Zoomed out by the wheel, Ctrl held.
  await page.keyboard.down('Control');
  for (let i = 0; i < 3; i += 1) await zoomWheel(page);
  await page.keyboard.up('Control');
  const chip = page.getByRole('button', { name: /^Zoom \d+ %/ });
  await expect(chip).toBeVisible();
  const zoomed = await chip.textContent();

  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await expect(chip).toBeHidden();

  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(zoomed!);
});

test('Space twice goes back to the zoom however the slide came to 100 %', async ({ page }) => {
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  const slide = page.getByRole('img', { name: SAMPLE_SLIDES[0] });
  await expect(slide).toBeInViewport();
  const box = (await slide.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  for (let i = 0; i < 2; i += 1) await zoomWheel(page);
  await page.keyboard.up('Control');
  const chip = page.getByRole('button', { name: /^Zoom \d+ %/ });
  const zoomed = await chip.textContent();
  // Back to 100 % by its chip.
  await chip.click();
  await expect(chip).toBeHidden();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await expect(chip).toHaveText(zoomed!);
});

/** WebKit can deliver the wheel and its coalesced zoom after mouse.wheel() resolves. */
async function zoomWheel(page: Page) {
  await Promise.all([
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.addEventListener('wheel', () => requestAnimationFrame(() => resolve()), {
            once: true,
          });
        }),
    ),
    page.mouse.wheel(0, 120),
  ]);
}
