import { expect, sampleDeckFile, SAMPLE_SLIDES, shot, test } from '../support';

test('uploading a PPTX imports it and opens the viewer', async ({ page }) => {
  await page.goto('/');
  // The toolbar button; the empty review list offers a second one.
  await page.getByRole('button', { name: 'Neue Review' }).first().click();
  await expect(page).toHaveURL(/\/neu/);
  await expect(page.getByRole('heading', { level: 1, name: 'Neue Review' })).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Datei auswählen' }).click();
  await (await chooser).setFiles(sampleDeckFile());

  // The deck page shows the import, then the slides.
  await expect(page).toHaveURL(/\/d\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1, name: 'slider-demo' })).toBeVisible({
    timeout: 30_000,
  });
  for (const [index, title] of SAMPLE_SLIDES.entries()) {
    await expect(
      page.getByRole('group', { name: `Folie ${index + 1} von 5: ${title}` }),
    ).toBeVisible();
  }
  const overview = page.getByRole('navigation', { name: 'Folienübersicht' });
  await expect(overview.getByRole('button')).toHaveCount(5);
  // Comments that came with the PowerPoint file.
  await expect(
    page.getByRole('region', { name: 'Kommentare' }).getByRole('article').first(),
  ).toBeVisible();
  // The slide image actually rendered (SVG preview without LibreOffice).
  const firstSlide = page.getByRole('img', { name: SAMPLE_SLIDES[0] });
  await expect(firstSlide).toBeVisible();
  const box = await firstSlide.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(100);
  await expect
    .poll(() => firstSlide.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  await shot(page, 'viewer');

  // The minimap folds away and comes back (remembered per browser).
  await page.getByRole('button', { name: 'Folienübersicht ausblenden' }).click();
  await expect(overview).toBeHidden();
  await shot(page, 'viewer-no-minimap');
  await page.getByRole('button', { name: 'Folienübersicht einblenden' }).click();
  await expect(overview).toBeVisible();

  // Back on the home page the review is listed.
  await page.getByRole('button', { name: 'Review schließen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reviews' })).toBeVisible();
  await expect(page.getByText('slider-demo').first()).toBeVisible();
  await shot(page, 'home-with-review');
});
