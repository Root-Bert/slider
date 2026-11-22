import { isOpenTodo } from '@slider/shared';
import { useCalendarEvents, useCalendars, useTodos } from '@/lib/api';
import { useHiddenCalendars } from './CalendarList';
import { addMonths, midnight, startOfMonth } from './days';
import { byDay, toEntries } from './entries';

/**
 * The days with something on them around `center` (the month before to the month after): an
 * event in a calendar one shows, an open to-do due – the small month's dots.
 */
export function useBusyDays(workspaceId: string, center: Date, enabled = true) {
  const from = midnight(startOfMonth(addMonths(startOfMonth(center), -1))).toISOString();
  const to = midnight(startOfMonth(addMonths(startOfMonth(center), 2))).toISOString();
  const calendars = useCalendars(workspaceId, enabled);
  const events = useCalendarEvents(workspaceId, from, to, enabled);
  const todos = useTodos(workspaceId, null, enabled);
  const { hidden } = useHiddenCalendars(workspaceId);
  const open = (todos.data ?? []).filter((todo) => isOpenTodo(todo.status));
  return new Set(
    byDay(toEntries(events.data ?? [], calendars.data ?? [], open, hidden)).keys(),
  ) as ReadonlySet<string>;
}
