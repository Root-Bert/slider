import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';

const KEY = 'slider.lastVisits.v2';
const LEGACY_KEY = 'slider.lastVisits.v1';

// The store is module-level: every test loads a fresh copy.
const load = () => import('./last-visits');

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('last visits', () => {
  it('persists when a deck was opened, per account', async () => {
    const { values } = stubStorage();
    const { lastVisitsStore, markDeckOpened, openedIn } = await load();
    markDeckOpened('u1', 'd1', 123);
    expect(JSON.parse(values.get(KEY)!)).toEqual({ u1: { d1: 123 } });
    markDeckOpened('u1', 'd2', 456);
    markDeckOpened('u2', 'd1', 789);
    const visits = lastVisitsStore.getSnapshot();
    expect(openedIn(visits, 'u1')).toEqual({ d1: 123, d2: 456 });
    // The next person on a shared computer sees only their own visits.
    expect(openedIn(visits, 'u2')).toEqual({ d1: 789 });
    expect(openedIn(visits, 'u3')).toEqual({});
  });

  it('hands the browser-wide visits of before to the first account, then deletes them', async () => {
    const { values } = stubStorage({
      [LEGACY_KEY]: JSON.stringify({ baseline: 1, decks: {}, opened: { d1: 5, d2: 6 } }),
      [KEY]: JSON.stringify({ u1: { d2: 9 } }),
    });
    const { adoptLegacyVisits, lastVisitsStore, openedIn } = await load();
    adoptLegacyVisits('u1');
    expect(values.has(LEGACY_KEY)).toBe(false);
    // What the account recorded itself wins.
    expect(openedIn(lastVisitsStore.getSnapshot(), 'u1')).toEqual({ d1: 5, d2: 9 });

    adoptLegacyVisits('u2');
    expect(openedIn(lastVisitsStore.getSnapshot(), 'u2')).toEqual({});
  });

  it('takes the visits of before over when a deck is opened', async () => {
    const { values } = stubStorage({ [LEGACY_KEY]: JSON.stringify({ opened: { d1: 5 } }) });
    const { lastVisitsStore, markDeckOpened, openedIn } = await load();
    markDeckOpened('u1', 'd2', 7);
    expect(values.has(LEGACY_KEY)).toBe(false);
    expect(openedIn(lastVisitsStore.getSnapshot(), 'u1')).toEqual({ d1: 5, d2: 7 });
  });

  it.each(['null', '[]', '{"opened":3}', 'garbage', '"x"'])(
    'deletes unusable visits of before (%s) without taking anything over',
    async (stored) => {
      const { values } = stubStorage({ [LEGACY_KEY]: stored });
      const { adoptLegacyVisits, lastVisitsStore } = await load();
      adoptLegacyVisits('u1');
      expect(values.has(LEGACY_KEY)).toBe(false);
      expect(lastVisitsStore.getSnapshot()).toEqual({});
    },
  );

  it.each(['null', '[]', '{"u1":3}', '{"u1":{"d1":"x"}}', 'garbage', '"x"'])(
    'starts over for %s',
    async (stored) => {
      stubStorage({ [KEY]: stored });
      const { lastVisitsStore, openedIn } = await load();
      expect(openedIn(lastVisitsStore.getSnapshot(), 'u1')).toEqual({});
    },
  );

  it('follows other tabs', async () => {
    const local = stubStorage({ [KEY]: '{"u1":{"d1":1}}' });
    const { lastVisitsStore, openedIn } = await load();
    const listener = vi.fn();
    lastVisitsStore.subscribe(listener);
    expect(openedIn(lastVisitsStore.getSnapshot(), 'u1')).toEqual({ d1: 1 });
    local.values.set(KEY, '{"u1":{"d1":2}}');
    local.dispatchStorage(KEY);
    expect(listener).toHaveBeenCalledOnce();
    expect(openedIn(lastVisitsStore.getSnapshot(), 'u1')).toEqual({ d1: 2 });
  });

  it('keeps visits in memory without storage', async () => {
    stubBrokenStorage();
    const { lastVisitsStore, markDeckOpened, openedIn } = await load();
    markDeckOpened('u1', 'd1', 9);
    expect(openedIn(lastVisitsStore.getSnapshot(), 'u1')).toEqual({ d1: 9 });
  });
});
