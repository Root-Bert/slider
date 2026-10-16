import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';

const KEY = 'slider.reviews.pinned.v2';
const ROB_A = { userId: 'rob', workspaceId: 'a' };
const ROB_B = { userId: 'rob', workspaceId: 'b' };
const ANNA_A = { userId: 'anna', workspaceId: 'a' };

// The store is module-level: every test loads a fresh copy.
const load = () => import('./pinned-decks');

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('pinned decks', () => {
  it('pins in order, idempotently, up to the limit', async () => {
    const { values } = stubStorage();
    const { MAX_PINNED, pinDeck, pinnedDecksStore, pinnedIn } = await load();
    expect(MAX_PINNED).toBe(3);
    expect(pinDeck(ROB_A, 'a')).toBe(true);
    expect(pinDeck(ROB_A, 'a')).toBe(true);
    expect(pinDeck(ROB_A, 'b')).toBe(true);
    expect(pinDeck(ROB_A, 'c')).toBe(true);
    expect(pinDeck(ROB_A, 'd')).toBe(false);
    expect(pinnedIn(pinnedDecksStore.getSnapshot(), ROB_A)).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(values.get(KEY)!)).toEqual({ 'rob/a': ['a', 'b', 'c'] });
  });

  it('counts the limit per workspace and keeps accounts apart', async () => {
    stubStorage();
    const { pinDeck, pinnedDecksStore, pinnedIn } = await load();
    for (const id of ['a1', 'a2', 'a3']) pinDeck(ROB_A, id);
    // A full workspace doesn't block another one, nor another account on this browser.
    expect(pinDeck(ROB_B, 'b1')).toBe(true);
    expect(pinDeck(ANNA_A, 'a1')).toBe(true);
    const pins = pinnedDecksStore.getSnapshot();
    expect(pinnedIn(pins, ROB_B)).toEqual(['b1']);
    expect(pinnedIn(pins, ANNA_A)).toEqual(['a1']);
    expect(pinnedIn(pins, ROB_A)).toEqual(['a1', 'a2', 'a3']);
  });

  it('unpins, and writes nothing for a deck that was not pinned', async () => {
    const { setItem } = stubStorage({ [KEY]: '{"rob/a":["a","b"]}' });
    const { pinnedDecksStore, pinnedIn, unpinDeck } = await load();
    unpinDeck(ROB_A, 'x');
    unpinDeck(ROB_B, 'a');
    expect(setItem).not.toHaveBeenCalled();
    unpinDeck(ROB_A, 'a');
    expect(pinnedIn(pinnedDecksStore.getSnapshot(), ROB_A)).toEqual(['b']);
  });

  it('prunes only the scope it is given, and only then writes', async () => {
    const { setItem } = stubStorage({ [KEY]: '{"rob/a":["a","b"],"anna/a":["a","z"]}' });
    const { pinnedDecksStore, pinnedIn, prunePinnedDecks } = await load();
    prunePinnedDecks(ROB_A, new Set(['a', 'b', 'c']));
    expect(setItem).not.toHaveBeenCalled();
    prunePinnedDecks(ROB_A, new Set(['b']));
    const pins = pinnedDecksStore.getSnapshot();
    expect(pinnedIn(pins, ROB_A)).toEqual(['b']);
    // Another account signing in on this browser doesn't lose its pins.
    expect(pinnedIn(pins, ANNA_A)).toEqual(['a', 'z']);
  });

  it('loads at most the limit and only strings', async () => {
    stubStorage({ [KEY]: JSON.stringify({ 'rob/a': ['a', 1, 'b', null, 'c', 'd'] }) });
    const { pinnedDecksStore, pinnedIn } = await load();
    expect(pinnedIn(pinnedDecksStore.getSnapshot(), ROB_A)).toEqual(['a', 'b', 'c']);
  });

  it.each(['{', '[]', '"a"', '{"rob/a":"a"}'])('has no pins for %s', async (stored) => {
    stubStorage({ [KEY]: stored });
    const { pinnedDecksStore, pinnedIn } = await load();
    expect(pinnedIn(pinnedDecksStore.getSnapshot(), ROB_A)).toEqual([]);
  });

  it('follows other tabs', async () => {
    const local = stubStorage({ [KEY]: '{"rob/a":["a"]}' });
    const { pinnedDecksStore, pinnedIn } = await load();
    const listener = vi.fn();
    pinnedDecksStore.subscribe(listener);
    pinnedDecksStore.getSnapshot();
    local.values.set(KEY, '{"rob/a":["b"]}');
    local.dispatchStorage(KEY);
    expect(listener).toHaveBeenCalledOnce();
    expect(pinnedIn(pinnedDecksStore.getSnapshot(), ROB_A)).toEqual(['b']);
  });

  it('pins for this session when storage fails', async () => {
    stubBrokenStorage();
    const { pinDeck, pinnedDecksStore, pinnedIn } = await load();
    expect(pinDeck(ROB_A, 'a')).toBe(true);
    expect(pinnedIn(pinnedDecksStore.getSnapshot(), ROB_A)).toEqual(['a']);
  });
});
