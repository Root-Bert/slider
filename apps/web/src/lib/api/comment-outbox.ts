import type {
  Author,
  Comment,
  CommentMedia,
  CommentReactionKind,
  CreateCommentInput,
  UpdateCommentInput,
} from '@slider/shared';
import {
  OUTBOX_TAB,
  retryDelay,
  sendOutcome,
  SERVER_ERROR_TRIES,
  statusOf,
  type OutboxStore,
  type QueuedEntry,
} from '../outbox';
import { api } from '../api-client';
import { newCommentId, withUpdate } from './comment-cache';

/*
 * Comments without a connection (BER-164): what is done to comments – written, answered, changed,
 * resolved, reacted to, deleted, a recording or pictures – goes through this outbox, one deck's
 * after another in the order done, and is kept in the browser until the server took it (the
 * editor's outbox store, `features/viewer/editing/outbox.ts`): a reload or a closed tab loses
 * nothing, it is sent once the server can be reached again. A new comment carries its own id
 * (`newCommentId`): a reply, a change or a delete queued after it names it, and sent again after
 * a lost answer the server returns the one saved first. What is queued is shown at once over the
 * server's list (`withQueued`) – a new comment pending until it is saved.
 *
 * Changes to a comment not sent yet go into it (`fold`): deleted, it never goes out at all.
 * Refused by the server (its slide gone meanwhile, rights taken away): dropped with what depends
 * on it, said once – never tried again.
 */

/** The entries' format: one of another is dropped when found. */
export const COMMENT_OUTBOX_VERSION = 1;

/** A recording kept for sending later: its bytes and what the upload says about it. */
export interface QueuedRecording {
  kind: CommentMedia['kind'];
  blob: Blob;
  mimeType: string;
  durationMs: number;
  peaks: number[];
}

/** What a media comment sends besides its text: the recording and the images (PNGs, in order). */
export interface QueuedMedia {
  recording: QueuedRecording | null;
  images: Blob[];
}

/** One thing done to the deck's comments, as it goes to the server. */
export type CommentAction =
  | {
      type: 'create';
      /** As shown until the server has it. */
      comment: Comment;
      input: CreateCommentInput & { id: string };
      media?: QueuedMedia;
    }
  | { type: 'update'; commentId: string; input: UpdateCommentInput }
  | { type: 'react'; commentId: string; kind: CommentReactionKind | null; author: Author }
  | { type: 'delete'; commentId: string; keepDrawing?: boolean };

export interface CommentOutboxEntry extends QueuedEntry {
  action: CommentAction;
}

/** What the outbox needs from the app: the API, the query cache, the session. */
export interface CommentTransport {
  /** Sends one action; the comment the server returns (`null` for a delete). */
  send(deckId: string, action: CommentAction): Promise<Comment | null>;
  /** Taken: the answer goes into the query cache (`settled`: nothing of the deck left to send). */
  answered(deckId: string, action: CommentAction, answer: Comment | null, settled: boolean): void;
  /** Refused for good: the deck's comments asked for anew. */
  refused(deckId: string, action: CommentAction, error: unknown): void;
  /** Whether the browser has a connection: without, nothing is tried. */
  online(): boolean;
  /** The signed-in account as the app knows it, `undefined` while it does not. */
  currentUser(): string | undefined;
  /** Asks the server who is signed in: their id, `null` nobody, `undefined` out of reach. */
  whoAmI(): Promise<string | null | undefined>;
  /** A request found the session ended (the app goes to the login). */
  sessionEnded(error: unknown): void;
}

/** What became of an action for whoever waits for it: the server's answer, or kept to send later. */
export type CommentOutcome = { sent: true; answer: Comment | null } | { sent: false };

interface Waiter {
  resolve(outcome: CommentOutcome): void;
  reject(error: unknown): void;
}

interface Item {
  entry: CommentOutboxEntry;
  /** Tried once already: it may have arrived, so nothing is folded into it any more. */
  attempted: boolean;
  /** Shown over the server's list – at once, or once it is held (`enqueue`'s `shown`). */
  shown: boolean;
  attempts: number;
  serverErrors: number;
  waiters: Waiter[];
  /** Let go of while on its way (another account signed in): not sent again from here. */
  forgotten?: boolean;
}

interface DeckQueue {
  deckId: string;
  items: Item[];
  pumping: boolean;
  retry: ReturnType<typeof setTimeout> | null;
  /** The shown actions, one array while they stay the same (`useSyncExternalStore`). */
  shown: readonly CommentAction[];
}

export interface CommentOutbox {
  /**
   * Queues `action` made under `userId` on `deckId`. `done` resolves with the server's answer,
   * or at once `{ sent: false }` while the server is out of reach (kept, sent later); it rejects
   * when the server refuses it – told to whoever waits, not as a toast (`onRefused`). Without
   * `shown`, a new comment shows only once it is held: until then the draft shows it.
   */
  enqueue(
    deckId: string,
    userId: string,
    action: CommentAction,
    options?: { shown?: boolean },
  ): { done: Promise<CommentOutcome> };
  /** The deck's actions not taken yet, as shown over its comments, in the order done. */
  queued(deckId: string): readonly CommentAction[];
  /** Whether the comment is still on its way to the server (written here, not saved yet). */
  isPending(commentId: string): boolean;
  subscribe(listener: () => void): () => void;
  /** Refused when nobody waited for it any more (sent later, or after a reload): to say so. */
  onRefused(listener: (error: unknown, action: CommentAction) => void): () => void;
  /** Actions of the signed-in account not sent yet, this tab's and those others keep. */
  unsent(): Promise<number>;
  setUser(userId: string | null): void;
  /** Takes over and sends what tabs no longer open left of this account. */
  drain(): Promise<void>;
  /** Any answer of the server's: when paused for an ended session, goes on once it is valid. */
  resume(): void;
  /** The connection is back: what is held goes out now. */
  retryNow(): void;
}

const NONE: readonly CommentAction[] = [];

/** The comment an action is about (a reply's root too, for a new reply). */
const refersTo = (action: CommentAction, ids: ReadonlySet<string>) =>
  action.type === 'create'
    ? ids.has(action.comment.id) ||
      (action.input.parentId != null && ids.has(action.input.parentId))
    : ids.has(action.commentId);

/**
 * A media comment kept from before (another page load): what it shows plays and shows from its
 * kept files again – the object URLs made then are gone with that page.
 */
function withFreshUrls(action: CommentAction): CommentAction {
  if (action.type !== 'create' || !action.media || typeof URL.createObjectURL !== 'function')
    return action;
  const { recording, images } = action.media;
  const { comment } = action;
  return {
    ...action,
    comment: {
      ...comment,
      media:
        comment.media && recording
          ? { ...comment.media, url: URL.createObjectURL(recording.blob) }
          : comment.media,
      images: comment.images?.map((image, index) => {
        const blob = images[index];
        return blob ? { ...image, url: URL.createObjectURL(blob) } : image;
      }),
    },
  };
}

/** After a session ended, whether it is valid again is asked at most this often. */
const SESSION_CHECK_MS = 5000;

export function createCommentOutbox(
  store: OutboxStore<CommentOutboxEntry>,
  transport: CommentTransport,
): CommentOutbox {
  const decks = new Map<string, DeckQueue>();
  const watchers = new Set<() => void>();
  const refusedListeners = new Set<(error: unknown, action: CommentAction) => void>();
  let user: string | null = null;
  let unreachable = false;
  let paused = false;
  let checkingSession: Promise<void> | null = null;
  let sessionCheckedAt = -Infinity;
  let draining: Promise<void> | null = null;

  const queueOf = (deckId: string): DeckQueue => {
    let deck = decks.get(deckId);
    if (!deck) {
      deck = { deckId, items: [], pumping: false, retry: null, shown: NONE };
      decks.set(deckId, deck);
    }
    return deck;
  };

  const publish = () => {
    for (const deck of decks.values()) {
      const shown = deck.items.filter((item) => item.shown).map((item) => item.entry.action);
      const same =
        shown.length === deck.shown.length &&
        shown.every((action, index) => action === deck.shown[index]);
      if (!same) deck.shown = shown.length === 0 ? NONE : shown;
      if (deck.items.length === 0 && !deck.pumping && deck.retry === null)
        decks.delete(deck.deckId);
    }
    for (const watcher of watchers) watcher();
  };

  /** Held for later: shown, and whoever waits goes on (`{ sent: false }`). */
  const hold = (deck: DeckQueue) => {
    for (const item of deck.items) {
      item.shown = true;
      for (const waiter of item.waiters.splice(0)) waiter.resolve({ sent: false });
    }
  };

  const scheduleRetry = (deck: DeckQueue, attempts: number) => {
    if (deck.retry !== null) clearTimeout(deck.retry);
    deck.retry = setTimeout(() => {
      deck.retry = null;
      void pump(deck);
    }, retryDelay(attempts));
  };

  /** Takes items out of line (not sent from here): their waiters go on, kept or not. */
  const remove = (deck: DeckQueue, gone: readonly Item[], drop: boolean) => {
    if (gone.length === 0) return;
    deck.items = deck.items.filter((item) => !gone.includes(item));
    for (const item of gone) {
      if (drop) void store.drop(item.entry.id);
      else store.release([item.entry.id]);
      for (const waiter of item.waiters.splice(0)) waiter.resolve({ sent: false });
    }
  };

  /** What depends on a refused or folded-away new comment: its replies, and what was done to them. */
  const dependents = (deck: DeckQueue, commentId: string): Item[] => {
    const ids = new Set([commentId]);
    for (const item of deck.items) {
      const { action } = item.entry;
      if (action.type === 'create' && action.input.parentId === commentId)
        ids.add(action.comment.id);
    }
    return deck.items.filter((item) => refersTo(item.entry.action, ids));
  };

  const pump = async (deck: DeckQueue): Promise<void> => {
    if (deck.pumping || paused) return;
    deck.pumping = true;
    if (deck.retry !== null) clearTimeout(deck.retry);
    deck.retry = null;
    while (deck.items.length > 0 && !paused) {
      const item = deck.items[0]!;
      // Made under another account than the one signed in now: left in the browser for it.
      if (item.entry.userId !== user) {
        remove(deck, [item], false);
        publish();
        continue;
      }
      const signedIn = transport.currentUser();
      if (signedIn !== undefined && signedIn !== user) {
        pause();
        break;
      }
      // No connection: not even tried – waits for it (`retryNow`), changes still go into it.
      if (!transport.online()) {
        unreachable = true;
        hold(deck);
        break;
      }
      item.attempted = true;
      publish();
      let answer: Comment | null = null;
      let failure: unknown = null;
      let ok = false;
      try {
        answer = await transport.send(deck.deckId, item.entry.action);
        ok = true;
      } catch (error) {
        failure = error;
      }
      // An error without an answer's status (a file that cannot be read, a bug) is no lost
      // connection: tried a few times like a server error, then given up on – never a loop.
      const answered = typeof failure === 'object' && failure !== null && 'status' in failure;
      if (!ok && (!answered || statusOf(failure) === 500)) item.serverErrors += 1;
      // Deleted already (by someone else, or a try whose answer was lost): done all the same.
      const gone = !ok && item.entry.action.type === 'delete' && statusOf(failure) === 404;
      const outcome =
        ok || gone
          ? 'done'
          : answered
            ? sendOutcome(failure, item.serverErrors)
            : item.serverErrors < SERVER_ERROR_TRIES
              ? 'retry'
              : 'refused';
      if (outcome !== 'signedOut') {
        const cameBack = unreachable && outcome !== 'unreachable';
        unreachable = outcome === 'unreachable';
        if (cameBack) for (const other of decks.values()) if (other !== deck) void pump(other);
      }
      if (item.forgotten) {
        if (outcome === 'done' || outcome === 'refused') void store.drop(item.entry.id);
        else store.release([item.entry.id]);
        publish();
        continue;
      }
      if (outcome === 'signedOut') {
        transport.sessionEnded(failure);
        pause();
        break;
      }
      if (outcome === 'unreachable' || outcome === 'retry') {
        item.attempts += 1;
        hold(deck);
        scheduleRetry(deck, item.attempts);
        break;
      }
      deck.items.shift();
      void store.drop(item.entry.id);
      const { action } = item.entry;
      if (outcome === 'done') {
        transport.answered(deck.deckId, action, answer, deck.items.length === 0);
        for (const waiter of item.waiters.splice(0)) waiter.resolve({ sent: true, answer });
      } else {
        // A new comment refused: what was queued on it goes too, never sent.
        if (action.type === 'create') remove(deck, dependents(deck, action.comment.id), true);
        transport.refused(deck.deckId, action, failure);
        if (item.waiters.length > 0)
          for (const waiter of item.waiters.splice(0)) waiter.reject(failure);
        else for (const listener of refusedListeners) listener(failure, action);
      }
      publish();
    }
    deck.pumping = false;
    publish();
  };

  const pumpAll = () => {
    for (const deck of decks.values()) void pump(deck);
  };

  function pause(): void {
    if (paused) return;
    paused = true;
    for (const deck of decks.values()) {
      hold(deck);
      if (deck.retry !== null) clearTimeout(deck.retry);
      deck.retry = null;
    }
    publish();
  }

  /** The new comment `id` while it has not gone out: what is done to it can go into it. */
  const unsentCreate = (deck: DeckQueue, id: string) =>
    deck.items.find(
      (item) =>
        !item.attempted &&
        item.entry.action.type === 'create' &&
        item.entry.action.comment.id === id,
    );

  /**
   * Folds `action` into what is queued, where it can: a delete of a comment not sent yet takes it
   * (and what depends on it) out of line – nothing goes; a change of its text, marks or place goes
   * into it; a delete takes out changes not sent yet. `true`: nothing more to queue.
   */
  const fold = (deck: DeckQueue, action: CommentAction): boolean => {
    if (action.type === 'delete') {
      const created = unsentCreate(deck, action.commentId);
      if (created && !action.keepDrawing) {
        remove(deck, dependents(deck, action.commentId), true);
        return true;
      }
      if (!action.keepDrawing)
        remove(
          deck,
          deck.items.filter(
            (item) =>
              !item.attempted &&
              item.entry.action.type !== 'create' &&
              item.entry.action.commentId === action.commentId,
          ),
          true,
        );
      return false;
    }
    if (action.type !== 'update' || action.input.status !== undefined) return false;
    const created = unsentCreate(deck, action.commentId);
    if (!created || created.entry.action.type !== 'create') return false;
    const queued = created.entry.action;
    const comment = withUpdate(queued.comment, action.input);
    created.entry = {
      ...created.entry,
      action: {
        ...queued,
        comment,
        input: {
          ...queued.input,
          body: comment.body,
          anchor: comment.anchor,
          strokes: comment.strokes,
        },
      },
    };
    void store.keep(created.entry);
    return true;
  };

  const takeOver = async (deckId?: string) => {
    const userId = user;
    if (!userId) return;
    const { entries } = await store.takeOver(userId, deckId);
    if (user !== userId) {
      store.release(entries.map((entry) => entry.id));
      return;
    }
    for (const kept of entries) {
      const entry = { ...kept, action: withFreshUrls(kept.action) };
      const deck = queueOf(entry.deckId);
      if (deck.items.some((item) => item.entry.id === entry.id)) continue;
      // Left from before: it may have gone out already – nothing is folded into it. In the order
      // made, after the one on its way.
      const item: Item = {
        entry,
        attempted: true,
        shown: true,
        attempts: 0,
        serverErrors: 0,
        waiters: [],
      };
      const from = deck.pumping ? 1 : 0;
      const at = deck.items.findIndex((other, index) => index >= from && other.entry.at > entry.at);
      deck.items.splice(at === -1 ? deck.items.length : at, 0, item);
    }
    publish();
    pumpAll();
  };

  const forgetAll = (release: boolean) => {
    for (const deck of decks.values()) {
      if (deck.retry !== null) clearTimeout(deck.retry);
      deck.retry = null;
      const gone = deck.items;
      deck.items = [];
      if (deck.pumping && gone[0]) gone[0].forgotten = true;
      if (release)
        store.release(gone.filter((item) => !item.forgotten).map((item) => item.entry.id));
      for (const item of gone)
        for (const waiter of item.waiters.splice(0)) waiter.resolve({ sent: false });
    }
    unreachable = false;
    publish();
  };

  store.onForgotten(() => forgetAll(false));

  function resume(): void {
    if (!paused || checkingSession || Date.now() - sessionCheckedAt < SESSION_CHECK_MS) return;
    sessionCheckedAt = Date.now();
    checkingSession = transport
      .whoAmI()
      .then((signedIn) => {
        if (!signedIn || signedIn !== user) return;
        paused = false;
        publish();
        pumpAll();
      })
      .finally(() => {
        checkingSession = null;
      });
  }

  return {
    enqueue(deckId, userId, action, { shown = true } = {}) {
      user ??= userId;
      const deck = queueOf(deckId);
      if (fold(deck, action)) {
        publish();
        return { done: Promise.resolve<CommentOutcome>({ sent: false }) };
      }
      let waiter!: Waiter;
      const done = new Promise<CommentOutcome>((resolve, reject) => (waiter = { resolve, reject }));
      const entry: CommentOutboxEntry = {
        v: COMMENT_OUTBOX_VERSION,
        id: newCommentId(),
        deckId,
        userId,
        tab: OUTBOX_TAB,
        at: Date.now(),
        action,
      };
      const item: Item = {
        entry,
        attempted: false,
        shown,
        attempts: 0,
        serverErrors: 0,
        waiters: [waiter],
      };
      deck.items.push(item);
      void store.keep(entry);
      // Held (no connection, the server away or busy, the session ended): kept, shown – whoever
      // waits goes on; tried with the deck's next try.
      if (paused || deck.retry !== null || !transport.online()) {
        hold(deck);
        if (!paused && !transport.online()) unreachable = true;
      } else void pump(deck);
      publish();
      return { done };
    },

    queued: (deckId) => decks.get(deckId)?.shown ?? NONE,

    isPending(commentId) {
      for (const deck of decks.values())
        for (const item of deck.items) {
          const { action } = item.entry;
          if (action.type === 'create' && action.comment.id === commentId) return true;
        }
      return false;
    },

    subscribe(watcher) {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },

    onRefused(listener) {
      refusedListeners.add(listener);
      return () => refusedListeners.delete(listener);
    },

    async unsent() {
      const here = [...decks.values()].flatMap((deck) => deck.items.map((item) => item.entry.id));
      const kept = user ? await store.keptOf(user) : [];
      return new Set([...here, ...kept]).size;
    },

    setUser(userId) {
      if (userId === user) return;
      const before = user;
      user = userId;
      if (before !== null) forgetAll(true);
      if (userId === null) return;
      if (paused) {
        paused = false;
        sessionCheckedAt = -Infinity;
        publish();
      }
      void takeOver();
    },

    drain: () =>
      (draining ??= takeOver().finally(() => {
        draining = null;
      })),

    resume,

    retryNow() {
      if (paused) resume();
      else pumpAll();
    },
  };
}

/** What a store keeps in memory only: the outbox without the browser's (tests, no IndexedDB). */
export function memoryCommentStore(): OutboxStore<CommentOutboxEntry> & {
  entries: Map<string, CommentOutboxEntry>;
} {
  const entries = new Map<string, CommentOutboxEntry>();
  const held = new Set<string>();
  return {
    entries,
    keep: async (entry) => {
      entries.set(entry.id, entry);
      held.add(entry.id);
    },
    drop: async (id) => {
      entries.delete(id);
      held.delete(id);
    },
    takeOver: async (userId, deckId) => ({
      entries: [...entries.values()]
        .filter(
          (entry) =>
            entry.userId === userId &&
            !held.has(entry.id) &&
            (deckId === undefined || entry.deckId === deckId),
        )
        .sort((a, b) => a.at - b.at)
        .map((entry) => {
          held.add(entry.id);
          return { ...entry, tab: OUTBOX_TAB };
        }),
      outdated: 0,
    }),
    release: (ids) => {
      for (const id of ids) held.delete(id);
    },
    keptOf: async (userId) =>
      [...entries.values()].filter((entry) => entry.userId === userId).map((entry) => entry.id),
    onForgotten: () => () => {},
  };
}

/** Sends one action through the API – a media comment through `sendMedia`. */
export function sendCommentAction(
  deckId: string,
  action: CommentAction,
  sendMedia?: (
    deckId: string,
    action: Extract<CommentAction, { type: 'create' }>,
  ) => Promise<Comment>,
): Promise<Comment | null> {
  switch (action.type) {
    case 'create':
      if (action.media && sendMedia) return sendMedia(deckId, action);
      return api.post<Comment>(`/decks/${deckId}/comments`, action.input);
    case 'update':
      return api.patch<Comment>(`/comments/${action.commentId}`, action.input);
    case 'react':
      return api.put<Comment>(`/comments/${action.commentId}/reaction`, { kind: action.kind });
    case 'delete':
      return api
        .delete(`/comments/${action.commentId}${action.keepDrawing ? '?keep=drawing' : ''}`)
        .then(() => null);
  }
}

/**
 * The app's one comment outbox (`installCommentOutbox` sets it with the browser's store and the
 * query cache); until then – in tests – one in memory, straight through the API.
 */
let installed: CommentOutbox | null = null;

export function setCommentOutbox(outbox: CommentOutbox): void {
  installed = outbox;
}

export function commentOutbox(): CommentOutbox {
  installed ??= createCommentOutbox(memoryCommentStore(), {
    send: (deckId, action) => sendCommentAction(deckId, action),
    answered: () => {},
    refused: () => {},
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    currentUser: () => undefined,
    whoAmI: async () => undefined,
    sessionEnded: () => {},
  });
  return installed;
}

/** Not saved yet: written here, on its way to the server (or held until it can be reached). */
export const isPendingComment = (comment: Pick<Comment, 'id'>) =>
  commentOutbox().isPending(comment.id);
