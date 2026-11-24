import { expect, test } from '../support';

test('Sender: a message is formatted, answered with its quote, found from the side bar, the conversation takes a topic, „Aktuell“ opens without the AI and „Direkt“ filters by who', async ({
  page,
}) => {
  const [workspace] = (await (await page.request.get('/api/workspaces')).json()) as {
    id: string;
  }[];
  const home = (await (
    await page.request.get(`/api/workspaces/${workspace!.id}/sender`)
  ).json()) as {
    areas: { root: boolean; channels: { id: string; name: string }[] }[];
  };
  const chat = home.areas.find((area) => area.root)!.channels[0]!;

  await page.goto(`/w/${workspace!.id}/nachrichten/kanal/${chat.id}`);
  const field = page.getByPlaceholder(`Nachricht an ${chat.name}`);
  await field.fill('Aufbau **Montag** um `8 Uhr`\n- Banner\n- Kabel');
  await field.press('Enter');
  const sent = page.locator('[data-message]').last();
  await expect(sent.locator('strong')).toHaveText('Montag');
  await expect(sent.locator('code')).toHaveText('8 Uhr');
  await expect(sent.locator('li')).toHaveText(['Banner', 'Kabel']);

  // „Antworten“: the quote above the field, then above the answer – it survives a reload.
  await sent.hover();
  await sent.getByRole('button', { name: 'Antworten' }).click();
  await expect(page.getByRole('button', { name: 'Nicht antworten' })).toBeVisible();
  await field.fill('Ich bringe die Kabel');
  await field.press('Enter');
  await expect(page.getByRole('button', { name: 'Nicht antworten' })).toBeHidden();
  await page.reload();
  const answer = page.locator('[data-message]').last();
  await expect(answer).toContainText('Ich bringe die Kabel');
  await expect(answer).toContainText('Aufbau');

  // The topic: typed where it stands, under the name.
  await page.getByRole('button', { name: `Aktionen für ${chat.name}` }).click();
  await page.getByRole('menuitem', { name: 'Thema festlegen' }).click();
  await page.getByRole('textbox', { name: 'Thema' }).fill('Messe im März');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Messe im März', { exact: true })).toBeVisible();

  // The side bar's search finds the words in messages, and the hit opens the conversation.
  await page.goto(`/w/${workspace!.id}/nachrichten`);
  await page.getByPlaceholder('Suchen').first().fill('Kabel');
  const hit = page.getByRole('listitem').filter({ hasText: 'Ich bringe die Kabel' });
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/kanal/${chat.id}$`));

  // „Aktuell“ opens without the AI (none here); „Direkt“ is filtered by who it is with.
  await page.goto(`/w/${workspace!.id}/nachrichten`);
  await expect(page.getByRole('heading', { name: 'Aktuell' })).toBeVisible();
  const who = page.getByRole('radiogroup', { name: 'Direkt zeigen' });
  await who.getByRole('radio', { name: 'Agenten' }).click();
  await expect(page.getByText('Noch kein Agent.')).toBeVisible();
  await who.getByRole('radio', { name: 'Personen' }).click();
  await expect(page.getByText('Schreib jemandem aus dem Workspace.')).toBeVisible();
});
