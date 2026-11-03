import { expect, openDeck, SAMPLE_SLIDES, test, uploadSampleDeck } from '../support';

test('Space twice takes a zoomed slide to 100 % and back', async ({ page }) => {
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  const slide = page.getByRole('img', { name: SAMPLE_SLIDES[0] });
  await expect(slide).toBeInViewport();
  const box = (await slide.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Zoomed out by the wheel, Ctrl held.
  await page.keyboard.down('Control');
  for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, 120);
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
  for (let i = 0; i < 2; i += 1) await page.mouse.wheel(0, 120);
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
