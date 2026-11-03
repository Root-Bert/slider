import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTabLock,
  OUTBOX_VERSION,
  pickLeftBehind,
  SERVER_ERROR_TRIES,
  retryDelay,
  sendOutcome,
  takeOverEdits,
  type OutboxEntry,
} from './outbox';

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  v: OUTBOX_VERSION,
  id: 'e1',
  deckId: 'deck',
  userId: 'ana',
  tab: 'closed-tab',
  operations: [],
  baseSeq: 3,
  at: 1000,
  ...over,
});

describe('the editor’s outbox', () => {
  it('keeps an edit to send again when the server is out of reach or busy, waiting longer each time', () => {
    // No connection, a timeout, a proxy without its server: out of reach, sent again later
    // however often.
    for (const status of [0, 408, 502, 504]) {
      expect(sendOutcome({ status }, 100)).toBe('unreachable');
    }
    expect(sendOutcome(new TypeError('Failed to fetch'))).toBe('unreachable');
    // Too many at once, LibreOffice busy: the server is there – tried again quietly, as often.
    for (const status of [429, 503]) expect(sendOutcome({ status }, 100)).toBe('retry');
    // An internal error may pass: tried a few times, then taken for the answer.
    expect(sendOutcome({ status: 500 }, SERVER_ERROR_TRIES - 1)).toBe('retry');
    expect(sendOutcome({ status: 500 }, SERVER_ERROR_TRIES)).toBe('refused');
    // The session ran out, or another account is signed in: kept – never dropped for it – but
    // not tried again blindly.
    expect(sendOutcome({ status: 401 })).toBe('signedOut');
    expect(sendOutcome({ status: 409, code: 'account_changed' })).toBe('signedOut');
    // The server's answer for good: dropped (a toast says why), never sent again and again.
    for (const status of [400, 403, 404, 409, 413]) {
      expect(sendOutcome({ status })).toBe('refused');
    }
    // At most half a minute between tries.
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });

  it('keeps the tab’s lock through a take-over while something is taken, and only then', async () => {
    // Web Locks by hand: granted a turn later, let go of when the callback's promise settles.
    let holding = false;
    const lock = createTabLock((_name, callback) => {
      const granted = Promise.resolve().then(() => {
        holding = true;
        return callback().then(() => {
          holding = false;
        });
      });
      return granted;
    }, 'tab');
    let taking!: () => void;
    const takeOver = lock.takingOver(async () => {
      // Granted with nothing held yet: still held for what is about to be taken.
      expect(holding).toBe(true);
      // An edit sent meanwhile is let go of: the lock stays, the take-over is not done.
      lock.guarded.add('sent');
      lock.letGo(['sent']);
      await new Promise<void>((resolve) => (taking = resolve));
      lock.guarded.add('taken');
    });
    await vi.waitFor(() => expect(taking).toBeTypeOf('function'));
    expect(holding).toBe(true);
    taking();
    await takeOver;
    // Something taken: held on.
    expect(holding).toBe(true);
    lock.letGo(['taken']);
    await Promise.resolve();
    expect(holding).toBe(false);

    // Nothing taken: let go of at once.
    let held = false;
    const empty = createTabLock(
      (_name, callback) =>
        Promise.resolve().then(() => {
          held = true;
          return callback().then(() => {
            held = false;
          });
        }),
      'tab',
    );
    await empty.takingOver(async () => expect(held).toBe(true));
    await Promise.resolve();
    expect(held).toBe(false);
  });

  it('takes over closed tabs’ edits of the account, in the order made, as this tab’s', async () => {
    // Without IndexedDB: nothing.
    expect(await takeOverEdits('ana', 'deck')).toEqual({ entries: [], outdated: 0 });

    const context = {
      userId: 'ana',
      tab: 'this-tab',
      guarded: new Set<string>(),
      open: new Set(['open-tab', 'this-tab']),
      now: 10_000,
    };
    {
      const { taken, outdated } = pickLeftBehind(
        [entry({ id: 'later', at: 2000 }), entry({ id: 'first', at: 1000 })],
        context,
      );
      expect(taken.map((item) => [item.id, item.tab])).toEqual([
        ['first', 'this-tab'],
        ['later', 'this-tab'],
      ]);
      expect(outdated).toEqual([]);
    }
    // Another account's edits are left for that account.
    expect(pickLeftBehind([entry({ userId: 'ben' })], context).taken).toEqual([]);
    {
      // Left: what an open tab still sends, and what this tab's sender holds.
      const { taken } = pickLeftBehind(
        [
          entry({ id: 'open', tab: 'open-tab' }),
          entry({ id: 'held', tab: 'this-tab' }),
          entry({ id: 'let-go', tab: 'this-tab' }),
        ],
        { ...context, guarded: new Set(['held']) },
      );
      expect(taken.map((item) => item.id)).toEqual(['let-go']);
    }
    {
      // Without Web Locks: only once it is a while old.
      const { taken } = pickLeftBehind(
        [entry({ id: 'fresh', at: 9_000 }), entry({ id: 'old', at: 1_000 })],
        { ...context, open: null, now: 65_000 },
      );
      expect(taken.map((item) => item.id)).toEqual(['old']);
    }
    {
      // Entries of another format are dropped – those from before entries named their account.
      const old = { id: 'old', deckId: 'deck', tab: 'closed-tab', operations: [], at: 1 };
      const { taken, outdated } = pickLeftBehind(
        [old, entry({ id: 'other', v: OUTBOX_VERSION + 1 })],
        context,
      );
      expect(taken).toEqual([]);
      expect(outdated).toEqual(['old', 'other']);
    }
  });
});

/**
 * IndexedDB and Web Locks by hand, as far as the browser's outbox uses them: one database whose
 * open connections hear when it is deleted (`wipe`, as `forgetOffline` does).
 */
function fakeBrowser() {
  const rows = new Map<string, OutboxEntry>();
  const connections: { onversionchange: ((event: { newVersion: null }) => void) | null }[] = [];
  let exists = false;
  const state = { opens: 0, holding: false, rows };
  const answer = <T>(read: () => T) => {
    const request: { result?: T; onsuccess?: () => void } = {};
    queueMicrotask(() => {
      request.result = read();
      request.onsuccess?.();
    });
    return request;
  };
  const objectStore = {
    put: (entry: OutboxEntry) => void rows.set(entry.id, entry),
    delete: (id: string) => void rows.delete(id),
    getAll: () => answer(() => [...rows.values()]),
    index: () => ({
      getAll: (deckId: string) =>
        answer(() => [...rows.values()].filter((row) => row.deckId === deckId)),
    }),
  };
  const open = () => {
    state.opens += 1;
    const request: { result?: unknown; onupgradeneeded?: () => void; onsuccess?: () => void } = {};
    setTimeout(() => {
      let closed = false;
      const db = {
        onversionchange: null,
        createObjectStore: () => ({ createIndex: () => {} }),
        close: () => void (closed = true),
        transaction: () => {
          if (closed) throw new Error('The database connection is closing.');
          const tx: { oncomplete?: () => void; objectStore: () => typeof objectStore } = {
            objectStore: () => objectStore,
          };
          setTimeout(() => tx.oncomplete?.(), 0);
          return tx;
        },
      };
      connections.push(db);
      request.result = db;
      if (!exists) {
        exists = true;
        request.onupgradeneeded?.();
      }
      request.onsuccess?.();
    }, 0);
    return request;
  };
  vi.stubGlobal('indexedDB', { open });
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, callback: () => Promise<void>) =>
        Promise.resolve().then(() => {
          state.holding = true;
          return callback().then(() => {
            state.holding = false;
          });
        }),
      query: async () => ({ held: [] }),
    },
  });
  return {
    state,
    wipe() {
      for (const db of connections.splice(0)) db.onversionchange?.({ newVersion: null });
      rows.clear();
      exists = false;
    },
  };
}

/** The outbox anew, on the fake browser: it keeps its database (or none) for the page's life. */
const freshOutbox = async () => {
  vi.resetModules();
  return import('./outbox');
};

/** Lets every write, transaction and lock waiting meanwhile go through. */
const flush = async () => {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('the browser’s outbox', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps and lists the account’s edits across tabs, letting go of what was released or wiped meanwhile', async () => {
    {
      // lets go of an edit let go of while it was still being kept – and the tab’s lock with it
      const { state } = fakeBrowser();
      const { browserOutboxStore: store, OUTBOX_TAB, takeOverEdits } = await freshOutbox();
      const kept = store.keep(entry({ id: 'e1', tab: OUTBOX_TAB }));
      // Let go of in the same turn (another account signed in): the keep has not run yet.
      store.release(['e1']);
      await kept;
      await flush();
      expect(state.holding).toBe(false);
      // Left behind by this tab's sender: taken over like a closed tab's.
      expect((await takeOverEdits('ana')).entries.map((taken) => taken.id)).toEqual(['e1']);
    }
    vi.unstubAllGlobals();
    {
      // lists the account’s edits kept by every tab, not another account’s
      fakeBrowser();
      const { browserOutboxStore: store } = await freshOutbox();
      void store.keep(entry({ id: 'mine', tab: 'this-tab' }));
      void store.keep(entry({ id: 'other-tab', tab: 'open-tab' }));
      void store.keep(entry({ id: 'bens', userId: 'ben' }));
      // Asked at once: the writes on their way are waited for.
      expect((await store.keptOf('ana')).sort()).toEqual(['mine', 'other-tab']);
    }
    vi.unstubAllGlobals();
    {
      // keeps nothing asked for before the outbox was wiped, nor opens it anew for it
      const browser = fakeBrowser();
      const { browserOutboxStore: store } = await freshOutbox();
      await store.keep(entry({ id: 'before' }));
      const opens = browser.state.opens;
      // Signed out in another tab while an edit's keep waited for its turn.
      const late = store.keep(entry({ id: 'late' }));
      browser.wipe();
      await late;
      await flush();
      expect(browser.state.opens).toBe(opens);
      expect(browser.state.rows.size).toBe(0);
      expect(browser.state.holding).toBe(false);
    }
  });
});
