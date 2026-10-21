import {
  API_PREFIX,
  type Deck,
  type DisconnectNextcloudResult,
  type ImportNextcloudItemInput,
  type NextcloudConnection,
  type NextcloudListing,
  type NextcloudLoginPoll,
  type NextcloudLoginStart,
  type NextcloudSettings,
} from '@slider/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest } from '../api-client';
import { queryKeys, workspaceKeys } from './keys';

// Nextcloud as a source (BER-135): connected accounts, the file browser and its imports.

export const useNextcloudSettings = () =>
  useQuery({
    queryKey: workspaceKeys.nextcloudSettings,
    queryFn: () => api.get<NextcloudSettings>('/nextcloud/settings'),
    staleTime: Infinity,
  });

export const useNextcloudConnections = (enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.nextcloud,
    queryFn: () => api.get<NextcloudConnection[]>('/me/nextcloud'),
    enabled,
  });

/** Asks the Nextcloud for a login; the caller opens `loginUrl` and polls. */
export const startNextcloudLogin = (server?: string) =>
  api.post<NextcloudLoginStart>('/nextcloud/login', server ? { server } : {});

export const pollNextcloudLogin = (id: string) =>
  api.post<NextcloudLoginPoll>(`/nextcloud/login/${encodeURIComponent(id)}/poll`);

/** Also revokes the app password at Nextcloud; `revoked: false` when it was unreachable. */
export function useDisconnectNextcloud() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<DisconnectNextcloudResult>(`/me/nextcloud/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKeys.nextcloud }),
        queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
      ]),
  });
}

export type NextcloudView =
  { kind: 'files'; path: string } | { kind: 'shared' } | { kind: 'search'; query: string };

function listingPath(connectionId: string, view: NextcloudView): string {
  const base = `/nextcloud/${encodeURIComponent(connectionId)}`;
  if (view.kind === 'files') return `${base}/files?path=${encodeURIComponent(view.path)}`;
  if (view.kind === 'shared') return `${base}/shared`;
  return `${base}/search?q=${encodeURIComponent(view.query)}`;
}

/** A folder, "Mit mir geteilt" or search results; keeps the last list while the next loads. */
export const useNextcloudListing = (connectionId: string | null, view: NextcloudView) =>
  useQuery({
    queryKey: workspaceKeys.nextcloudListing(
      connectionId ?? '',
      view.kind,
      view.kind === 'files' ? view.path : view.kind === 'search' ? view.query : '',
    ),
    queryFn: () => api.get<NextcloudListing>(listingPath(connectionId!, view)),
    enabled: connectionId !== null && (view.kind !== 'search' || view.query.trim().length >= 2),
    placeholderData: keepPreviousData,
    retry: false,
  });

/** The thumbnail URL – the API proxies it, the app password stays on the server. */
export const nextcloudPreviewUrl = (connectionId: string, fileId: string) =>
  `${API_PREFIX}/nextcloud/${encodeURIComponent(connectionId)}/preview/${encodeURIComponent(fileId)}`;

/** A presentation picked in the Nextcloud browser. */
export function useImportNextcloudItem(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Omit<ImportNextcloudItemInput, 'workspaceId'>) =>
      api.post<Deck>('/decks/nextcloud-item', workspaceId ? { ...item, workspaceId } : item),
    onSuccess: (deck) => {
      // Like the OneDrive picker: the viewer opens on the cached deck, the lists show it.
      queryClient.setQueryData(queryKeys.deck(deck.id), deck);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deckLists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: workspaceKeys.nextcloud }),
      ]);
    },
  });
}
