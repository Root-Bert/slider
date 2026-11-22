import type { CloudConnection, CloudConnectionInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { cloudKeys } from './cloud';

/**
 * „Verbindungen“ in Cloud: the services outside a person connected so that their agents work
 * there too. They are that person's alone; an agent may add one, so the list is asked again
 * whenever its page is looked at.
 */

export const cloudConnectionKeys = {
  list: (workspaceId: string) => [...cloudKeys.all(workspaceId), 'connections'] as const,
};

export function useCloudConnections(workspaceId: string) {
  return useQuery({
    queryKey: cloudConnectionKeys.list(workspaceId),
    queryFn: () => api.get<CloudConnection[]>(`/workspaces/${workspaceId}/cloud/connections`),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}

/** Puts a connection as the server now has it into the list – new, or in its place. */
function usePut(workspaceId: string) {
  const queryClient = useQueryClient();
  return (connection: CloudConnection) =>
    queryClient.setQueryData<CloudConnection[]>(cloudConnectionKeys.list(workspaceId), (list) =>
      list?.some((each) => each.id === connection.id)
        ? list.map((each) => (each.id === connection.id ? connection : each))
        : [...(list ?? []), connection],
    );
}

/** Connects a service – it is asked at once what it offers, so this takes a moment. */
export function useAddCloudConnection(workspaceId: string) {
  const put = usePut(workspaceId);
  return useMutation({
    mutationFn: (input: CloudConnectionInput) =>
      api.post<CloudConnection>(`/workspaces/${workspaceId}/cloud/connections`, input),
    onSuccess: put,
  });
}

export function useCheckCloudConnection(workspaceId: string) {
  const put = usePut(workspaceId);
  return useMutation({
    mutationFn: (connectionId: string) =>
      api.post<CloudConnection>(`/cloud/connections/${connectionId}/check`),
    onSuccess: put,
  });
}

/** Whether agents may change things there: the switch moves at once. */
export function useSetCloudConnectionMayChange(workspaceId: string) {
  const queryClient = useQueryClient();
  const key = cloudConnectionKeys.list(workspaceId);
  return useMutation({
    mutationFn: ({ connectionId, mayChange }: { connectionId: string; mayChange: boolean }) =>
      api.patch<void>(`/cloud/connections/${connectionId}`, { mayChange }),
    onMutate: ({ connectionId, mayChange }) => {
      queryClient.setQueryData<CloudConnection[]>(key, (list) =>
        list?.map((each) => (each.id === connectionId ? { ...each, mayChange } : each)),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useRemoveCloudConnection(workspaceId: string) {
  const queryClient = useQueryClient();
  const key = cloudConnectionKeys.list(workspaceId);
  return useMutation({
    mutationFn: (connectionId: string) => api.delete(`/cloud/connections/${connectionId}`),
    onMutate: (connectionId) => {
      queryClient.setQueryData<CloudConnection[]>(key, (list) =>
        list?.filter((each) => each.id !== connectionId),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
