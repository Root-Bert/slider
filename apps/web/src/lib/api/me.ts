import type { MeResponse, UpdateMeInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';

export const useMe = () =>
  useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<MeResponse>('/me'),
    staleTime: Infinity,
    // Back in the tab: pick up a role change, a removal or a session ended elsewhere (the
    // 401 then goes to the login, see `app/query-client.ts`).
    refetchOnWindowFocus: 'always',
  });

/** Picks the viewer's colour; their comments are recoloured, so everything deck-related reloads. */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) => api.patch<MeResponse>('/me', input),
    onSuccess: (me) => {
      queryClient.setQueryData(queryKeys.me, me);
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
    },
  });
}
