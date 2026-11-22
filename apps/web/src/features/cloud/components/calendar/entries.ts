import type { Calendar, CalendarEvent, CloudAreaColor, Todo } from '@slider/shared';
import { areaColor } from '../AreaDot';
import {
  addMonths,
  at,
  iso,
  midnight,
  monthDays,
  monthFormat,
  plus,
  startOfMonth,
  startOfWeek,
  weekNumber,
} from './days';

/** What the calendar shows at once – as Apple's and Google's: a day, a week, a month, a year, a list. */
export const CALENDAR_VIEWS = ['tag', 'woche', 'monat', 'jahr', 'agenda'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export const VIEW_LABELS: Record<CalendarView, string> = {
  tag: 'Tag',
  woche: 'Woche',
  monat: 'Monat',
  jahr: 'Jahr',
  agenda: 'Agenda',
};
/** The list's days: four weeks from the day picked. */
const AGENDA_DAYS = 28;

/** The days a view shows, first to last (the month's whole weeks, the year's months). */
export function viewDays(view: CalendarView, anchor: Date): Date[] {
  switch (view) {
    case 'tag':
      return [anchor];
    case 'woche':
      return Array.from({ length: 7 }, (_, index) => plus(startOfWeek(anchor), index));
    case 'monat':
      return monthDays(startOfMonth(anchor));
    case 'jahr': {
      const first = new Date(anchor.getFullYear(), 0, 1, 12);
      const count = Math.round(
        (new Date(anchor.getFullYear() + 1, 0, 1, 12).getTime() - first.getTime()) / 86_400_000,
      );
      return Array.from({ length: count }, (_, index) => plus(first, index));
    }
    case 'agenda':
      return Array.from({ length: AGENDA_DAYS }, (_, index) => plus(anchor, index));
  }
}

/** One step back or on: a day, a week, a month, a year, the list's four weeks. */
export function stepped(view: CalendarView, anchor: Date, by: 1 | -1): Date {
  switch (view) {
    case 'tag':
      return plus(anchor, by);
    case 'woche':
      return plus(anchor, 7 * by);
    case 'monat':
      return addMonths(anchor, by);
    case 'jahr':
      return new Date(anchor.getFullYear() + by, anchor.getMonth(), 1, 12);
    case 'agenda':
      return plus(anchor, AGENDA_DAYS * by);
  }
}

const weekdayFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });
const shortDay = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const shortDayYear = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
/** A day, short – with its year only when that is not this year's. */
const short = (day: Date) =>
  (day.getFullYear() === new Date().getFullYear() ? shortDay : shortDayYear).format(day);
/** „16.–22. Nov.“, „30. Nov. – 6. Dez.“, „28. Dez. 2026 – 3. Jan. 2027“: short enough for the head beside the buttons. */
const span = (first: Date, last: Date) =>
  first.getFullYear() !== last.getFullYear()
    ? `${shortDayYear.format(first)} – ${shortDayYear.format(last)}`
    : first.getMonth() === last.getMonth()
      ? `${first.getDate()}.–${short(last)}`
      : `${shortDay.format(first)} – ${short(last)}`;

/** What the head says: „November 2026“, „KW 47 · 16.–22. Nov.“, „Samstag, 21. Nov.“ (another year's with it). */
export function viewTitle(view: CalendarView, anchor: Date): string {
  const days = viewDays(view, anchor);
  switch (view) {
    case 'tag':
      return `${weekdayFormat.format(anchor)}, ${short(anchor)}`;
    case 'woche':
      return `KW ${weekNumber(anchor)} · ${span(days[0]!, days[6]!)}`;
    case 'monat':
      return monthFormat.format(anchor);
    case 'jahr':
      return String(anchor.getFullYear());
    case 'agenda':
      return span(days[0]!, days.at(-1)!);
  }
}

/** What the server is asked for: the view's days from midnight to midnight, as instants. */
export function viewRange(view: CalendarView, anchor: Date) {
  const days = viewDays(view, anchor);
  return {
    from: midnight(days[0]!).toISOString(),
    to: midnight(plus(days.at(-1)!, 1)).toISOString(),
  };
}

/** An event or a due to-do, as the views place them. */
export interface Entry {
  key: string;
  title: string;
  color: string;
  allDay: boolean;
  /** All-day: the first day's noon; else the instant. */
  start: Date;
  /** All-day: the noon of the day after the last (exclusive); else the instant. */
  end: Date;
  /** Where it is from: the calendar's name. */
  place: string;
  location: string;
  event?: CalendarEvent;
  todo?: Todo;
}

export const colorOf = (color: string) => areaColor(color as CloudAreaColor);

export function toEntries(
  events: readonly CalendarEvent[],
  calendars: readonly Calendar[],
  todos: readonly Todo[],
  hidden: ReadonlySet<string>,
): Entry[] {
  const byId = new Map(calendars.map((each) => [each.id, each]));
  /** Hidden: it, or one it stands under. */
  const isHidden = (id: string | null): boolean => {
    for (let depth = 0, at = id; at && depth < 8; depth++) {
      if (hidden.has(at)) return true;
      at = byId.get(at)?.parentId ?? null;
    }
    return false;
  };
  const entries: Entry[] = [];
  for (const event of events) {
    const calendar = byId.get(event.calendarId);
    if (!calendar || isHidden(calendar.id)) continue;
    entries.push({
      key: `e:${event.id}`,
      title: event.title,
      color: colorOf(calendar.color),
      allDay: event.allDay,
      start: event.allDay ? at(event.start) : new Date(event.start),
      end: event.allDay ? at(event.end) : new Date(event.end),
      place: calendar.name,
      location: event.location,
      event,
    });
  }
  if (!hidden.has(TODOS)) {
    for (const todo of todos) {
      if (!todo.dueOn) continue;
      entries.push({
        key: `t:${todo.id}`,
        title: todo.title,
        color: 'var(--color-fg-subtle)',
        allDay: true,
        start: at(todo.dueOn),
        end: plus(at(todo.dueOn), 1),
        place: 'Aufgaben',
        location: '',
        todo,
      });
    }
  }
  return entries.sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime(),
  );
}

/** The to-dos' row in the calendars' list, hidden as a calendar is. */
export const TODOS = 'aufgaben';

/** The days an entry covers, as kept (`YYYY-MM-DD`). */
export function entryDays(entry: Entry): string[] {
  const last = entry.allDay ? plus(entry.end, -1) : new Date(entry.end.getTime() - 1);
  const days: string[] = [];
  for (
    let day = at(iso(entry.start));
    iso(day) <= iso(last) && days.length < 400;
    day = plus(day, 1)
  ) {
    days.push(iso(day));
  }
  return days.length ? days : [iso(entry.start)];
}

/** Entries by day, each in its order. */
export function byDay(entries: readonly Entry[]) {
  const days = new Map<string, Entry[]>();
  for (const entry of entries) {
    for (const day of entryDays(entry)) days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return days;
}
