import { expect, sampleDeckFile, SAMPLE_SLIDES, shot, test } from '../support';

test('uploading a PPTX imports it and opens the viewer; its „Material“ lists and deletes', async ({
  page,
}) => {
  await page.goto('/slider');
  // „Neue Präsentation“ starts new ones, on a template; a file is dropped on the presentations.
  await page.getByRole('button', { name: 'Neue Präsentation' }).first().click();
  await expect(page).toHaveURL(/\/neu/);
  await expect(page.getByRole('heading', { level: 1, name: 'Neue Präsentation' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Ohne Vorlage' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Pop Art' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Datei auswählen' })).toHaveCount(0);
  await page.goBack();

  const sample = sampleDeckFile();
  const dataTransfer = await page.evaluateHandle(
    ({ name, mimeType, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: mimeType }));
      return transfer;
    },
    { name: sample.name, mimeType: sample.mimeType, base64: sample.buffer.toString('base64') },
  );
  await page.getByRole('main').dispatchEvent('drop', { dataTransfer });

  // The deck page shows the import, then the slides.
  await expect(page).toHaveURL(/\/d\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1, name: 'slider-demo' })).toBeVisible({
    timeout: 30_000,
  });
  const deckId = /\/d\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  // The overview holds the slides only; the last ones are reached through it.
  const overview = page.getByRole('navigation', { name: 'Folienübersicht' });
  const slideButtons = overview.getByRole('button');
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

  // Back on the home page the deck is listed.
  await page.getByRole('button', { name: 'Präsentation schließen' }).click();
  await expect(page).not.toHaveURL(/\/d\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Präsentationen');
  await expect(page.getByText('slider-demo').first()).toBeVisible();
  await shot(page, 'home-with-review');

  // „Material“ in its ⋯ menu: what was collected for it (here what an AI app put there), beside
  // the slides – a note unfolds in place, one's own is deleted after asking, Esc closes.
  for (const item of [
    { kind: 'box', text: 'Marktanteil\n\n40 % im Süden', url: null },
    { kind: 'link', text: 'Studie', url: 'https://example.com/studie' },
  ]) {
    const made = await page.request.post(`/api/decks/${deckId}/board/items`, {
      data: { id: crypto.randomUUID(), x: 0, y: 0, w: 360, h: 120, ...item },
    });
    expect(made.ok()).toBe(true);
  }
  // The card's ⋯ shows on hover; a right click opens the same menu.
  await page.getByRole('link', { name: 'slider-demo' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Material' }).click();
  await expect(page).toHaveURL(new RegExp(`/d/${deckId}$`));
  const material = page.locator('[data-material-panel]');
  const entries = material.locator('[data-material-entry]');
  await expect(entries).toHaveCount(2);
  await material.getByRole('button', { name: /^Marktanteil/ }).click();
  await expect(material).toContainText('40 % im Süden');
  // Unfolded without its first line again – the row shows it.
  await expect(material.getByText('Marktanteil', { exact: true })).toHaveCount(1);
  await shot(page, 'material');
  await material.getByRole('button', { name: '„Studie“ löschen' }).click();
  // Tab stays in the question, not pulled back into the panel behind it.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog').locator(':focus')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(entries).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(material).toHaveCount(0);
});
