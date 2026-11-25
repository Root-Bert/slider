import type { CallVoices, MeResponse, UpdateMeInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, apiFile, isStoredAnswer, pageIsFor } from '../api-client';
import { sawVersion } from '../app-version';
import { queryKeys } from './keys';

export const useMe = () =>
  useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const me = await api.get<MeResponse>('/me');
      pageIsFor(me.user?.id ?? null);
      // From the offline store it may name a release long gone.
      if (!isStoredAnswer(me)) sawVersion(me.version);
      return me;
    },
    staleTime: Infinity,
    // Back in the tab: pick up a role change, a removal or a session ended elsewhere (the
    // 401 then goes to the login, see `app/query-client.ts`).
    refetchOnWindowFocus: 'always',
  });

/**
 * The viewer's own colour (Einstellungen), from what `/me` already brought – never asks itself,
 * so it is safe anywhere; `undefined` until `/me` is in.
 */
export const useOwnColor = () =>
  useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<MeResponse>('/me'),
    enabled: false,
    select: (me) => me.viewer.author.color,
  }).data;

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

/**
 * Einstellungen › Dateien › „Dateiendungen zeigen“, kept with the account: every list shows the
 * change at once (the account's answer changed in place), a refusal puts it back.
 */
export function useSetShowExtensions() {
  const queryClient = useQueryClient();
  const put = (shown: boolean) =>
    queryClient.setQueryData<MeResponse>(queryKeys.me, (me) =>
      me?.user ? { ...me, user: { ...me.user, showExtensions: shown } } : me,
    );
  return useMutation({
    scope: { id: 'me' },
    mutationFn: (shown: boolean) => api.patch<MeResponse>('/me', { showExtensions: shown }),
    onMutate: (shown) => {
      const before = queryClient.getQueryData<MeResponse>(queryKeys.me)?.user?.showExtensions;
      put(shown);
      return { before };
    },
    onError: (_error, _shown, context) => {
      if (context?.before !== undefined) put(context.before);
    },
  });
}

/** A browser's choice from before the account kept it, saved to the account once. */
export async function saveShowExtensions(queryClient: QueryClient, shown: boolean) {
  queryClient.setQueryData(
    queryKeys.me,
    await api.patch<MeResponse>('/me', { showExtensions: shown }),
  );
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
