import { expect, openDeck, SAMPLE_SLIDES, shot, test, uploadSampleDeck } from '../support';

test('slides can be navigated with the keyboard', async ({ page }) => {
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  const counter = page.getByRole('textbox', { name: 'Aktuelle Folie, 1 bis 5' });
  const slideParam = async () => new URL(page.url()).searchParams.get('slide');
  await expect(counter).toHaveValue('1');

  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveValue('2');
  await expect(page.getByText('Folie 2 von 5', { exact: true })).toBeAttached();
  const second = await slideParam();

  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveValue('3');
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveValue('2');
  await expect.poll(slideParam).toBe(second);

  await page.keyboard.press('End');
  await expect(counter).toHaveValue('5');
  await expect(page.getByRole('img', { name: SAMPLE_SLIDES[4] })).toBeInViewport();
  // Past the last slide nothing happens.
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveValue('5');

  await page.keyboard.press('Home');
  await expect(counter).toHaveValue('1');
  await expect(page.getByRole('img', { name: SAMPLE_SLIDES[0] })).toBeInViewport();

  // Typing a number into the counter jumps there.
  await counter.fill('4');
  await counter.press('Enter');
  await expect(counter).toHaveValue('4');
  await expect(page.getByRole('img', { name: SAMPLE_SLIDES[3] })).toBeInViewport();
});

test('the viewer works at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  await expect(page.getByRole('img', { name: SAMPLE_SLIDES[0] })).toBeInViewport();
  await shot(page, 'viewer-375');
});
