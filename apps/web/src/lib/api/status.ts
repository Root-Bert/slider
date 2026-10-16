import type { DeckStatus } from '@slider/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';

/** Status poll every 20 s while the tab is visible; faster while a change is being imported. */
const STATUS_POLL_MS = 20_000;
const STATUS_POLL_PENDING_MS = 5_000;
/** While slide images are re-rendered (BER-94): progress in the ⋯ menu. */
const STATUS_POLL_RENDERING_MS = 1_500;

export const useDeckStatus = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.status(deckId),
    queryFn: () => api.get<DeckStatus>(`/decks/${deckId}/status`),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.rendering
        ? STATUS_POLL_RENDERING_MS
        : query.state.data?.sync.pending
          ? STATUS_POLL_PENDING_MS
          : STATUS_POLL_MS,
    // Hidden tabs don't poll; coming back (focus / visibility) refetches right away.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });

/** Status of several decks, polled like {@link useDeckStatus} (fast while rendering). */
export const useDeckStatuses = (deckIds: readonly string[]) =>
  useQueries({
    queries: deckIds.map((deckId) => ({
      queryKey: queryKeys.status(deckId),
      queryFn: () => api.get<DeckStatus>(`/decks/${deckId}/status`),
      refetchInterval: (query: { state: { data?: DeckStatus } }) =>
        query.state.data?.rendering ? STATUS_POLL_RENDERING_MS : STATUS_POLL_MS,
      refetchIntervalInBackground: false,
    })),
  });
