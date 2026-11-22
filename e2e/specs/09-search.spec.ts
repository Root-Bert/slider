import { expect, shot, test, uploadSampleDeck } from '../support';

test('the search finds slide text and opens the review at that slide (BER-175), the library its contents too, Cloud’s bar what is typed fast, a click on a file its details', async ({
  page,
}) => {
  const deck = await uploadSampleDeck(page);
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

  // The library searches the same way: ⌘F, names by default, the button adds the contents –
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

  // Cloud's side bar keeps every letter typed fast – the address follows after (it lagged, and
  // „Bericht“ became „t“); „Zurück“ ends the search.
  await page.goto('/');
  const bar = page.getByRole('searchbox', { name: 'Dateien, Bereiche, Chats und Personen suchen' });
  await bar.click();
  await page.keyboard.type('Bericht', { delay: 0 });
  await expect(bar).toHaveValue('Bericht');
  await expect(page).toHaveURL(/suche=Bericht/);
  await page.goBack();
  await expect(bar).toHaveValue('');

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
  await page.getByRole('link', { name: 'Meine Dateien' }).click();
  const key = page.getByRole('link', { name: 'Vision.key' });
  await key.click();
  const details = page.getByRole('complementary', { name: 'Details zu „Vision.key“' });
  const open = details.getByRole('button', { name: 'Öffnen', exact: true });
  await expect(open).toBeDisabled();
  await expect(open).toHaveAttribute('title', 'Slider kann .key-Dateien nicht öffnen');
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
});
