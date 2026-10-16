import { expect, openDeck, shot, test, uploadSampleDeck } from '../support';

test('comment, reply and resolve – all of it survives a reload', async ({ page }) => {
  const deck = await uploadSampleDeck(page);
  await openDeck(page, deck.id);
  const comments = page.getByRole('region', { name: 'Kommentare' });
  const text = 'E2E: Bitte die Zahlen prüfen';
  const reply = 'E2E: Erledige ich bis Freitag';

  // New comment on slide 3 (box mode: a click on the slide comments on the box under it).
  await page.getByRole('img', { name: 'Umsatz nach Region' }).click({ position: { x: 30, y: 30 } });
  const composer = page.getByRole('textbox', { name: 'Kommentar', exact: true });
  await expect(composer).toBeVisible();
  await composer.fill(text);
  await page.getByRole('button', { name: /^Senden/ }).click();
  await expect(composer).toBeHidden();
  const card = comments.getByRole('article').filter({ hasText: text });
  await expect(card).toBeVisible();

  // Reply in the thread panel.
  await card.getByRole('button', { name: 'Thread von Robert Hofmann öffnen' }).click();
  const thread = page.getByRole('complementary', { name: 'Thread · Folie 3' });
  await expect(thread).toBeVisible();
  const replyField = thread.getByRole('textbox', { name: 'Antwort an Robert Hofmann' });
  await expect(replyField).toBeVisible();
  await replyField.fill(reply);
  await replyField.press('Enter');
  await expect(thread.getByRole('list', { name: 'Antworten' }).getByText(reply)).toBeVisible();
  await shot(page, 'comment-thread');

  // Resolve the thread.
  await thread.getByRole('button', { name: 'Als erledigt markieren' }).click();
  await expect(thread.getByRole('button', { name: 'Wieder öffnen' })).toBeVisible();

  // Wait for the server, then reload.
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/decks/${deck.id}/comments`);
      const list = (await res.json()) as {
        body: string;
        status: string;
        parentId?: string | null;
      }[];
      return list.find((c) => c.body === text)?.status;
    })
    .toBe('done');
  await page.reload();
  await expect(page.getByRole('group', { name: /^Folie 1 von 5/ })).toBeVisible();

  await page.getByRole('radio', { name: /^Erledigt/ }).click();
  const doneCard = comments.getByRole('article').filter({ hasText: text });
  await expect(doneCard).toBeVisible();
  await doneCard.getByRole('button', { name: 'Thread von Robert Hofmann öffnen' }).click();
  await expect(thread.getByRole('list', { name: 'Antworten' }).getByText(reply)).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Wieder öffnen' })).toBeVisible();
  await shot(page, 'comment-after-reload');
});
