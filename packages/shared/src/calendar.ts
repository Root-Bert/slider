/**
 * Calendars – the workspace's days. Every area is a calendar by itself (the workspace too: it is
 * an area), each person has a private one, and under any of them sub-calendars („Urlaub“,
 * „Messen“). A person's mail accounts bring their calendars along, read only and theirs alone.
 * Events are seen by whoever sees the calendar and changed by whoever may edit there.
 */
import { z } from 'zod';
import { cloudAreaColorSchema } from './cloud';
import type { Author } from './model';

/**
 * `area`: an area's (the workspace's own area too) – its people's. `private`: one's own, only
 * one sees it. `mail`: a calendar of one's mail account, read only. Sub-calendars take the kind
 * of the one they stand under.
 */
export type CalendarKind = 'area' | 'private' | 'mail';

export interface Calendar {
  id: string;
  workspaceId: string;
  kind: CalendarKind;
  /** An area's (or under one): that area. */
  areaId: string | null;
  /** A sub-calendar: the one it stands under. */
  parentId: string | null;
  /** From a mail account: which (its address names the group). */
  mailAccountId: string | null;
  name: string;
  /** An accent name (`blue`, … as an area's) or a provider's `#rrggbb`. */
  color: string;
  /** Events may be put in, changed and deleted here. */
  canEdit: boolean;
  /** It may be renamed, coloured or deleted (sub-calendars one may edit in). */
  canManage: boolean;
}

/**
 * A mailbox signed in through its provider whose calendars Slider may not read: signed in before
 * calendars were asked for. Signing in anew asks.
 */
export interface MailCalendarRefusal {
  accountId: string;
  signIn: 'google' | 'microsoft';
}

export interface CalendarEvent {
  /** A mail calendar's: the provider's, per occurrence. */
  id: string;
  calendarId: string;
  title: string;
  location: string;
  notes: string;
  allDay: boolean;
  /** All-day: `YYYY-MM-DD`, `end` exclusive (as iCal); else ISO instants. */
  start: string;
  end: string;
  canEdit: boolean;
  createdBy: Author | null;
}

export const MAX_CALENDAR_NAME = 80;
export const MAX_EVENT_TITLE = 300;
export const MAX_EVENT_NOTES = 20_000;
export const MAX_EVENT_LOCATION = 500;
/** What one look at the calendar spans at most: a year (the year view) and a little. */
export const MAX_EVENT_RANGE_DAYS = 400;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().datetime({ offset: true });

export const calendarInputSchema = z.object({
  /** Where it stands: under an area's, one's private or another sub-calendar. */
  parentId: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(MAX_CALENDAR_NAME),
  color: cloudAreaColorSchema.optional(),
});
export type CalendarInput = z.infer<typeof calendarInputSchema>;

export const calendarChangeSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_CALENDAR_NAME),
    color: cloudAreaColorSchema,
  })
  .partial();
export type CalendarChange = z.infer<typeof calendarChangeSchema>;

const eventFields = {
  calendarId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(MAX_EVENT_TITLE),
  location: z.string().max(MAX_EVENT_LOCATION),
  notes: z.string().max(MAX_EVENT_NOTES),
  allDay: z.boolean(),
  start: z.union([day, instant]),
  end: z.union([day, instant]),
};

/** Start before end, both of the event's kind (days all-day, instants else). */
const fits = (event: { allDay?: boolean; start?: string; end?: string }) =>
  event.start === undefined ||
  event.end === undefined ||
  event.allDay === undefined ||
  ((event.allDay ? day : instant).safeParse(event.start).success &&
    (event.allDay ? day : instant).safeParse(event.end).success &&
    (event.allDay ? event.start < event.end : Date.parse(event.start) < Date.parse(event.end)));

export const calendarEventInputSchema = z
  .object({
    ...eventFields,
    location: eventFields.location.optional(),
    notes: eventFields.notes.optional(),
  })
  .refine(fits, { message: 'Der Termin endet vor seinem Beginn.' });
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

/** A change: any field; `calendarId` moves it to another calendar one may edit. */
export const calendarEventChangeSchema = z.object(eventFields).partial();
export type CalendarEventChange = z.infer<typeof calendarEventChangeSchema>;

/** What the AI's overview beside the calendar is asked about: the calendars hidden in view. */
export const calendarOverviewInputSchema = z.object({
  /** Calendar ids hidden in this browser, and `aufgaben` for the to-dos. */
  hidden: z.array(z.string().min(1).max(100)).max(500).default([]),
});
export type CalendarOverviewInput = z.infer<typeof calendarOverviewInputSchema>;

/** How many days ahead the overview looks, today the first. */
export const CALENDAR_OVERVIEW_DAYS = 7;

/**
 * The AI's word on the days ahead beside the calendar: a few bullets and what it proposes (each a
 * request the person can hand to an agent as it stands). `off`: the workspace has no AI.
 */
export type CalendarOverview =
  { state: 'off' } | { state: 'ready'; bullets: string[]; suggestions: string[] };
