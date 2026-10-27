import { expect, shot, test, uploadSampleDeck } from '../support';

test('the search finds slide text and opens the review at that slide (BER-175)', async ({
  page,
}) => {
  const deck = await uploadSampleDeck(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Reviews' })).toBeVisible();

  // Not in the title "slider-demo" – on the agenda (slide 2) and slide 3, "Umsatz nach Region".
  // By default only names are searched: nothing.
  const search = page.getByRole('searchbox', { name: 'Reviews durchsuchen' });
  await search.fill('nach region');
  await expect(page.getByText('slider-demo')).toHaveCount(0);
  // With slides and comments switched on, the deck shows with where it matched.
  await page.getByRole('button', { name: 'Auch Folien und Kommentare durchsuchen' }).click();
  await expect(search).toBeFocused();
  const link = page.locator(`a[href*="/d/${deck.id}?slide="]`);
  await expect(link).toBeVisible();
  const card = page.locator(`[data-deck-id="${deck.id}"]`);
  await expect(card.getByRole('paragraph')).toContainText('Folie 2:');
  await expect(card.getByRole('paragraph')).toContainText('1 weiterer Treffer');
  await expect(card.locator('mark')).toHaveText('nach Region');
  await shot(page, 'search-content');

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/d/${deck.id}\\?slide=`));
  await expect(page.getByRole('heading', { level: 1, name: 'slider-demo' })).toBeVisible();
});
