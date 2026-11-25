import type {
  Attachment,
  Calendar,
  CalendarChange,
  CalendarConnection,
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
import { mailKeys } from './mail';

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
export function useCalendarEvents(
  workspaceId: string,
  from: string,
  to: string,
  enabled = true,
  /** Asked again this often while shown (the header's meeting: a mailbox's change shows). */
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: calendarKeys.range(workspaceId, from, to),
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/workspaces/${workspaceId}/calendar-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled,
    ...(refetchInterval && { refetchInterval }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * A page of the calendar (a day, a week, a month, a year): its events, and while they load what
 * any other range already holds of them – zoomed from the month into a week, its events are
 * there at once and move to their places instead of popping in.
 */
export function useCalendarPage(workspaceId: string, from: string, to: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: calendarKeys.range(workspaceId, from, to),
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/workspaces/${workspaceId}/calendar-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    staleTime: 30_000,
    placeholderData: () => {
      // A day's slack on either side: whole-day events are kept by their dates, not instants.
      const first = Date.parse(from) - 86_400_000;
      const last = Date.parse(to) + 86_400_000;
      const seen = new Map<string, CalendarEvent>();
      for (const [, list] of queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: calendarKeys.events(workspaceId),
      })) {
        for (const event of list ?? []) {
          if (Date.parse(event.end) >= first && Date.parse(event.start) <= last)
            seen.set(event.id, event);
        }
      }
      return seen.size ? [...seen.values()] : undefined;
    },
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

/**
 * One's calendars without a mailbox („Google/Microsoft Kalender verbinden“, or a mailbox removed
 * in Post while its calendars stayed).
 */
export function useCalendarConnections(workspaceId: string) {
  return useQuery({
    queryKey: [...calendarKeys.all(workspaceId), 'connections'] as const,
    queryFn: () => api.get<CalendarConnection[]>(`/workspaces/${workspaceId}/calendar-connections`),
    staleTime: 60_000,
  });
}

/**
 * Removes an account's calendars („Entfernen“ on „Konten“): a mailbox stays in Post, calendars
 * alone go with them. At the provider all stays.
 */
export function useRemoveAccountCalendars(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.delete(`/mail/accounts/${accountId}/calendars`),
    onSettled: () =>
      Promise.all([
        settle(queryClient, workspaceId)(),
        queryClient.invalidateQueries({ queryKey: mailKeys.accounts(workspaceId) }),
      ]),
  });
}

/**
 * A mailbox's calendars on again – at once where its sign-in lets them be read, else `signIn`:
 * its provider is asked first (`startMailOAuth` with `calendarOnly` and the account).
 */
export function useAddAccountCalendars(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      api.post<{ signIn: boolean }>(`/mail/accounts/${accountId}/calendars`),
    onSettled: () =>
      Promise.all([
        settle(queryClient, workspaceId)(),
        queryClient.invalidateQueries({ queryKey: mailKeys.accounts(workspaceId) }),
      ]),
  });
}

/**
 * Such a connection's own name (`label`, empty: its address) – at once in the calendar's list and
 * „Konten“; a refusal puts the old one back.
 */
export function useRenameCalendarConnection(workspaceId: string) {
  const queryClient = useQueryClient();
  const key = [...calendarKeys.all(workspaceId), 'connections'] as const;
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      api.patch(`/mail/accounts/${id}`, { label }),
    onMutate: async ({ id, label }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<CalendarConnection[]>(key);
      queryClient.setQueryData<CalendarConnection[]>(key, (now) =>
        now?.map((one) => (one.accountId === id ? { ...one, label: label.trim() || null } : one)),
      );
      return { before };
    },
    onError: (_error, _input, context) => queryClient.setQueryData(key, context?.before),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
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

/**
 * An event's id in a path: a mail calendar's (`mail:<calendar>:<provider's id>`) may hold `/`.
 */
const eventPath = (id: string) => `/calendar-events/${encodeURIComponent(id)}`;

/**
 * A change shows at once – title, time, calendar. Moved between a mailbox's calendar and another,
 * it comes back under a new id (made there, deleted here): it takes the old one's place.
 */
export function useUpdateEvent(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      change,
    }: {
      id: string;
      change: CalendarEventChange;
      /** The files `change.attachments` names, shown at once. */
      files?: Attachment[];
    }) => api.patch<CalendarEvent>(eventPath(id), change),
    onMutate: ({ id, change, files }) => {
      const { attachments: _ids, ...rest } = change;
      updateEvents(queryClient, workspaceId, (list) =>
        list.map((each) =>
          each.id === id ? { ...each, ...rest, ...(files && { attachments: files }) } : each,
        ),
      );
    },
    onSuccess: (event, { id }) =>
      updateEvents(queryClient, workspaceId, (list) =>
        list.map((each) => (each.id === id ? event : each)),
      ),
    onSettled: settle(queryClient, workspaceId),
  });
}

export function useDeleteEvent(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(eventPath(id)),
    onMutate: (id) =>
      updateEvents(queryClient, workspaceId, (list) => list.filter((each) => each.id !== id)),
    onSettled: settle(queryClient, workspaceId),
  });
}
