import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  MAX_EVENT_RANGE_DAYS,
  type Calendar,
  type CalendarChange,
  type CalendarEvent,
  type CalendarEventChange,
  type CalendarEventInput,
  type CalendarInput,
  type MailCalendarRefusal,
} from '@slider/shared';
import { calendarEvents, calendars, type CalendarEventRow, type CalendarRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, forbidden, notFound } from '../http/errors';
import { authorsOf, cloudContext, type CloudCtx } from './cloud/context';
import {
  mailCalendarsRefused,
  mailEvents,
  syncMailCalendarsBriefly,
} from './calendar/mail-calendars';
import { areaAudience, senderLive } from './sender';

/*
 * Calendars (`@slider/shared` calendar). Every area has its own – made the first time its
 * calendars are looked at, as the workspace's own area is – and every person a private one; under
 * any of them sub-calendars. An area's are seen by whoever sees the area and filled by whoever may
 * edit there; one's private ones are one's own. A mail account's calendars are its person's
 * alone and read only: their events stay at the provider (`calendar/remote.ts`).
 */

export const calendarNotFound = () => notFound('Diesen Kalender gibt es nicht (mehr).');
export const eventNotFound = () => notFound('Diesen Termin gibt es nicht (mehr).');
const READ_ONLY = 'In diesem Kalender darfst du nur ansehen, nichts ändern.';

/** As many events as one look holds – a year of a busy team, not an archive. */
const MAX_LISTED = 5000;
/** Sub-calendars under one: a handful, not a tree to get lost in. */
const MAX_DEPTH = 4;

/** Whether the caller sees it, and may put events in it. */
function accessTo(ctx: CloudCtx, row: Pick<CalendarRow, 'areaId' | 'ownerId' | 'mailAccountId'>) {
  if (row.mailAccountId) return row.ownerId === ctx.userId ? 'view' : null;
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

function seenWhere(ctx: CloudCtx) {
  const seen = [...ctx.areas.entries()].filter(([, one]) => one.access).map(([id]) => id);
  return and(
    eq(calendars.workspaceId, ctx.workspaceId),
    or(
      and(isNull(calendars.areaId), eq(calendars.ownerId, ctx.userId)),
      seen.length ? inArray(calendars.areaId, seen) : sql`false`,
    ),
  );
}

function toCalendar(ctx: CloudCtx, row: CalendarRow): Calendar {
  const area = row.areaId ? ctx.areas.get(row.areaId)?.row : undefined;
  const root = !row.parentId && !row.mailAccountId;
  const access = accessTo(ctx, row);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.mailAccountId ? 'mail' : row.areaId ? 'area' : 'private',
    areaId: row.areaId,
    parentId: row.parentId,
    mailAccountId: row.mailAccountId,
    name: root ? (area ? area.name : 'Privat') : row.name,
    color: row.color ?? (root && area ? area.color : 'blue'),
    canEdit: access === 'edit',
    canManage: access === 'edit' && Boolean(row.parentId),
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
  const byOrder = (row: CalendarRow) => row.createdAt.getTime();
  return rows
    .sort(
      (a, b) =>
        Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) || byOrder(a) - byOrder(b),
    )
    .map((row) => toCalendar(ctx, row));
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
  const { ctx, row: parent } = await calendarToEdit(deps, userId, input.parentId);
  if (parent.mailAccountId) throw forbidden(READ_ONLY);
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
  return toCalendar(ctx, row!);
}

/** Renames or colours a sub-calendar (an area's own and one's private one keep theirs). */
export async function updateCalendar(
  deps: AppDeps,
  userId: string,
  calendarId: string,
  change: CalendarChange,
): Promise<Calendar> {
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
  return toCalendar(ctx, after!);
}

/** Deletes a sub-calendar, the ones under it and all their events. */
export async function deleteCalendar(deps: AppDeps, userId: string, calendarId: string) {
  const { row } = await calendarToEdit(deps, userId, calendarId);
  if (!row.parentId) throw forbidden('Diesen Kalender kannst du nicht löschen.');
  await deps.db.delete(calendars).where(eq(calendars.id, calendarId));
  await tellCalendar(deps, row);
}

// ── Events ──────────────────────────────────────────────────────────────────

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

async function toEvents(
  deps: AppDeps,
  editable: (calendarId: string) => boolean,
  rows: CalendarEventRow[],
): Promise<CalendarEvent[]> {
  const people = await authorsOf(
    deps.db,
    rows.map((row) => row.createdBy),
  );
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
  }));
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
        gt(calendarEvents.endsAt, new Date(from.getTime() - DAY_MS)),
      ),
    )
    .orderBy(calendarEvents.startsAt)
    .limit(MAX_LISTED);
  return [...(await toEvents(deps, (id) => access.get(id) === 'edit', rows)), ...(await fromMail)];
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

export async function getEvent(
  deps: AppDeps,
  userId: string,
  eventId: string,
): Promise<CalendarEvent> {
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
  return (await toEvents(deps, () => access === 'edit', [event]))[0]!;
}

export async function createEvent(
  deps: AppDeps,
  userId: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  const { row: calendar } = await calendarToEdit(deps, userId, input.calendarId);
  if (calendar.mailAccountId) throw forbidden(READ_ONLY);
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
      ...bounds(input),
      createdBy: userId,
    })
    .returning();
  await tellCalendar(deps, calendar);
  return (await toEvents(deps, () => true, [row!]))[0]!;
}

/** Changes any of its fields; `calendarId` moves it to another calendar the caller may fill. */
export async function updateEvent(
  deps: AppDeps,
  userId: string,
  eventId: string,
  change: CalendarEventChange,
): Promise<CalendarEvent> {
  const { event, calendar } = await eventToEdit(deps, userId, eventId);
  let target = calendar;
  if (change.calendarId && change.calendarId !== calendar.id) {
    target = (await calendarToEdit(deps, userId, change.calendarId)).row;
    if (target.mailAccountId || target.workspaceId !== calendar.workspaceId) {
      throw forbidden(READ_ONLY);
    }
  }
  const allDay = change.allDay ?? event.allDay;
  const timing =
    change.start !== undefined || change.end !== undefined || change.allDay !== undefined
      ? bounds({
          allDay,
          start: change.start ?? (allDay ? dayOf(event.startsAt) : event.startsAt.toISOString()),
          end: change.end ?? (allDay ? dayOf(event.endsAt) : event.endsAt.toISOString()),
        })
      : {};
  const [after] = await deps.db
    .update(calendarEvents)
    .set({
      calendarId: target.id,
      ...(change.title !== undefined && { title: change.title.trim() }),
      ...(change.location !== undefined && { location: change.location.trim() }),
      ...(change.notes !== undefined && { notes: change.notes }),
      allDay,
      ...timing,
      updatedAt: new Date(),
    })
    .where(eq(calendarEvents.id, eventId))
    .returning();
  await tellCalendar(deps, calendar);
  if (target !== calendar) await tellCalendar(deps, target);
  return (await toEvents(deps, () => true, [after!]))[0]!;
}

export async function deleteEvent(deps: AppDeps, userId: string, eventId: string) {
  const { calendar } = await eventToEdit(deps, userId, eventId);
  await deps.db.delete(calendarEvents).where(eq(calendarEvents.id, eventId));
  await tellCalendar(deps, calendar);
}
