import type { Deck, ImportDriveItemInput } from '@slider/shared';
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

/** A file picked in Microsoft's OneDrive file picker. */
export function useImportDriveItem(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Omit<ImportDriveItemInput, 'workspaceId'>) =>
      api.post<Deck>('/decks/drive-item', workspaceId ? { ...item, workspaceId } : item),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });
}
