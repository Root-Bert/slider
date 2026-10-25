import type { DeckStorage, PruneDeckStorageResult } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';

/** How much a review takes up (managers only) – sized on the server from the stored files. */
export const useDeckStorage = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.storage(deckId),
    queryFn: () => api.get<DeckStorage>(`/decks/${deckId}/storage`),
    enabled,
  });

/**
 * "Alles außer der neuesten Version löschen": the files of older versions go, comments stay.
 * Old versions' images are gone afterwards – what shows them is loaded again.
 */
export function usePruneDeckStorage(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PruneDeckStorageResult>(`/decks/${deckId}/storage/prune`),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.storage(deckId), result.storage);
      // Frees the workspace's storage (`Workspace.usage`, the "Nutzung" page – BER-151).
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === 'workspaces' && queryKey[2] === 'usage',
      });
    },
    onSettled: () =>
      Promise.all(
        (['slide-versions', 'deleted-slides', 'revision-diff', 'revisions'] as const).map((part) =>
          queryClient.invalidateQueries({ queryKey: ['decks', deckId, part] }),
        ),
      ),
  });
}
