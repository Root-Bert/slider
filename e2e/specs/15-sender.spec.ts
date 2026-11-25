import { expect, test } from '../support';

test('Sender: a message is formatted, answered with its quote, found from the side bar, a message is planned for later, files are dropped on it, the conversation takes a topic, „Aktuell“ opens without the AI, „Direkt“ filters by who and files dropped on a chat row in Cloud open it with them', async ({
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
  // The field shows the formatting as it is typed (`RichField`); Markdown put in goes out as it is.
  const field = page.getByRole('combobox', { name: 'Nachricht' });
  await expect(field).toHaveAttribute('aria-placeholder', `Nachricht an ${chat.name}`);
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
  // Typed Markdown turns into its formatting at once; ⌘B formats too.
  await field.pressSequentially('Ich bringe die **Kabel** ');
  await expect(field.locator('strong, .font-semibold')).toHaveText('Kabel');
  await field.press('ControlOrMeta+b');
  await field.pressSequentially('mit');
  await field.press('Enter');
  await expect(page.getByRole('button', { name: 'Nicht antworten' })).toBeHidden();
  await page.reload();
  const answer = page.locator('[data-message]').last();
  await expect(answer).toContainText('Ich bringe die Kabel mit');
  await expect(answer.locator('strong')).toHaveText(['Kabel', 'mit']);
  await expect(answer).toContainText('Aufbau');

  // „Später senden“ (right click on „Senden“): above the field until sent, not in the
  // conversation; „Bearbeiten“ puts it back into the field.
  await field.fill('Erinnerung an die Kabel');
  await page.getByRole('button', { name: 'Senden', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Morgen um 9:00' }).click();
  const planned = page.getByRole('list', { name: 'Geplante Nachrichten' });
  await expect(planned).toContainText('Geht morgen um 9:00');
  await expect(field).toHaveText('');
  await expect(page.locator('[data-message]').last()).not.toContainText('Erinnerung');
  await planned.getByRole('button', { name: 'Bearbeiten' }).click();
  await expect(field).toHaveText('Erinnerung an die Kabel');
  await expect(planned).toBeHidden();
  await field.fill('');

  // Files from the computer dropped anywhere on the conversation – or right on the field – go on
  // the message, each once; the hint shows while they hover.
  const filesOf = (...names: string[]) =>
    page.evaluateHandle((names) => {
      const data = new DataTransfer();
      for (const name of names) data.items.add(new File(['Hallo'], name, { type: 'text/plain' }));
      return data;
    }, names);
  const list = page.locator('[data-message]').first();
  const plan = await filesOf('Aufbauplan.txt');
  await list.dispatchEvent('dragover', { dataTransfer: plan });
  await expect(page.getByText('Zum Anhängen loslassen')).toBeVisible();
  await list.dispatchEvent('drop', { dataTransfer: plan });
  await expect(page.getByText('Zum Anhängen loslassen')).toBeHidden();
  await field.dispatchEvent('drop', { dataTransfer: await filesOf('Notizen.txt') });
  const form = page.getByRole('form', { name: 'Nachricht schreiben' });
  await expect(form.getByText('Aufbauplan.txt')).toHaveCount(1);
  await expect(form.getByText('Notizen.txt')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Senden', exact: true })).toBeEnabled();
  await field.press('Enter');
  await expect(page.locator('[data-message]').last()).toContainText('Aufbauplan.txt');
  await expect(page.locator('[data-message]').last()).toContainText('Notizen.txt');

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

  // Dropped on a chat's row in Cloud's side bar: the chat opens with them on the message.
  const made = await page.request.post(`/api/workspaces/${workspace!.id}/cloud/agents/own`);
  // An agent needs an AI connection (409 `ai_not_configured` without one, as in CI): this part
  // runs where one is set up (a key in `.env`).
  if (made.status() === 409) return;
  const agent = (await made.json()) as { id: string };
  await page.request.post(`/api/cloud/agents/${agent.id}/messages`, { data: { text: 'Hallo' } });
  await page.goto(`/w/${workspace!.id}/dateien`);
  const row = page.getByRole('navigation', { name: 'Cloud' }).locator(`a[href$="${agent.id}"]`);
  await row.dispatchEvent('drop', { dataTransfer: await filesOf('Rechnung.txt') });
  await expect(
    page.getByRole('form', { name: 'Nachricht an den Agenten' }).getByText('Rechnung.txt'),
  ).toHaveCount(1);
});
