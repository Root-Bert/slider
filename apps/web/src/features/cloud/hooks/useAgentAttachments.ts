import { useAttachments } from '@/features/attachments';

/** The files on a message to an agent – kept with its draft, by the same key. */
export const useAgentAttachments = (workspaceId: string | undefined, keep: string | undefined) =>
  useAttachments({ workspaceId, keep: keep ? `agent:${keep}` : undefined });
