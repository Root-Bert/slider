import {
  MutationCache,
  QueryCache,
  QueryClient,
  type QueryKey,
  type QueryPersister,
} from '@tanstack/react-query';
import type { MeResponse } from '@slider/shared';
import { ApiError, isStoredAnswer } from '@/lib/api-client';
import { isGoneError, queryKeys, setSessionErrorHandler } from '@/lib/api';
import { currentPath, routes } from '@/lib/routes';

/**
 * The session ended while the app still thinks it is signed in (signed out in another tab,
 * `sessionTtlDays` reached, session revoked): any request answers 401 `unauthorized`. Instead of
 * every list and action failing on its own, go to the login and come back here afterwards.
 *
 * Only for `unauthorized`: the source imports answer 401 `microsoft_login_required` too, which
 * their own UI handles (A3 card, picker). And only while `me` says signed in – signed-out pages
 * (login, setup, join) and the deck page handle their own 401s.
 */
export function signedOutHandler(
  getClient: () => QueryClient,
  redirect: (path: string) => void = (path) => window.location.assign(path),
) {
  let redirecting = false;
  return (error: unknown) => {
    if (redirecting) return;
    if (!(error instanceof ApiError) || error.status !== 401 || error.code !== 'unauthorized') {
      return;
    }
    if (!getClient().getQueryData<MeResponse>(queryKeys.me)?.user) return;
    redirecting = true;
    // A full page load: everything cached belongs to the ended session.
    redirect(routes.login(currentPath()));
  };
}

/**
 * Every query's fetch (the `persister` hook wraps its query function): the server out of reach
 * for a moment (no connection, its proxy answering 502–504), the service worker answers a read
 * from its store (`public/sw.js`) – kept by its URL alone, perhaps from before what the query
 * holds (the edit state a step back, the slides of an earlier step after an edit's answer was
 * stored). Only a query with nothing yet takes it: opened offline, the stored answer is what
 * there is. One holding data – asked when the tab comes back, or by a live update – keeps it:
 * no error shown over what is on screen, nothing drawn again (the same data, shared as it is).
 * Stored answers taken are asked for again once the server answers (`refreshStoredAnswers`).
 *
 * A query with a `persister` of its own would go without this – none has one.
 */
export const keepNewerData: QueryPersister<unknown, QueryKey> = async (queryFn, context, query) => {
  const data = await queryFn(context);
  // Read after the answer came: an edit's answer may have been stored meanwhile.
  const held = query.state.data;
  return isStoredAnswer(data) && held !== undefined ? held : data;
};

/**
 * Queries showing a stored answer (taken while the server was out of reach) are asked again
 * once it is back – the first real answer of any query says so, as do the connection coming back
 * and the tab coming to the front. Without it a query that never goes stale (a slide taken apart
 * at a step) would keep the stored one for good.
 */
function refreshStoredAnswers(client: QueryClient): void {
  let asking = false;
  const refresh = () => {
    if (asking) return;
    const stored = client.getQueryCache().findAll({
      predicate: (query) => isStoredAnswer(query.state.data),
    });
    if (stored.length === 0) return;
    asking = true;
    void client
      .invalidateQueries({ predicate: (query) => isStoredAnswer(query.state.data) })
      .finally(() => {
        asking = false;
      });
  };
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (!isStoredAnswer(event.query.state.data)) refresh();
  });
  if (typeof window === 'undefined') return;
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
}

export function createQueryClient(redirect?: (path: string) => void): QueryClient {
  const onError = signedOutHandler(() => client, redirect);
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // Client errors (403/404/…) are final; only retry network and server hiccups (and 408/429).
        retry: (failureCount, error) => failureCount < 2 && !isGoneError(error),
        persister: keepNewerData,
      },
    },
  });
  // API calls outside React Query (upload, OneDrive picker) report through `reportSessionError`.
  setSessionErrorHandler(client, onError);
  refreshStoredAnswers(client);
  return client;
}
