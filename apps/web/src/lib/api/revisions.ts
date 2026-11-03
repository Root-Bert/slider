import type { DeletedSlide, RerenderResult, RevisionDiff } from '@slider/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';

/**
 * Answers with slide image URLs: signed URLs expire after 6 h at the earliest (BER-94), so
 * these are fetched again after an hour instead of being kept forever – also in a tab left open
 * and visible all day, where no focus change would refetch them (images mounted later, e.g.
 * scrolled to, would otherwise load expired links).
 */
export const SIGNED_URL_STALE_MS = 60 * 60_000;

/**
 * What the current revision changed; only fetched from revision 2 on. Asks for the revision by
 * id rather than `latest`: right after a new revision `latest` already means the new one, and its
 * diff must not land in the cache entry of the revision before it.
 */
export const useLatestDiff = (deckId: string, revisionId: string | null, enabled = true) =>
  useQuery({
    queryKey: queryKeys.revisionDiff(deckId, revisionId),
    queryFn: () => api.get<RevisionDiff>(`/decks/${deckId}/revisions/${revisionId}/diff`),
    enabled: enabled && revisionId !== null,
    staleTime: SIGNED_URL_STALE_MS,
  });

/**
 * Slides deleted in a later revision. While a new revision's list loads, the previous one of the
 * same deck stays (`isPlaceholderData`), so the open panel isn't unmounted and mounted again.
 */
export const useDeletedSlides = (deckId: string, revisionId: string | null, enabled = true) =>
  useQuery({
    queryKey: queryKeys.deletedSlides(deckId, revisionId),
    queryFn: () => api.get<DeletedSlide[]>(`/decks/${deckId}/deleted-slides`),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === deckId ? previous : undefined,
    enabled: enabled && revisionId !== null,
    staleTime: SIGNED_URL_STALE_MS,
    refetchInterval: SIGNED_URL_STALE_MS,
  });

/**
 * Everything that belongs to a revision: reloaded when a new one arrives. Diffs and deleted
 * slides are keyed by revision id – the new deck DTO brings a new id and with it fresh queries,
 * so they're left alone here (invalidating them would only refetch the old revision's entries).
 */
export function useInvalidateRevision(deckId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.slides(deckId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.comments(deckId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.status(deckId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.deckLists }),
    ]);
}

/**
 * "Neu rendern" (BER-94): queues new slide images, Office first, then LibreOffice. Progress and
 * the end show up in the deck status (`rendering`, `renderedAt`). `newVersion`: the linked file
 * had changed and comes in as a new revision instead.
 */
export function useRerenderDeck(deckId: string) {
  const queryClient = useQueryClient();
  const invalidateRevision = useInvalidateRevision(deckId);
  return useMutation({
    mutationFn: () => api.post<RerenderResult>(`/decks/${deckId}/rerender`),
    onSuccess: (result) =>
      result.status === 'newVersion'
        ? invalidateRevision()
        : queryClient.invalidateQueries({ queryKey: queryKeys.status(deckId), exact: true }),
  });
}

/** New slide images arrived: the slide list and thumbnails point at new files. */
export const invalidateSlideImages = (queryClient: QueryClient, deckId: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId), exact: true }),
    queryClient.invalidateQueries({ queryKey: queryKeys.slides(deckId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.deckLists }),
  ]);

/** `invalidateSlideImages` for this deck, from a component. */
export function useInvalidateSlideImages(deckId: string) {
  const queryClient = useQueryClient();
  return () => invalidateSlideImages(queryClient, deckId);
}
