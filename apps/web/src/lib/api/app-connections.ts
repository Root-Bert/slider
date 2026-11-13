import type {
  AppConnections,
  AppRequest,
  CreateAppTokenInput,
  CreatedAppToken,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { workspaceKeys } from './keys';

/** „KI-Apps“ on `/konto`: the MCP address and the apps let into the account. */
export const useAppConnections = () =>
  useQuery({
    queryKey: workspaceKeys.appConnections,
    queryFn: () => api.get<AppConnections>('/connections'),
  });

/** „Token erstellen“: the token comes back once. */
export function useCreateAppToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAppTokenInput) =>
      api.post<CreatedAppToken>('/connections/tokens', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.appConnections }),
  });
}

/** „Entfernen“: the app's access ends at once. */
export function useRemoveAppConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/connections/${encodeURIComponent(id)}`),
    onMutate: (id) =>
      queryClient.setQueryData<AppConnections>(workspaceKeys.appConnections, (old) =>
        old ? { ...old, connections: old.connections.filter((each) => each.id !== id) } : old,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.appConnections }),
  });
}

/** The app asking on `/verbinden`. */
export const useAppRequest = (request: string) =>
  useQuery({
    queryKey: ['account', 'app-request', request],
    queryFn: () => api.post<AppRequest>('/connections/request', { request }),
    enabled: request !== '',
    retry: false,
    staleTime: Infinity,
  });

/** „Zulassen“ / „Ablehnen“: where the browser goes on – back to the app. */
export const answerAppRequest = (
  answer: 'approve' | 'deny',
  request: string,
  workspaceId: string | null,
) =>
  api.post<{ redirectUrl: string }>(
    `/connections/${answer}`,
    answer === 'approve' ? { request, workspaceId } : { request },
  );
