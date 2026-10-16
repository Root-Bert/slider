import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';

const KEY = 'slider.lastVisits.v1';

// The store is module-level: every test loads a fresh copy.
const load = () => import('./last-visits');

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('last visits', () => {
  it('persists when a deck was opened', async () => {
    const { values } = stubStorage();
    const { lastVisitsStore, markDeckOpened } = await load();
    markDeckOpened('d1', 123);
    expect(JSON.parse(values.get(KEY)!)).toEqual({ opened: { d1: 123 } });
    markDeckOpened('d2', 456);
    expect(lastVisitsStore.getSnapshot().opened).toEqual({ d1: 123, d2: 456 });
  });

  it('reads the legacy shape and drops its extra fields', async () => {
    stubStorage({ [KEY]: JSON.stringify({ baseline: 1, decks: {}, opened: { d1: 5 } }) });
    const { lastVisitsStore } = await load();
    expect(lastVisitsStore.getSnapshot()).toEqual({ opened: { d1: 5 } });
  });

  it.each(['null', '[]', '{"opened":3}', 'garbage', '"x"'])(
    'starts over for %s',
    async (stored) => {
      stubStorage({ [KEY]: stored });
      const { lastVisitsStore } = await load();
      expect(lastVisitsStore.getSnapshot().opened ?? {}).toEqual({});
    },
  );

  it('follows other tabs', async () => {
    const local = stubStorage({ [KEY]: '{"opened":{"d1":1}}' });
    const { lastVisitsStore } = await load();
    const listener = vi.fn();
    lastVisitsStore.subscribe(listener);
    expect(lastVisitsStore.getSnapshot().opened).toEqual({ d1: 1 });
    local.values.set(KEY, '{"opened":{"d1":2}}');
    local.dispatchStorage(KEY);
    expect(listener).toHaveBeenCalledOnce();
    expect(lastVisitsStore.getSnapshot().opened).toEqual({ d1: 2 });
  });

  it('keeps visits in memory without storage', async () => {
    stubBrokenStorage();
    const { lastVisitsStore, markDeckOpened } = await load();
    markDeckOpened('d1', 9);
    expect(lastVisitsStore.getSnapshot().opened).toEqual({ d1: 9 });
  });
});
