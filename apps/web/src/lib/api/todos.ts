import type {
  Attachment,
  MilestoneChange,
  MilestoneInput,
  ProjectChange,
  ProjectInput,
  Todo,
  TodoChange,
  TodoInput,
  TodoMilestone,
  TodoProject,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { cloudAgentKeys } from './cloud-agents';

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
    mutationFn: ({
      id,
      change,
    }: {
      id: string;
      change: TodoChange;
      /** With `change.attachments`: the files themselves, shown at once. */
      files?: Attachment[];
    }) => api.patch<Todo>(`/todos/${id}`, change),
    onMutate: ({ id, change, files }) =>
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) => {
          if (each.id !== id) return each;
          const { assigneeId, assigneeAgentId, milestoneId, projectId, attachments, ...rest } =
            change;
          // Another area or project: its project and milestone as the server will set them.
          const moved = rest.areaId !== undefined && rest.areaId !== each.areaId;
          const project =
            projectId === undefined
              ? moved
                ? null
                : each.project
              : projectId === null
                ? null
                : (projectOf(queryClient, workspaceId, projectId) ?? each.project);
          const replaced = moved || (project?.id ?? null) !== (each.project?.id ?? null);
          return {
            ...each,
            ...rest,
            project: project ?? null,
            ...(replaced && milestoneId === undefined ? { milestone: null } : {}),
            // A place's to-dos wait on each other alone: another place, its links go.
            ...(replaced && rest.blockedBy === undefined ? { blockedBy: [] } : {}),
            ...(attachments && files ? { attachments: files } : {}),
            ...(assigneeId === null ? { assignee: null } : {}),
            ...(assigneeAgentId === null ? { assigneeAgent: null } : {}),
            // Into another milestone (or place) without a place among its lines: last there.
            ...(rest.position === undefined &&
            (replaced ||
              (milestoneId !== undefined && milestoneId !== (each.milestone?.id ?? null)))
              ? { position: Math.max(0, ...list.map((one) => one.position)) + 1 }
              : {}),
            ...(milestoneId === null
              ? { milestone: null }
              : milestoneId
                ? {
                    milestone: milestoneOf(queryClient, workspaceId, milestoneId) ?? each.milestone,
                  }
                : {}),
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

/** „Neuer Agent“: one of one's own named as the to-do, given it – not yet sent. */
export function useNewTodoAgent(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Todo>(`/todos/${id}/agent`),
    onSuccess: (todo) => {
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) => (each.id === todo.id ? todo : each)),
      );
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
    },
    onSettled: settle(queryClient, workspaceId),
  });
}

/** „Losschicken“: the agent given it starts on it – its face pulses once the list says so. */
export function useSendTodoAgent(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Todo>(`/todos/${id}/send`),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) }),
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

/** The live stream said to-dos changed: every list fetched anew, their milestones and projects too. */
export function todosChanged(queryClient: QueryClient, workspaceId: string) {
  void queryClient.invalidateQueries({ queryKey: todoKeys.all(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: milestoneKeys.all(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: projectKeys.all(workspaceId) });
}

/**
 * Milestones (`services/todos.ts`): one's own and the areas' one sees, or one area's – apart from
 * the to-dos' lists, which `updateLists` changes as to-dos.
 */
export const milestoneKeys = {
  all: (workspaceId: string) => ['todo-milestones', workspaceId] as const,
  list: (workspaceId: string, areaId: string | null) =>
    ['todo-milestones', workspaceId, areaId ?? 'all'] as const,
};

/** A milestone already in a list – a to-do given it shows its name at once. */
function milestoneOf(queryClient: QueryClient, workspaceId: string, id: string) {
  for (const [, list] of queryClient.getQueriesData<TodoMilestone[]>({
    queryKey: milestoneKeys.all(workspaceId),
  })) {
    const found = list?.find((one) => one.id === id);
    if (found) return { id: found.id, name: found.name, dueOn: found.dueOn };
  }
  return undefined;
}

export function useMilestones(workspaceId: string, areaId: string | null = null) {
  return useQuery({
    queryKey: milestoneKeys.list(workspaceId, areaId),
    queryFn: () =>
      api.get<TodoMilestone[]>(
        `/workspaces/${workspaceId}/todo-milestones${areaId ? `?area=${encodeURIComponent(areaId)}` : ''}`,
      ),
    staleTime: 30_000,
  });
}

function updateMilestones(
  queryClient: QueryClient,
  workspaceId: string,
  change: (list: TodoMilestone[]) => TodoMilestone[],
) {
  queryClient.setQueriesData<TodoMilestone[]>(
    { queryKey: milestoneKeys.all(workspaceId) },
    (list) => (list ? change(list) : list),
  );
}

const settleMilestones = (queryClient: QueryClient, workspaceId: string) => () => {
  void queryClient.invalidateQueries({ queryKey: milestoneKeys.all(workspaceId) });
  // Their to-dos carry name and date.
  void queryClient.invalidateQueries({ queryKey: todoKeys.all(workspaceId) });
};

export function useCreateMilestone(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MilestoneInput) =>
      api.post<TodoMilestone>(`/workspaces/${workspaceId}/todo-milestones`, input),
    onSuccess: (milestone) =>
      updateMilestones(queryClient, workspaceId, (list) =>
        list.some((each) => each.id === milestone.id) ? list : [...list, milestone],
      ),
    onSettled: settleMilestones(queryClient, workspaceId),
  });
}

/** Renamed or moved to another day – at once, on the timeline and on its to-dos. */
export function useUpdateMilestone(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: MilestoneChange }) =>
      api.patch<TodoMilestone>(`/todo-milestones/${id}`, change),
    onMutate: ({ id, change }) => {
      updateMilestones(queryClient, workspaceId, (list) =>
        list.map((each) => (each.id === id ? { ...each, ...change } : each)),
      );
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) =>
          each.milestone?.id === id
            ? { ...each, milestone: { ...each.milestone, ...change } }
            : each,
        ),
      );
    },
    onSettled: settleMilestones(queryClient, workspaceId),
  });
}

export function useDeleteMilestone(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/todo-milestones/${id}`),
    onMutate: (id) => {
      updateMilestones(queryClient, workspaceId, (list) => list.filter((each) => each.id !== id));
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) => (each.milestone?.id === id ? { ...each, milestone: null } : each)),
      );
    },
    onSettled: settleMilestones(queryClient, workspaceId),
  });
}

/**
 * Projects (`services/todos.ts`): an area's plans beside its „Allgemein“ – one area's, or every
 * area's one sees (the overview).
 */
export const projectKeys = {
  all: (workspaceId: string) => ['todo-projects', workspaceId] as const,
  list: (workspaceId: string, areaId: string | null) =>
    ['todo-projects', workspaceId, areaId ?? 'all'] as const,
};

/** A project already in a list – a to-do moved into it shows its name at once. */
function projectOf(queryClient: QueryClient, workspaceId: string, id: string) {
  for (const [, list] of queryClient.getQueriesData<TodoProject[]>({
    queryKey: projectKeys.all(workspaceId),
  })) {
    const found = list?.find((one) => one.id === id);
    if (found) return { id: found.id, name: found.name };
  }
  return undefined;
}

export function useProjects(workspaceId: string, areaId: string | null = null, enabled = true) {
  return useQuery({
    queryKey: projectKeys.list(workspaceId, areaId),
    queryFn: () =>
      api.get<TodoProject[]>(
        `/workspaces/${workspaceId}/todo-projects${areaId ? `?area=${encodeURIComponent(areaId)}` : ''}`,
      ),
    enabled,
    staleTime: 30_000,
  });
}

function updateProjects(
  queryClient: QueryClient,
  workspaceId: string,
  change: (list: TodoProject[]) => TodoProject[],
) {
  queryClient.setQueriesData<TodoProject[]>({ queryKey: projectKeys.all(workspaceId) }, (list) =>
    list ? change(list) : list,
  );
}

const settleProjects = (queryClient: QueryClient, workspaceId: string) => () => {
  void queryClient.invalidateQueries({ queryKey: projectKeys.all(workspaceId) });
  // Their to-dos carry the name; deleted, they and its milestones are „Allgemein“'s.
  void queryClient.invalidateQueries({ queryKey: todoKeys.all(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: milestoneKeys.all(workspaceId) });
};

export function useCreateProject(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectInput) =>
      api.post<TodoProject>(`/workspaces/${workspaceId}/todo-projects`, input),
    onSuccess: (project) =>
      updateProjects(queryClient, workspaceId, (list) =>
        list.some((each) => each.id === project.id) ? list : [...list, project],
      ),
    onSettled: settleProjects(queryClient, workspaceId),
  });
}

/** Renamed – at once, in its tab and on its to-dos. */
export function useUpdateProject(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: ProjectChange }) =>
      api.patch<TodoProject>(`/todo-projects/${id}`, change),
    onMutate: ({ id, change }) => {
      updateProjects(queryClient, workspaceId, (list) =>
        list.map((each) => (each.id === id ? { ...each, ...change } : each)),
      );
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) =>
          each.project?.id === id ? { ...each, project: { ...each.project, ...change } } : each,
        ),
      );
    },
    onSettled: settleProjects(queryClient, workspaceId),
  });
}

/** Deleted: its to-dos and milestones stand in „Allgemein“ at once. */
export function useDeleteProject(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/todo-projects/${id}`),
    onMutate: (id) => {
      updateProjects(queryClient, workspaceId, (list) => list.filter((each) => each.id !== id));
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) => (each.project?.id === id ? { ...each, project: null } : each)),
      );
      updateMilestones(queryClient, workspaceId, (list) =>
        list.map((each) => (each.projectId === id ? { ...each, projectId: null } : each)),
      );
    },
    onSettled: settleProjects(queryClient, workspaceId),
  });
}
