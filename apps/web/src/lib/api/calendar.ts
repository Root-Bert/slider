import type {
  Calendar,
  CalendarChange,
  CalendarEvent,
  CalendarEventChange,
  CalendarEventInput,
  CalendarInput,
  CalendarOverview,
  MailCalendarRefusal,
} from '@slider/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from '../api-client';

/** Calendars (`services/calendars.ts`): the ones one sees, their events by range. */
export const calendarKeys = {
  all: (workspaceId: string) => ['calendar', workspaceId] as const,
  calendars: (workspaceId: string) => ['calendar', workspaceId, 'calendars'] as const,
  events: (workspaceId: string) => ['calendar', workspaceId, 'events'] as const,
  range: (workspaceId: string, from: string, to: string) =>
    ['calendar', workspaceId, 'events', from, to] as const,
};

/** Every calendar one sees – the areas', one's private one, sub-calendars, the mail accounts'. */
export function useCalendars(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: calendarKeys.calendars(workspaceId),
    queryFn: () => api.get<Calendar[]>(`/workspaces/${workspaceId}/calendars`),
    enabled,
    staleTime: 60_000,
  });
}

/** The events overlapping [from, to) (ISO instants); the last range stays while the next loads. */
export function useCalendarEvents(workspaceId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: calendarKeys.range(workspaceId, from, to),
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/workspaces/${workspaceId}/calendar-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * The AI's word on the days ahead for what one sees (`hidden`: this browser's hidden calendars and
 * to-dos). Asked again with the calendar; the server asks the model only when that changed.
 */
export function useCalendarOverview(
  workspaceId: string,
  hidden: ReadonlySet<string>,
  enabled = true,
) {
  const list = [...hidden].sort();
  return useQuery({
    queryKey: [...calendarKeys.all(workspaceId), 'overview', list] as const,
    queryFn: () =>
      api.post<CalendarOverview>(`/workspaces/${workspaceId}/calendar-overview`, {
        hidden: list,
      }),
    enabled,
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/** One's mailboxes whose calendars their provider keeps from Slider until signed in anew. */
export function useMailCalendarRefusals(workspaceId: string) {
  return useQuery({
    queryKey: [...calendarKeys.all(workspaceId), 'refused'] as const,
    queryFn: () =>
      api.get<MailCalendarRefusal[]>(`/workspaces/${workspaceId}/mail-calendars/refused`),
    staleTime: 60_000,
  });
}

function updateEvents(
  queryClient: QueryClient,
  workspaceId: string,
  change: (list: CalendarEvent[]) => CalendarEvent[],
) {
  queryClient.setQueriesData<CalendarEvent[]>(
    { queryKey: calendarKeys.events(workspaceId) },
    (list) => (list ? change(list) : list),
  );
}

const settle = (queryClient: QueryClient, workspaceId: string) => () =>
  queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });

/** The live stream said calendars or events changed: fetched anew. */
export function calendarChanged(queryClient: QueryClient, workspaceId: string) {
  void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
}

export function useCreateCalendar(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CalendarInput) => api.post<Calendar>('/calendars', input),
    onSuccess: (calendar) =>
      queryClient.setQueryData<Calendar[]>(calendarKeys.calendars(workspaceId), (list) =>
        list && !list.some((each) => each.id === calendar.id) ? [...list, calendar] : list,
      ),
    onSettled: settle(queryClient, workspaceId),
  });
}

export function useUpdateCalendar(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: CalendarChange }) =>
      api.patch<Calendar>(`/calendars/${id}`, change),
    onMutate: ({ id, change }) =>
      queryClient.setQueryData<Calendar[]>(calendarKeys.calendars(workspaceId), (list) =>
        list?.map((each) => (each.id === id ? { ...each, ...change } : each)),
      ),
    onSettled: settle(queryClient, workspaceId),
  });
}

export function useDeleteCalendar(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/calendars/${id}`),
    onMutate: (id) => {
      queryClient.setQueryData<Calendar[]>(calendarKeys.calendars(workspaceId), (list) =>
        list?.filter((each) => each.id !== id && each.parentId !== id),
      );
      updateEvents(queryClient, workspaceId, (list) =>
        list.filter((each) => each.calendarId !== id),
      );
    },
    onSettled: settle(queryClient, workspaceId),
  });
}

export function useCreateEvent(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CalendarEventInput) => api.post<CalendarEvent>('/calendar-events', input),
    onSuccess: (event) =>
      updateEvents(queryClient, workspaceId, (list) =>
        list.some((each) => each.id === event.id) ? list : [...list, event],
      ),
    onSettled: settle(queryClient, workspaceId),
  });
}

/** A change shows at once – title, time, calendar. */
export function useUpdateEvent(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: CalendarEventChange }) =>
      api.patch<CalendarEvent>(`/calendar-events/${id}`, change),
    onMutate: ({ id, change }) =>
      updateEvents(queryClient, workspaceId, (list) =>
        list.map((each) => (each.id === id ? { ...each, ...change } : each)),
      ),
    onSuccess: (event) =>
      updateEvents(queryClient, workspaceId, (list) =>
        list.map((each) => (each.id === event.id ? event : each)),
      ),
    onSettled: settle(queryClient, workspaceId),
  });
}

export function useDeleteEvent(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/calendar-events/${id}`),
    onMutate: (id) =>
      updateEvents(queryClient, workspaceId, (list) => list.filter((each) => each.id !== id)),
    onSettled: settle(queryClient, workspaceId),
  });
}
