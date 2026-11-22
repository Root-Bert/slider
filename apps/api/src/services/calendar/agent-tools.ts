import type { Calendar, CalendarEvent } from '@slider/shared';
import type { AppDeps } from '../../deps';
import { promptName } from '../ai-prompt-parts';
import {
  createEvent,
  deleteEvent,
  getEvent,
  listCalendars,
  listEvents,
  updateEvent,
} from '../calendars';
import { ToolChatError } from '../tool-chat';
import {
  CALENDAR_INPUTS,
  DAY_MS,
  LIST_DAYS,
  MAX_LISTED,
  MAX_LIST_DAYS,
  ZONE,
  type CalendarToolName,
} from './agent-tool-defs';
import { zonedToUtc } from './ical';

/*
 * The calendars as tools for the AI – the chat beside the files, agents and apps (MCP) alike:
 * the calendars one sees, their events in a range, events made, changed and deleted with one's
 * rights (`services/calendars.ts`). Times as the app's people read them (Europe/Berlin).
 */

const BERLIN = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const berlin = (instant: string) => BERLIN.format(new Date(instant));
const isDay = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text);
const dayAfter = (day: string, by = 1) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);

/** A time as the server keeps it: an instant; local times are Berlin's. */
function toInstant(text: string): string {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const instant = Date.parse(text);
    if (Number.isNaN(instant)) throw new ToolChatError(`Not a time: ${text}`);
    return new Date(instant).toISOString();
  }
  const [date, clock = '00:00'] = text.split('T') as [string, string?];
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute, second = 0] = clock.split(':').map(Number) as [number, number, number?];
  return new Date(
    zonedToUtc(Date.UTC(year, month - 1, day, hour, minute, Math.floor(second)), ZONE),
  ).toISOString();
}

/** Start and end as the server takes them: days (end exclusive) or instants. */
function span(start: string, end: string | undefined) {
  if (isDay(start)) {
    if (end && !isDay(end))
      throw new ToolChatError('A whole-day event ends on a day (YYYY-MM-DD), not at a time.');
    const last = end ?? start;
    if (last < start) throw new ToolChatError('It ends before it starts.');
    return { allDay: true, start, end: dayAfter(last) };
  }
  if (end && isDay(end))
    throw new ToolChatError('An event at a time ends at a time (YYYY-MM-DDTHH:MM).');
  const from = toInstant(start);
  const to = end ? toInstant(end) : new Date(Date.parse(from) + 3_600_000).toISOString();
  if (Date.parse(to) <= Date.parse(from)) throw new ToolChatError('It ends before it starts.');
  return { allDay: false, start: from, end: to };
}

function whereOf(calendar: Calendar, byId: Map<string, Calendar>) {
  const parent = calendar.parentId ? byId.get(calendar.parentId) : undefined;
  if (parent) return `under „${promptName(parent.name)}“`;
  if (calendar.kind === 'area') return 'the area’s, its people see it';
  if (calendar.kind === 'private') return 'private, only the person sees it';
  return 'from one of the person’s mailboxes';
}

export function whenOf(event: CalendarEvent) {
  if (event.allDay) {
    const last = dayAfter(event.end, -1);
    return last === event.start ? `${event.start} (all day)` : `${event.start} – ${last} (all day)`;
  }
  const [startDay, startClock] = berlin(event.start).split(' ');
  const [endDay, endClock] = berlin(event.end).split(' ');
  return startDay === endDay
    ? `${startDay} ${startClock}–${endClock}`
    : `${startDay} ${startClock} – ${endDay} ${endClock}`;
}

function eventLine(event: CalendarEvent, byId: Map<string, Calendar>) {
  const calendar = byId.get(event.calendarId);
  return [
    `[${event.id}] ${whenOf(event)} · ${promptName(event.title)}`,
    event.location ? ` · at ${promptName(event.location)}` : '',
    calendar ? ` · in „${promptName(calendar.name)}“ (${calendar.id})` : '',
    event.canEdit ? '' : ' · read only',
  ].join('');
}

/**
 * Runs a calendar tool as the person (`userId`). `areasOnly`: why only areas' calendars are
 * open (a shared agent, one working by itself) – the private and mail ones are left out.
 */
export async function runCalendarTool(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  name: CalendarToolName,
  raw: unknown,
  { areasOnly }: { areasOnly?: string | null } = {},
): Promise<string> {
  const all = await listCalendars(deps, userId, workspaceId);
  const byId = new Map(all.map((each) => [each.id, each]));
  /** It, or the one it stands under, is an area's. */
  const isArea = (calendar: Calendar | undefined) => !!calendar?.areaId;
  const open = (calendar: Calendar | undefined) => !areasOnly || isArea(calendar);
  const calendarOf = (calendarId: string) => {
    const calendar = byId.get(calendarId);
    if (!calendar) throw new ToolChatError(`No calendar ${calendarId}: see list_calendars.`);
    if (!open(calendar))
      throw new ToolChatError(`Not here: that is the person's own calendar, and ${areasOnly}.`);
    return calendar;
  };
  const eventOf = async (eventId: string) => {
    if (eventId.startsWith('mail:'))
      throw new ToolChatError('That event is from a mailbox’s calendar: read only.');
    const event = await getEvent(deps, userId, eventId);
    calendarOf(event.calendarId);
    return event;
  };
  switch (name) {
    case 'list_calendars': {
      CALENDAR_INPUTS.list_calendars.parse(raw ?? {});
      const shown = all.filter(open);
      return (
        (shown
          .map(
            (calendar) =>
              `[${calendar.id}] „${promptName(calendar.name)}“ – ${whereOf(calendar, byId)}${calendar.canEdit ? '; takes events' : '; read only'}`,
          )
          .join('\n') || 'No calendars.') +
        (areasOnly ? `\nThe person's own calendars are not open to you: ${areasOnly}.` : '')
      );
    }
    case 'list_events': {
      const input = CALENDAR_INPUTS.list_events.parse(raw ?? {});
      const from = input.from ?? BERLIN.format(deps.clock.now()).slice(0, 10);
      const to = input.to ?? dayAfter(from, LIST_DAYS - 1);
      if (to < from) throw new ToolChatError('to is before from.');
      if (Date.parse(to) - Date.parse(from) > MAX_LIST_DAYS * DAY_MS)
        throw new ToolChatError(`At most ${MAX_LIST_DAYS} days at once.`);
      const within = input.calendar ? calendarOf(input.calendar).id : null;
      const under = (calendarId: string) => {
        for (let at: string | null = calendarId, depth = 0; at && depth < 8; depth++) {
          if (at === within) return true;
          at = byId.get(at)?.parentId ?? null;
        }
        return false;
      };
      const words = input.query?.toLocaleLowerCase('de');
      const events = (
        await listEvents(deps, userId, workspaceId, {
          from: toInstant(from),
          to: toInstant(dayAfter(to)),
        })
      )
        .filter((event) => open(byId.get(event.calendarId)))
        .filter((event) => !within || under(event.calendarId))
        .filter(
          (event) =>
            !words ||
            `${event.title}\n${event.location}\n${event.notes}`
              .toLocaleLowerCase('de')
              .includes(words),
        )
        .sort((a, b) => toInstantOf(a) - toInstantOf(b));
      const lines = events.slice(0, MAX_LISTED).map((event) => eventLine(event, byId));
      return (
        (lines.join('\n') || `No events from ${from} to ${to}.`) +
        (events.length > MAX_LISTED
          ? `\n… and ${events.length - MAX_LISTED} more: ask for fewer days.`
          : '')
      );
    }
    case 'create_event': {
      const input = CALENDAR_INPUTS.create_event.parse(raw);
      const calendar = calendarOf(input.calendar);
      if (!calendar.canEdit)
        throw new ToolChatError(`„${promptName(calendar.name)}“ takes no events from the person.`);
      const event = await createEvent(deps, userId, {
        calendarId: calendar.id,
        title: input.title,
        location: input.location,
        notes: input.notes,
        ...span(input.start, input.end),
      });
      return `Made: ${eventLine(event, byId)}`;
    }
    case 'update_event': {
      const input = CALENDAR_INPUTS.update_event.parse(raw);
      const event = await eventOf(input.event);
      if (input.calendar) calendarOf(input.calendar);
      let times = {};
      if (input.start || input.end) {
        let end = input.end;
        // Moved without an end: it keeps its length while it keeps its kind (day or time).
        if (!end && input.start && event.allDay === isDay(input.start)) {
          const length = Date.parse(event.end) - Date.parse(event.start);
          end = event.allDay
            ? dayAfter(input.start, length / DAY_MS - 1)
            : new Date(Date.parse(toInstant(input.start)) + length).toISOString();
        }
        times = span(input.start ?? event.start, end);
      }
      const changed = await updateEvent(deps, userId, event.id, {
        calendarId: input.calendar,
        title: input.title,
        location: input.location,
        notes: input.notes,
        ...times,
      });
      return `Changed: ${eventLine(changed, byId)}`;
    }
    case 'delete_event': {
      const event = await eventOf(CALENDAR_INPUTS.delete_event.parse(raw).event);
      await deleteEvent(deps, userId, event.id);
      return `Deleted: ${eventLine(event, byId)}`;
    }
  }
}

const toInstantOf = (event: CalendarEvent) =>
  event.allDay ? Date.parse(toInstant(event.start)) : Date.parse(event.start);
