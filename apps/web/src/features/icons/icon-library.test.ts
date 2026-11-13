import { expect, it, vi } from 'vitest';
import { loadIconLibrary, searchIcons } from './icon-library';
import carbon from './sets/carbon-pictograms.json?raw';
import phosphor from './sets/phosphor.json?raw';

it('searches the sets in German and English, best first, and a German word only as itself or inflected', async () => {
  // The sets as the page fetches them (`?url`).
  vi.stubGlobal('fetch', (url: string) =>
    Promise.resolve(new Response(url.includes('phosphor') ? phosphor : carbon)),
  );
  const { icons } = await loadIconLibrary();
  const ids = (query: string) => searchIcons(icons, query).map((icon) => icon.id);

  expect(ids('pfeil')[0]).toMatch(/^phosphor\/arrow-/);
  expect(ids('pfeile')).toEqual(ids('pfeil'));
  expect(ids('pfe')).toEqual(expect.arrayContaining(ids('pfeil')));
  expect(ids('geld').slice(0, 2)).toEqual(['phosphor/coins', 'phosphor/money']);
  expect(ids('auto')[0]).toBe('phosphor/car');
  expect(ids('uhr')[0]).toBe('phosphor/clock');
  expect(ids('menschen')).toContain('phosphor/users');
  // A longer word is not a short key's: `kinder` not `ki`, `zahlung` not `zahl`, `handy` not
  // `hand`, `kopfhörer` not `kopf`.
  expect(ids('kinder')[0]).toBe('phosphor/baby');
  expect(ids('kinder').some((id) => /robot|brain|\/ai/.test(id))).toBe(false);
  expect(ids('zahlung')).toContain('phosphor/credit-card');
  expect(ids('zahlung').some((id) => id.includes('number-'))).toBe(false);
  expect(ids('handy')).toContain('phosphor/device-mobile');
  expect(ids('handy')).not.toContain('phosphor/hand');
  expect(ids('kopfhörer')[0]).toBe('phosphor/headphones');
  expect(ids('kopfhörer')).not.toContain('phosphor/brain');
  // Empty: all of the kind picked, as the sets order them.
  const pictograms = searchIcons(icons, '', 'pictograms');
  expect(pictograms.length).toBeGreaterThan(0);
  expect(pictograms.every((icon) => icon.kind === 'pictograms')).toBe(true);
  vi.unstubAllGlobals();
});
