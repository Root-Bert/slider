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
  /**
   * An accent name (`blue`, … as an area's) or `#rrggbb`: an area's own takes the area's, one's
   * private one its person's („Deine Farbe“), the ones under them theirs until coloured; a mail
   * calendar its provider's until coloured in Slider.
   */
  color: string;
  /** Events may be put in, changed and deleted here. */
  canEdit: boolean;
  /**
   * It may be renamed (sub-calendars one may edit in; a mail calendar one owns – in Slider alone
   * where its provider won't) and coloured – the list offers a colour only for one's private
   * sub-calendars and mail calendars, an area's keep the area's.
   */
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

/**
 * A meeting on an event: a call in one of Sender's conversations (an area's channel, a group, a
 * direct one – joined in Slider), or one held elsewhere (Zoom, Meet, Teams) by its link. A mail
 * calendar's events bring the provider's own link (Meet, Teams) or one found in where/notes.
 */
export type EventMeeting = { kind: 'call'; channelId: string } | { kind: 'link'; url: string };

export const MAX_MEETING_URL = 2000;

/** A link one may open to join: http(s) only. */
export const meetingUrlSchema = z
  .string()
  .trim()
  .max(MAX_MEETING_URL)
  .refine((value) => /^https?:\/\/[^\s]+$/i.test(value), {
    message: 'Der Link zum Meeting muss mit http:// oder https:// beginnen.',
  });

export const eventMeetingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('call'), channelId: z.string().min(1).max(100) }),
  z.object({ kind: z.literal('link'), url: meetingUrlSchema }),
]);

/** Minutes before a meeting that it shows beside the date in the header; `null`: never. */
export const MEETING_NOTICE_CHOICES = [null, 1, 5, 10, 15, 30] as const;
export const DEFAULT_MEETING_NOTICE = 5;
export const meetingNoticeSchema = z.number().int().min(0).max(120).nullable();

/** Hosts whose links are meetings: found in a mail calendar's where/notes. */
const MEETING_HOSTS =
  /^https:\/\/(?:[\w-]+\.)*(?:zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|meet\.jit\.si|gotomeeting\.com|bluejeans\.com|chime\.aws)\//i;

/** The first meeting link in a text („Ort“, notes of an invitation), if any. */
export function meetingLinkIn(...texts: string[]): string | null {
  for (const text of texts) {
    for (const match of text.matchAll(/https:\/\/[^\s<>"')\]]+/gi)) {
      const url = match[0].replace(/[.,;:!?]+$/, '');
      if (MEETING_HOSTS.test(url) && url.length <= MAX_MEETING_URL) return url;
    }
  }
  return null;
}

/**
 * How an event of the workspace's own calendars repeats, as the panel offers it: every `interval`
 * days, weeks (on `days`, Monday 0 – none: the first one's weekday), months (the first one's
 * date) or years – until the last day one may start on, or without end. Mail calendars' events
 * repeat at their provider (not changed here).
 */
export interface EventRepeat {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  days?: number[];
  until: string | null;
}

/** Which of a series a change or „Löschen“ means: this one, this and the ones after it, all. */
export type EventScope = 'one' | 'following' | 'all';
export const eventScopeSchema = z.enum(['one', 'following', 'all']);

export interface CalendarEvent {
  /**
   * A mail calendar's: the provider's, per occurrence. One of a series: the series' id and the
   * start it was planned for (`<id>@<start>`), so it keeps its id however it is changed.
   */
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
  /** A meeting to join from it (and from the header shortly before). */
  meeting?: EventMeeting | null;
  /** One of a series (the workspace's own calendars): how it repeats, and the series' id. */
  repeat?: EventRepeat | null;
  seriesId?: string;
}

export const MAX_CALENDAR_NAME = 80;
export const MAX_EVENT_TITLE = 300;
export const MAX_EVENT_NOTES = 20_000;
export const MAX_EVENT_LOCATION = 500;
/** What one look at the calendar spans at most: a year (the year view) and a little. */
export const MAX_EVENT_RANGE_DAYS = 400;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().datetime({ offset: true });

export const eventRepeatSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(99),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  until: day.nullable(),
});
/** The person's IANA zone, a series is walked in (its 9:00 stays 9:00 across the DST switch). */
const timeZone = z.string().min(1).max(64);

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
    meeting: eventMeetingSchema.nullable().optional(),
    repeat: eventRepeatSchema.nullable().optional(),
    timeZone: timeZone.optional(),
  })
  .refine(fits, { message: 'Der Termin endet vor seinem Beginn.' });
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

/** A change: any field; `calendarId` moves it to another calendar one may edit. */
export const calendarEventChangeSchema = z
  .object({
    ...eventFields,
    /** Its files as they shall be: the ones kept, new ones up already; the rest is deleted. */
    attachments: z.array(z.string().min(1).max(100)).max(MAX_ATTACHMENTS),
    /** `null`: no meeting any more. */
    meeting: eventMeetingSchema.nullable(),
    /** `null`: it repeats no more (scope „all“ or „following“). */
    repeat: eventRepeatSchema.nullable(),
    timeZone,
    /** One of a series: which of it (default this one; a series' own id: all). */
    scope: eventScopeSchema,
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
