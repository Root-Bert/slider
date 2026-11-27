import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import {
  MAX_EVENT_LOCATION,
  MAX_EVENT_RANGE_DAYS,
  type AccentColor,
  type Calendar,
  type CalendarChange,
  type CalendarConnection,
  type CalendarEvent,
  type CalendarEventChange,
  type CalendarEventInput,
  type CalendarInput,
  type EventMeeting,
  type EventRepeat,
  type EventScope,
  type MailCalendarRefusal,
} from '@slider/shared';
import {
  calendarEvents,
  calendars,
  mailAccounts,
  senderChannels,
  senderMembers,
  users,
  type CalendarEventRow,
  type CalendarRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { claimAttachments, deleteAttachments } from './attachments';
import { badRequest, forbidden, notFound } from '../http/errors';
import { authorsOf, cloudContext, type CloudCtx } from './cloud/context';
import {
  calendarConnections,
  createMailCalendar,
  createMailEvent,
  deleteMailEvent,
  dropMailCalendar,
  mailCalendarsRefused,
  mailEventId,
  mailEventOf,
  mailEvents,
  syncMailCalendarsBriefly,
  updateMailCalendar,
  updateMailEvent,
} from './calendar/mail-calendars';
import { areaAudience, seenChannel, senderLive } from './sender';
import { wallOf, zonedToUtc } from './calendar/ical';
import {
  endedBefore,
  exKey,
  occurrenceAt,
  occurrenceId,
  occurrencesOf,
  repeatOf,
  repeatsUntilOf,
  ruleOf,
  seriesRef,
  zoneOr,
} from './calendar/recurrence';

/*
 * Calendars (`@slider/shared` calendar). Every area has its own – made the first time its
 * calendars are looked at, as the workspace's own area is – and every person a private one; under
 * any of them sub-calendars. An area's are seen by whoever sees the area and filled by whoever may
 * edit there; one's private ones are one's own. A mail account's calendars are its person's
 * alone: their events stay at the provider (`calendar/remote.ts`) and are written there, as far as
 * the provider and the sign-in let (`remote_rights`); their ids are `mail:<calendar>:<provider's>`,
 * the calendar checked to be the caller's before the provider is asked.
 */

export const calendarNotFound = () => notFound('Diesen Kalender gibt es nicht (mehr).');
export const eventNotFound = () => notFound('Diesen Termin gibt es nicht (mehr).');
const READ_ONLY = 'In diesem Kalender darfst du nur ansehen, nichts ändern.';

/** As many events as one look holds – a year of a busy team, not an archive. */
const MAX_LISTED = 5000;
/** Sub-calendars under one: a handful, not a tree to get lost in. */
const MAX_DEPTH = 4;

/** Whether the caller sees it, and may put events in it. */
function accessTo(
  ctx: CloudCtx,
  row: Pick<CalendarRow, 'areaId' | 'ownerId' | 'mailAccountId' | 'remoteRights'>,
) {
  if (row.mailAccountId) {
    if (row.ownerId !== ctx.userId) return null;
    return (row.remoteRights?.events ?? true) ? 'edit' : 'view';
  }
  if (!row.areaId) return row.ownerId === ctx.userId ? 'edit' : null;
  const access = ctx.areas.get(row.areaId)?.access;
  if (!access) return null;
  return access === 'view' ? 'view' : 'edit';
}

/** The area's own calendars and the caller's private one, made where they are missing. */
async function ensureDefaults(deps: AppDeps, ctx: CloudCtx, rows: CalendarRow[]) {
  const roots = new Set(
    rows.filter((row) => !row.parentId && !row.mailAccountId).map((row) => row.areaId ?? 'own'),
  );
  const missing = [...ctx.areas.values()]
    .filter((entry) => entry.access && !roots.has(entry.row.id))
    .map((entry): { areaId: string | null; ownerId: string | null } => ({
      areaId: entry.row.id,
      ownerId: null,
    }));
  if (!roots.has('own')) missing.push({ areaId: null, ownerId: ctx.userId });
  if (!missing.length) return false;
  // Two asking at once make one each: the partial unique indexes keep the second's out.
  await deps.db
    .insert(calendars)
    .values(
      missing.map((one) => ({
        id: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        areaId: one.areaId,
        ownerId: one.ownerId,
        name: '',
      })),
    )
    .onConflictDoNothing();
  return true;
}

export function seenWhere(ctx: CloudCtx) {
  const seen = [...ctx.areas.entries()].filter(([, one]) => one.access).map(([id]) => id);
  return and(
    eq(calendars.workspaceId, ctx.workspaceId),
    or(
      and(isNull(calendars.areaId), eq(calendars.ownerId, ctx.userId)),
      seen.length ? inArray(calendars.areaId, seen) : sql`false`,
    ),
  );
}

/** The caller's own colour („Deine Farbe“): their private calendar's, and of those under it. */
async function ownColorOf(deps: AppDeps, userId: string): Promise<AccentColor> {
  const [me] = await deps.db.select({ color: users.color }).from(users).where(eq(users.id, userId));
  return me?.color ?? 'blue';
}

/**
 * `ownColor`: the caller's – one's private calendar takes it, as an area's own takes the area's;
 * the ones under them too, until coloured themselves. A mail calendar is its owner's alone: its
 * name and colour may be Slider's own over the provider's (`local_name`, `local_color`).
 */
function toCalendar(ctx: CloudCtx, row: CalendarRow, ownColor: AccentColor): Calendar {
  const area = row.areaId ? ctx.areas.get(row.areaId)?.row : undefined;
  const root = !row.parentId && !row.mailAccountId;
  const access = accessTo(ctx, row);
  const rights = row.mailAccountId ? row.remoteRights : null;
  const canManage = row.mailAccountId ? true : access === 'edit' && Boolean(row.parentId);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.mailAccountId ? 'mail' : row.areaId ? 'area' : 'private',
    areaId: row.areaId,
    parentId: row.parentId,
    mailAccountId: row.mailAccountId,
    name: root ? (area ? area.name : 'Privat') : (row.localName ?? row.name),
    color: row.mailAccountId
      ? (row.localColor ?? row.color ?? 'blue')
      : (row.color ?? (area ? area.color : ownColor)),
    canEdit: access === 'edit',
    canManage,
    canDelete: row.mailAccountId ? !rights || rights.drop === 'delete' : canManage,
    canRemove: rights?.drop === 'remove',
    canAddCalendar: Boolean(row.mailAccountId) && (rights?.create ?? true),
    signInToChange: rights?.regrant ?? false,
  };
}

/** Every calendar the caller sees, area by area: the area's own first, its sub-calendars after. */
export async function listCalendars(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<Calendar[]> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  await syncMailCalendarsBriefly(deps, workspaceId, userId);
  const read = () => deps.db.select().from(calendars).where(seenWhere(ctx));
  let rows = await read();
  if (await ensureDefaults(deps, ctx, rows)) rows = await read();
  const ownColor = await ownColorOf(deps, userId);
  const byOrder = (row: CalendarRow) => row.createdAt.getTime();
  return rows
    .sort(
      (a, b) =>
        Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) || byOrder(a) - byOrder(b),
    )
    .map((row) => toCalendar(ctx, row, ownColor));
}

/** The caller's mailboxes whose calendars their provider keeps from Slider (signed in before). */
export async function listMailCalendarRefusals(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<MailCalendarRefusal[]> {
  await cloudContext(deps.db, workspaceId, userId);
  return mailCalendarsRefused(deps, workspaceId, userId);
}

/** The caller's Google calendars connected without a mailbox. */
export async function listCalendarConnections(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<CalendarConnection[]> {
  await cloudContext(deps.db, workspaceId, userId);
  return calendarConnections(deps, workspaceId, userId);
}

/** A calendar the caller may fill, by id alone (its workspace read from it). */
async function calendarToEdit(deps: AppDeps, userId: string, calendarId: string) {
  const [row] = await deps.db.select().from(calendars).where(eq(calendars.id, calendarId));
  if (!row) throw calendarNotFound();
  const ctx = await cloudContext(deps.db, row.workspaceId, userId).catch(() => {
    throw calendarNotFound();
  });
  const access = accessTo(ctx, row);
  if (!access) throw calendarNotFound();
  if (access !== 'edit') throw forbidden(READ_ONLY);
  return { ctx, row };
}

/** Tells those who see the calendar that its days changed: their views refetch. */
async function tellCalendar(
  deps: AppDeps,
  row: Pick<CalendarRow, 'workspaceId' | 'areaId' | 'ownerId'>,
) {
  if (!senderLive.open(row.workspaceId)) return;
  const audience = row.areaId
    ? await areaAudience(deps.db, row.workspaceId, row.areaId)
    : new Set(row.ownerId ? [row.ownerId] : []);
  senderLive.publish(row.workspaceId, audience, { type: 'calendar' });
}

/** A sub-calendar under one the caller may fill: it belongs where that one does. */
export async function createCalendar(
  deps: AppDeps,
  userId: string,
  input: CalendarInput,
): Promise<Calendar> {
  if (input.mailAccountId) {
    const [account] = await deps.db
      .select({ workspaceId: mailAccounts.workspaceId })
      .from(mailAccounts)
      .where(and(eq(mailAccounts.id, input.mailAccountId), eq(mailAccounts.userId, userId)));
    if (!account) throw calendarNotFound();
    const ctx = await cloudContext(deps.db, account.workspaceId, userId).catch(() => {
      throw calendarNotFound();
    });
    const row = await createMailCalendar(deps, input.mailAccountId, userId, {
      name: input.name.trim(),
      color: remoteColor(input.color),
    });
    await tellCalendar(deps, row);
    return toCalendar(ctx, row, await ownColorOf(deps, userId));
  }
  const { ctx, row: parent } = await calendarToEdit(deps, userId, input.parentId!);
  if (parent.mailAccountId) {
    throw forbidden('In den Kalendern eines Postfachs gibt es keine Unterkalender.');
  }
  let depth = 0;
  for (let up: string | null = parent.parentId; up && depth < MAX_DEPTH; depth++) {
    const [above] = await deps.db
      .select({ parentId: calendars.parentId })
      .from(calendars)
      .where(eq(calendars.id, up));
    up = above?.parentId ?? null;
  }
  if (depth >= MAX_DEPTH - 1) throw badRequest('So tief lassen sich Kalender nicht schachteln.');
  const [row] = await deps.db
    .insert(calendars)
    .values({
      id: crypto.randomUUID(),
      workspaceId: parent.workspaceId,
      areaId: parent.areaId,
      ownerId: parent.areaId ? null : parent.ownerId,
      parentId: parent.id,
      name: input.name.trim(),
      color: input.color ?? null,
      createdBy: userId,
    })
    .returning();
  await tellCalendar(deps, row!);
  return toCalendar(ctx, row!, await ownColorOf(deps, userId));
}

/** A provider takes a colour as `#rrggbb`; an accent name is Slider's theme's. */
function remoteColor(color: string | undefined): string | null {
  if (color === undefined) return null;
  if (!color.startsWith('#')) {
    throw badRequest('Für diesen Kalender bitte eine Farbe wie #1a2b3c.');
  }
  return color;
}

/** One of the caller's mail calendars, by id alone. */
async function mailCalendarOf(deps: AppDeps, userId: string, calendarId: string) {
  const [row] = await deps.db.select().from(calendars).where(eq(calendars.id, calendarId));
  if (!row?.mailAccountId || row.ownerId !== userId) return null;
  const ctx = await cloudContext(deps.db, row.workspaceId, userId).catch(() => null);
  return ctx && { ctx, row };
}

/**
 * Renames or colours a sub-calendar (an area's own and one's private one keep theirs) or one of
 * one's mail calendars: renamed at the provider where it lets, else in Slider alone; coloured in
 * Slider alone (the palette's colours are Slider's, Outlook refuses any).
 */
export async function updateCalendar(
  deps: AppDeps,
  userId: string,
  calendarId: string,
  change: CalendarChange,
): Promise<Calendar> {
  const mail = await mailCalendarOf(deps, userId, calendarId);
  if (mail) {
    let row = mail.row;
    const name = change.name?.trim();
    const atProvider =
      name !== undefined && name !== row.name && (row.remoteRights?.rename ?? true);
    // Refused there after all (Outlook's default calendar, signed out, unreachable): Slider's own.
    if (atProvider) row = await updateMailCalendar(deps, row, { name }).catch(() => row);
    const [after] = await deps.db
      .update(calendars)
      .set({
        // Its provider's name again, or renamed there: nothing of Slider's own over it.
        ...(name !== undefined && { localName: name === row.name ? null : name }),
        ...(change.color !== undefined && { localColor: change.color }),
        updatedAt: new Date(),
      })
      .where(eq(calendars.id, row.id))
      .returning();
    await tellCalendar(deps, after!);
    return toCalendar(mail.ctx, after!, await ownColorOf(deps, userId));
  }
  const { ctx, row } = await calendarToEdit(deps, userId, calendarId);
  if (!row.parentId) throw forbidden('Diesen Kalender kannst du nicht umbenennen.');
  const [after] = await deps.db
    .update(calendars)
    .set({
      ...(change.name !== undefined && { name: change.name.trim() }),
      ...(change.color !== undefined && { color: change.color }),
      updatedAt: new Date(),
    })
    .where(eq(calendars.id, calendarId))
    .returning();
  await tellCalendar(deps, after!);
  return toCalendar(ctx, after!, await ownColorOf(deps, userId));
}

/**
 * Deletes a sub-calendar, the ones under it and all their events; a mail calendar at its provider
 * – or, someone else's, takes it off one's list there.
 */
export async function deleteCalendar(deps: AppDeps, userId: string, calendarId: string) {
  const mail = await mailCalendarOf(deps, userId, calendarId);
  if (mail) {
    if (mail.row.remoteRights?.drop === null) {
      throw forbidden('Diesen Kalender kannst du nicht löschen.');
    }
    await dropMailCalendar(deps, mail.row);
    await tellCalendar(deps, mail.row);
    return;
  }
  const { row } = await calendarToEdit(deps, userId, calendarId);
  if (!row.parentId) throw forbidden('Diesen Kalender kannst du nicht löschen.');
  // Its events go with it, those of the calendars under it too – and their files.
  const ids = [calendarId];
  for (let at = 0; at < ids.length && ids.length < 1000; at++) {
    const under = await deps.db
      .select({ id: calendars.id })
      .from(calendars)
      .where(eq(calendars.parentId, ids[at]!));
    ids.push(...under.map((each) => each.id));
  }
  const files = await deps.db
    .select({ attachments: calendarEvents.attachments })
    .from(calendarEvents)
    .where(inArray(calendarEvents.calendarId, ids));
  await deps.db.delete(calendars).where(eq(calendars.id, calendarId));
  await deleteAttachments(
    deps,
    files.flatMap((each) => each.attachments),
  );
  await tellCalendar(deps, row);
}

// ── Events ──────────────────────────────────────────────────────────────────

const MAIL_EVENT_FILES = 'Dateien gehen nur an Termine in Kalendern des Workspace.';
const MAIL_SERIES = 'Wiederholungen gehen nur in Kalendern des Workspace.';
const ONE_REPEAT = 'Die Wiederholung ändert sich nur für alle oder die folgenden Termine.';
const SERIES_FILES = 'Dateien gehören zur ganzen Serie.';

const DAY_MS = 86_400_000;
/** An all-day event's days as UTC midnights, so they compare with instants in one range. */
const dayStart = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dayOf = (at: Date) => at.toISOString().slice(0, 10);

function bounds(event: { allDay: boolean; start: string; end: string }) {
  const startsAt = event.allDay ? dayStart(event.start) : new Date(event.start);
  const endsAt = event.allDay ? dayStart(event.end) : new Date(event.end);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw badRequest('Der Termin endet vor seinem Beginn.');
  }
  if (endsAt.getTime() - startsAt.getTime() > 366 * DAY_MS) {
    throw badRequest('Ein Termin dauert höchstens ein Jahr.');
  }
  return { startsAt, endsAt };
}

const SLIDER_CALL_ONLY =
  'Ein Anruf in Sender geht nur in Kalendern des Workspace – im Kalender eines Postfachs ein Link.';
const NOT_A_CALL_PLACE = 'In diesem Gespräch kannst du kein Meeting ansetzen.';

/**
 * Of these conversations, the ones the caller sees: an area's while they see the area, a group or
 * a direct one while in it. A meeting in another stays hidden from them.
 */
async function seenChannels(deps: AppDeps, userId: string, ids: readonly string[]) {
  const seen = new Set<string>();
  if (!ids.length) return seen;
  const [rows, mine] = await Promise.all([
    deps.db
      .select()
      .from(senderChannels)
      .where(inArray(senderChannels.id, [...ids])),
    deps.db
      .select({ channelId: senderMembers.channelId })
      .from(senderMembers)
      .where(and(eq(senderMembers.userId, userId), inArray(senderMembers.channelId, [...ids]))),
  ]);
  const member = new Set(mine.map((each) => each.channelId));
  const contexts = new Map<string, Promise<CloudCtx | null>>();
  for (const row of rows) {
    if (row.kind === 'agent') continue;
    if (row.kind !== 'area' && row.kind !== 'channel') {
      if (member.has(row.id)) seen.add(row.id);
      continue;
    }
    if (!contexts.has(row.workspaceId)) {
      contexts.set(
        row.workspaceId,
        cloudContext(deps.db, row.workspaceId, userId).catch(() => null),
      );
    }
    const ctx = await contexts.get(row.workspaceId);
    if (row.areaId && ctx?.areas.get(row.areaId)?.access) seen.add(row.id);
  }
  return seen;
}

/**
 * A meeting as stored: a call only in a conversation of the event's workspace the caller sees and
 * may speak in (not an agent's chat, not an area they only view); a link as typed.
 */
async function meetingColumns(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  meeting: EventMeeting | null,
): Promise<{ callChannelId: string | null; meetingUrl: string | null }> {
  if (!meeting) return { callChannelId: null, meetingUrl: null };
  if (meeting.kind === 'link') return { callChannelId: null, meetingUrl: meeting.url.trim() };
  const row = await seenChannel(deps, userId, meeting.channelId);
  if (row.workspaceId !== workspaceId || row.kind === 'agent') throw badRequest(NOT_A_CALL_PLACE);
  if (row.areaId && (row.kind === 'area' || row.kind === 'channel')) {
    const ctx = await cloudContext(deps.db, workspaceId, userId);
    if (ctx.areas.get(row.areaId)?.access === 'view') throw badRequest(NOT_A_CALL_PLACE);
  }
  return { callChannelId: row.id, meetingUrl: null };
}

/**
 * A mail calendar keeps no meeting of Slider's: a link goes where its provider shows one – in the
 * place or notes instead of the link it had (`before`), else the place when it has none (and the
 * link fits), else at the head of the notes; a call is refused.
 */
function linkInto(
  fields: { location: string; notes: string },
  meeting: EventMeeting | null | undefined,
  before: EventMeeting | null = null,
): { location: string; notes: string } {
  if (!meeting) return fields;
  if (meeting.kind === 'call') throw badRequest(SLIDER_CALL_ONLY);
  const url = meeting.url.trim();
  // The old link read first from where it stands: replaced, so the new one is the one read back.
  const old = before?.kind === 'link' && before.url !== url ? before.url : null;
  if (old && fields.location.includes(old)) {
    const location = fields.location.replace(old, () => url);
    if (location.length <= MAX_EVENT_LOCATION) return { ...fields, location };
    // Too long for the place (read back cut, the link broken): out of it, at the head of the notes.
    const rest = fields.location
      .replace(old, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s|,;–-]+|[\s|,;–-]+$/g, '');
    if (fields.notes.includes(url)) return { ...fields, location: rest };
    return { location: rest, notes: fields.notes ? `${url}\n\n${fields.notes}` : url };
  }
  if (old && fields.notes.includes(old)) {
    return { ...fields, notes: fields.notes.replace(old, () => url) };
  }
  if (fields.location.includes(url) || fields.notes.includes(url)) return fields;
  if (!fields.location.trim() && url.length <= MAX_EVENT_LOCATION) {
    return { ...fields, location: url };
  }
  return { ...fields, notes: fields.notes ? `${url}\n\n${fields.notes}` : url };
}

async function toEvents(
  deps: AppDeps,
  userId: string,
  editable: (calendarId: string) => boolean,
  rows: CalendarEventRow[],
): Promise<CalendarEvent[]> {
  const [people, channels] = await Promise.all([
    authorsOf(
      deps.db,
      rows.map((row) => row.createdBy),
    ),
    seenChannels(deps, userId, [
      ...new Set(rows.flatMap((row) => (row.callChannelId ? [row.callChannelId] : []))),
    ]),
  ]);
  const meetingOf = (row: CalendarEventRow): EventMeeting | null =>
    row.callChannelId
      ? channels.has(row.callChannelId)
        ? { kind: 'call', channelId: row.callChannelId }
        : null
      : row.meetingUrl
        ? { kind: 'link', url: row.meetingUrl }
        : null;
  return rows.map((row) => ({
    id: row.id,
    calendarId: row.calendarId,
    title: row.title,
    location: row.location,
    notes: row.notes,
    allDay: row.allDay,
    start: row.allDay ? dayOf(row.startsAt) : row.startsAt.toISOString(),
    end: row.allDay ? dayOf(row.endsAt) : row.endsAt.toISOString(),
    canEdit: editable(row.calendarId),
    createdBy: (row.createdBy && people.get(row.createdBy)) || null,
    attachments: row.attachments,
    meeting: meetingOf(row),
    ...(row.recurrence && {
      repeat: repeatOf(row.recurrence, row.allDay, zoneOr(row.timeZone)),
      seriesId: seriesRef(row.id)?.seriesId ?? row.id,
    }),
  }));
}

/** One of a series as a row of its own: its id and times, the rest the series'. */
const asOccurrence = (row: CalendarEventRow, startsAt: Date): CalendarEventRow => ({
  ...row,
  id: occurrenceId(row.id, startsAt.getTime(), row.allDay),
  startsAt,
  endsAt: new Date(startsAt.getTime() + row.endsAt.getTime() - row.startsAt.getTime()),
});

/** Rows as the page sees them: a series as its occurrences in `[from, to)`. */
function expanded(rows: CalendarEventRow[], from: number, to: number): CalendarEventRow[] {
  return rows
    .flatMap((row) =>
      row.recurrence
        ? occurrencesOf(row, from, to).map((one) => asOccurrence(row, one.startsAt))
        : [row],
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** A row as handed out: a series as its occurrence at `at` (its first where it has none then). */
function shown(row: CalendarEventRow, at = row.startsAt.getTime()): CalendarEventRow {
  if (!row.recurrence) return row;
  const one = occurrenceAt(row, at) ?? occurrencesOf(row, row.startsAt.getTime(), Infinity)[0];
  return asOccurrence(row, one?.startsAt ?? row.startsAt);
}

/**
 * A series' first one on a day of its rule – „Werktags“ asked on a Saturday starts on Monday at
 * the same wall time, as its first one always counts (here and in every calendar app).
 */
function onItsDay(
  repeat: EventRepeat | null,
  timing: { allDay: boolean; startsAt: Date; endsAt: Date },
  zone: string,
): { startsAt: Date; endsAt: Date } {
  const { startsAt, endsAt, allDay } = timing;
  // Only a weekly series names its days (`ruleOf`): any other starts where it was put.
  if (repeat?.freq !== 'weekly' || !repeat.days?.length) return { startsAt, endsAt };
  const wall = allDay ? startsAt.getTime() : wallOf(startsAt.getTime(), zone);
  const weekday = (new Date(wall).getUTCDay() + 6) % 7;
  const ahead = Math.min(...repeat.days.map((day) => (day - weekday + 7) % 7));
  if (!ahead) return { startsAt, endsAt };
  const moved = (at: Date) =>
    allDay
      ? new Date(at.getTime() + ahead * DAY_MS)
      : new Date(zonedToUtc(wallOf(at.getTime(), zone) + ahead * DAY_MS, zone));
  return { startsAt: moved(startsAt), endsAt: moved(endsAt) };
}

/** Its left-out ones with one more – added in the database, so two at once both stay out. */
const withExdate = (key: string) =>
  sql<
    string[]
  >`case when ${calendarEvents.exdates} @> ${JSON.stringify([key])}::jsonb then ${calendarEvents.exdates} else ${calendarEvents.exdates} || ${JSON.stringify([key])}::jsonb end`;

/** The columns that make a row a series (or none): its rule in its zone, where it ends. */
function seriesColumns(
  repeat: EventRepeat | null,
  timing: { allDay: boolean; startsAt: Date; endsAt: Date },
  zone: string,
) {
  if (!repeat) return { recurrence: null, timeZone: null, repeatsUntil: null, exdates: [] };
  return {
    recurrence: ruleOf(repeat, timing.startsAt.getTime(), timing.allDay, zone),
    timeZone: zone,
    repeatsUntil: repeatsUntilOf(
      repeat,
      timing.allDay,
      zone,
      timing.endsAt.getTime() - timing.startsAt.getTime(),
    ),
  };
}

/**
 * The events of every calendar the caller sees that overlap [from, to) – all-day ones by their
 * days, which may lie up to a day on either side of a time zone's midnight: the page sorts them in.
 */
export async function listEvents(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  range: { from: string; to: string },
): Promise<CalendarEvent[]> {
  const from = new Date(range.from);
  const to = new Date(range.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw badRequest('Dieser Zeitraum geht nicht.');
  }
  if (to.getTime() - from.getTime() > MAX_EVENT_RANGE_DAYS * DAY_MS) {
    throw badRequest('So viel Kalender auf einmal geht nicht.');
  }
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  const seen = await deps.db.select().from(calendars).where(seenWhere(ctx));
  const own = seen.filter((row) => !row.mailAccountId);
  const fromMail = mailEvents(
    deps,
    seen.filter((row) => row.mailAccountId),
    from,
    to,
  );
  if (!own.length) return fromMail;
  const access = new Map(own.map((row) => [row.id, accessTo(ctx, row)]));
  const rows = await deps.db
    .select()
    .from(calendarEvents)
    .where(
      and(
        inArray(
          calendarEvents.calendarId,
          own.map((row) => row.id),
        ),
        lt(calendarEvents.startsAt, new Date(to.getTime() + DAY_MS)),
        or(
          and(
            isNull(calendarEvents.recurrence),
            gt(calendarEvents.endsAt, new Date(from.getTime() - DAY_MS)),
          ),
          // A series from before: as long as it has not ended.
          and(
            isNotNull(calendarEvents.recurrence),
            or(
              isNull(calendarEvents.repeatsUntil),
              gt(calendarEvents.repeatsUntil, new Date(from.getTime() - DAY_MS)),
            ),
          ),
        ),
      ),
    )
    .orderBy(calendarEvents.startsAt)
    .limit(MAX_LISTED);
  const occurrences = expanded(rows, from.getTime() - DAY_MS, to.getTime() + DAY_MS);
  return [
    ...(await toEvents(deps, userId, (id) => access.get(id) === 'edit', occurrences)),
    ...(await fromMail),
  ];
}

async function eventToEdit(deps: AppDeps, userId: string, eventId: string) {
  const [event] = await deps.db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
  if (!event) throw eventNotFound();
  const [calendar] = await deps.db
    .select()
    .from(calendars)
    .where(eq(calendars.id, event.calendarId));
  const ctx =
    calendar && (await cloudContext(deps.db, calendar.workspaceId, userId).catch(() => null));
  const access = ctx && accessTo(ctx, calendar);
  if (!access) throw eventNotFound();
  if (access !== 'edit') throw forbidden(READ_ONLY);
  return { event, calendar, ctx };
}

/**
 * A mail calendar's event by its id: the calendar must be the caller's (a forged id naming
 * another's is not found); `edit`: and take events.
 */
async function mailEventToEdit(deps: AppDeps, userId: string, eventId: string, edit: boolean) {
  const ids = mailEventId(eventId);
  const mail = ids && (await mailCalendarOf(deps, userId, ids.calendarId));
  if (!ids || !mail) throw eventNotFound();
  if (edit && accessTo(mail.ctx, mail.row) !== 'edit') throw forbidden(READ_ONLY);
  return { row: mail.row, remoteId: ids.remoteId };
}

export async function getEvent(
  deps: AppDeps,
  userId: string,
  eventId: string,
): Promise<CalendarEvent> {
  if (mailEventId(eventId)) {
    const { row, remoteId } = await mailEventToEdit(deps, userId, eventId, false);
    const event = await mailEventOf(deps, row, remoteId);
    if (!event) throw eventNotFound();
    return event;
  }
  const ref = seriesRef(eventId);
  const [event] = await deps.db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, ref?.seriesId ?? eventId));
  if (!event) throw eventNotFound();
  const [calendar] = await deps.db
    .select()
    .from(calendars)
    .where(eq(calendars.id, event.calendarId));
  const ctx =
    calendar && (await cloudContext(deps.db, calendar.workspaceId, userId).catch(() => null));
  const access = ctx && accessTo(ctx, calendar);
  if (!access) throw eventNotFound();
  const one = ref ? event.recurrence && occurrenceAt(event, ref.at) : null;
  if (ref && !one) throw eventNotFound();
  const row = one ? asOccurrence(event, one.startsAt) : shown(event);
  return (await toEvents(deps, userId, () => access === 'edit', [row]))[0]!;
}

export async function createEvent(
  deps: AppDeps,
  userId: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  const { row: calendar } = await calendarToEdit(deps, userId, input.calendarId);
  if (calendar.mailAccountId) {
    if (input.attachments?.length) throw badRequest(MAIL_EVENT_FILES);
    if (input.repeat) throw badRequest(MAIL_SERIES);
    bounds(input);
    const made = await createMailEvent(deps, calendar, {
      title: input.title.trim(),
      ...linkInto(
        { location: input.location?.trim() ?? '', notes: input.notes ?? '' },
        input.meeting,
      ),
      allDay: input.allDay,
      start: input.start,
      end: input.end,
    });
    await tellCalendar(deps, calendar);
    return made;
  }
  const timing = onItsDay(
    input.repeat ?? null,
    { allDay: input.allDay, ...bounds(input) },
    zoneOr(input.timeZone),
  );
  const [row] = await deps.db
    .insert(calendarEvents)
    .values({
      id: crypto.randomUUID(),
      workspaceId: calendar.workspaceId,
      calendarId: calendar.id,
      title: input.title.trim(),
      location: input.location?.trim() ?? '',
      notes: input.notes ?? '',
      allDay: input.allDay,
      ...timing,
      ...seriesColumns(
        input.repeat ?? null,
        { allDay: input.allDay, ...timing },
        zoneOr(input.timeZone),
      ),
      ...(await meetingColumns(deps, userId, calendar.workspaceId, input.meeting ?? null)),
      attachments: await claimAttachments(
        deps.db,
        deps.clock.now(),
        userId,
        calendar.workspaceId,
        input.attachments ?? [],
      ),
      createdBy: userId,
    })
    .returning();
  await tellCalendar(deps, calendar);
  return (await toEvents(deps, userId, () => true, [shown(row!)]))[0]!;
}

/** Start and end of the kind `allDay` asks: an event's own, or turned (a day ↔ its midnight). */
function timingOf(event: CalendarEvent, change: CalendarEventChange) {
  const allDay = change.allDay ?? event.allDay;
  const as = (value: string) =>
    allDay === event.allDay ? value : allDay ? value.slice(0, 10) : `${value}T00:00:00.000Z`;
  const timing = {
    allDay,
    start: change.start ?? as(event.start),
    end: change.end ?? as(event.end),
  };
  bounds(timing);
  return timing;
}

const changesTiming = (change: CalendarEventChange) =>
  change.start !== undefined || change.end !== undefined || change.allDay !== undefined;

/**
 * Moves an event between a mail calendar and another (any provider, or Slider's own): made in the
 * one, then deleted in the other – nothing moves an event across providers.
 */
async function moveAcross(
  deps: AppDeps,
  userId: string,
  event: CalendarEvent,
  change: CalendarEventChange & { calendarId: string },
): Promise<CalendarEvent> {
  if ((event.attachments?.length ?? 0) > 0 || change.attachments?.length) {
    throw badRequest(MAIL_EVENT_FILES);
  }
  const made = await createEvent(deps, userId, {
    calendarId: change.calendarId,
    title: change.title ?? event.title,
    location: change.location ?? event.location,
    notes: change.notes ?? event.notes,
    meeting: change.meeting !== undefined ? change.meeting : (event.meeting ?? null),
    ...timingOf(event, change),
  });
  try {
    await deleteNow(deps, userId, event.id);
  } catch (error) {
    // The old one stays: the new one goes again, so it is not there twice.
    await deleteNow(deps, userId, made.id).catch(() => undefined);
    throw error;
  }
  return made;
}

/** Changes any of its fields; `calendarId` moves it to another calendar the caller may fill. */
export async function updateEvent(
  deps: AppDeps,
  userId: string,
  eventId: string,
  change: CalendarEventChange,
): Promise<CalendarEvent> {
  if (mailEventId(eventId)) {
    const { row, remoteId } = await mailEventToEdit(deps, userId, eventId, true);
    const event = await mailEventOf(deps, row, remoteId);
    if (!event) throw eventNotFound();
    if (change.attachments?.length) throw badRequest(MAIL_EVENT_FILES);
    if (change.calendarId && change.calendarId !== row.id) {
      const target = (await calendarToEdit(deps, userId, change.calendarId)).row;
      if (target.workspaceId !== row.workspaceId) throw forbidden(READ_ONLY);
      return moveAcross(deps, userId, event, { ...change, calendarId: change.calendarId });
    }
    // A link put on it goes in its place or notes; taken off, the provider's own stays. Only
    // what the link changed is written: place and notes as read are cut to Slider's lengths.
    const linked = change.meeting
      ? linkInto(
          {
            location: change.location?.trim() ?? event.location,
            notes: change.notes ?? event.notes,
          },
          change.meeting,
          event.meeting ?? null,
        )
      : null;
    const changed = await updateMailEvent(deps, row, remoteId, {
      ...(change.title !== undefined && { title: change.title.trim() }),
      ...(change.location !== undefined && { location: change.location.trim() }),
      ...(change.notes !== undefined && { notes: change.notes }),
      ...(linked &&
        (change.location !== undefined || linked.location !== event.location) && {
          location: linked.location,
        }),
      ...(linked &&
        (change.notes !== undefined || linked.notes !== event.notes) && { notes: linked.notes }),
      ...(changesTiming(change) && timingOf(event, change)),
    });
    await tellCalendar(deps, row);
    return changed;
  }
  const ref = seriesRef(eventId);
  return inTurn(ref?.seriesId ?? eventId, async () => {
    const { event, calendar } = await eventToEdit(deps, userId, ref?.seriesId ?? eventId);
    const { scope, ...rest } = change;
    if (event.recurrence) {
      const at = ref?.at ?? event.startsAt.getTime();
      return updateSeries(deps, userId, event, calendar, at, scope ?? (ref ? 'one' : 'all'), rest);
    }
    if (ref) throw eventNotFound();
    return updateOwn(deps, userId, event, calendar, rest);
  });
}

/**
 * One change of an event at a time: a series' left out ones are read, worked on and written back
 * whole (`endBefore`, the shift of all of it) – another change between would be lost (a day
 * deleted alone back again). The server is one process, as its runs and calls are.
 */
const turns = new Map<string, Promise<unknown>>();

function inTurn<T>(eventId: string, work: () => Promise<T>): Promise<T> {
  const next = (turns.get(eventId) ?? Promise.resolve()).catch(() => undefined).then(work);
  const tail = next.catch(() => undefined);
  turns.set(eventId, tail);
  void tail.then(() => {
    if (turns.get(eventId) === tail) turns.delete(eventId);
  });
  return next;
}

type OwnChange = Omit<CalendarEventChange, 'scope'>;

/**
 * Changes an event of the workspace's own calendars – a series as a whole (`exdates`: its left
 * out ones moved along); handed back as its occurrence at `showAt` (else its first).
 */
async function updateOwn(
  deps: AppDeps,
  userId: string,
  event: CalendarEventRow,
  calendar: CalendarRow,
  change: OwnChange,
  exdates?: string[],
  showAt?: number,
): Promise<CalendarEvent> {
  const zone = zoneOr(change.timeZone ?? event.timeZone);
  const repeat =
    change.repeat !== undefined
      ? change.repeat
      : event.recurrence
        ? repeatOf(event.recurrence, event.allDay, zone)
        : null;
  let target = calendar;
  if (change.calendarId && change.calendarId !== calendar.id) {
    target = (await calendarToEdit(deps, userId, change.calendarId)).row;
    if (target.workspaceId !== calendar.workspaceId) throw forbidden(READ_ONLY);
    if (target.mailAccountId) {
      // A series would be made there as one of its days and deleted here as a whole.
      if (repeat) throw badRequest(MAIL_SERIES);
      const [own] = await toEvents(deps, userId, () => true, [event]);
      return moveAcross(deps, userId, own!, { ...change, calendarId: target.id });
    }
  }
  const allDay = change.allDay ?? event.allDay;
  const asked: { startsAt?: Date; endsAt?: Date } =
    change.start !== undefined || change.end !== undefined || change.allDay !== undefined
      ? bounds({
          allDay,
          start: change.start ?? (allDay ? dayOf(event.startsAt) : event.startsAt.toISOString()),
          end: change.end ?? (allDay ? dayOf(event.endsAt) : event.endsAt.toISOString()),
        })
      : {};
  const timing = repeat
    ? onItsDay(
        repeat,
        {
          allDay,
          startsAt: asked.startsAt ?? event.startsAt,
          endsAt: asked.endsAt ?? event.endsAt,
        },
        zone,
      )
    : asked;
  const series =
    repeat || event.recurrence
      ? seriesColumns(
          repeat,
          {
            allDay,
            startsAt: timing.startsAt ?? event.startsAt,
            endsAt: timing.endsAt ?? event.endsAt,
          },
          zone,
        )
      : {};
  // Its files as asked: the new ones taken (one's own, waiting), the ones left out deleted after.
  let files = event.attachments;
  let gone: typeof files = [];
  if (change.attachments !== undefined) {
    const wanted = new Set(change.attachments);
    const known = new Set(files.map((one) => one.id));
    gone = files.filter((one) => !wanted.has(one.id));
    const added = await claimAttachments(
      deps.db,
      deps.clock.now(),
      userId,
      calendar.workspaceId,
      change.attachments.filter((id) => !known.has(id)),
    );
    files = [...files.filter((one) => wanted.has(one.id)), ...added];
  }
  const [after] = await deps.db
    .update(calendarEvents)
    .set({
      calendarId: target.id,
      ...(change.title !== undefined && { title: change.title.trim() }),
      ...(change.location !== undefined && { location: change.location.trim() }),
      ...(change.notes !== undefined && { notes: change.notes }),
      allDay,
      ...timing,
      ...series,
      // One day changed alone, given a repeat of its own: a series of its own, deleted on its own
      // – no longer a part of the one it came from (`deleteFamily` by `seriesRoot`).
      ...(repeat && !event.recurrence && { seriesRoot: null }),
      ...(repeat && exdates && { exdates }),
      ...(change.attachments !== undefined && { attachments: files }),
      ...(change.meeting !== undefined &&
        (await meetingColumns(deps, userId, calendar.workspaceId, change.meeting))),
      updatedAt: new Date(),
    })
    .where(eq(calendarEvents.id, event.id))
    .returning();
  // Deleted meanwhile – with the whole series it was split off: gone, not a failure.
  if (!after) throw eventNotFound();
  await deleteAttachments(deps, gone);
  await tellCalendar(deps, calendar);
  if (target !== calendar) await tellCalendar(deps, target);
  return (await toEvents(deps, userId, () => true, [shown(after, showAt)]))[0]!;
}

/** A copy of a series' row as an event (or series) of its own from `startsAt` – no files. */
async function splitOff(
  deps: AppDeps,
  event: CalendarEventRow,
  startsAt: Date,
  series: Partial<CalendarEventRow>,
): Promise<CalendarEventRow> {
  const { id: _id, createdAt: _made, ...fields } = event;
  const [copy] = await deps.db
    .insert(calendarEvents)
    .values({
      ...fields,
      id: crypto.randomUUID(),
      startsAt,
      endsAt: new Date(startsAt.getTime() + event.endsAt.getTime() - event.startsAt.getTime()),
      // Files stay the series' – a copy naming them would delete them with itself.
      attachments: [],
      recurrence: null,
      timeZone: null,
      exdates: [],
      repeatsUntil: null,
      // Its family: the first series, so deleting all of it takes this along.
      seriesRoot: event.seriesRoot ?? event.id,
      ...series,
      updatedAt: new Date(),
    })
    .returning();
  return copy!;
}

/**
 * Changes one of a series (planned for `at`): „one“ – it leaves the series as an event of its
 * own; „following“ – a new series from it on, the old one ending the day before; „all“ – the
 * series, its times moved by as much as this one's (on the wall clock).
 */
async function updateSeries(
  deps: AppDeps,
  userId: string,
  event: CalendarEventRow,
  calendar: CalendarRow,
  at: number,
  scope: EventScope,
  change: OwnChange,
): Promise<CalendarEvent> {
  const occurrence = occurrenceAt(event, at);
  if (!occurrence) throw eventNotFound();
  const zone = zoneOr(event.timeZone);
  const repeat = repeatOf(event.recurrence ?? '', event.allDay, zone);
  if (scope === 'one') {
    if (change.repeat !== undefined) throw badRequest(ONE_REPEAT);
    if (change.attachments !== undefined) throw badRequest(SERIES_FILES);
    const copy = await splitOff(deps, event, occurrence.startsAt, {});
    let made: CalendarEvent;
    try {
      made = await updateOwn(deps, userId, copy, calendar, change);
    } catch (error) {
      await deps.db.delete(calendarEvents).where(eq(calendarEvents.id, copy.id));
      throw error;
    }
    await deps.db
      .update(calendarEvents)
      .set({ exdates: withExdate(exKey(at, event.allDay)), updatedAt: new Date() })
      .where(eq(calendarEvents.id, event.id));
    return made;
  }
  if (scope === 'following' && at > event.startsAt.getTime() && repeat) {
    const later = event.exdates.filter((key) => Date.parse(key) > at);
    const copy = await splitOff(deps, event, occurrence.startsAt, {
      ...seriesColumns(repeat, { allDay: event.allDay, ...occurrence }, zone),
      exdates: later,
    });
    let made: CalendarEvent;
    try {
      made = await updateSeries(deps, userId, copy, calendar, at, 'all', change);
    } catch (error) {
      await deps.db.delete(calendarEvents).where(eq(calendarEvents.id, copy.id));
      throw error;
    }
    await endBefore(deps, event, at);
    return made;
  }
  // All of it: the series' first one moves as this one does, on the wall clock (a 9:00 in
  // summer moved to 10:00 moves a first one in winter to 10:00 too); left out ones along.
  if (!changesTiming(change))
    return updateOwn(deps, userId, event, calendar, change, undefined, at);
  const allDay = change.allDay ?? event.allDay;
  const as = (value: Date) => (event.allDay ? dayOf(value) : value.toISOString());
  const moved = timingOf(
    {
      allDay: event.allDay,
      start: as(occurrence.startsAt),
      end: as(occurrence.endsAt),
    } as CalendarEvent,
    change,
  );
  const next = bounds(moved);
  const wall = (instant: number, whole: boolean) => (whole ? instant : wallOf(instant, zone));
  const instant = (wallTime: number, whole: boolean) =>
    whole ? wallTime : zonedToUtc(wallTime, zone);
  const by = wall(next.startsAt.getTime(), allDay) - wall(at, event.allDay);
  const shift = (instantBefore: number) => instant(wall(instantBefore, event.allDay) + by, allDay);
  const startsAt = new Date(shift(event.startsAt.getTime()));
  const endsAt = new Date(startsAt.getTime() + next.endsAt.getTime() - next.startsAt.getTime());
  const asked = (value: Date) => (allDay ? dayOf(value) : value.toISOString());
  return updateOwn(
    deps,
    userId,
    event,
    calendar,
    { ...change, allDay, start: asked(startsAt), end: asked(endsAt) },
    event.exdates.map((key) => exKey(shift(Date.parse(key)), allDay)),
    next.startsAt.getTime(),
  );
}

/** A series ends on the day before `at` – its left out ones after that forgotten. */
async function endBefore(deps: AppDeps, event: CalendarEventRow, at: number) {
  const zone = zoneOr(event.timeZone);
  const repeat = repeatOf(event.recurrence ?? '', event.allDay, zone);
  if (!repeat) return;
  const ended = endedBefore(repeat, at, event.allDay, zone);
  await deps.db
    .update(calendarEvents)
    .set({
      ...seriesColumns(ended, event, zone),
      exdates: event.exdates.filter((key) => Date.parse(key) < at),
      updatedAt: new Date(),
    })
    .where(eq(calendarEvents.id, event.id));
}

/**
 * Deletes an event – one of a series as `scope` says (default: this one; a series' own id: all
 * of it): left out, the series ending before it, or the series with its files. The ones and
 * series split off it go along – all of them, or those from this one on.
 */
export function deleteEvent(deps: AppDeps, userId: string, eventId: string, scope?: EventScope) {
  return inTurn(seriesRef(eventId)?.seriesId ?? eventId, () =>
    deleteNow(deps, userId, eventId, scope),
  );
}

/** {@link deleteEvent} in a turn already taken – an event moved away is deleted where it was. */
async function deleteNow(deps: AppDeps, userId: string, eventId: string, scope?: EventScope) {
  if (mailEventId(eventId)) {
    const { row, remoteId } = await mailEventToEdit(deps, userId, eventId, true);
    await deleteMailEvent(deps, row, remoteId);
    await tellCalendar(deps, row);
    return;
  }
  const ref = seriesRef(eventId);
  const { event, calendar, ctx } = await eventToEdit(deps, userId, ref?.seriesId ?? eventId);
  if (ref && (!event.recurrence || !occurrenceAt(event, ref.at))) throw eventNotFound();
  const at = ref?.at ?? event.startsAt.getTime();
  const which = event.recurrence ? (scope ?? (ref ? 'one' : 'all')) : 'all';
  if (which === 'one') {
    await deps.db
      .update(calendarEvents)
      .set({ exdates: withExdate(exKey(at, event.allDay)), updatedAt: new Date() })
      .where(eq(calendarEvents.id, event.id));
  } else if (which === 'following' && at > event.startsAt.getTime()) {
    await endBefore(deps, event, at);
  } else {
    await deps.db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
    await deleteAttachments(deps, event.attachments);
  }
  if (event.recurrence && which !== 'one') {
    await deleteFamily(deps, ctx, event, which === 'following' ? at : null);
  }
  await tellCalendar(deps, calendar);
}

/**
 * A series' family – the first series, the ones changed alone and the series split off it – in
 * the calendars one may change, all of it or from `from` on (the series asked for gone already).
 */
async function deleteFamily(
  deps: AppDeps,
  ctx: CloudCtx,
  event: CalendarEventRow,
  from: number | null,
) {
  const root = event.seriesRoot ?? event.id;
  const family = await deps.db
    .select()
    .from(calendarEvents)
    .where(
      and(
        or(eq(calendarEvents.id, root), eq(calendarEvents.seriesRoot, root)),
        from === null ? undefined : gte(calendarEvents.startsAt, new Date(from)),
      ),
    );
  const near = [...new Set(family.map((row) => row.calendarId))];
  const changeable = near.length
    ? (await deps.db.select().from(calendars).where(inArray(calendars.id, near))).filter(
        (row) => accessTo(ctx, row) === 'edit',
      )
    : [];
  const gone = family.filter(
    (row) => row.id !== event.id && changeable.some((one) => one.id === row.calendarId),
  );
  if (!gone.length) return;
  await deps.db.delete(calendarEvents).where(
    inArray(
      calendarEvents.id,
      gone.map((row) => row.id),
    ),
  );
  await deleteAttachments(
    deps,
    gone.flatMap((row) => row.attachments),
  );
  for (const other of changeable) {
    if (other.id !== event.calendarId && gone.some((row) => row.calendarId === other.id)) {
      await tellCalendar(deps, other);
    }
  }
}
