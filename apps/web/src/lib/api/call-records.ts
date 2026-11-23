import type { CallRecord } from '@slider/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

/**
 * A call that is over: its turns, who was in it, and the notes the AI writes once after it –
 * asked again while those are being written.
 */

const WRITING_MS = 3000;

export const callRecordKeys = {
  one: (callId: string) => ['call-records', callId] as const,
};

export function useCallRecord(callId: string, enabled = true) {
  return useQuery({
    queryKey: callRecordKeys.one(callId),
    enabled,
    queryFn: () => api.get<CallRecord>(`/calls/${callId}/record`),
    refetchInterval: (query) => (query.state.data?.notesState === 'pending' ? WRITING_MS : false),
  });
}
