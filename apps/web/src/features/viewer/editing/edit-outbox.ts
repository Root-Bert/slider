import type { ApplyEditInput, ApplyEditResult, SlideOperation } from '@slider/shared';
import {
  OUTBOX_TAB,
  OUTBOX_VERSION,
  retryDelay,
  sendOutcome,
  statusOf,
  type OutboxEntry,
  type OutboxStore,
} from './outbox';

/*
 * Sending the editor's edits (BER-181), outside React: one queue a deck, sent one after another –
 * each on the step the one before made – under its own id (`clientEditId`, applied once however
 * often it goes). The queue lives here, not in the editor: leaving the deck (or the viewer) while
 * edits are on their way or held back sends them all the same, and what tabs no longer open left
 * in the browser's outbox (`outbox.ts`) is taken over and sent too, whichever deck is open.
 *
 * The editor attaches to its deck (`attach`) to show its edits at once and to hear what the
 * server made of them; detached, the queue goes on alone. The server out of reach: edits are
 * held and tried again, waiting longer each time; the session ended (401), or the server finds
 * another account signed in than the edit names (409 `account_changed`): nothing goes until the
 * same account is signed in again – never under another one.
 */

/** What the outbox needs from the app: the API, the query cache, the session. */
export interface OutboxTransport {
  send(deckId: string, input: ApplyEditInput): Promise<ApplyEditResult>;
  /** The server's answer: stored as the deck's edit state, its slides reloaded. */
  answered(deckId: string, answer: ApplyEditResult): void;
  /** The step of the deck's last answer (the query cache), `undefined` when none is there. */
  currentSeq(deckId: string): number | undefined;
  /** The signed-in account as the app knows it (`/api/me`), `undefined` while it does not. */
  currentUser(): string | undefined;
  /** Asks the server who is signed in: their id, `null` nobody, `undefined` out of reach. */
  whoAmI(): Promise<string | null | undefined>;
  /** A request found the session ended (the app goes to the login). */
  sessionEnded(error: unknown): void;
}

/** What an attached editor hears about its deck's edits. */
export interface OutboxListener {
  /** An edit it did not make here (left by a tab before, or made before it attached): to show. */
  added(id: string, operations: readonly SlideOperation[]): void;
  /**
   * The server took it: its answer, and the step it was sent on – the `baseSeq` the server got
   * (for one held back, the step it was made on; the server may have applied it on a later one).
   */
  taken(id: string, answer: ApplyEditResult, sentOn: number | undefined): void;
  /** Refused for good (a toast says why). */
  refused(id: string, error: unknown): void;
  /** Done with either way: what it showed can go (`ok`: the server has it). */
  settled(id: string, ok: boolean): void;
}

/** The outbox as the editor shows it. */
export interface OutboxStatus {
  /** The deck's edits the server does not have yet. */
  pending: number;
  /** One is on its way. */
  sending: boolean;
  /** The last try found the server out of reach: edits are held and tried again. */
  unreachable: boolean;
  /** The session ended: nothing goes until the account is signed in again. */
  paused: boolean;
}

interface Item {
  /** Its entry in the outbox, and its `clientEditId`. */
  id: string;
  userId: string;
  operations: SlideOperation[];
  coalesce?: string;
  /** The edit step it was made on. */
  baseSeq: number | undefined;
  /** When it was made (ms since 1970) – merged with newer ones (`coalesce`), it keeps its place. */
  at: number;
  /**
   * Held back – the server was out of reach, it is left from before, or nobody shows it any more:
   * sent on the step it was made on, so the server applies what still fits (rather than refusing
   * all of it, with nobody there to say why).
   */
  onOwnStep: boolean;
  /** Tries that found the server out of reach, for the wait before the next. */
  attempts: number;
  /** Tries the server failed with an internal error (500): given up on after a few. */
  serverErrors: number;
  /**
   * Sent once already (or left from before): it may have been applied, so it goes again as it
   * was – under its id the server applies it once – and newer edits are not merged into it.
   */
  sent: boolean;
  /** Whoever waits for it: answered when it is settled, or let go on while it is held. */
  waiters: ((ok: boolean) => void)[];
  /**
   * Let go of while on its way (another account signed in, or the outbox wiped): out of the queue
   * already, and once its try settles only taken off the browser's outbox (or left there for its
   * account) – never sent again from here, nor its answer stored for the account signed in now.
   */
  forgotten?: boolean;
}

interface DeckQueue {
  deckId: string;
  items: Item[];
  /** The one on its way: not merged with newer ones (`coalesce`), not overtaken. */
  inFlight: Item | null;
  /** Its edits are being sent (`pump` runs): one loop a deck, never two at once. */
  pumping: boolean;
  retry: ReturnType<typeof setTimeout> | null;
  /** Sending is held for something else on its way (a take-back, `holdWhenSettled`). */
  holds: number;
  listeners: Set<OutboxListener>;
  status: OutboxStatus;
}

/** After an ended session, whether it is valid again is asked at most this often. */
const SESSION_CHECK_MS = 5000;

/** A deck with nothing queued, the server there. */
const NOTHING: OutboxStatus = { pending: 0, sending: false, unreachable: false, paused: false };

export interface EditOutbox {
  /**
   * Queues operations made under `userId` on `deckId`: sent once those before have gone. With
   * `coalesce`, they replace those of the last queued edit when it has that key and has not gone out.
   * `done` settles once the server has them (`false`: refused) – or at once while edits are held.
   */
  enqueue(
    deckId: string,
    userId: string,
    operations: SlideOperation[],
    options?: { coalesce?: string },
  ): { id: string; done: Promise<boolean> };
  /** An editor shows the deck: told about its edits (those queued already at once). */
  attach(deckId: string, listener: OutboxListener): () => void;
  status(deckId: string): OutboxStatus;
  /** The ids of the deck's edits not settled yet, in the order they go. */
  queued(deckId: string): string[];
  subscribe(listener: () => void): () => void;
  /**
   * Resolves `true` once the deck has no edit left to send – `false` when it is not sent within
   * `timeoutMs`, or edits are held (out of reach, signed out).
   */
  settled(deckId: string, timeoutMs: number): Promise<boolean>;
  /**
   * Waits like `settled`, then holds the deck's sending – edits made meanwhile wait – until the
   * function it resolves to is called: something else sent on the step the last edit made (a
   * take-back) is not overtaken by them. `null` when the deck did not settle (nothing held).
   */
  holdWhenSettled(deckId: string, timeoutMs: number): Promise<(() => void) | null>;
  /**
   * Edits of the signed-in account not sent yet: this tab's, of every deck, and those other tabs
   * keep in the browser – signing out drops them all (`forgetOffline`), not only this tab's.
   */
  unsent(): Promise<number>;
  /** Like `settled`, for every deck: before signing out, what is still to send. */
  allSettled(timeoutMs: number): Promise<boolean>;
  /** The signed-in account (`null`: nobody): its edits left behind are taken over and sent. */
  setUser(userId: string | null): void;
  /** Takes over and sends what tabs no longer open left of this account, every deck. */
  drain(): Promise<void>;
  /**
   * Something suggests the session may be valid again (any answer of the server's): when sending
   * paused for an ended session, it goes on once the server names the same account signed in.
   */
  resume(): void;
  /** The connection is back (or the tab is): edits held for the server go out now, not later. */
  retryNow(): void;
  /** Edits not sent yet while the server is out of reach – the tab should not close unasked. */
  unsentWhileUnreachable(): boolean;
}

export function createEditOutbox(store: OutboxStore, transport: OutboxTransport): EditOutbox {
  const decks = new Map<string, DeckQueue>();
  const watchers = new Set<() => void>();
  let user: string | null = null;
  // The server out of reach (the last try of any deck found it so) – it is one server for all.
  let unreachable = false;
  // The session ended: no deck sends until `resume` finds the same account signed in again.
  let paused = false;
  let checkingSession: Promise<void> | null = null;
  let sessionCheckedAt = -Infinity;
  // The status of a deck with nothing queued: one object while it holds (`useSyncExternalStore`).
  let idle: OutboxStatus = NOTHING;
  // The take-over of every deck's edits under way (`drain`), shared by whoever asks meanwhile.
  let draining: Promise<void> | null = null;
  // The account whose outbox was wiped (signed out, here or in another tab) while this tab still
  // shows its edits: what it makes meanwhile is kept in memory only – written, it would open the
  // browser's outbox anew for an account signed out – until the server takes one of its edits or
  // names it signed in again (`confirmed`), or another account signs in.
  let forgottenUser: string | null = null;

  const queueOf = (deckId: string): DeckQueue => {
    let deck = decks.get(deckId);
    if (!deck) {
      deck = {
        deckId,
        items: [],
        inFlight: null,
        pumping: false,
        retry: null,
        holds: 0,
        listeners: new Set(),
        status: NOTHING,
      };
      decks.set(deckId, deck);
    }
    return deck;
  };

  /** The deck's status anew (a new object only when it changed), and everyone told. */
  const publish = () => {
    if (idle.unreachable !== unreachable || idle.paused !== paused) {
      idle = { ...NOTHING, unreachable, paused };
    }
    for (const deck of decks.values()) {
      const next: OutboxStatus = {
        pending: deck.items.length,
        sending: deck.inFlight !== null,
        unreachable,
        paused,
      };
      const now = deck.status;
      if (
        now.pending !== next.pending ||
        now.sending !== next.sending ||
        now.unreachable !== next.unreachable ||
        now.paused !== next.paused
      ) {
        deck.status = next;
      }
      // Nothing left, nothing on its way and nobody showing it: forgotten. (A try let go of may
      // still be on its way: its loop goes on with what is queued after it, never a second one.)
      if (
        deck.items.length === 0 &&
        deck.listeners.size === 0 &&
        deck.retry === null &&
        !deck.pumping &&
        deck.holds === 0
      ) {
        decks.delete(deck.deckId);
      }
    }
    for (const watcher of watchers) watcher();
  };

  const entryOf = (deckId: string, item: Item): OutboxEntry => ({
    v: OUTBOX_VERSION,
    id: item.id,
    deckId,
    userId: item.userId,
    tab: OUTBOX_TAB,
    operations: item.operations,
    baseSeq: item.baseSeq,
    at: item.at,
  });

  /** Keeps an edit in the browser's outbox – not for an account signed out (`forgottenUser`). */
  const keep = (deckId: string, item: Item) => {
    if (item.userId !== forgottenUser) void store.keep(entryOf(deckId, item));
  };

  /**
   * The account is signed in after all (the server took an edit of it, or named it): what it made
   * since its outbox was wiped is kept in the browser again.
   */
  const confirmed = (userId: string) => {
    if (forgottenUser !== userId) return;
    forgottenUser = null;
    for (const deck of decks.values()) {
      for (const item of deck.items) if (item.userId === userId) keep(deck.deckId, item);
    }
  };

  /** Everyone waiting for an edit of the deck goes on: they are kept, to be sent later. */
  const letWaitersGoOn = (deck: DeckQueue) => {
    for (const item of deck.items) for (const done of item.waiters.splice(0)) done(true);
  };

  /** Nothing goes out now: the server out of reach, or the session ended (paused). */
  const sendingStopped = () => unreachable || paused;

  const scheduleRetry = (deck: DeckQueue, attempts: number) => {
    if (deck.retry !== null) clearTimeout(deck.retry);
    deck.retry = setTimeout(() => {
      deck.retry = null;
      void pump(deck);
    }, retryDelay(attempts));
  };

  /** Takes an edit out of line that is not to be sent from here: settled, for nobody to wait. */
  const letGoOf = (deck: DeckQueue, item: Item) => {
    deck.items = deck.items.filter((other) => other !== item);
    store.release([item.id]);
    for (const listener of deck.listeners) listener.settled(item.id, false);
    for (const done of item.waiters.splice(0)) done(false);
  };

  const pump = async (deck: DeckQueue): Promise<void> => {
    if (deck.pumping || paused || deck.holds > 0) return;
    deck.pumping = true;
    if (deck.retry !== null) clearTimeout(deck.retry);
    deck.retry = null;
    while (deck.items.length > 0 && !paused && deck.holds === 0) {
      const item = deck.items[0] as Item;
      // Made under another account than the one signed in here now (an editor that had not heard
      // of the switch yet): left in the browser for that account, not sent – nor waited for.
      if (item.userId !== user) {
        letGoOf(deck, item);
        publish();
        continue;
      }
      // The app knows of another account than the outbox does (another tab signed in): nothing
      // goes out until the two agree – the outbox follows the app's account (`setUser`).
      const signedIn = transport.currentUser();
      if (signedIn !== undefined && signedIn !== user) {
        pause();
        break;
      }
      deck.inFlight = item;
      publish();
      // Sent at once while it is shown: on the step the edit before made (the cache has the
      // server's last answer), refused when it does not fit. Held back, or nobody shows it: on
      // the step it was made on, the server applying what still fits.
      const lenient = item.onOwnStep || deck.listeners.size === 0;
      const sentOn = lenient ? item.baseSeq : transport.currentSeq(deck.deckId);
      item.sent = true;
      let answer: ApplyEditResult | null = null;
      let failure: unknown = null;
      try {
        answer = await transport.send(deck.deckId, {
          operations: item.operations,
          baseSeq: sentOn,
          clientEditId: item.id,
          // The server refuses it when another account is signed in by now (this tab's account
          // may be out of date): never applied as someone else's.
          userId: item.userId,
        });
      } catch (error) {
        failure = error;
      }
      deck.inFlight = null;
      if (!answer && statusOf(failure) === 500) item.serverErrors += 1;
      const outcome = answer ? 'done' : sendOutcome(failure, item.serverErrors);
      if (outcome !== 'signedOut') {
        // Any answer of the server's, a refusal or a busy one too: it is there again – for the
        // other decks too. Only no answer at all shows the editor offline.
        const cameBack = unreachable && outcome !== 'unreachable';
        unreachable = outcome === 'unreachable';
        if (cameBack) for (const other of decks.values()) if (other !== deck) void pump(other);
      }
      if (item.forgotten) {
        // Let go of while on its way: whoever waited was told already. Taken (or refused for
        // good): off the browser's outbox; otherwise left there for its account to send.
        if (outcome === 'done' || outcome === 'refused') void store.drop(item.id);
        else store.release([item.id]);
        publish();
        continue;
      }
      if (outcome === 'signedOut') {
        // Kept as it is, first in line; whoever waits goes on.
        item.onOwnStep = true;
        transport.sessionEnded(failure);
        pause();
        break;
      }
      if (outcome === 'unreachable' || outcome === 'retry') {
        // Kept (in the queue and in the browser) and sent again later – out of reach or the
        // server busy alike; whoever waits goes on – for every edit kept, also those made while
        // this try was on its way.
        item.onOwnStep = true;
        item.attempts += 1;
        letWaitersGoOn(deck);
        scheduleRetry(deck, item.attempts);
        break;
      }
      deck.items.shift();
      void store.drop(item.id);
      if (outcome === 'done') confirmed(item.userId);
      const ok = outcome === 'done';
      for (const listener of deck.listeners) {
        if (answer) listener.taken(item.id, answer, sentOn);
        else listener.refused(item.id, failure);
        listener.settled(item.id, ok);
      }
      if (answer) transport.answered(deck.deckId, answer);
      for (const done of item.waiters.splice(0)) done(ok);
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
      letWaitersGoOn(deck);
      if (deck.retry !== null) clearTimeout(deck.retry);
      deck.retry = null;
    }
    publish();
  }

  /** Puts an edit taken over from the outbox in line: in the order made, after the one on its way. */
  const insert = (deck: DeckQueue, entry: OutboxEntry) => {
    if (deck.items.some((item) => item.id === entry.id)) return;
    const item: Item = {
      id: entry.id,
      userId: entry.userId,
      operations: entry.operations,
      baseSeq: entry.baseSeq,
      at: entry.at,
      onOwnStep: true,
      attempts: 0,
      serverErrors: 0,
      sent: true,
      waiters: [],
    };
    const from = deck.inFlight && deck.items[0] === deck.inFlight ? 1 : 0;
    const at = deck.items.findIndex((other, index) => index >= from && other.at > item.at);
    deck.items.splice(at === -1 ? deck.items.length : at, 0, item);
    for (const listener of deck.listeners) listener.added(item.id, item.operations);
  };

  const takeOver = async (deckId?: string) => {
    const userId = user;
    // Signed out (its outbox wiped): nothing of it is left, nor is the outbox opened anew for it.
    if (!userId || userId === forgottenUser) return;
    const { entries, outdated } = await store.takeOver(userId, deckId);
    if (outdated > 0) {
      console.warn(
        `Slider: ${outdated} unsent edit(s) of an older app version were dropped from the outbox.`,
      );
    }
    // Another account signed in meanwhile: not this one's to send.
    if (user !== userId) {
      store.release(entries.map((entry) => entry.id));
      return;
    }
    for (const entry of entries) insert(queueOf(entry.deckId), entry);
    publish();
    pumpAll();
  };

  /**
   * Lets go of every edit held here (another account signed in, or the outbox was wiped): the
   * editors drop what they showed, nobody waits any longer. One on its way is marked to be let go
   * of once its try settles (`forgotten`) – not put back in line, where it would stand before the
   * next account's edits and go out again. (`release`: left in the browser for their account.)
   */
  const forgetAll = (release: boolean) => {
    for (const deck of decks.values()) {
      if (deck.retry !== null) clearTimeout(deck.retry);
      deck.retry = null;
      const gone = deck.items;
      deck.items = [];
      if (deck.inFlight) deck.inFlight.forgotten = true;
      if (release) store.release(gone.filter((item) => !item.forgotten).map((item) => item.id));
      for (const item of gone) {
        for (const listener of deck.listeners) listener.settled(item.id, false);
        for (const done of item.waiters.splice(0)) done(false);
      }
    }
    // Nothing held is left to try again: the next try tells whether the server is there.
    unreachable = false;
    publish();
  };

  store.onForgotten(() => {
    forgottenUser = user;
    forgetAll(false);
  });

  /**
   * Signed in again – as whom? Only the account the edits were made under sends them. Asked at
   * most every few seconds, however many answers come meanwhile.
   */
  function resume(): void {
    if (!paused || checkingSession || Date.now() - sessionCheckedAt < SESSION_CHECK_MS) return;
    sessionCheckedAt = Date.now();
    checkingSession = transport
      .whoAmI()
      .then((signedIn) => {
        if (!signedIn || signedIn !== user) return;
        confirmed(signedIn);
        paused = false;
        publish();
        pumpAll();
      })
      .finally(() => {
        checkingSession = null;
      });
  }

  const emptyDeck = (deckId: string) => (decks.get(deckId)?.items.length ?? 0) === 0;

  /**
   * Resolves `true` once `empty` holds (checked now and on every change), `false` after
   * `timeoutMs` or as soon as edits are held (out of reach, signed out) – they would not go.
   */
  const whenEmpty = (empty: () => boolean, timeoutMs: number) => {
    if (empty()) return Promise.resolve(true);
    if (sendingStopped()) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        watchers.delete(check);
        resolve(ok);
      };
      const check = () => {
        if (empty()) finish(true);
        else if (sendingStopped()) finish(false);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      watchers.add(check);
    });
  };

  return {
    enqueue(deckId, userId, operations, { coalesce } = {}) {
      user ??= userId;
      const deck = queueOf(deckId);
      let done!: (ok: boolean) => void;
      const promise = new Promise<boolean>((resolve) => (done = resolve));
      // Only into the last one: merged into an earlier edit, it would go out before the edits
      // made after that one (an undo's way back sent in between would then win).
      const last = deck.items.at(-1);
      const merged =
        coalesce && last?.coalesce === coalesce && !last.sent && last.userId === userId
          ? last
          : undefined;
      let item: Item;
      if (merged) {
        merged.operations = operations;
        merged.waiters.push(done);
        item = merged;
      } else {
        item = {
          id: crypto.randomUUID(),
          userId,
          operations,
          coalesce,
          baseSeq: transport.currentSeq(deckId),
          at: Date.now(),
          onOwnStep: false,
          attempts: 0,
          serverErrors: 0,
          sent: false,
          waiters: [done],
        };
        deck.items.push(item);
      }
      keep(deckId, item);
      publish();
      // The server away (or the session ended), or busy with a try of the deck's pending: kept
      // to be sent with the next try – whoever waits goes on, and a busy server is not asked
      // again at once for every edit made meanwhile. Out of reach, the deck tries again itself
      // when no try of its own is pending (its first edit since, or the tries were let go of).
      if (sendingStopped() || deck.retry !== null) {
        done(true);
        if (!paused && !deck.pumping && deck.retry === null) scheduleRetry(deck, 1);
      } else void pump(deck);
      return { id: item.id, done: promise };
    },

    attach(deckId, listener) {
      const deck = queueOf(deckId);
      deck.listeners.add(listener);
      for (const item of deck.items) listener.added(item.id, item.operations);
      void takeOver(deckId);
      return () => {
        deck.listeners.delete(listener);
        publish();
      };
    },

    status: (deckId) => decks.get(deckId)?.status ?? idle,

    queued: (deckId) => decks.get(deckId)?.items.map((item) => item.id) ?? [],

    subscribe(watcher) {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },

    settled: (deckId, timeoutMs) => whenEmpty(() => emptyDeck(deckId), timeoutMs),

    async holdWhenSettled(deckId, timeoutMs) {
      let release: (() => void) | null = null;
      // Held in the same turn the deck is found settled: nothing queued after can slip out first.
      const ok = await whenEmpty(() => {
        if (!emptyDeck(deckId)) return false;
        const deck = queueOf(deckId);
        deck.holds += 1;
        let released = false;
        release = () => {
          if (released) return;
          released = true;
          deck.holds -= 1;
          if (deck.holds === 0) void pump(deck);
          publish();
        };
        return true;
      }, timeoutMs);
      return ok ? release : null;
    },

    async unsent() {
      const here = [...decks.values()].flatMap((deck) => deck.items.map((item) => item.id));
      // Mostly the same edits: this tab's are kept in the browser too (unless it cannot).
      const kept = user ? await store.keptOf(user) : [];
      return new Set([...here, ...kept]).size;
    },

    allSettled: (timeoutMs) =>
      whenEmpty(() => [...decks.values()].every((deck) => deck.items.length === 0), timeoutMs),

    setUser(userId) {
      if (userId === user) return;
      const before = user;
      user = userId;
      forgottenUser = null;
      // Another account than the one whose edits are queued: they stay in the browser, for it.
      if (before !== null) forgetAll(true);
      if (userId === null) return;
      // Paused for the account before (its session ended, or the app knew of another one): this
      // one is signed in – the app has just heard so from the server.
      if (paused) {
        paused = false;
        sessionCheckedAt = -Infinity;
        publish();
      }
      void takeOver();
    },

    // Asked for twice at once (the tab's focus and its visibility come together): one take-over.
    drain: () =>
      (draining ??= takeOver().finally(() => {
        draining = null;
      })),

    resume,

    retryNow() {
      if (paused) resume();
      else pumpAll();
    },

    unsentWhileUnreachable: () =>
      unreachable && [...decks.values()].some((deck) => deck.items.length > 0),
  };
}
