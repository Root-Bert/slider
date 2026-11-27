/*
 * A person's calendars of a workspace as a feed (webcal): added once in Apple's calendar (iCloud
 * carries it to every device) or Google's („Per URL“), fetched again every few minutes. It holds
 * the workspace's own calendars the person sees – their private one and their areas' – never a
 * mailbox's, which their provider shows already. Read only: changed in Office.
 *
 * The link's secret is all that opens it: kept hashed to find it and sealed to show it again; a
 * new link ends the old. Leaving the workspace or a blocked account ends it too. Not in the
 * desktop app: its server is this computer's, no calendar app elsewhere reaches it.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { API_PREFIX } from '@slider/shared';
import { hashToken, newSecretToken } from '../../auth/session';
import { calendarEvents, calendarFeeds, calendars, users, workspaces } from '../../db/schema';
import type { CalendarEventRow } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { notFound } from '../../http/errors';
import { seenWhere } from '../calendars';
import { cloudContext } from '../cloud/context';
import { wallOf } from './ical';
import { zoneOr } from './recurrence';

const DAY = 86_400_000;
/** How far back a feed reaches – a calendar app keeps what it fetched before. */
const PAST_DAYS = 400;
const MAX_EVENTS = 5000;

const feedUrl = (deps: Pick<AppDeps, 'config'>, token: string) =>
  `${deps.config.webOrigin}${API_PREFIX}/calendar-feed/${token}.ics`;

/** The person's feed link of the workspace – made on first asking; `renew`: a new one. */
export async function calendarFeedLink(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  renew = false,
): Promise<{ url: string }> {
  if (deps.config.desktop) throw notFound('Abonnieren geht in der Desktop-App nicht.');
  await cloudContext(deps.db, workspaceId, userId);
  const where = and(eq(calendarFeeds.workspaceId, workspaceId), eq(calendarFeeds.userId, userId));
  const [kept] = await deps.db.select().from(calendarFeeds).where(where);
  if (kept && !renew) return { url: feedUrl(deps, kept.token) };
  const token = newSecretToken();
  await deps.db
    .insert(calendarFeeds)
    .values({ workspaceId, userId, token, tokenHash: hashToken(token) })
    .onConflictDoUpdate({
      target: [calendarFeeds.workspaceId, calendarFeeds.userId],
      set: { token, tokenHash: hashToken(token), createdAt: new Date() },
    });
  return { url: feedUrl(deps, token) };
}

/** The feed a link names, as iCalendar – not found for a link renewed or a person gone. */
export async function calendarFeed(deps: AppDeps, token: string): Promise<string> {
  const [feed] = token
    ? await deps.db
        .select({ workspaceId: calendarFeeds.workspaceId, userId: calendarFeeds.userId })
        .from(calendarFeeds)
        .innerJoin(users, eq(users.id, calendarFeeds.userId))
        .where(and(eq(calendarFeeds.tokenHash, hashToken(token)), isNull(users.blockedAt)))
    : [];
  if (!feed) throw notFound('Diesen Kalender gibt es nicht mehr.');
  const ctx = await cloudContext(deps.db, feed.workspaceId, feed.userId).catch(() => null);
  if (!ctx) throw notFound('Diesen Kalender gibt es nicht mehr.');
  const [workspace] = await deps.db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, feed.workspaceId));
  const own = (await deps.db.select().from(calendars).where(seenWhere(ctx))).filter(
    (row) => !row.mailAccountId,
  );
  if (!own.length) return icsOf(workspace?.name ?? 'Kalender', []);
  const since = new Date(Date.now() - PAST_DAYS * DAY);
  const inOwn = inArray(
    calendarEvents.calendarId,
    own.map((row) => row.id),
  );
  // Series first (an old one may run on), then the single ones from the latest back: where there
  // are too many, the oldest past ones stay out, never the coming ones.
  const series = await deps.db
    .select()
    .from(calendarEvents)
    .where(
      and(
        inOwn,
        isNotNull(calendarEvents.recurrence),
        or(isNull(calendarEvents.repeatsUntil), gt(calendarEvents.repeatsUntil, since)),
      ),
    )
    .orderBy(desc(calendarEvents.startsAt))
    .limit(MAX_EVENTS);
  const single =
    series.length < MAX_EVENTS
      ? await deps.db
          .select()
          .from(calendarEvents)
          .where(and(inOwn, isNull(calendarEvents.recurrence), gt(calendarEvents.endsAt, since)))
          .orderBy(desc(calendarEvents.startsAt))
          .limit(MAX_EVENTS - series.length)
      : [];
  return icsOf(workspace?.name ?? 'Kalender', [...series, ...single.reverse()]);
}

/** `20261116T080000Z` – an instant in UTC. */
const utc = (at: Date) => at.toISOString().replace(/[-:]|\.\d{3}/g, '');
/** `20261116` – an all-day one's day (stored as its UTC midnight). */
const date = (at: Date) => at.toISOString().slice(0, 10).replace(/-/g, '');
/** `20261116T090000` – an instant as the wall clock in `zone` shows it. */
const wall = (at: number, zone: string) =>
  new Date(wallOf(at, zone)).toISOString().slice(0, 19).replace(/[-:]/g, '');

/** Control characters out – a line break in a value never starts a line of the feed. */
const plain = (text: string) =>
  // eslint-disable-next-line no-control-regex -- control characters are what it takes out
  text.replace(/\r\n|\r|\n/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');

const escape = (text: string) =>
  plain(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');

/** A content line folded at 75 octets (RFC 5545 3.1), never inside a character. */
function fold(line: string): string {
  const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
  if (bytes(line) <= 75) return line;
  const parts: string[] = [];
  let part = '';
  for (const char of line) {
    if (bytes(part + char) > (parts.length ? 74 : 75)) {
      parts.push(part);
      part = '';
    }
    part += char;
  }
  parts.push(part);
  return parts.join('\r\n ');
}

function vevent(row: CalendarEventRow): string[] {
  const zone = zoneOr(row.timeZone);
  const series = Boolean(row.recurrence);
  const times = row.allDay
    ? [`DTSTART;VALUE=DATE:${date(row.startsAt)}`, `DTEND;VALUE=DATE:${date(row.endsAt)}`]
    : series
      ? // A series is walked on its zone's wall clock: 9:00 stays 9:00 across DST.
        [
          `DTSTART;TZID=${zone}:${wall(row.startsAt.getTime(), zone)}`,
          `DTEND;TZID=${zone}:${wall(row.endsAt.getTime(), zone)}`,
        ]
      : [`DTSTART:${utc(row.startsAt)}`, `DTEND:${utc(row.endsAt)}`];
  const left = row.exdates.length
    ? row.allDay
      ? [`EXDATE;VALUE=DATE:${row.exdates.map((day) => day.replace(/-/g, '')).join(',')}`]
      : [`EXDATE;TZID=${zone}:${row.exdates.map((at) => wall(Date.parse(at), zone)).join(',')}`]
    : [];
  const notes = [row.notes, row.meetingUrl].filter(Boolean).join('\n\n');
  return [
    'BEGIN:VEVENT',
    `UID:${row.id}`,
    `DTSTAMP:${utc(row.updatedAt)}`,
    `LAST-MODIFIED:${utc(row.updatedAt)}`,
    ...times,
    ...(series ? [`RRULE:${row.recurrence}`, ...left] : []),
    `SUMMARY:${escape(row.title || 'Termin')}`,
    ...(row.location ? [`LOCATION:${escape(row.location)}`] : []),
    ...(notes ? [`DESCRIPTION:${escape(notes)}`] : []),
    ...(row.meetingUrl ? [`URL:${plain(row.meetingUrl).replace(/\n/g, '')}`] : []),
    'END:VEVENT',
  ];
}

const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** `+0100` – an offset as iCalendar writes it. */
function offsetText(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ms < 0 ? '-' : '+'}${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}`;
}

/**
 * The zone a series names, as RFC 5545 asks for each TZID (Outlook reads only this): its
 * switches of this year as yearly rules – the n-th (or last) weekday of their month at the wall
 * time they happen – or its one offset where it has no summer time.
 */
function vtimezone(zone: string, year: number): string[] {
  const offset = (at: number) => wallOf(at, zone) - at;
  const start = Date.UTC(year, 0, 1);
  const switches: { at: number; from: number; to: number }[] = [];
  let before = offset(start);
  for (let day = start + DAY; day <= Date.UTC(year + 1, 0, 1); day += DAY) {
    if (offset(day) === before) continue;
    let [low, high] = [day - DAY, day];
    while (high - low > 60_000) {
      const mid = Math.floor((low + high) / 2);
      if (offset(mid) === before) low = mid;
      else high = mid;
    }
    const at = Math.floor(high / 60_000) * 60_000;
    switches.push({ at, from: before, to: offset(day) });
    before = offset(day);
  }
  const observance = (kind: string, from: number, to: number, rest: string[]) => [
    `BEGIN:${kind}`,
    `TZOFFSETFROM:${offsetText(from)}`,
    `TZOFFSETTO:${offsetText(to)}`,
    ...rest,
    `END:${kind}`,
  ];
  const body = switches.length
    ? switches.flatMap(({ at, from, to }) => {
        // On the wall clock as it was before the switch (02:00 in March, 03:00 in October).
        const wallTime = new Date(at + from);
        const month = wallTime.getUTCMonth();
        const date = wallTime.getUTCDate();
        const weekday = wallTime.getUTCDay();
        const monthDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const nth = date + 7 > monthDays ? -1 : Math.ceil(date / 7);
        // The same rule's day in 1970, where its yearly rule starts.
        const first = new Date(Date.UTC(1970, month, 1)).getUTCDay();
        const firstDay = 1 + ((weekday - first + 7) % 7);
        const last = new Date(Date.UTC(1970, month + 1, 0)).getUTCDate();
        const day1970 =
          nth > 0 ? firstDay + (nth - 1) * 7 : firstDay + Math.floor((last - firstDay) / 7) * 7;
        const pad = (n: number) => String(n).padStart(2, '0');
        return observance(to > from ? 'DAYLIGHT' : 'STANDARD', from, to, [
          `DTSTART:1970${pad(month + 1)}${pad(day1970)}T${pad(wallTime.getUTCHours())}${pad(wallTime.getUTCMinutes())}00`,
          `RRULE:FREQ=YEARLY;BYMONTH=${month + 1};BYDAY=${nth}${ICS_DAYS[weekday]}`,
        ]);
      })
    : observance('STANDARD', before, before, ['DTSTART:19700101T000000']);
  return ['BEGIN:VTIMEZONE', `TZID:${zone}`, ...body, 'END:VTIMEZONE'];
}

function icsOf(name: string, rows: CalendarEventRow[]): string {
  const zones = [
    ...new Set(
      rows.filter((row) => row.recurrence && !row.allDay).map((row) => zoneOr(row.timeZone)),
    ),
  ];
  const year = new Date().getUTCFullYear();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Office//Kalender//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
    ...zones.flatMap((zone) => vtimezone(zone, year)),
    ...rows.flatMap(vevent),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
