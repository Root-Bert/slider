import { deckCreationSchema, type DeckCreation, type StartDeckCreationInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';

/*
 * A new deck built by the AI from the prompt on Folie 1: whether the prompt shows, the outline
 * and the progress of a run. Live events (`creation`, and every `slides`) refetch it.
 */

export const useDeckCreation = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.creation(deckId),
    queryFn: async () =>
      deckCreationSchema.nullable().parse(await api.get(`/decks/${deckId}/creation`)),
    enabled,
    // While it runs the live stream tells each step; polling is a slow safety net.
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 15_000 : false),
  });

/** „Erstellen“: shown running at once – the panel closes on the click, the server answers after. */
export function useStartCreation(deckId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.creation(deckId);
  return useMutation({
    mutationFn: (input: StartDeckCreationInput) =>
      api.post<DeckCreation>(`/decks/${deckId}/creation`, input),
    onMutate: (input) => {
      const before = queryClient.getQueryData<DeckCreation | null>(key);
      if (before) {
        const next: DeckCreation = {
          ...before,
          status: 'running',
          prompt: false,
          kind: input.kind,
          pages: input.pages,
          templateId: input.templateId,
          outline: null,
          built: 0,
          step: 'Bereitet die Präsentation vor',
          error: null,
        };
        queryClient.setQueryData(key, next);
      }
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before !== undefined) queryClient.setQueryData(key, context.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** „Abbrechen“: the slides built stay. */
export function useCancelCreation(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>(`/decks/${deckId}/creation/cancel`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.creation(deckId) }),
  });
}

/** „Leer anfangen“: the prompt goes for good – at once, the server told after. */
export function useDismissCreation(deckId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.creation(deckId);
  return useMutation({
    mutationFn: () => api.post<void>(`/decks/${deckId}/creation/dismiss`),
    onMutate: () => {
      const before = queryClient.getQueryData<DeckCreation | null>(key);
      if (before) {
        const next: DeckCreation = { ...before, status: 'dismissed', prompt: false };
        queryClient.setQueryData(key, next);
      }
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before !== undefined) queryClient.setQueryData(key, context.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
