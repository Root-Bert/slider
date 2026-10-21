import type { Deck, GoogleConnection, ImportGoogleItemInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest } from '../api-client';
import { queryKeys, workspaceKeys } from './keys';

// Google Drive as a source (BER-119): connected accounts, the picker and its imports.

export const useGoogleConnections = (enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.google,
    queryFn: () => api.get<GoogleConnection[]>('/me/google'),
    enabled,
  });

/**
 * Google's picker page (BER-158); comes back to `returnTo` with `googlePicked` and
 * `googleConnection` (or `googleError`). Connects an account first if there is none.
 */
export const googlePickUrl = (returnTo: string, fileId?: string) =>
  `/api/auth/google/pick?returnTo=${encodeURIComponent(returnTo)}${
    fileId ? `&fileId=${encodeURIComponent(fileId)}` : ''
  }`;

/** Where the browser connects Google Drive; comes back to `returnTo`. */
export const googleDriveConnectUrl = (returnTo: string, connectionId?: string) =>
  `/api/auth/google/drive?returnTo=${encodeURIComponent(returnTo)}${
    connectionId ? `&connection=${encodeURIComponent(connectionId)}` : ''
  }`;

/** Also revokes Slider's access at Google. */
export function useDisconnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/me/google/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKeys.google }),
        queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
      ]),
  });
}

/** A file picked in Google's picker. */
export function useImportGoogleItem(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Omit<ImportGoogleItemInput, 'workspaceId'>) =>
      api.post<Deck>('/decks/google-item', workspaceId ? { ...item, workspaceId } : item),
    onSuccess: (deck) => {
      // Like the OneDrive picker: the viewer opens on the cached deck, the lists show it.
      queryClient.setQueryData(queryKeys.deck(deck.id), deck);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deckLists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: workspaceKeys.google }),
      ]);
    },
  });
}
