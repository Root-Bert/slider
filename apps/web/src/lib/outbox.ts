/*
 * What the browser's outboxes share – the editor's edits (`features/viewer/editing/outbox.ts`,
 * `edit-outbox.ts`) and comments (`lib/api/comment-outbox.ts`): the entries kept, the store they
 * are kept in, the tab sending them, and what became of a try.
 */

/** What every entry kept here has, an edit or a comment. */
export interface QueuedEntry {
  /** The format (`OUTBOX_VERSION` for edits). */
  v: number;
  id: string;
  deckId: string;
  /** The account it was made under: sent by that account only. */
  userId: string;
  /** The tab that sends it. */
  tab: string;
  /** When it was made (ms since 1970): kept in the order made. */
  at: number;
}

/** What was taken over, and how many entries of another format were dropped on the way. */
export interface TakenOver<E extends QueuedEntry> {
  entries: E[];
  outdated: number;
}

/**
 * Where a sender keeps what it has not sent yet – the editor's edits, comments: the browser's
 * IndexedDB (`features/viewer/editing/outbox.ts`), memory in tests.
 */
export interface OutboxStore<E extends QueuedEntry> {
  keep(entry: E): Promise<void>;
  drop(id: string): Promise<void>;
  /**
   * Takes over the entries of `userId` that no tab sends any more – of one deck, or of all of them
   * – in the order they were made. Held from then on, until dropped or let go of (`release`).
   */
  takeOver(userId: string, deckId?: string): Promise<TakenOver<E>>;
  /** The sender let go of these (another account signed in): another may take them over. */
  release(ids: Iterable<string>): void;
  /**
   * The ids of every entry kept for `userId`, whichever tab sends it (or none any more) – once
   * the writes on their way are done. Signing out drops them all (`forgetOffline`).
   */
  keptOf(userId: string): Promise<string[]>;
  /** The store was wiped (signed out, here or in another tab): every edit kept is gone. */
  onForgotten(listener: () => void): () => void;
}

/** This page load: the tab its edits and comments belong to. */
export const OUTBOX_TAB = crypto.randomUUID();

/**
 * What became of sending an edit: taken (or refused for good); to be sent again later – the
 * server out of reach (`unreachable`: the editor shows itself offline) or there but not taking
 * it just now (`retry`: tried again quietly); or the session ended – kept until the same account
 * is signed in again.
 */
export type SendOutcome = 'done' | 'refused' | 'unreachable' | 'retry' | 'signedOut';

/** The HTTP status of a failed request; 0 for none (no connection, a network error). */
export const statusOf = (error: unknown): number =>
  error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : 0;

/**
 * An internal server error (500) may pass – a restart, a hiccup – or come every time (an edit the
 * server cannot apply): tried this often in all, then taken for its answer for good.
 */
export const SERVER_ERROR_TRIES = 5;

/**
 * No connection (status 0, or a timeout: 408), or a proxy in between without its server (502,
 * 504): out of reach, sent again later however long it takes. The server there but busy – too
 * many at once (429), LibreOffice busy (503) – is tried again the same way, but it answered: not
 * out of reach. An internal error (500) is tried again too, but only up to `SERVER_ERROR_TRIES`
 * (`tries`: this one included). The session ran out (401), or another account was signed in
 * meanwhile (409 `account_changed`): kept, never dropped for it, and not tried again blindly –
 * the sender waits until the account is signed in again. Anything else is the server's answer
 * for good – not allowed (403) too.
 */
export function sendOutcome(error: unknown, tries = 1): SendOutcome {
  const status = statusOf(error);
  if (status === 401) return 'signedOut';
  if (status === 409 && (error as { code?: unknown }).code === 'account_changed') {
    return 'signedOut';
  }
  if (status === 0 || status === 408 || status === 502 || status === 504) return 'unreachable';
  if (status === 429 || status === 503) return 'retry';
  if (status === 500) return tries < SERVER_ERROR_TRIES ? 'retry' : 'refused';
  return 'refused';
}

/** How long to wait before sending again after `attempts` failed tries: 1 s, 2 s, 4 s … 30 s. */
export const retryDelay = (attempts: number) =>
  Math.min(30_000, 1000 * 2 ** Math.max(0, attempts - 1));
