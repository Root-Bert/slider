import { expect, openDeck, SAMPLE_SLIDES, test, uploadSampleDeck } from '../support';

// Only in bundle mode (`bun run e2e:bundle`): the service worker is registered by production
// builds alone – under the Vite dev server it would stand in the way of its reloads.
test.skip(!process.env.E2E_BUNDLE, 'needs the production build served by the API');

// Without a connection the browser reports every request it cannot make (the live stream too).
// Wrapped once more: a fixture given an array takes it as `[value, options]`.
test.use({
  allowConsoleErrors: [[/ERR_INTERNET_DISCONNECTED/, /Failed to load resource/], { scope: 'test' }],
});

test('a deck opened once opens again offline, its slides drawn, comments written meanwhile sent once back', async ({
  page,
  context,
}) => {
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  // Its pictures loaded, and the service worker in charge of the page (it keeps what it loads).
  const firstSlide = page.getByRole('img', { name: SAMPLE_SLIDES[0] });
  await expect
    .poll(() => firstSlide.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  // Loaded once more under the service worker: now it has kept everything the viewer loads.
  await openDeck(page, deck.id);
  await expect
    .poll(() => firstSlide.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('group', { name: `Folie 1 von 5: ${SAMPLE_SLIDES[0]}` }),
  ).toBeVisible();
  await expect
    .poll(() => firstSlide.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);

  // Commented offline (BER-164): a comment and a reply to it show at once, pending, are still
  // there after a reload without a connection, and are saved once each when it is back.
  const text = 'E2E: offline geschrieben';
  const reply = 'E2E: offline beantwortet';
  const comments = page.getByRole('region', { name: 'Kommentare' });
  await firstSlide.click({ position: { x: 30, y: 30 } });
  const composer = page.getByRole('combobox', { name: 'Kommentar', exact: true });
  await composer.fill(text);
  await page.getByRole('button', { name: /^Senden/ }).click();
  await expect(composer).toBeHidden();
  const card = comments.getByRole('article').filter({ hasText: text });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Thread von Robert Hofmann öffnen' }).click();
  const thread = page.getByRole('complementary', { name: 'Thread | Folie 1' });
  const replyField = thread.getByRole('combobox', { name: 'Antwort an Robert Hofmann' });
  await replyField.fill(reply);
  await replyField.press('Enter');
  const replies = thread.getByRole('list', { name: 'Antworten' });
  await expect(replies.getByText(reply)).toBeVisible();
  await page.reload();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('aria-busy', 'true');
  await card.getByRole('button', { name: 'Thread von Robert Hofmann öffnen' }).click();
  await expect(replies.getByText(reply)).toBeVisible();

  await context.setOffline(false);
  const saved = async () => {
    const res = await page.request.get(`/api/decks/${deck.id}/comments`);
    const list = (await res.json()) as { body: string; parentId: string | null }[];
    return list.filter((comment) => comment.body === text || comment.body === reply).length;
  };
  await expect.poll(saved).toBe(2);
  await expect(card).not.toHaveAttribute('aria-busy', 'true');
  // Once: nothing is sent again by a later reload.
  await page.reload();
  await expect(card).toBeVisible();
  expect(await saved()).toBe(2);
});
