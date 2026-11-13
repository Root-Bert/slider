import { expect, shot, test, uploadSampleDeck } from '../support';

test('the search finds slide text and opens the review at that slide (BER-175), the library its contents too', async ({
  page,
}) => {
  const deck = await uploadSampleDeck(page);
  await page.goto('/');
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

  // The library searches the same way: ⌘K, names by default, the button adds the contents –
  // here the Office font a Slider font stands in for.
  await page.getByRole('link', { name: 'Bibliothek' }).click();
  await page.getByRole('radio', { name: /^Schriften/ }).click();
  const library = page.getByRole('searchbox', { name: 'Bibliothek durchsuchen' });
  await page.keyboard.press('ControlOrMeta+k');
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
});
