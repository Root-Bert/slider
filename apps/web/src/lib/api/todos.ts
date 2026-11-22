import type { Todo, TodoChange, TodoInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api-client';

/** To-dos (`services/todos.ts`): the overview (one's own and the areas' one sees), an area's. */
export const todoKeys = {
  all: (workspaceId: string) => ['todos', workspaceId] as const,
  list: (workspaceId: string, areaId: string | null) =>
    ['todos', workspaceId, areaId ?? 'all'] as const,
};

/** The overview (`areaId` null) or one area's list; kept fresh by the live stream (`todos`). */
export function useTodos(workspaceId: string, areaId: string | null = null, enabled = true) {
  return useQuery({
    queryKey: todoKeys.list(workspaceId, areaId),
    queryFn: () =>
      api.get<Todo[]>(
        `/workspaces/${workspaceId}/todos${areaId ? `?area=${encodeURIComponent(areaId)}` : ''}`,
      ),
    enabled,
    staleTime: 30_000,
  });
}

/** Every list it may stand in, changed at once. */
function updateLists(
  queryClient: QueryClient,
  workspaceId: string,
  change: (list: Todo[]) => Todo[],
) {
  queryClient.setQueriesData<Todo[]>({ queryKey: todoKeys.all(workspaceId) }, (list) =>
    list ? change(list) : list,
  );
}

const settle = (queryClient: QueryClient, workspaceId: string) => () =>
  queryClient.invalidateQueries({ queryKey: todoKeys.all(workspaceId) });

export function useCreateTodo(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TodoInput) => api.post<Todo>(`/workspaces/${workspaceId}/todos`, input),
    onSuccess: (todo) =>
      updateLists(queryClient, workspaceId, (list) =>
        list.some((each) => each.id === todo.id) ? list : [todo, ...list],
      ),
    onSettled: settle(queryClient, workspaceId),
  });
}

/** A change shows at once – status, priority, who, due date, words. */
export function useUpdateTodo(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: TodoChange }) =>
      api.patch<Todo>(`/todos/${id}`, change),
    onMutate: ({ id, change }) =>
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) => {
          if (each.id !== id) return each;
          const { assigneeId, assigneeAgentId, ...rest } = change;
          return {
            ...each,
            ...rest,
            ...(assigneeId === null ? { assignee: null } : {}),
            ...(assigneeAgentId === null ? { assigneeAgent: null } : {}),
          };
        }),
      ),
    onSuccess: (todo) =>
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) => (each.id === todo.id ? todo : each)),
      ),
    onSettled: settle(queryClient, workspaceId),
  });
}

export function useDeleteTodo(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/todos/${id}`),
    onMutate: (id) =>
      updateLists(queryClient, workspaceId, (list) => list.filter((each) => each.id !== id)),
    onSettled: settle(queryClient, workspaceId),
  });
}

/** The live stream said to-dos changed: every list fetched anew. */
export function todosChanged(queryClient: QueryClient, workspaceId: string) {
  void queryClient.invalidateQueries({ queryKey: todoKeys.all(workspaceId) });
}
