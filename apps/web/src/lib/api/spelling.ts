import type { SpellingWord } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest } from '../api-client';

/** The spell check's own words: the account's („Wörterbuch“) and a workspace's („Wörter“). */
export const spellingKeys = {
  own: ['account', 'words'] as const,
  workspace: (workspaceId: string) => ['workspaces', workspaceId, 'words'] as const,
};

const ownPath = '/me/words';
const workspacePath = (workspaceId: string) => `/workspaces/${workspaceId}/words`;
const withWord = (path: string, word: string) => `${path}?word=${encodeURIComponent(word)}`;

/** The account's own words, A–Z. */
export const useOwnWords = (enabled = true) =>
  useQuery({
    queryKey: spellingKeys.own,
    queryFn: () => api.get<SpellingWord[]>(ownPath),
    enabled,
    staleTime: 60_000,
  });

/** A workspace's words, A–Z – `null`: none asked (not a member). */
export const useWorkspaceWords = (workspaceId: string | null) =>
  useQuery({
    queryKey: spellingKeys.workspace(workspaceId ?? ''),
    queryFn: () => api.get<SpellingWord[]>(workspacePath(workspaceId!)),
    enabled: workspaceId !== null,
    staleTime: 60_000,
  });

/** Sends one word to the account (`workspaceId` null) or a workspace; the list it answers is kept. */
export function postSpellingWord(workspaceId: string | null, word: string) {
  return api.post<SpellingWord[]>(workspaceId ? workspacePath(workspaceId) : ownPath, { word });
}

/**
 * Takes a word out of the account's dictionary (`workspaceId` null) or a workspace's – gone from
 * the list at once, back with a refusal.
 */
export function useRemoveSpellingWord(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const key = workspaceId ? spellingKeys.workspace(workspaceId) : spellingKeys.own;
  return useMutation({
    mutationFn: (word: string) =>
      apiRequest<SpellingWord[]>(
        withWord(workspaceId ? workspacePath(workspaceId) : ownPath, word),
        {
          method: 'DELETE',
        },
      ),
    onMutate: async (word) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<SpellingWord[]>(key);
      queryClient.setQueryData<SpellingWord[]>(key, (list) => list?.filter((w) => w.word !== word));
      return { before };
    },
    onError: (_error, _word, context) => queryClient.setQueryData(key, context?.before),
    onSuccess: (list) => queryClient.setQueryData(key, list),
  });
}
