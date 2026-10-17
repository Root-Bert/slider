import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import { queryKeys, setSessionErrorHandler } from '@/lib/api';
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

export function createQueryClient(redirect?: (path: string) => void): QueryClient {
  const onError = signedOutHandler(() => client, redirect);
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // Client errors (403/404/…) are final; only retry network and server hiccups.
        retry: (failureCount, error) =>
          failureCount < 2 &&
          !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
  // API calls outside React Query (upload, OneDrive picker) report through `reportSessionError`.
  setSessionErrorHandler(client, onError);
  return client;
}
