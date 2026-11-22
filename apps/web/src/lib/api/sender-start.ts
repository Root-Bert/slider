import type { SenderSummary, SenderUnread } from '@slider/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api-client';
import { senderKeys } from './sender';

/*
 * Sender's start („Aktuell“): what is unread, and the AI's summary of it. Both are asked
 * anew when `stamp` changes – what the side bar's counts and the mails say (something came in,
 * something was read); meanwhile the last answer stays on screen.
 */

export function useSenderUnread(workspaceId: string, stamp: string | null) {
  return useQuery({
    queryKey: [...senderKeys.all(workspaceId), 'unread', stamp],
    queryFn: () => api.get<SenderUnread>(`/workspaces/${workspaceId}/sender/unread`),
    enabled: stamp !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

/** The AI's part: slow, so asked only while the page is open and kept per stamp. */
export function useSenderSummary(workspaceId: string, stamp: string | null) {
  return useQuery({
    queryKey: [...senderKeys.all(workspaceId), 'summary', stamp],
    queryFn: () => api.get<SenderSummary>(`/workspaces/${workspaceId}/sender/summary`),
    enabled: stamp !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
}
