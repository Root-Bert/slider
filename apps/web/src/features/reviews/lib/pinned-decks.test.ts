import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';

const KEY = 'slider.reviews.pinned.v1';

// The store is module-level: every test loads a fresh copy.
const load = () => import('./pinned-decks');

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('pinned decks', () => {
  it('pins in order, idempotently, up to the limit', async () => {
    const { values } = stubStorage();
    const { MAX_PINNED, pinDeck, pinnedDecksStore } = await load();
    expect(MAX_PINNED).toBe(3);
    expect(pinDeck('a')).toBe(true);
    expect(pinDeck('a')).toBe(true);
    expect(pinDeck('b')).toBe(true);
    expect(pinDeck('c')).toBe(true);
    expect(pinDeck('d')).toBe(false);
    expect(pinnedDecksStore.getSnapshot()).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(values.get(KEY)!)).toEqual(['a', 'b', 'c']);
  });

  it('unpins, and writes nothing for a deck that was not pinned', async () => {
    const { setItem } = stubStorage({ [KEY]: '["a","b"]' });
    const { pinnedDecksStore, unpinDeck } = await load();
    unpinDeck('x');
    expect(setItem).not.toHaveBeenCalled();
    unpinDeck('a');
    expect(pinnedDecksStore.getSnapshot()).toEqual(['b']);
  });

  it('prunes pins of decks that are gone, and only then writes', async () => {
    const { setItem } = stubStorage({ [KEY]: '["a","b"]' });
    const { pinnedDecksStore, prunePinnedDecks } = await load();
    prunePinnedDecks(new Set(['a', 'b', 'c']));
    expect(setItem).not.toHaveBeenCalled();
    prunePinnedDecks(new Set(['b']));
    expect(pinnedDecksStore.getSnapshot()).toEqual(['b']);
  });

  it('loads at most the limit and only strings', async () => {
    stubStorage({ [KEY]: JSON.stringify(['a', 1, 'b', null, 'c', 'd']) });
    const { pinnedDecksStore } = await load();
    expect(pinnedDecksStore.getSnapshot()).toEqual(['a', 'b', 'c']);
  });

  it.each(['{', '{}', '"a"'])('has no pins for %s', async (stored) => {
    stubStorage({ [KEY]: stored });
    const { pinnedDecksStore } = await load();
    expect(pinnedDecksStore.getSnapshot()).toEqual([]);
  });

  it('follows other tabs', async () => {
    const local = stubStorage({ [KEY]: '["a"]' });
    const { pinnedDecksStore } = await load();
    const listener = vi.fn();
    pinnedDecksStore.subscribe(listener);
    pinnedDecksStore.getSnapshot();
    local.values.set(KEY, '["b"]');
    local.dispatchStorage(KEY);
    expect(listener).toHaveBeenCalledOnce();
    expect(pinnedDecksStore.getSnapshot()).toEqual(['b']);
  });

  it('pins for this session when storage fails', async () => {
    stubBrokenStorage();
    const { pinDeck, pinnedDecksStore } = await load();
    expect(pinDeck('a')).toBe(true);
    expect(pinnedDecksStore.getSnapshot()).toEqual(['a']);
  });
});
