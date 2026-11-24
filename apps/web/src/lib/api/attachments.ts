import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  API_PREFIX,
  attachmentPath,
  type Attachment,
  type SenderFile,
  type SenderFileFiling,
  type SenderFilePlace,
} from '@slider/shared';
import { api, apiRequest, uploadWithProgress } from '../api-client';

/** Puts a file up for something being written in the workspace – `onProgress` from 0 to 1. */
export const uploadAttachment = (
  workspaceId: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
) => {
  const form = new FormData();
  form.append('file', file);
  return uploadWithProgress<Attachment>(
    `/workspaces/${workspaceId}/attachments`,
    form,
    onProgress,
    signal,
  );
};

/** Takes a waiting file off again – gone on the server too (never awaited by the field). */
export const dropAttachment = (id: string) =>
  apiRequest<void>(`/attachments/${id}`, { method: 'DELETE' }).catch(() => undefined);

/** Where a file put on something is shown (`download`: saved instead). */
export const attachmentUrl = (id: string, download = false) =>
  `${API_PREFIX}${attachmentPath(id, download)}`;

export const chatFileKeys = {
  all: ['chat-files'] as const,
  of: (channelId: string) => ['chat-files', 'channel', channelId] as const,
  filing: (folderId: string) => ['chat-files', 'filing', folderId] as const,
};

/** A conversation's „Dateien“, newest first, with where each lies in Cloud. */
export function useChatFiles(channelId: string, enabled = true) {
  return useQuery({
    queryKey: chatFileKeys.of(channelId),
    queryFn: () => api.get<SenderFile[]>(`/sender/channels/${channelId}/files`),
    enabled,
    // The AI's suggestion comes a few seconds after a file was sent.
    refetchInterval: 15_000,
  });
}

/** A Cloud „Chat-Dateien“ folder's files with where the AI would put each (by the file's id). */
export function useFolderFilings(folderId: string | null) {
  return useQuery({
    queryKey: chatFileKeys.filing(folderId ?? ''),
    queryFn: () =>
      api.get<Record<string, SenderFileFiling & { attachmentId: string }>>(
        `/cloud/folders/${folderId}/filing`,
      ),
    enabled: !!folderId,
    refetchInterval: 30_000,
  });
}

/** „Verschieben“ / „Ablegen“: a chat's file to `place` – or, none, where the AI would put it. */
export function usePlaceChatFile(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ attachmentId, place }: { attachmentId: string; place?: SenderFilePlace }) =>
      api.post<{ nodeId: string; name: string; place: string }>(
        `/sender/files/${attachmentId}/place`,
        place ?? {},
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: chatFileKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['cloud', workspaceId] });
    },
  });
}
