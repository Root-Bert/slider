import { expect, shot, test } from '../support';

test('Writer keeps what is typed, and a comment on it takes replies and offers the AI', async ({
  page,
}) => {
  const [workspace] = (await (await page.request.get('/api/workspaces')).json()) as {
    id: string;
  }[];
  const made = await page.request.post('/api/documents', {
    data: { workspaceId: workspace!.id, title: 'Notiz', template: 'plain' },
  });
  expect(made.status()).toBe(201);
  const document = (await made.json()) as { id: string };

  await page.goto(`/t/${document.id}`);
  const first = page.locator('.writer-stack .writer-flow [data-p]').first();
  await first.click();
  await page.keyboard.type('Hallo Writer');
  type Opened = { content: { blocks: { id: string; runs?: { text: string }[] }[] } };
  // Saved is said by nothing (only offline is): the file holds the words.
  await expect
    .poll(async () => {
      const read = (await (
        await page.request.get(`/api/documents/${document.id}`)
      ).json()) as Opened;
      return read.content.blocks[0]?.runs?.map((run) => run.text).join('');
    })
    .toBe('Hallo Writer');
  const opened = (await (await page.request.get(`/api/documents/${document.id}`)).json()) as Opened;
  const commented = await page.request.post(`/api/documents/${document.id}/comments`, {
    data: {
      id: crypto.randomUUID(),
      parentId: null,
      body: 'Bitte freundlicher',
      anchor: { paragraphId: opened.content.blocks[0]!.id, start: 0, end: 5, quote: 'Hallo' },
    },
  });
  expect(commented.status()).toBe(201);

  await page.reload();
  await expect(page.locator('.writer-stack .writer-flow [data-p]').first()).toHaveText(
    'Hallo Writer',
  );
  await page.locator('[data-thread]').first().click();
  // A combobox, as on a slide: it suggests people after `@`.
  const reply = page.getByRole('combobox', { name: 'Antwort senden' });
  await reply.fill('Mach das bitte');
  // Offered, not asked: the instance's AI is not part of this suite.
  await expect(
    page.getByRole('button', { name: 'Senden und die KI den Text ändern lassen' }),
  ).toBeEnabled();
  await reply.press('Enter');
  await expect(page.getByText('Mach das bitte')).toBeVisible();
  await expect(page.locator('[data-ai-proposal]')).toHaveCount(0);
  await shot(page, 'writer-comment');

  // „Seitenfarbe“: dark sheets at once, and still so after a reload.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Seitenfarbe/ }).click();
  await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
  await expect(page.locator('[data-pages]')).toHaveAttribute('data-pages', 'dark');
  await page.reload();
  await expect(page.locator('[data-pages]')).toHaveAttribute('data-pages', 'dark');
});
