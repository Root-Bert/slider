/**
 * Calendars – the workspace's days. Every area is a calendar by itself (the workspace too: it is
 * an area), each person has a private one, and under any of them sub-calendars („Urlaub“,
 * „Messen“). A person's mail accounts bring their calendars along, theirs alone: their events and
 * the calendars themselves are changed at the provider, as far as it lets them.
 * Events are seen by whoever sees the calendar and changed by whoever may edit there.
 */
import { z } from 'zod';
import { MAX_ATTACHMENTS, type Attachment } from './attachments';
import { cloudAreaColorSchema } from './cloud';
import type { Author } from './model';

/**
 * `area`: an area's (the workspace's own area too) – its people's. `private`: one's own, only
 * one sees it. `mail`: a calendar of one's mail account (no sub-calendars). Sub-calendars take
 * the kind of the one they stand under.
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
  /** It may be renamed and coloured (sub-calendars one may edit in; a mail calendar one owns). */
  canManage: boolean;
  /** It may be deleted („Löschen“) – with its events, at the provider too. */
  canDelete: boolean;
  /** A mail calendar someone else owns (subscribed): only taken off one's list („Entfernen“). */
  canRemove: boolean;
  /** A mail calendar: new ones may be made beside it, in its account. */
  canAddCalendar: boolean;
  /** A mail calendar whose provider would let more than the sign-in does: „Neu anmelden“. */
  signInToChange: boolean;
}

/**
 * A mailbox signed in through its provider whose calendars Slider may not read: signed in before
 * calendars were asked for. Signing in anew asks.
 */
export interface MailCalendarRefusal {
  accountId: string;
  signIn: 'google' | 'microsoft';
}

/**
 * Calendars connected without a mailbox: „Google/Microsoft Kalender verbinden“ (the account asked
 * only for its calendars), or a mailbox removed in Post while its calendars stayed. Its calendars
 * come as a mailbox's (`mailAccountId` = `accountId`); `signedOut`: the provider ended its sign-in
 * – „Neu anmelden“.
 */
export interface CalendarConnection {
  accountId: string;
  address: string;
  /** What its person called it („Kalender › Konten“) – `null`: its address. */
  label: string | null;
  /** Through its provider, or its password (a mailbox's CalDAV, the mailbox removed). */
  signIn: 'google' | 'microsoft' | 'password';
  signedOut: boolean;
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
  /** Files put on it – Slider's own calendars only (a mail calendar's live at its provider). */
  attachments?: Attachment[];
}

export const MAX_CALENDAR_NAME = 80;
export const MAX_EVENT_TITLE = 300;
export const MAX_EVENT_NOTES = 20_000;
export const MAX_EVENT_LOCATION = 500;
/** What one look at the calendar spans at most: a year (the year view) and a little. */
export const MAX_EVENT_RANGE_DAYS = 400;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().datetime({ offset: true });

export const calendarInputSchema = z
  .object({
    /** Where it stands: under an area's, one's private or another sub-calendar … */
    parentId: z.string().min(1).max(100).optional(),
    /** … or in one's mail account, made at its provider. */
    mailAccountId: z.string().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(MAX_CALENDAR_NAME),
    color: cloudAreaColorSchema.optional(),
  })
  .refine((input) => Boolean(input.parentId) !== Boolean(input.mailAccountId), {
    message: 'Wo der Kalender stehen soll, fehlt.',
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
    /** Files up already (`/attachments`), waiting as the caller's. */
    attachments: z.array(z.string().min(1).max(100)).max(MAX_ATTACHMENTS).optional(),
  })
  .refine(fits, { message: 'Der Termin endet vor seinem Beginn.' });
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

/** A change: any field; `calendarId` moves it to another calendar one may edit. */
export const calendarEventChangeSchema = z
  .object({
    ...eventFields,
    /** Its files as they shall be: the ones kept, new ones up already; the rest is deleted. */
    attachments: z.array(z.string().min(1).max(100)).max(MAX_ATTACHMENTS),
  })
  .partial();
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
