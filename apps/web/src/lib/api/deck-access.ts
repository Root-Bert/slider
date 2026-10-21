import type { DeckAccess, UpdateDeckAccessInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';

/** Who may open a review (managers only) – loaded while "Zugriff einschränken …" is open. */
export const useDeckAccess = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.access(deckId),
    queryFn: () => api.get<DeckAccess>(`/decks/${deckId}/access`),
    enabled,
  });

/**
 * Replaces who may open the review. The deck (`restricted`), its workspace's deck list (the lock
 * on cards and rows) and the `@` suggestions (only people who can open it) are loaded again.
 */
export function useUpdateDeckAccess(deckId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDeckAccessInput) =>
      api.put<DeckAccess>(`/decks/${deckId}/access`, input),
    onSuccess: (access) => {
      queryClient.setQueryData(queryKeys.access(deckId), access);
      // `exact`: the deck's key prefixes its slides, comments, … – those stay as they are.
      void queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId), exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckList(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.people(deckId) });
    },
  });
}
