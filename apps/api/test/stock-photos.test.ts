import { describe, expect, it } from 'vitest';
import type { StockPhotoRecord } from '../src/db/schema';
import type { AppDeps } from '../src/deps';
import { randomPhotos, searchPhotos, type StockPhotoSource } from '../src/services/stock-photos';
import { TestClock, testConfig } from './helpers';

const record = (id: string): StockPhotoRecord => ({
  id,
  description: null,
  width: 4000,
  height: 3000,
  color: '#888888',
  thumbUrl: `https://images.unsplash.com/${id}?w=400`,
  rawUrl: `https://images.unsplash.com/${id}`,
  credit: {
    name: 'Jo',
    profileUrl: 'https://unsplash.com/@jo',
    photoUrl: 'https://unsplash.com/photos/x',
  },
  downloadLocation: `https://api.unsplash.com/photos/${id}/download`,
});

/** A fake Unsplash that counts its calls for random photos. */
function fakeSource() {
  const calls: { count: number }[] = [];
  const source: StockPhotoSource = {
    search: async () => [],
    random: async ({ count }) => {
      calls.push({ count });
      return Array.from({ length: count }, (_, i) => record(`r${calls.length}-${i}`));
    },
    photo: async () => null,
    picture: async () => new Uint8Array(),
    track: async () => {},
  };
  return { source, calls };
}

describe('stock photos', () => {
  it('at random and searched cost Unsplash one call each, asked twice at once too, a failed search asked again', async () => {
    {
      const { source, calls } = fakeSource();
      const clock = new TestClock();
      // Its own count: the cache is the module's, shared with other tests.
      const deps = { config: testConfig(), stockPhotos: source, clock } as unknown as AppDeps;

      const first = await randomPhotos(deps, 'w', { count: 7 });
      expect(first).toHaveLength(7);
      expect(await randomPhotos(deps, 'w', { count: 7 })).toEqual(first);
      expect(calls).toHaveLength(1);

      clock.advance(16 * 60_000);
      const later = await randomPhotos(deps, 'w', { count: 7 });
      expect(calls).toHaveLength(2);
      expect(later[0]?.id).not.toBe(first[0]?.id);
    }
    {
      const asked: string[] = [];
      let failing = true;
      const source: StockPhotoSource = {
        search: async (query) => {
          asked.push(query);
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (query === 'kaputt' && failing) throw new Error('Unsplash ist weg');
          return [record(`${query}-${asked.length}`)];
        },
        random: async () => [],
        photo: async () => null,
        picture: async () => new Uint8Array(),
        track: async () => {},
      };
      const deps = {
        config: testConfig(),
        stockPhotos: source,
        clock: new TestClock(),
      } as unknown as AppDeps;

      const [first, again] = await Promise.all([
        searchPhotos(deps, 'w', 'Leuchtturm'),
        searchPhotos(deps, 'w', ' leuchtturm '),
      ]);
      expect(again).toBe(first);
      expect(asked).toEqual(['Leuchtturm']);

      await expect(searchPhotos(deps, 'w', 'kaputt')).rejects.toThrow('Unsplash ist weg');
      failing = false;
      expect(await searchPhotos(deps, 'w', 'kaputt')).toHaveLength(1);
      expect(asked).toEqual(['Leuchtturm', 'kaputt', 'kaputt']);
    }
  });
});
