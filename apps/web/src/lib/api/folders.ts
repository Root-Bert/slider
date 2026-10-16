import type { DeckFolder } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';

export const useFolders = (workspaceId: string) =>
  useQuery({
    queryKey: queryKeys.folders(workspaceId),
    queryFn: () => api.get<DeckFolder[]>(`/workspaces/${encodeURIComponent(workspaceId)}/folders`),
  });

export function useCreateFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<DeckFolder>(`/workspaces/${encodeURIComponent(workspaceId)}/folders`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.folders(workspaceId) }),
  });
}

export function useRenameFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      api.patch<DeckFolder>(`/folders/${folderId}`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.folders(workspaceId) }),
  });
}

/** Its decks stay, outside any folder – so the deck lists reload too. */
export function useDeleteFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => api.delete(`/folders/${folderId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
    },
  });
}
