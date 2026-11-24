import { useQueryClient } from '@tanstack/react-query';
import { chatCloud, cloudKeys } from '@/lib/api';
import { useAgentChat, type Chat } from '@/features/viewer';

/*
 * The AI in Cloud (✨ in the header, `CloudChat`): one person's chat with the workspace's AI
 * beside the files (`useAgentChat`). Whenever the AI touched files, the lists are read again.
 */

/** Where the person is, for „hier“. */
export interface ChatPlace {
  folderId?: string | null;
  areaId?: string | null;
}

/** The workspace's open chat: sending, stopping, beginning anew; refusals go to `refused`. */
export function useCloudChat(
  workspaceId: string,
  place: ChatPlace,
  refused: (message: string) => void,
): Chat {
  const queryClient = useQueryClient();
  return useAgentChat<never>(
    `cloud:${workspaceId}`,
    (text, history, onEvent, signal, attachments) =>
      chatCloud(
        workspaceId,
        {
          text,
          attachments,
          history,
          folderId: place.folderId ?? null,
          areaId: place.areaId ?? null,
        },
        onEvent,
        signal,
      ),
    {
      changed: () => {
        void queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) });
        // It works in Slider too: a presentation made or changed shows there at once.
        void queryClient.invalidateQueries({ queryKey: ['decks'] });
      },
      refused,
    },
  );
}
