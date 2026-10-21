import type { DeckStatus } from '@slider/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../api-client';
import { queryKeys } from './keys';

/** Status poll every 20 s while the tab is visible; faster while a change is being imported. */
export const STATUS_POLL_MS = 20_000;
export const STATUS_POLL_PENDING_MS = 5_000;
/** While a deck's slide images are being re-rendered (BER-94): progress in the ⋯ menu. */
export const STATUS_POLL_RENDERING_MS = 1_500;

/**
 * A 4xx (deck deleted, access lost) is final: polling it again cannot change the answer. Not a
 * timeout (408) or "too many requests" (429) – those pass.
 */
export const isGoneError = (error: unknown) =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408 &&
  error.status !== 429;

interface StatusQueryState {
  state: { data?: DeckStatus; error?: unknown };
}

/**
 * Poll interval of one deck status. Only the deck the (serial) render queue is working on
 * polls fast; a merely queued one can't change until its turn comes, so it waits `queuedMs`.
 */
export const statusPollInterval = (
  { state }: StatusQueryState,
  { queuedMs }: { queuedMs: number },
): number | false => {
  if (isGoneError(state.error)) return false;
  const rendering = state.data?.rendering;
  if (rendering?.status === 'running') return STATUS_POLL_RENDERING_MS;
  if (rendering) return queuedMs;
  return state.data?.sync.pending ? STATUS_POLL_PENDING_MS : STATUS_POLL_MS;
};

export const useDeckStatus = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.status(deckId),
    queryFn: () => api.get<DeckStatus>(`/decks/${deckId}/status`),
    enabled,
    refetchInterval: (query) => statusPollInterval(query, { queuedMs: STATUS_POLL_PENDING_MS }),
    // Hidden tabs don't poll; coming back (focus / visibility) refetches right away.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });

/**
 * Status of several decks (bulk "Neu rendern"): fast only for the one being rendered, every
 * 20 s for the queued rest – 40 queued decks would otherwise cost ~27 requests per second.
 */
export const useDeckStatuses = (deckIds: readonly string[]) =>
  useQueries({
    queries: deckIds.map((deckId) => ({
      queryKey: queryKeys.status(deckId),
      queryFn: () => api.get<DeckStatus>(`/decks/${deckId}/status`),
      refetchInterval: (query: StatusQueryState) =>
        statusPollInterval(query, { queuedMs: STATUS_POLL_MS }),
      refetchIntervalInBackground: false,
    })),
  });
