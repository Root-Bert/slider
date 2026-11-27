import { expect, sampleDeckFile, shot, test, uploadSampleDeck } from '../support';

test('the search finds slide text and opens the review at that slide (BER-175), the library its contents too, Cloud’s bar what is typed fast, ⌘K’s panel a typed command over any field, areas, a presentation file opened in Slider, the deck’s own commands, the agent’s toast, Abmelden, a click on a file its details', async ({
  page,
}) => {
  const deck = await uploadSampleDeck(page);
  // For ⌘K: an area, and a presentation lying in Cloud as a file.
  const area = await page.request.post(`/api/workspaces/${deck.workspaceId}/cloud/areas`, {
    data: { name: 'Vertrieb Nord', color: 'blue' },
  });
  expect(area.status()).toBe(201);
  const areaId = ((await area.json()) as { id: string }).id;
  const pptx = await page.request.post(
    `/api/workspaces/${deck.workspaceId}/cloud/files?name=${encodeURIComponent('Quartalszahlen.pptx')}`,
    { headers: { 'content-type': 'application/octet-stream' }, data: sampleDeckFile().buffer },
  );
  expect(pptx.status()).toBe(201);
  await page.goto('/slider');
  await expect(page.getByRole('heading', { level: 1, name: /Präsentationen/ })).toBeVisible();

  // Not in the title "slider-demo" – on the agenda (slide 2) and slide 3, "Umsatz nach Region".
  // By default only names are searched: nothing.
  const search = page.getByRole('searchbox', { name: 'Präsentationen durchsuchen' });
  await search.fill('nach region');
  await expect(page.getByText('slider-demo')).toHaveCount(0);
  // With slides and comments switched on, the deck shows with where it matched.
  await page.getByRole('button', { name: 'Auch Folien und Kommentare durchsuchen' }).click();
  await expect(search).toBeFocused();
  const link = page.locator(`a[href*="/d/${deck.id}?slide="]`);
  await expect(link).toBeVisible();
  const card = page.locator(`[data-select-id="${deck.id}"]`);
  await expect(card.getByRole('paragraph')).toContainText('Folie 2:');
  await expect(card.getByRole('paragraph')).toContainText('1 weiterer Treffer');
  await expect(card.locator('mark')).toHaveText('nach Region');
  await shot(page, 'search-content');

  // The library searches the same way: ⌘F (the page's own field), names by default, the button adds the contents –
  // here the Office font a Slider font stands in for.
  await page.getByRole('link', { name: 'Bibliothek' }).click();
  await page.getByRole('radio', { name: /^Schriften/ }).click();
  const library = page.getByRole('searchbox', { name: 'Bibliothek durchsuchen' });
  await page.keyboard.press('ControlOrMeta+f');
  await expect(library).toBeFocused();
  await library.fill('calibri');
  await expect(page.getByText('Carlito')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Auch ersetzte Schriften und Herkunft durchsuchen' })
    .click();
  await expect(page.getByText('Carlito').first()).toBeVisible();
  await shot(page, 'library-search-content');
  await page.goBack();

  await page.getByRole('searchbox', { name: 'Präsentationen durchsuchen' }).fill('nach region');
  await page.getByRole('button', { name: 'Auch Folien und Kommentare durchsuchen' }).click();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/d/${deck.id}\\?slide=`));
  await expect(page.getByRole('heading', { level: 1, name: 'slider-demo' })).toBeVisible();

  // Cloud's side bar – the whole app's search, ⇧⌘F – keeps every letter typed fast – the address
  // follows after (it lagged, and „Bericht“ became „t“); „Zurück“ ends the search.
  await page.goto('/');
  const bar = page.getByRole('searchbox', {
    name: 'Dateien, Bereiche, Chats, Personen und Mails suchen',
  });
  await expect(bar).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+f');
  await expect(bar).toBeFocused();
  await page.keyboard.type('Bericht', { delay: 0 });
  await expect(bar).toHaveValue('Bericht');
  await expect(page).toHaveURL(/suche=Bericht/);
  await page.goBack();
  await expect(bar).toHaveValue('');

  // ⌘K – the command panel, on every page: over a field typed into, Esc gives the field its caret
  // back and typing goes on there; the letters typed at once reach the panel's field, ↵ runs.
  await bar.click();
  await page.keyboard.type('Be');
  await page.keyboard.press('ControlOrMeta+k');
  const panel = page.getByRole('dialog', { name: 'Befehle' });
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.keyboard.type('richt');
  await expect(bar).toHaveValue('Bericht');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('entwürfe', { delay: 0 });
  await expect(panel.getByRole('textbox')).toHaveValue('entwürfe');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dateien\/entwuerfe$/);
  await expect(panel).toBeHidden();

  // Typed, the areas too (and the mails, as Cloud's search): an area opens in Cloud.
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('vertrieb');
  await expect(panel.getByText('Bereiche', { exact: true })).toBeVisible();
  await expect(panel.getByRole('option', { name: /Vertrieb Nord/ })).toBeVisible();
  await shot(page, 'command-panel-area');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/bereich/${areaId}$`));
  // A presentation among the files opens in Slider, made a presentation as Cloud's „Öffnen“ does.
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('quartalszahlen');
  await expect(panel.getByRole('option', { name: /Quartalszahlen/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/d\/[^/?]+/);
  await expect(panel).toBeHidden();

  // An open presentation lends its pill's commands: „Referentenansicht“ runs from ⌘K.
  await page.goto(`/d/${deck.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'slider-demo' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Präsentation', { exact: true })).toBeVisible();
  await expect(panel.getByRole('option', { name: /^Präsentieren/ })).toBeVisible();
  await page.keyboard.type('referentenansicht');
  await page.keyboard.press('Enter');
  const presenter = page.getByRole('dialog', { name: /^Referentenansicht/ });
  await expect(presenter).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(presenter).toBeHidden();

  // Given to the AI and closed before its agent is there: the page stays, a toast says it with
  // „Öffnen“. (No AI here: the order is answered as the server would, a moment later.)
  await page.goto('/konto');
  await expect(page.getByRole('region', { name: 'KI-Apps' })).toBeVisible();
  await page.route('**/cloud/agents', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({
      status: 201,
      json: {
        id: 'e2e-agent',
        title: 'Woche zusammenfassen',
        areaId: null,
        shared: false,
        running: true,
        updatedAt: new Date().toISOString(),
      },
    });
  });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(panel).toBeVisible();
  await page.keyboard.type('Fasse die Woche zusammen');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(panel.getByText('Die KI legt los …')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByText('Der Agent arbeitet daran.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Öffnen', exact: true })).toBeVisible();
  await shot(page, 'command-panel-agent-toast');
  await expect(page).toHaveURL(/\/konto$/);
  await page.unroute('**/cloud/agents');

  // One click on a file picks it and shows its details – never a toast, never opening; a file
  // Slider does not open offers the download there, and Enter downloads it, as the Finder opens.
  const uploaded = await page.request.post(
    `/api/workspaces/${deck.workspaceId}/cloud/files?name=${encodeURIComponent('Vision.key')}`,
    { headers: { 'content-type': 'application/octet-stream' }, data: Buffer.from('keynote') },
  );
  expect(uploaded.status()).toBe(201);
  await page.goto(`/w/${deck.workspaceId}/dateien/meine`);
  // Come to it from another page of Cloud: one Esc still ends details and pick together.
  await page.getByRole('link', { name: 'Entwürfe' }).click();
  await page.getByRole('link', { name: 'Dateien', exact: true }).click();
  // Its name without the ending, as „Dateiendungen zeigen“ is off by default.
  const key = page.getByRole('link', { name: 'Vision', exact: true });
  await key.click();
  const details = page.getByRole('complementary', { name: 'Details zu „Vision.key“' });
  const open = details.getByRole('button', { name: 'Öffnen', exact: true });
  await expect(open).toBeDisabled();
  await expect(open).toHaveAttribute('title', 'Office kann .key-Dateien nicht öffnen');
  await expect(key).toBeFocused();
  // The picked file is the selection: its actions stand in the toolbar's place, Esc ends both.
  await expect(page.locator('li[data-selected]')).toHaveCount(1);
  await expect(page.locator('[data-selection-bar]')).toContainText('1 ausgewählt');
  // Its details stand beside already: the bar offers no „Details“.
  await expect(
    page.locator('[data-selection-bar]').getByRole('button', { name: 'Details', exact: true }),
  ).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toBe('Vision.key');
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(page.locator('li[data-selected]')).toHaveCount(0);
  // Deleted right after the click, before its details came: they never ask for it (no 404).
  await key.click();
  await page.keyboard.press('Delete');
  await expect(key).toHaveCount(0);
  await expect(details).toHaveCount(0);

  // „Abmelden“ is a command too, last under „Konto“, as in the account menu.
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('abmelden');
  await expect(panel.getByText('Konto', { exact: true })).toBeVisible();
  const logout = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/auth/logout'),
  );
  await page.keyboard.press('Enter');
  expect((await (await logout).response())?.ok()).toBe(true);
});
