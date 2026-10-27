import {
  DECK_SEARCH_MAX_LENGTH,
  DECK_SEARCH_MIN_LENGTH,
  type DeckSearchResult,
} from '@slider/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';

/** Whether a query is long enough (and short enough) to search the decks' text. */
export const isContentQuery = (query: string) =>
  query.trim().length >= DECK_SEARCH_MIN_LENGTH && query.length <= DECK_SEARCH_MAX_LENGTH;

/**
 * Decks of a workspace whose slides or comments contain `query` (BER-175) – titles are filtered
 * on the client. Pass the settled query (typing paused); while the next one loads, the last
 * results stay, so the list doesn't flicker.
 */
export function useDeckSearch(workspaceId: string, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: queryKeys.deckSearch(workspaceId, trimmed),
    queryFn: () =>
      api.get<DeckSearchResult[]>(
        `/decks/search?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(trimmed)}`,
      ),
    enabled: isContentQuery(trimmed),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
