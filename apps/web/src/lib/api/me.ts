import type { CallVoices, MeResponse, UpdateMeInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiFile, pageIsFor } from '../api-client';
import { queryKeys } from './keys';

export const useMe = () =>
  useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const me = await api.get<MeResponse>('/me');
      pageIsFor(me.user?.id ?? null);
      return me;
    },
    staleTime: Infinity,
    // Back in the tab: pick up a role change, a removal or a session ended elsewhere (the
    // 401 then goes to the login, see `app/query-client.ts`).
    refetchOnWindowFocus: 'always',
  });

/** Picks the viewer's colour; their comments are recoloured, so everything deck-related reloads. */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    // One after another: a name saved as you type must not be overtaken by an older save.
    scope: { id: 'me' },
    mutationFn: (input: UpdateMeInput) => api.patch<MeResponse>('/me', input),
    onSuccess: (me) => {
      queryClient.setQueryData(queryKeys.me, me);
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
    },
  });
}

const CALL_VOICE = ['call-voice'] as const;

/**
 * The voice agents speak with where the viewer calls them or brings them into a call, and the
 * voices to pick from (asked of a workspace's live key).
 */
export const useCallVoice = () =>
  useQuery({
    queryKey: CALL_VOICE,
    queryFn: () => api.get<CallVoices>('/me/call-voice'),
    staleTime: 5 * 60_000,
    retry: false,
  });

/** Picks the viewer's voice (`null`: the automatic one). */
export function usePickCallVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (voice: string | null) => api.put<CallVoices>('/me/call-voice', { voice }),
    onSuccess: (voices) => queryClient.setQueryData(CALL_VOICE, voices),
  });
}

/** A voice reading a sentence, as WAV – to hear it before picking it. */
export const callVoiceSample = (voice: string) =>
  apiFile(`/me/call-voice/${encodeURIComponent(voice)}/sample`, 'stimme.wav');
