import type { Deck } from '@slider/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';

export function useImportLink(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (url: string) =>
      api.post<Deck>('/decks/link', workspaceId ? { url, workspaceId } : { url }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

/** Start from scratch: a new deck with one slide, blank or of a workspace design's first layout. */
export function useCreateBlankDeck(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (masterId?: string) =>
      api.post<Deck>('/decks/blank', masterId ? { workspaceId, masterId } : { workspaceId }),
    onSuccess: (deck) => {
      queryClient.setQueryData(queryKeys.deck(deck.id), deck);
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}
