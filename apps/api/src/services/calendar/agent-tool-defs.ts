import { z } from 'zod';
import {
  MAX_CALENDAR_NAME,
  MAX_EVENT_LOCATION,
  MAX_EVENT_NOTES,
  MAX_EVENT_TITLE,
  meetingUrlSchema,
} from '@slider/shared';

/*
 * The calendar tools as the model reads them (`agent-tools.ts` runs them) – apart, so the apps'
 * catalogue can list them while the services are still loading.
 */

export const ZONE = 'Europe/Berlin';
export const DAY_MS = 86_400_000;
/** What one listing spans unless asked otherwise, and at most. */
export const LIST_DAYS = 14;
export const MAX_LIST_DAYS = 366;
export const MAX_LISTED = 300;

const id = z.string().min(1).max(100);
const dayText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
/** A day (all-day) or a time: local in Berlin („2026-11-23T14:00“) or with an offset. */
const timeText = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/,
    'YYYY-MM-DD for a whole day, else YYYY-MM-DDTHH:MM',
  );
const eventFields = {
  title: z.string().trim().min(1).max(MAX_EVENT_TITLE),
  start: timeText,
  end: timeText,
  location: z.string().max(MAX_EVENT_LOCATION),
  notes: z.string().max(MAX_EVENT_NOTES),
  calendar: id,
  /** A meeting elsewhere (Zoom, Meet, Teams) by its link; empty: none any more. */
  meeting_link: z.union([z.literal(''), meetingUrlSchema]),
};

export const CALENDAR_INPUTS = {
  list_calendars: z.object({}),
  list_events: z.object({
    from: dayText.optional(),
    to: dayText.optional(),
    calendar: id.optional(),
    query: z.string().trim().max(200).optional(),
  }),
  create_event: z.object({
    ...eventFields,
    end: eventFields.end.optional(),
    location: eventFields.location.optional(),
    notes: eventFields.notes.optional(),
    meeting_link: eventFields.meeting_link.optional(),
  }),
  update_event: z
    .object({ event: id, ...eventFields })
    .partial()
    .required({ event: true }),
  delete_event: z.object({ event: id }),
  create_calendar: z.object({
    name: z.string().trim().min(1).max(MAX_CALENDAR_NAME),
    under: id.optional(),
    mailbox: id.optional(),
    color: z.string().trim().max(20).optional(),
  }),
  update_calendar: z.object({
    calendar: id,
    name: z.string().trim().min(1).max(MAX_CALENDAR_NAME).optional(),
    color: z.string().trim().max(20).optional(),
  }),
  delete_calendar: z.object({ calendar: id }),
};
export type CalendarToolName = keyof typeof CALENDAR_INPUTS;
export const CALENDAR_TOOL_NAMES = Object.keys(CALENDAR_INPUTS) as CalendarToolName[];

const EVENT_PROPERTIES = {
  title: { type: 'string', description: 'What it is, short.' },
  start: {
    type: 'string',
    description: 'YYYY-MM-DD: a whole day. Else YYYY-MM-DDTHH:MM, Berlin time (or with an offset).',
  },
  end: {
    type: 'string',
    description:
      'As start. A whole-day one: its last day (2026-11-23 for a one-day one). Left out: one day, or an hour.',
  },
  location: { type: 'string', description: 'Where: a place, an address or a link.' },
  notes: { type: 'string', description: 'Details, plain text. On update it replaces the old.' },
  meeting_link: {
    type: 'string',
    description:
      'A meeting held elsewhere (Zoom, Google Meet, Teams …): its https link – joined from the event and, shortly before, from the header. Empty on update: no meeting any more.',
  },
} as const;

/** The tools as the model reads them: name, what it does, its input (JSON Schema). */
export const CALENDAR_TOOLS: {
  name: CalendarToolName;
  title: string;
  description: string;
  properties: Record<string, unknown>;
  required: string[];
  reads: boolean;
}[] = [
  {
    name: 'list_calendars',
    title: 'List calendars',
    description:
      'The calendars the person sees, by id: each area’s (everyone in the area sees it), their private one (only they), sub-calendars under them, and their mailboxes’ calendars (changed at the mailbox’s provider). Says where events may be put.',
    properties: {},
    required: [],
    reads: true,
  },
  {
    name: 'list_events',
    title: 'List events',
    description: `Events („Termine“) in the calendars the person sees, by start, times in Berlin time: from a day (default today) to a day (inclusive; default ${LIST_DAYS} days on). With calendar: that one and its sub-calendars; with query: only events whose title, place or notes have it. Each with its id, its calendar and whether it may be changed.`,
    properties: {
      from: { type: 'string', description: 'First day, YYYY-MM-DD.' },
      to: { type: 'string', description: 'Last day, YYYY-MM-DD.' },
      calendar: { type: 'string', description: 'A calendar id (from list_calendars).' },
      query: { type: 'string', description: 'Words to find.' },
    },
    required: [],
    reads: true,
  },
  {
    name: 'create_event',
    title: 'Create an event',
    description:
      'Puts an event into a calendar (from list_calendars, one that takes events): an area’s is seen by its people, the private one only by the person. Only when asked to put something in the calendar.',
    properties: {
      calendar: { type: 'string', description: 'A calendar id.' },
      ...EVENT_PROPERTIES,
    },
    required: ['calendar', 'title', 'start'],
    reads: false,
  },
  {
    name: 'update_event',
    title: 'Change an event',
    description:
      'Changes an event (by id, from list_events): only the fields given. calendar moves it to another calendar that takes events. Start and end given together keep their kind (day or time).',
    properties: {
      event: { type: 'string' },
      calendar: { type: 'string', description: 'Another calendar id.' },
      ...EVENT_PROPERTIES,
    },
    required: ['event'],
    reads: false,
  },
  {
    name: 'delete_event',
    title: 'Delete an event',
    description: 'Deletes an event (by id) for everyone who sees its calendar. Only when asked.',
    properties: { event: { type: 'string' } },
    required: ['event'],
    reads: false,
  },
  {
    name: 'create_calendar',
    title: 'Create a calendar',
    description:
      'Makes a calendar, as „Neuer Kalender“ does: under one that takes events (`under`: an area’s, the person’s own or another one’s sub-calendar) or in one of their mailboxes at its provider (`mailbox`, from list_mailboxes) – exactly one of the two.',
    properties: {
      name: { type: 'string' },
      under: { type: 'string', description: 'A calendar id (list_calendars).' },
      mailbox: { type: 'string', description: 'A mailbox id.' },
      color: { type: 'string', description: 'An accent (blue, green, …) or #rrggbb.' },
    },
    required: ['name'],
    reads: false,
  },
  {
    name: 'update_calendar',
    title: 'Rename or recolour a calendar',
    description: 'Renames a calendar or gives it another colour – where the person may manage it.',
    properties: {
      calendar: { type: 'string' },
      name: { type: 'string' },
      color: { type: 'string', description: 'An accent (blue, green, …) or #rrggbb.' },
    },
    required: ['calendar'],
    reads: false,
  },
  {
    name: 'delete_calendar',
    title: 'Delete a calendar',
    description:
      'Deletes a calendar with its events for everyone who sees it. With an agent it waits for the person’s „Löschen“ on a card.',
    properties: { calendar: { type: 'string' } },
    required: ['calendar'],
    reads: false,
  },
];
