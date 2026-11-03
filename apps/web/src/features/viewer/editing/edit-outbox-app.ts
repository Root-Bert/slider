import { useSyncExternalStore } from 'react';
import type { DeckEditState, MeResponse } from '@slider/shared';
import { hashKey, type QueryClient } from '@tanstack/react-query';
import { ApiError, apiRequestAnswer } from '@/lib/api-client';
import { postEdit, queryKeys, reportSessionError, storeEditAnswer } from '@/lib/api';
import type { CommentOutbox } from '@/lib/api/comment-outbox';
import { createAppCommentOutbox } from '../comments/comment-outbox-app';
import { createEditOutbox, type OutboxTransport } from './edit-outbox';
import { browserOutboxStore } from './outbox';

/*
 * The app's one editor outbox (`edit-outbox.ts`): kept in the browser's IndexedDB, sending
 * through the API and storing the answers in the query cache. Installed once with the app's query
 * client (`installEditOutbox`), it follows the signed-in account from the cached `/api/me` answer
 * – no request of its own – and takes over the edits tabs no longer open left of that account,
 * whichever page is open. The comment outbox (`comment-outbox-app.ts`) goes along: the same
 * account, the same connection and tab events.
 */

let client: QueryClient | null = null;

const signedInUser = () => client?.getQueryData<MeResponse>(queryKeys.me)?.user?.id;

const transport: OutboxTransport = {
  send: postEdit,
  answered: (deckId, answer) => {
    if (client) void storeEditAnswer(client, deckId, answer);
  },
  currentSeq: (deckId) => client?.getQueryData<DeckEditState>(queryKeys.edit(deckId))?.seq,
  currentUser: signedInUser,
  // The server's own answer only: the service worker's stored one names whoever was signed in
  // when it was stored – not that the session is valid again.
  whoAmI: () =>
    apiRequestAnswer<MeResponse>('/me').then(
      ({ data: me, fromStore }) => (fromStore ? undefined : (me.user?.id ?? null)),
      (error: unknown) => (error instanceof ApiError && error.status === 401 ? null : undefined),
    ),
  sessionEnded: (error) => {
    if (!client) return;
    // Another account signed in than this tab knew of: it hears who, and the outbox follows it –
    // the edits made under the one before stay in the browser for it.
    if (error instanceof ApiError && error.code === 'account_changed') {
      void client.invalidateQueries({ queryKey: queryKeys.me });
    } else reportSessionError(client, error);
  },
};

export const editOutbox = createEditOutbox(browserOutboxStore, transport);

/** Comments made while the server was out of reach – created with the query client. */
let commentOutbox: CommentOutbox | null = null;

const ME_HASH = hashKey(queryKeys.me);

/**
 * Whether one of the deck's edits is on its way – for the few that wait for it (the busy
 * indicator, a tilt's picture), not in the editing context: each edit going out would render
 * every `useEditing` reader again.
 */
export const useOutboxSending = (deckId: string): boolean =>
  useSyncExternalStore(editOutbox.subscribe, () => editOutbox.status(deckId).sending);

/** Edits still on their way are waited for before signing out, at most this long. */
const SIGN_OUT_WAIT_MS = 3000;

/**
 * Before signing out: waits a moment for this tab's edits still on their way, then tells how many
 * of the account's edits and comments are left unsent – other tabs' too: signing out drops them
 * all with the rest the browser kept (`forgetOffline`).
 */
export async function editsUnsentBeforeSignOut(): Promise<number> {
  await editOutbox.allSettled(SIGN_OUT_WAIT_MS);
  return (await editOutbox.unsent()) + ((await commentOutbox?.unsent()) ?? 0);
}

/** Wires the outbox to the app: the account, the connection, the tab's closing. Once. */
export function installEditOutbox(queryClient: QueryClient): void {
  if (client) return;
  client = queryClient;
  const comments = createAppCommentOutbox(queryClient, transport);
  commentOutbox = comments;
  const follow = () => {
    const userId = signedInUser();
    // Not loaded yet, or signed out (the page goes to the login): nothing to follow.
    if (!userId) return;
    editOutbox.setUser(userId);
    comments.setUser(userId);
  };
  follow();
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (event.query.queryHash === ME_HASH) follow();
    // Any answer of the server's: the session may be valid again (paused for an ended one). Not
    // a reason to retry what the server was out of reach for – offline, the service worker
    // answers from its store; that waits for its next try, or the connection's return.
    editOutbox.resume();
    comments.resume();
  });
  if (typeof window === 'undefined') return;
  // Back online, or back in the tab: held edits go out, and what closed tabs left is taken over
  // (one take-over, however many of these come together).
  const comeBack = () => {
    editOutbox.retryNow();
    void editOutbox.drain();
    comments.retryNow();
    void comments.drain();
  };
  window.addEventListener('online', comeBack);
  window.addEventListener('focus', comeBack);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') comeBack();
  });
  // Closing the tab with edits the server could not be reached for: the browser asks first. They
  // stay in the browser (sent once the deck or the app opens again), but not without IndexedDB.
  // Listened for only meanwhile: a page with a `beforeunload` listener is kept out of the
  // browser's back-forward cache.
  const askBeforeClosing = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    // Older browsers ask only with a return value.
    event.returnValue = '';
  };
  let asking = false;
  // Comments are not counted: closing the tab with some held loses none (kept in the browser).
  editOutbox.subscribe(() => {
    const unsent = editOutbox.unsentWhileUnreachable();
    if (unsent === asking) return;
    asking = unsent;
    if (unsent) window.addEventListener('beforeunload', askBeforeClosing);
    else window.removeEventListener('beforeunload', askBeforeClosing);
  });
}
