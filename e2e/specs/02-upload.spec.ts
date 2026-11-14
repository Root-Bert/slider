import { expect, sampleDeckFile, SAMPLE_SLIDES, shot, test } from '../support';

test('uploading a PPTX imports it and opens the viewer', async ({ page }) => {
  await page.goto('/');
  // The toolbar button; the empty list offers a second one.
  await page.getByRole('button', { name: 'Neue Präsentation' }).first().click();
  await expect(page).toHaveURL(/\/neu/);
  await expect(page.getByRole('heading', { level: 1, name: 'Neue Präsentation' })).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Datei auswählen' }).click();
  await (await chooser).setFiles(sampleDeckFile());

  // The deck page shows the import, then the slides.
  await expect(page).toHaveURL(/\/d\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1, name: 'slider-demo' })).toBeVisible({
    timeout: 30_000,
  });
  // The material tile sits left of the slides; the last ones are reached through the overview.
  const overview = page.getByRole('navigation', { name: 'Folienübersicht' });
  await expect(overview.getByRole('button', { name: 'Material anzeigen' })).toBeVisible();
  const slideButtons = overview.locator('button:not([data-board-thumb])');
  await expect(slideButtons).toHaveCount(5);
  for (const [index, title] of SAMPLE_SLIDES.entries()) {
    await slideButtons.nth(index).click();
    await expect(
      page.getByRole('group', { name: `Folie ${index + 1} von 5: ${title}` }),
    ).toBeVisible();
  }
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

  // On the material board a note drawn is written in a comment's composer, then a comment's card: a
  // press on its buttons keeps the note typed (not the board's focus) – „Abbrechen“ drops it,
  // „Senden“ keeps it.
  await overview.getByRole('button', { name: 'Material anzeigen' }).click();
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  const send = page.getByRole('form', { name: 'Notiz' });
  for (const [label, kept] of [
    ['Abbrechen', 0],
    ['Senden', 1],
  ] as const) {
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(320, 260, { steps: 5 });
    await page.mouse.move(440, 330, { steps: 5 });
    await page.mouse.up();
    await expect(send).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Notiz' })).toBeFocused();
    await page.keyboard.type(`Notiz ${label}`);
    // A press as a hand does it: a locator's click scrolls the clipped node into view first.
    const button = (await send.locator('button', { hasText: label }).boundingBox())!;
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    await expect(send).toBeHidden();
    await expect(page.locator('[data-note]').filter({ hasText: `Notiz ${label}` })).toHaveCount(
      kept,
    );
  }
  // Under the note a reply is written as under a comment (↵, the AI not asked), its thread folded
  // and opened again.
  const kept = page.locator('[data-note]').filter({ hasText: 'Notiz Senden' });
  const card = (await kept.locator('article').first().boundingBox())!;
  await page.mouse.move(card.x + 40, card.y + 20);
  const field = kept.getByRole('textbox', { name: 'Antwort' });
  await expect(field).toBeVisible();
  const at = (await field.boundingBox())!;
  await page.mouse.click(at.x + 20, at.y + at.height / 2);
  await page.keyboard.type('Passt so');
  await page.keyboard.press('Enter');
  const reply = kept.locator('[data-note-reply]').filter({ hasText: 'Passt so' });
  await expect(reply).toBeVisible();
  await kept.getByRole('button', { name: 'Zuklappen' }).click();
  await expect(reply).toBeHidden();
  await expect(kept.getByText('1 Antwort')).toBeVisible();
  await kept.getByRole('button', { name: 'Aufklappen' }).click();
  await expect(reply).toBeVisible();
  // Two fingers move the surface every way, sideways too.
  const viewport = page.locator('.react-flow__viewport');
  const before = await viewport.getAttribute('style');
  await page.mouse.move(1000, 600);
  await page.mouse.wheel(150, 0);
  await expect
    .poll(async () => (await viewport.getAttribute('style'))?.match(/translate\(([-\d.]+)px/)?.[1])
    .not.toBe(before?.match(/translate\(([-\d.]+)px/)?.[1]);
  await page.getByRole('button', { name: 'Zur Präsentation' }).click();

  // Back on the home page the deck is listed.
  await page.getByRole('button', { name: 'Präsentation schließen' }).click();
  await expect(page).not.toHaveURL(/\/d\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Präsentationen');
  await expect(page.getByText('slider-demo').first()).toBeVisible();
  await shot(page, 'home-with-review');
});
