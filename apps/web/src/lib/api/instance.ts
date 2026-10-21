import type {
  InstanceHistory,
  InstanceInterval,
  InstanceOverview,
  InstanceTimeline,
  InstanceUser,
  InstanceUserList,
  InstanceWorkspace,
  InstanceWorkspaceList,
  PlanId,
} from '@slider/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';

/** The instance admin's dashboard `/instanz` (BER-167). */

const INSTANCE_KEY = ['instance'] as const;
const instanceKeys = {
  overview: [...INSTANCE_KEY, 'overview'] as const,
  timeline: (query: string) => [...INSTANCE_KEY, 'timeline', query] as const,
  history: [...INSTANCE_KEY, 'history'] as const,
  users: (q: string, offset: number) => [...INSTANCE_KEY, 'users', q, offset] as const,
  workspaces: (q: string, offset: number) => [...INSTANCE_KEY, 'workspaces', q, offset] as const,
};

const listQuery = (q: string, offset: number) => {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (offset > 0) params.set('offset', String(offset));
  const search = params.toString();
  return search ? `?${search}` : '';
};

type Refresh = { refetchInterval?: number | false };

/** The instance as it is now – nothing here depends on the chart's window. */
export const useInstanceOverview = ({ refetchInterval }: Refresh = {}) =>
  useQuery({
    queryKey: instanceKeys.overview,
    queryFn: () => api.get<InstanceOverview>('/instance/overview'),
    refetchInterval,
  });

/**
 * What was created in the chart's window (`interval=…&to=…`, as built by `timelineQuery`); the
 * previous window stays while the next loads, so moving it never flickers.
 */
export const useInstanceTimeline = (query: string, { refetchInterval }: Refresh = {}) =>
  useQuery({
    queryKey: instanceKeys.timeline(query),
    queryFn: () => api.get<InstanceTimeline>(`/instance/timeline?${query}`),
    placeholderData: keepPreviousData,
    refetchInterval,
  });

/** `interval=31d&to=…` – the timeline's query for a window. */
export const timelineQuery = (interval: InstanceInterval, to: number) =>
  new URLSearchParams({ interval, to: new Date(to).toISOString() }).toString();

/** History changes by the day: the strip it draws needn't ask more than every few minutes. */
const HISTORY_STALE_MS = 5 * 60_000;

/** The whole history, for the strip the window slides over. */
export const useInstanceHistory = () =>
  useQuery({
    queryKey: instanceKeys.history,
    queryFn: () => api.get<InstanceHistory>('/instance/history'),
    staleTime: HISTORY_STALE_MS,
  });

/** One page of accounts; the previous page stays while the next loads (search as you type). */
export const useInstanceUsers = (q: string, offset: number) =>
  useQuery({
    queryKey: instanceKeys.users(q, offset),
    queryFn: () => api.get<InstanceUserList>(`/instance/users${listQuery(q, offset)}`),
    placeholderData: keepPreviousData,
  });

export const useInstanceWorkspaces = (q: string, offset: number) =>
  useQuery({
    queryKey: instanceKeys.workspaces(q, offset),
    queryFn: () => api.get<InstanceWorkspaceList>(`/instance/workspaces${listQuery(q, offset)}`),
    placeholderData: keepPreviousData,
  });

/**
 * A change moves one row and a number on the overview – never what was created over time. The
 * row the server answers with replaces its old self on every cached page; the overview reloads.
 */
function useApplyRow<Key extends 'users' | 'workspaces', Row extends { id: string }>(key: Key) {
  const queryClient = useQueryClient();
  return (row: Row) => {
    queryClient.setQueriesData<Record<Key, Row[]>>(
      { queryKey: [...INSTANCE_KEY, key] },
      (page) =>
        page && {
          ...page,
          [key]: page[key].map((each) => (each.id === row.id ? row : each)),
        },
    );
    return queryClient.invalidateQueries({ queryKey: instanceKeys.overview });
  };
}

export function useSetUserBlocked() {
  const apply = useApplyRow<'users', InstanceUser>('users');
  return useMutation({
    mutationFn: ({ userId, blocked }: { userId: string; blocked: boolean }) =>
      api.put<InstanceUser>(`/instance/users/${userId}/blocked`, { blocked }),
    onSuccess: apply,
  });
}

export function useSetWorkspaceBlocked() {
  const apply = useApplyRow<'workspaces', InstanceWorkspace>('workspaces');
  return useMutation({
    mutationFn: ({ workspaceId, blocked }: { workspaceId: string; blocked: boolean }) =>
      api.put<InstanceWorkspace>(`/instance/workspaces/${workspaceId}/blocked`, { blocked }),
    onSuccess: apply,
  });
}

export function useSetWorkspacePlan() {
  const apply = useApplyRow<'workspaces', InstanceWorkspace>('workspaces');
  return useMutation({
    mutationFn: ({ workspaceId, plan }: { workspaceId: string; plan: PlanId }) =>
      api.put<InstanceWorkspace>(`/instance/workspaces/${workspaceId}/plan`, { plan }),
    onSuccess: apply,
  });
}
