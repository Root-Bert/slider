import type {
  Board,
  BoardFrame,
  BoardItem,
  CreateBoardItemInput,
  UpdateBoardItemInput,
} from '@slider/shared';
import { api } from '@/lib/api-client';
import { OUTBOX_TAB, retryDelay, sendOutcome, type QueuedEntry } from '@/lib/outbox';
import { BOARD_STORE, browserQueue } from '../editing/outbox';

/*
 * Changes to a deck's board (the material page) without a connection, like comments (`comment-outbox.ts`):
 * a note or link put down, its text changed, things moved or deleted – shown at once over the
 * server's board (`withQueued`), sent one after the other in the order made, kept in the browser
 * (IndexedDB, beside the editor's edits and comments) until the server took them – a reload
 * loses nothing. A new note carries its own id, so a change or delete queued after it names it;
 * sent again, the server answers with the one saved first. A delete of a note not sent yet takes
 * it out of the queue, it never goes out. Refused by the server (rights gone, deck deleted):
 * dropped and said once.
 *
 * Files are not kept here: they can be hundreds of MB – too much for the browser's storage – and
 * tus already sends what got through only once and goes on where it stopped. A file put down
 * offline is sent as soon as the connection is back while the tab stays open.
 */

export const BOARD_OUTBOX_VERSION = 1;

export type BoardAction =
  | { type: 'create'; item: BoardItem; input: CreateBoardItemInput & { id: string } }
  | { type: 'update'; itemId: string; input: UpdateBoardItemInput }
  | { type: 'move'; frames: (BoardFrame & { id: string })[] }
  | { type: 'delete'; itemId: string };

export interface BoardEntry extends QueuedEntry {
  action: BoardAction;
}

interface Item {
  entry: BoardEntry;
  attempted: boolean;
  attempts: number;
}

/** The board as shown: the server's with what is queued here laid over it, in order. */
export function withQueued(board: Board, actions: readonly BoardAction[]): Board {
  if (actions.length === 0) return board;
  let materials = board.materials;
  let items = board.items;
  for (const action of actions) {
    if (action.type === 'create') {
      if (!items.some((item) => item.id === action.item.id)) items = [...items, action.item];
    } else if (action.type === 'update') {
      items = items.map((item) =>
        item.id === action.itemId
          ? {
              ...item,
              ...(action.input.text !== undefined && { text: action.input.text }),
              ...(action.input.url !== undefined && { url: action.input.url }),
              ...(action.input.boundIds !== undefined && { boundIds: action.input.boundIds }),
              ...(action.input.color !== undefined && { color: action.input.color }),
              ...(action.input.rich !== undefined && { rich: action.input.rich }),
            }
          : item,
      );
    } else if (action.type === 'move') {
      const frames = new Map(action.frames.map(({ id, ...frame }) => [id, frame]));
      materials = materials.map((m) => (frames.has(m.id) ? { ...m, ...frames.get(m.id) } : m));
      items = items.map((item) =>
        frames.has(item.id) ? { ...item, ...frames.get(item.id) } : item,
      );
    } else {
      materials = materials.filter((m) => m.id !== action.itemId);
      items = unbound(
        items.filter((item) => item.id !== action.itemId),
        action.itemId,
      );
    }
  }
  return { materials, items };
}

/**
 * A thing gone from the board: the notes hanging on it let go of it, one hanging on it alone goes
 * with it (and so on), as on the server.
 */
function unbound(items: BoardItem[], goneId: string): BoardItem[] {
  const gone: string[] = [];
  const left = items.flatMap((item) => {
    if (!item.boundIds.includes(goneId)) return [item];
    const boundIds = item.boundIds.filter((id) => id !== goneId);
    // A frame or folder stays, empty or not; a note on nothing left goes.
    if (boundIds.length > 0 || item.kind !== 'note') return [{ ...item, boundIds }];
    gone.push(item.id);
    return [];
  });
  return gone.reduce(unbound, left);
}

async function send(deckId: string, action: BoardAction): Promise<void> {
  const base = `/decks/${encodeURIComponent(deckId)}/board`;
  if (action.type === 'create') await api.post(`${base}/items`, action.input);
  else if (action.type === 'update')
    await api.patch(`${base}/items/${encodeURIComponent(action.itemId)}`, action.input);
  else if (action.type === 'move') await api.patch(base, { frames: action.frames });
  else await api.delete(`${base}/${encodeURIComponent(action.itemId)}`);
}

export interface BoardOutbox {
  enqueue(deckId: string, userId: string, action: BoardAction): void;
  /** The deck's actions not taken yet, in order (one array while they stay the same). */
  queued(deckId: string): readonly BoardAction[];
  subscribe(listener: () => void): () => void;
  /** Takes up what a closed tab left of this deck and account, and sends it. */
  resume(deckId: string, userId: string): void;
  /** The server took (`ok`) or refused an action: the deck's board is asked for anew. */
  onSettled(listener: (deckId: string, refused: unknown) => void): () => void;
  /**
   * Once a new note queued here is on the server (at once when none is queued): asking about it
   * there needs it saved. Refused, it throws the server's refusal.
   */
  saved(deckId: string, itemId: string): Promise<void>;
  /**
   * The deck's board as fetched from `startedAt` on is in: actions the server took before that
   * are in it and go. Till then a taken action stays shown – dropped at once, the board would
   * show where things were before till the board fetched anew is in (a drag jumped back).
   */
  forget(deckId: string, startedAt: number): void;
}

export function createBoardOutbox(
  store = browserQueue<BoardEntry>(BOARD_STORE, BOARD_OUTBOX_VERSION),
): BoardOutbox {
  const decks = new Map<
    string,
    {
      items: Item[];
      /** Taken by the server, shown till a board fetched after that is in. */
      taken: { action: BoardAction; at: number }[];
      pumping: boolean;
      shown: BoardAction[];
    }
  >();
  const listeners = new Set<() => void>();
  const settled = new Set<(deckId: string, refused: unknown) => void>();
  const resumed = new Set<string>();
  const waiters = new Set<{
    deckId: string;
    itemId: string;
    resolve: () => void;
    reject: (error: unknown) => void;
  }>();
  const EMPTY: BoardAction[] = [];

  const deckOf = (deckId: string) => {
    let deck = decks.get(deckId);
    if (!deck) {
      deck = { items: [], taken: [], pumping: false, shown: EMPTY };
      decks.set(deckId, deck);
    }
    return deck;
  };
  const changed = (deckId: string) => {
    const deck = deckOf(deckId);
    const shown = [
      ...deck.taken.map((each) => each.action),
      ...deck.items.map((item) => item.entry.action),
    ];
    deck.shown = shown.length > 0 ? shown : EMPTY;
    for (const listener of listeners) listener();
  };

  const pump = async (deckId: string): Promise<void> => {
    const deck = deckOf(deckId);
    if (deck.pumping) return;
    deck.pumping = true;
    try {
      while (deck.items.length > 0) {
        if (navigator.onLine === false) return;
        const item = deck.items[0]!;
        item.attempted = true;
        item.attempts += 1;
        let refused: unknown = null;
        try {
          await send(deckId, item.entry.action);
        } catch (error) {
          const outcome = sendOutcome(error, item.attempts);
          if (outcome !== 'refused') {
            // Out of reach, busy or signed out: kept, tried again later.
            setTimeout(() => void pump(deckId), retryDelay(item.attempts));
            return;
          }
          refused = error;
        }
        deck.items.shift();
        if (!refused) deck.taken.push({ action: item.entry.action, at: Date.now() });
        await store.drop(item.entry.id);
        changed(deckId);
        const { action } = item.entry;
        if (action.type === 'create')
          for (const waiter of waiters)
            if (waiter.deckId === deckId && waiter.itemId === action.item.id) {
              waiters.delete(waiter);
              if (refused) waiter.reject(refused);
              else waiter.resolve();
            }
        for (const listener of settled) listener(deckId, refused);
      }
    } finally {
      deck.pumping = false;
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      for (const deckId of decks.keys()) void pump(deckId);
    });
  }

  return {
    enqueue(deckId, userId, action) {
      const deck = deckOf(deckId);
      // A note not sent yet and deleted: it never goes out, nor do its changes.
      if (action.type === 'delete') {
        const created = deck.items.find(
          (item) =>
            !item.attempted &&
            item.entry.action.type === 'create' &&
            item.entry.action.item.id === action.itemId,
        );
        if (created) {
          const gone = deck.items.filter(
            (item) =>
              !item.attempted &&
              ((item.entry.action.type === 'create' &&
                item.entry.action.item.id === action.itemId) ||
                (item.entry.action.type === 'update' &&
                  item.entry.action.itemId === action.itemId)),
          );
          deck.items = deck.items.filter((item) => !gone.includes(item));
          for (const item of gone) void store.drop(item.entry.id);
          for (const waiter of waiters)
            if (waiter.deckId === deckId && waiter.itemId === action.itemId) {
              waiters.delete(waiter);
              waiter.reject(new Error('deleted'));
            }
          changed(deckId);
          return;
        }
      }
      const entry: BoardEntry = {
        v: BOARD_OUTBOX_VERSION,
        id: crypto.randomUUID(),
        deckId,
        userId,
        tab: OUTBOX_TAB,
        at: Date.now(),
        action,
      };
      deck.items.push({ entry, attempted: false, attempts: 0 });
      changed(deckId);
      void store.keep(entry).then(() => pump(deckId));
    },
    queued: (deckId) => decks.get(deckId)?.shown ?? EMPTY,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    resume(deckId, userId) {
      const key = `${userId}:${deckId}`;
      if (resumed.has(key)) return;
      resumed.add(key);
      void store.takeOver(userId, deckId).then(({ entries }) => {
        if (entries.length === 0) return;
        const deck = deckOf(deckId);
        const known = new Set(deck.items.map((item) => item.entry.id));
        const taken = entries
          .filter((entry) => !known.has(entry.id))
          .map((entry) => ({ entry, attempted: true, attempts: 0 }));
        deck.items = [...taken, ...deck.items];
        changed(deckId);
        void pump(deckId);
      });
    },
    onSettled(listener) {
      settled.add(listener);
      return () => void settled.delete(listener);
    },
    saved(deckId, itemId) {
      const queued = decks
        .get(deckId)
        ?.items.some(
          (item) => item.entry.action.type === 'create' && item.entry.action.item.id === itemId,
        );
      if (!queued) return Promise.resolve();
      return new Promise((resolve, reject) => waiters.add({ deckId, itemId, resolve, reject }));
    },
    forget(deckId, startedAt) {
      const deck = decks.get(deckId);
      if (!deck || deck.taken.length === 0) return;
      const left = deck.taken.filter((each) => each.at >= startedAt);
      if (left.length === deck.taken.length) return;
      deck.taken = left;
      changed(deckId);
    },
  };
}

let shared: BoardOutbox | null = null;

/** The app's one board outbox, made when first asked for. */
export function boardOutbox(): BoardOutbox {
  shared ??= createBoardOutbox();
  return shared;
}
