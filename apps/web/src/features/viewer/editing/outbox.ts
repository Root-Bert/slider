import type { SlideOperation } from '@slider/shared';
import { OUTBOX_DB } from '@/lib/offline';
import {
  OUTBOX_TAB,
  type OutboxStore as Store,
  type QueuedEntry,
  type TakenOver as Taken,
} from '@/lib/outbox';

export {
  OUTBOX_TAB,
  retryDelay,
  SERVER_ERROR_TRIES,
  sendOutcome,
  statusOf,
  type QueuedEntry,
  type SendOutcome,
} from '@/lib/outbox';

/*
 * The editor's edits not yet taken by the server, kept in the browser (IndexedDB) until they are:
 * a reload, a closed tab or a lost connection loses none. Each edit is kept by the tab that made
 * it and names the account it was made under – only that account sends it, never another one
 * signed in later in the same browser. A tab coming up takes over what tabs no longer open left
 * behind (a tab holds a Web Lock of its own while it has edits kept here), never what another
 * open tab is still sending. Without IndexedDB (a private window, blocked site data) edits are
 * kept in memory only. Signing out drops them with the rest the browser kept of the account
 * (`forgetOffline`) – an open tab lets go of its own at once (`onForgotten`).
 *
 * This file is the storage only; sending is `edit-outbox.ts`'s. Comments made offline wait in a
 * store of their own beside the edits (`browserQueue`, sent by `lib/api/comment-outbox.ts`), kept
 * and taken over the same way, under the same tab lock.
 */

/**
 * The entries' format: one of another (an older app, before entries named their account) is not
 * sent – it is dropped when found (`takeOverEdits`).
 */
export const OUTBOX_VERSION = 2;

export interface OutboxEntry extends QueuedEntry {
  operations: SlideOperation[];
  /** The edit step the operations were made on. */
  baseSeq: number | undefined;
}

/** What was taken over (`OutboxStore.takeOver`): edits, unless said otherwise. */
export type TakenOver<E extends QueuedEntry = OutboxEntry> = Taken<E>;

/** Where the sender keeps its edits (`edit-outbox.ts`): IndexedDB here, memory in tests. */
export type OutboxStore<E extends QueuedEntry = OutboxEntry> = Store<E>;

const STORE = 'edits';
/** Comments made while the server was out of reach (`lib/api/comment-outbox.ts`). */
export const COMMENT_STORE = 'comments';
/** Changes to a deck's board (the material page) made while the server was out of reach (`lib/api/board.ts`). */
export const BOARD_STORE = 'board';
const TAB_LOCK = 'slider-tab:';

/** Asks for a Web Lock (`navigator.locks.request`); `undefined` without Web Locks. */
export type LockRequest = (
  name: string,
  callback: () => Promise<void>,
) => Promise<unknown> | undefined;

/**
 * The tab's Web Lock: the others see it is still open (`navigator.locks.query`) and leave its
 * edits alone. Held only while this tab has edits kept here (`guarded`) or is taking some over
 * (`takingOver`) – a page holding a lock is not kept in the browser's back-forward cache, and a
 * tab without edits has nothing to guard. A take-over starts with nothing held and adds what it
 * takes only inside its transaction: counted meanwhile, the lock is not let go of under it – not
 * when it is granted (with nothing held yet), not when the last edit held is dropped – or another
 * tab, finding this one's lock gone, would take the same edits and both would send them.
 */
export function createTabLock(request: LockRequest | undefined, name: string) {
  /**
   * The entries this tab's sender holds (queued, or being taken over for it): the others of this
   * tab are left behind – their sender let go of them – and taken over like a closed tab's.
   */
  const guarded = new Set<string>();
  let taking = 0;
  let granted: Promise<void> | null = null;
  let letLockGo: (() => void) | null = null;

  const needed = () => guarded.size > 0 || taking > 0;

  /** Lets go of the lock once it guards nothing any more. */
  const release = (): void => {
    if (needed() || !letLockGo) return;
    letLockGo();
    letLockGo = null;
    granted = null;
  };

  /** Takes the lock (once granted, this tab's entries are safe from other tabs). */
  const hold = (): Promise<void> => {
    if (granted) return granted;
    granted = new Promise<void>((resolve) => {
      try {
        const asked = request?.(
          name,
          () =>
            new Promise<void>((letGoOf) => {
              letLockGo = letGoOf;
              resolve();
              // Nothing to guard any more by the time it came (all sent meanwhile): let go of.
              release();
            }),
        );
        if (!asked) resolve();
        else asked.catch(() => resolve());
      } catch {
        // No Web Locks: edits left behind are taken over only once they are a while old (below).
        resolve();
      }
    });
    return granted;
  };

  return {
    guarded,
    hold,
    release,
    /** The sender let go of these (sent, or another account's): the lock may go with them. */
    letGo(ids: Iterable<string>): void {
      for (const id of ids) guarded.delete(id);
      release();
    },
    /** Runs a take-over with the lock held throughout, let go of after only if nothing was taken. */
    async takingOver<T>(work: () => Promise<T>): Promise<T> {
      taking += 1;
      try {
        await hold();
        return await work();
      } finally {
        taking -= 1;
        release();
      }
    },
  };
}

const tabLock = createTabLock(
  typeof navigator === 'undefined' || !navigator.locks
    ? undefined
    : (name, callback) => navigator.locks.request(name, callback),
  `${TAB_LOCK}${OUTBOX_TAB}`,
);
const guarded = tabLock.guarded;
const letGo = tabLock.letGo;

const forgottenListeners = new Set<() => void>();

let opened: Promise<IDBDatabase | null> | null = null;

/**
 * How often the outbox was wiped (signed out, here or in another tab) while this tab had it open.
 * A write asked for before a wipe but run after it – in turn behind another (`inTurn`) – is left
 * out: it was the signed-out account's, and would open the database anew to keep it there.
 */
let wipes = 0;

function database(): Promise<IDBDatabase | null> {
  opened ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      // 2: comments beside the edits – an outbox of 1 keeps its edits, and gets their store.
      // 3: the boards' changes beside them.
      const request = indexedDB.open(OUTBOX_DB, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of [STORE, COMMENT_STORE, BOARD_STORE]) {
          if (db.objectStoreNames?.contains(name)) continue;
          db.createObjectStore(name, { keyPath: 'id' }).createIndex('deckId', 'deckId');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Signing out deletes the database (`forgetOffline`, `newVersion` null): let go of it,
        // and of every edit held – they were the account's. Opened anew when needed.
        db.onversionchange = (event) => {
          db.close();
          opened = null;
          if (event.newVersion !== null) return;
          wipes += 1;
          letGo([...guarded]);
          for (const listener of forgottenListeners) listener();
        };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

/** Runs `work` in one transaction; done (or failed: nothing kept) when it settles. */
async function transact(
  db: IDBDatabase,
  name: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(name, mode);
      work(tx.objectStore(name));
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Writes per entry, one after another: an edit kept and sent at once is dropped only after it was
 * written – never written back after its drop, to be sent again from there.
 */
const writes = new Map<string, Promise<void>>();

function inTurn(id: string, write: () => Promise<void>): Promise<void> {
  const next = (writes.get(id) ?? Promise.resolve()).then(write);
  writes.set(id, next);
  void next.finally(() => {
    if (writes.get(id) === next) writes.delete(id);
  });
  return next;
}

/**
 * Lets go of entries in turn with their writes: a keep still on its way (`inTurn` runs it a turn
 * later) would hold one again after it was let go of – never let go of, and with it the tab's lock.
 */
const releaseEntries = (ids: Iterable<string>) => {
  for (const id of ids) void inTurn(id, async () => letGo([id]));
};

/** Tabs still open, by their Web Lock; `null` when it cannot be told. */
async function openTabs(): Promise<Set<string> | null> {
  try {
    const locks = await navigator.locks?.query();
    if (!locks) return null;
    return new Set(
      (locks.held ?? [])
        .map((lock) => lock.name ?? '')
        .filter((name) => name.startsWith(TAB_LOCK))
        .map((name) => name.slice(TAB_LOCK.length)),
    );
  } catch {
    return null;
  }
}

/** Without Web Locks, an edit this old is taken to be left behind by a closed tab. */
const LEFT_BEHIND_MS = 60_000;

/**
 * Of the entries kept, those this tab takes over for `userId` (rewritten as `tab`'s) – left
 * behind by tabs no longer open (`open`, by their Web Lock; `null`: not to be told, then by age),
 * or this tab's own its sender lets go of (not `guarded`) – and those of another format (`v`), to be
 * dropped. Another account's are left alone.
 */
export function pickLeftBehind<E extends QueuedEntry = OutboxEntry>(
  entries: readonly Partial<E>[],
  context: {
    userId: string;
    tab: string;
    guarded: ReadonlySet<string>;
    open: ReadonlySet<string> | null;
    now: number;
    /** The entries' format (`OUTBOX_VERSION` for edits). */
    version?: number;
  },
): { taken: E[]; outdated: string[] } {
  const taken: E[] = [];
  const outdated: string[] = [];
  for (const entry of entries) {
    if (!entry.id || context.guarded.has(entry.id)) continue;
    if (entry.v !== (context.version ?? OUTBOX_VERSION)) {
      outdated.push(entry.id);
      continue;
    }
    const kept = entry as E;
    if (kept.userId !== context.userId) continue;
    const leftBehind =
      kept.tab === context.tab ||
      (context.open ? !context.open.has(kept.tab) : context.now - kept.at > LEFT_BEHIND_MS);
    if (leftBehind) taken.push({ ...kept, tab: context.tab });
  }
  return { taken: taken.sort((a, b) => a.at - b.at), outdated };
}

/**
 * The browser's outbox of one kind (an IndexedDB store): its entries kept, dropped, taken over
 * from tabs no longer open and listed – of the format `version`, others dropped when found.
 */
export function browserQueue<E extends QueuedEntry>(name: string, version: number): OutboxStore<E> {
  const keep = (entry: E) => {
    const asked = wipes;
    return inTurn(entry.id, async () => {
      if (wipes !== asked) return;
      const db = await database();
      if (!db || wipes !== asked) return;
      guarded.add(entry.id);
      // Before it is written: no other tab may take it for left behind meanwhile.
      await tabLock.hold();
      // Wiped while the lock was asked for: let go of again, not written.
      if (wipes !== asked) return letGo([entry.id]);
      await transact(db, name, 'readwrite', (store) => store.put(entry));
    });
  };

  const drop = (id: string) => {
    const asked = wipes;
    return inTurn(id, async () => {
      // Wiped since: gone with the rest – not a reason to open the database anew.
      const db = wipes === asked ? await database() : null;
      if (db) await transact(db, name, 'readwrite', (store) => store.delete(id));
      letGo([id]);
    });
  };

  /**
   * Takes over the entries of `userId` (of `deckId`, or of every deck) that tabs no longer open
   * left behind – they are this tab's then – and this tab's own its sender does not hold, in the
   * order they were made. Entries of another format are deleted and counted; another account's
   * are left as they are, for that account to send once it signs in here again.
   */
  const takeOver = async (userId: string, deckId?: string): Promise<TakenOver<E>> => {
    const none: TakenOver<E> = { entries: [], outdated: 0 };
    const db = await database();
    if (!db) return none;
    // Held before the entries are rewritten as this tab's – they are not left behind for a
    // moment – and until they are held one by one; let go of after if nothing was taken.
    return tabLock.takingOver(async () => {
      const open = await openTabs();
      const now = Date.now();
      return new Promise<TakenOver<E>>((resolve) => {
        try {
          const tx = db.transaction(name, 'readwrite');
          const store = tx.objectStore(name);
          const result: TakenOver<E> = { entries: [], outdated: 0 };
          // One transaction: two tabs coming up at once do not both take the same entries.
          const request =
            deckId === undefined ? store.getAll() : store.index('deckId').getAll(deckId);
          request.onsuccess = () => {
            const picked = pickLeftBehind<E>(request.result as Partial<E>[], {
              userId,
              tab: OUTBOX_TAB,
              guarded,
              open,
              now,
              version,
            });
            for (const id of picked.outdated) store.delete(id);
            result.outdated = picked.outdated.length;
            for (const mine of picked.taken) {
              store.put(mine);
              guarded.add(mine.id);
              result.entries.push(mine);
            }
          };
          tx.oncomplete = () => resolve(result);
          tx.onerror = tx.onabort = () => {
            letGo(result.entries.map((entry) => entry.id));
            resolve(none);
          };
        } catch {
          resolve(none);
        }
      });
    });
  };

  /** Every entry kept for `userId` (`OutboxStore.keptOf`), of this tab and of any other. */
  const keptOf = async (userId: string): Promise<string[]> => {
    // After the writes on their way: an entry just taken is not counted, one just made is.
    await Promise.allSettled([...writes.values()]);
    const db = await database();
    if (!db) return [];
    return new Promise<string[]>((resolve) => {
      try {
        const request = db.transaction(name, 'readonly').objectStore(name).getAll();
        request.onsuccess = () =>
          resolve(
            (request.result as Partial<E>[])
              .filter((entry) => entry.v === version && entry.userId === userId)
              .flatMap((entry) => (entry.id ? [entry.id] : [])),
          );
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  };

  return {
    keep,
    drop,
    takeOver,
    release: releaseEntries,
    keptOf,
    onForgotten: (listener) => {
      forgottenListeners.add(listener);
      return () => forgottenListeners.delete(listener);
    },
  };
}

/** The browser's outbox of the editor's edits: IndexedDB, guarded by the tab's Web Lock. */
export const browserOutboxStore = browserQueue<OutboxEntry>(STORE, OUTBOX_VERSION);

/** Takes over the edits tabs no longer open left of `userId` (`OutboxStore.takeOver`). */
export const takeOverEdits = (userId: string, deckId?: string) =>
  browserOutboxStore.takeOver(userId, deckId);
