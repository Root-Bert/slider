import type { RemoteEvent } from './remote';

/*
 * iCalendar (RFC 5545) as CalDAV servers hand it out: the events of one calendar resource, their
 * recurrences expanded into the occurrences that touch a window. No time zone library – the
 * runtime's `Intl` knows every IANA zone, so a VTIMEZONE block is not needed when its TZID names
 * one; Outlook's Windows names are mapped. Recurrences are walked in the event's own wall time,
 * so a weekly 9:00 stays 9:00 across the DST switch.
 */

const DAY = 86_400_000;

/** Times without a zone („floating“) and unknown zones: Slider's people sit in Germany. */
const FALLBACK_ZONE = 'Europe/Berlin';

/** At most this many occurrences of one event in a window – a daily event over years stays cheap. */
const MAX_OCCURRENCES = 2000;
/** Periods (days, weeks, months, years) one rule is walked at most – a rule that never matches ends. */
const MAX_STEPS = 50_000;

/** A date or date-time as written. */
interface IcsTime {
  /** The wall-clock time counted as if it were UTC – days and hours without a DST jump between. */
  wall: number;
  /** 'UTC' or an IANA zone; whole days use {@link FALLBACK_ZONE} only to place the window. */
  zone: string;
  /** A whole day (`VALUE=DATE`). */
  date: boolean;
}

interface Property {
  params: Record<string, string>;
  value: string;
}

type Props = Map<string, Property[]>;

// ---------------------------------------------------------------------------------------------
// Time zones

/** Outlook and Exchange write Windows zone names; the common ones, as IANA names. */
const WINDOWS_ZONES: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'GTB Standard Time': 'Europe/Bucharest',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Helsinki',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC',
  GMT: 'UTC',
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Throws a RangeError for a zone the runtime does not know. */
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, found);
  }
  return found;
}

export function knownZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The IANA zone a TZID means: Windows names mapped, prefixed ones (`/mozilla.org/…/Europe/Berlin`)
 * by their tail, anything else (Outlook's „Customized Time Zone“) Berlin.
 */
function resolveZone(tzid: string): string {
  const name = tzid.trim();
  const mapped = WINDOWS_ZONES[name];
  if (mapped) return mapped;
  if (knownZone(name)) return name;
  const tail = /([A-Z][A-Za-z_-]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)\s*$/.exec(name)?.[1];
  if (tail && knownZone(tail)) return tail;
  return FALLBACK_ZONE;
}

/** How far `zone`'s wall clock is ahead of UTC at `instant`, in ms. */
function offsetAt(instant: number, zone: string): number {
  const parts = formatter(zone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour') % 24,
    part('minute'),
    part('second'),
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a wall-clock time in `zone` names. Asked twice because the offset at the guess may
 * be the other side of a DST switch; a time in the spring gap lands an hour later, as in
 * calendars.
 */
export function zonedToUtc(wall: number, zone: string): number {
  if (zone === 'UTC') return wall;
  const first = offsetAt(wall, zone);
  const instant = wall - first;
  const second = offsetAt(instant, zone);
  return second === first ? instant : wall - second;
}

/** The wall-clock time (counted as if UTC) `zone` shows at `instant`. */
export const wallOf = (instant: number, zone: string) =>
  zone === 'UTC' ? instant : instant + offsetAt(instant, zone);

const instantOf = (time: IcsTime): number =>
  zonedToUtc(time.wall, time.date ? FALLBACK_ZONE : time.zone);

// ---------------------------------------------------------------------------------------------
// Lines and values

/** Unfolded content lines (a line starting with a space or tab continues the one before). */
function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/** `text` split at `separator`, but not inside double quotes. */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (c === separator && !quoted) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

function parseLine(line: string): ({ name: string } & Property) | null {
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const [name = '', ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ';');
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;
    params[raw.slice(0, eq).toUpperCase()] = raw.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

const unescapeText = (text: string): string =>
  text.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

function parseTime(value: string, params: Record<string, string>): IcsTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const date = m[4] === undefined || params.VALUE === 'DATE';
  const wall = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    date ? 0 : Number(m[4]),
    date ? 0 : Number(m[5]),
    date ? 0 : Number(m[6] ?? 0),
  );
  if (Number.isNaN(wall)) return null;
  const zone = m[7] ? 'UTC' : params.TZID ? resolveZone(params.TZID) : FALLBACK_ZONE;
  return { wall, zone, date };
}

/** The times of a list property (EXDATE, RDATE: comma separated, may repeat). */
function timeList(props: Props, name: string): IcsTime[] {
  return (props.get(name) ?? []).flatMap(({ params, value }) =>
    value.split(',').flatMap((one) => parseTime(one, params) ?? []),
  );
}

/** A DURATION: its days count on the wall clock, its hours, minutes and seconds in real time. */
function parseDuration(text: string): { days: number; ms: number } | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    text.trim(),
  );
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const days = (Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * sign;
  const ms =
    (Number(m[4] ?? 0) * 3_600_000 + Number(m[5] ?? 0) * 60_000 + Number(m[6] ?? 0) * 1000) * sign;
  return { days, ms };
}

// ---------------------------------------------------------------------------------------------
// Days

const dayOf = (wall: number) => Math.floor(wall / DAY);
/** 0 = Sunday, as `SU` is the first of the iCal weekdays below. */
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7;
const dayFrom = (year: number, month: number, date: number) =>
  Date.UTC(year, month - 1, date) / DAY;
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

function dateParts(day: number): [number, number, number] {
  const d = new Date(day * DAY);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function isoDate(day: number): string {
  const [y, m, d] = dateParts(day);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** An occurrence's part of its id: `20261025` for a day, `20261025T080000Z` for a time. */
function stamp(key: number, allDay: boolean): string {
  if (allDay) return isoDate(dayOf(key)).replace(/-/g, '');
  return new Date(key).toISOString().replace(/[-:]|\.\d{3}/g, '');
}

// ---------------------------------------------------------------------------------------------
// Recurrence rules

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: IcsTime;
  /** `n` is the ordinal (`2MO` → 2, `-1FR` → -1), 0 for every such weekday. */
  byDay: { n: number; day: number }[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  weekStart: number;
}

const intList = (text: string | undefined) =>
  (text ?? '')
    .split(',')
    .map((part) => Number.parseInt(part, 10))
    .filter((n) => Number.isFinite(n) && n !== 0);

function parseRule(text: string, start: IcsTime): Rule | null {
  const parts = new Map<string, string>();
  for (const part of text.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) parts.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1).toUpperCase());
  }
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null; // HOURLY and finer: not something a person's calendar holds
  }
  const count = Number.parseInt(parts.get('COUNT') ?? '', 10);
  const untilText = parts.get('UNTIL');
  let until = untilText ? (parseTime(untilText, {}) ?? undefined) : undefined;
  // A floating UNTIL is meant in the event's own zone.
  if (until && !until.date && until.zone !== 'UTC') until = { ...until, zone: start.zone };
  const byDay = (parts.get('BYDAY') ?? '').split(',').flatMap((part) => {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(part.trim());
    return m ? [{ n: Number(m[1] ?? 0), day: WEEKDAYS.indexOf(m[2] ?? '') }] : [];
  });
  return {
    freq,
    interval: Math.max(1, Number.parseInt(parts.get('INTERVAL') ?? '1', 10) || 1),
    count: Number.isFinite(count) && count > 0 ? count : undefined,
    until,
    byDay,
    byMonthDay: intList(parts.get('BYMONTHDAY')).filter((n) => Math.abs(n) <= 31),
    byMonth: intList(parts.get('BYMONTH')).filter((n) => n >= 1 && n <= 12),
    bySetPos: intList(parts.get('BYSETPOS')),
    weekStart: Math.max(0, WEEKDAYS.indexOf(parts.get('WKST') ?? 'MO')),
  };
}

/** The `n`th `day` of the days `[first, first + length)` – all of them for `n` 0. */
function nthWeekdays(first: number, length: number, { n, day }: Rule['byDay'][number]): number[] {
  const all: number[] = [];
  for (let d = first + ((day - weekdayOf(first) + 7) % 7); d < first + length; d += 7) all.push(d);
  if (n === 0) return all;
  const pick = n > 0 ? all[n - 1] : all[all.length + n];
  return pick === undefined ? [] : [pick];
}

function monthDays(year: number, month: number, rule: Rule, startDate: number): number[] {
  const length = daysInMonth(year, month);
  const first = dayFrom(year, month, 1);
  if (rule.byMonthDay.length > 0) {
    const days = rule.byMonthDay
      .map((n) => (n > 0 ? n : length + n + 1))
      .filter((n) => n >= 1 && n <= length)
      .map((n) => first + n - 1);
    return rule.byDay.length > 0
      ? days.filter((d) => rule.byDay.some((b) => b.day === weekdayOf(d)))
      : days;
  }
  if (rule.byDay.length > 0) return rule.byDay.flatMap((b) => nthWeekdays(first, length, b));
  return startDate <= length ? [first + startDate - 1] : []; // the 31st skips short months
}

/** The days of period `k` (the `k`th step of the rule from the start), before BYSETPOS. */
function periodDays(rule: Rule, startDay: number, k: number): number[] {
  const [sy, sm, sd] = dateParts(startDay);
  const inMonths = (d: number) =>
    rule.byMonth.length === 0 || rule.byMonth.includes(dateParts(d)[1]);
  switch (rule.freq) {
    case 'DAILY': {
      const day = startDay + k * rule.interval;
      const [year, month, date] = dateParts(day);
      const length = daysInMonth(year, month);
      const fits =
        inMonths(day) &&
        (rule.byMonthDay.length === 0 ||
          rule.byMonthDay.some((n) => (n > 0 ? n : length + n + 1) === date)) &&
        (rule.byDay.length === 0 || rule.byDay.some((b) => b.day === weekdayOf(day)));
      return fits ? [day] : [];
    }
    case 'WEEKLY': {
      const weekOne = startDay - ((weekdayOf(startDay) - rule.weekStart + 7) % 7);
      const week = weekOne + k * 7 * rule.interval;
      const days =
        rule.byDay.length > 0
          ? rule.byDay.map((b) => week + ((b.day - rule.weekStart + 7) % 7))
          : [week + ((weekdayOf(startDay) - rule.weekStart + 7) % 7)];
      return days.filter(inMonths);
    }
    case 'MONTHLY': {
      const index = sy * 12 + (sm - 1) + k * rule.interval;
      const year = Math.floor(index / 12);
      const month = (index % 12) + 1;
      if (rule.byMonth.length > 0 && !rule.byMonth.includes(month)) return [];
      return monthDays(year, month, rule, sd);
    }
    case 'YEARLY': {
      const year = sy + k * rule.interval;
      if (rule.byDay.length > 0 && rule.byMonth.length === 0 && rule.byMonthDay.length === 0) {
        // BYDAY over the whole year: its ordinals count within the year (`20MO`).
        const first = dayFrom(year, 1, 1);
        return rule.byDay.flatMap((b) => nthWeekdays(first, dayFrom(year + 1, 1, 1) - first, b));
      }
      const months =
        rule.byMonth.length > 0
          ? rule.byMonth
          : rule.byMonthDay.length > 0
            ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
            : [sm];
      return months.flatMap((month) => monthDays(year, month, rule, sd));
    }
  }
}

/**
 * The starts (wall times) a rule makes, in order, DTSTART first – it counts as the first even
 * where the rule would not hit it, as RFC 5545 has it. Without COUNT the walk jumps close to
 * `notBeforeDay` for daily and weekly rules: a daily event since 2015 then costs a few steps.
 */
function* ruleStarts(start: IcsTime, rule: Rule, notBeforeDay: number): Generator<number> {
  const startDay = dayOf(start.wall);
  const time = start.wall - startDay * DAY;
  const { until, count } = rule;
  const beforeUntil = (wall: number) => {
    if (!until) return true;
    if (until.date || start.date) return dayOf(wall) <= dayOf(until.wall);
    return zonedToUtc(wall, start.zone) <= instantOf(until);
  };

  let first = 0;
  const span = rule.freq === 'DAILY' ? 1 : rule.freq === 'WEEKLY' ? 7 : 0;
  if (count === undefined && span > 0 && notBeforeDay > startDay) {
    first = Math.max(0, Math.floor((notBeforeDay - startDay) / (span * rule.interval)) - 1);
  }
  let made = 0;
  if (first === 0) {
    made++;
    yield start.wall;
    if (count !== undefined && made >= count) return;
  }
  for (let k = first; k < first + MAX_STEPS; k++) {
    let days = [...new Set(periodDays(rule, startDay, k))].sort((a, b) => a - b);
    if (rule.bySetPos.length > 0) {
      const all = days;
      days = [
        ...new Set(rule.bySetPos.flatMap((p) => all[p > 0 ? p - 1 : all.length + p] ?? [])),
      ].sort((a, b) => a - b);
    }
    for (const day of days) {
      const wall = day * DAY + time;
      if (wall <= start.wall) continue;
      if (!beforeUntil(wall)) return;
      made++;
      yield wall;
      if (count !== undefined && made >= count) return;
    }
  }
}

/**
 * The workspace's own series (`recurrence.ts`): the starts an RRULE makes from `start` that begin
 * before `to` and end after `from` – instants walked in `zone`'s wall time; an all-day series'
 * days as their UTC midnights. The first counts even where the rule would not hit it.
 */
export function seriesStarts(
  rrule: string,
  start: number,
  allDay: boolean,
  zone: string,
  lengthMs: number,
  from: number,
  to: number,
): number[] {
  const time: IcsTime = allDay
    ? { wall: start, zone: FALLBACK_ZONE, date: true }
    : { wall: start + offsetAt(start, zone), zone, date: false };
  const rule = parseRule(rrule, time);
  const found: number[] = [];
  const walls = rule ? ruleStarts(time, rule, dayOf(from - lengthMs) - 1) : [time.wall];
  for (const wall of walls) {
    const at = allDay ? dayOf(wall) * DAY : zonedToUtc(wall, zone);
    if (at >= to) break;
    if (at + lengthMs > from) found.push(at);
    if (found.length >= MAX_OCCURRENCES) break;
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Events

interface Vevent {
  uid: string;
  start: IcsTime;
  /** Length: `days` on the wall clock, then `ms` in real time. */
  length: { days: number; ms: number };
  title: string;
  location: string;
  notes: string;
  cancelled: boolean;
  rule: Rule | null;
  rdates: IcsTime[];
  exdates: IcsTime[];
  recurrenceId: IcsTime | null;
}

const text = (props: Props, name: string) => unescapeText(props.get(name)?.[0]?.value ?? '');

function toVevent(props: Props): Vevent | null {
  const startProp = props.get('DTSTART')?.[0];
  const start = startProp ? parseTime(startProp.value, startProp.params) : null;
  if (!start) return null;
  const endProp = props.get('DTEND')?.[0];
  const end = endProp ? parseTime(endProp.value, endProp.params) : null;
  const duration = parseDuration(props.get('DURATION')?.[0]?.value ?? '');
  let length: Vevent['length'];
  if (start.date) {
    // A whole day lasts whole days, one at least (no DTEND means that one day).
    const days = end
      ? dayOf(end.wall) - dayOf(start.wall)
      : duration
        ? duration.days + Math.round(duration.ms / DAY)
        : 1;
    length = { days: Math.max(1, days), ms: 0 };
  } else if (end) {
    length = { days: 0, ms: Math.max(0, instantOf(end) - instantOf(start)) };
  } else {
    length = duration ?? { days: 0, ms: 0 };
  }
  const ruleText = props.get('RRULE')?.[0]?.value;
  const recurrence = props.get('RECURRENCE-ID')?.[0];
  return {
    uid: props.get('UID')?.[0]?.value.trim() ?? '',
    start,
    length,
    title: text(props, 'SUMMARY'),
    location: text(props, 'LOCATION'),
    notes: text(props, 'DESCRIPTION'),
    cancelled: (props.get('STATUS')?.[0]?.value ?? '').trim().toUpperCase() === 'CANCELLED',
    rule: ruleText ? parseRule(ruleText, start) : null,
    rdates: timeList(props, 'RDATE'),
    exdates: timeList(props, 'EXDATE'),
    recurrenceId: recurrence ? parseTime(recurrence.value, recurrence.params) : null,
  };
}

/** The VEVENTs' properties; nested components (VALARM's own DESCRIPTION) are left out. */
function vevents(ics: string): Props[] {
  const found: Props[] = [];
  const stack: string[] = [];
  let current: Props | null = null;
  for (const line of unfold(ics)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;
    if (name === 'BEGIN') {
      stack.push(value.trim().toUpperCase());
      if (stack.at(-1) === 'VEVENT' && current === null) current = new Map();
      continue;
    }
    if (name === 'END') {
      const ended = stack.pop();
      if (ended === 'VEVENT' && current && !stack.includes('VEVENT')) {
        found.push(current);
        current = null;
      }
      continue;
    }
    if (current && stack.at(-1) === 'VEVENT') {
      const list = current.get(name) ?? [];
      list.push({ params, value });
      current.set(name, list);
    }
  }
  return found;
}

/** Where an occurrence starting at `key` (its instant, or its day's wall time) ends. */
function occurrence(
  event: Vevent,
  wall: number,
  id: string,
  calendarRemoteId: string,
  from: number,
  to: number,
): RemoteEvent | null {
  const base = {
    id,
    calendarRemoteId,
    title: event.title,
    location: event.location,
    notes: event.notes,
  };
  if (event.start.date) {
    const day = dayOf(wall);
    const last = day + event.length.days;
    const startsAt = zonedToUtc(day * DAY, FALLBACK_ZONE);
    const endsAt = zonedToUtc(last * DAY, FALLBACK_ZONE);
    if (!(startsAt < to && endsAt > from)) return null;
    return { ...base, allDay: true, start: isoDate(day), end: isoDate(last) };
  }
  const startsAt = zonedToUtc(wall, event.start.zone);
  const endsAt = Math.max(
    startsAt,
    zonedToUtc(wall + event.length.days * DAY, event.start.zone) + event.length.ms,
  );
  const overlaps = startsAt < to && (endsAt > from || (endsAt === startsAt && startsAt >= from));
  if (!overlaps) return null;
  return {
    ...base,
    allDay: false,
    start: new Date(startsAt).toISOString(),
    end: new Date(endsAt).toISOString(),
  };
}

/** The key one occurrence is known by: its instant, or its day for a whole-day series. */
const keyOf = (time: IcsTime, allDay: boolean) =>
  allDay ? dayOf(time.wall) * DAY : instantOf(time);

/**
 * The occurrences of the events in one iCalendar text that overlap `[from, to)`. A recurring
 * one's id is its UID plus the start it was planned for, so a moved occurrence keeps its id.
 */
export function parseIcsEvents(
  ics: string,
  calendarRemoteId: string,
  from: Date,
  to: Date,
): RemoteEvent[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const masters = new Map<string, Vevent>();
  const overrides: Vevent[] = [];
  const singles: Vevent[] = [];
  for (const props of vevents(ics)) {
    const event = toVevent(props);
    if (!event) continue;
    if (event.recurrenceId) overrides.push(event);
    else if (event.uid && !masters.has(event.uid) && (event.rule || event.rdates.length > 0)) {
      masters.set(event.uid, event);
    } else singles.push(event);
  }

  const found: RemoteEvent[] = [];
  for (const event of singles) {
    if (event.cancelled) continue;
    const id =
      event.uid ||
      `${event.title}@${stamp(keyOf(event.start, event.start.date), event.start.date)}`;
    const one = occurrence(event, event.start.wall, id, calendarRemoteId, fromMs, toMs);
    if (one) found.push(one);
  }

  // An override replaces its occurrence wherever it was moved to – into the window or out of it.
  const replaced = new Map<string, Set<number>>();
  for (const event of overrides) {
    const master = masters.get(event.uid);
    const allDay = master ? master.start.date : event.start.date;
    const key = keyOf(event.recurrenceId!, allDay);
    const keys = replaced.get(event.uid) ?? new Set<number>();
    keys.add(key);
    replaced.set(event.uid, keys);
    if (event.cancelled || master?.cancelled) continue;
    const id = `${event.uid}/${stamp(key, allDay)}`;
    const one = occurrence(event, event.start.wall, id, calendarRemoteId, fromMs, toMs);
    if (one) found.push(one);
  }

  for (const master of masters.values()) {
    if (master.cancelled) continue;
    const allDay = master.start.date;
    const skip = new Set([
      ...master.exdates.map((t) => keyOf(t, allDay)),
      ...(replaced.get(master.uid) ?? []),
    ]);
    const longest = master.length.days + Math.ceil(master.length.ms / DAY) + 2;
    const notBeforeDay = dayOf(fromMs) - longest;
    const walls = master.rule ? [...takeStarts(master, master.rule, notBeforeDay, toMs)] : [];
    // RDATEs in the event's zone (a whole-day series keeps whole days).
    for (const rdate of master.rdates) {
      walls.push(
        allDay
          ? dayOf(rdate.wall) * DAY
          : rdate.zone === master.start.zone
            ? rdate.wall
            : instantOf(rdate) + offsetAt(instantOf(rdate), master.start.zone),
      );
    }
    if (!master.rule) walls.push(master.start.wall);
    let count = 0;
    const seen = new Set<number>();
    for (const wall of walls.sort((a, b) => a - b)) {
      const key = keyOf({ ...master.start, wall }, allDay);
      if (seen.has(key) || skip.has(key)) continue;
      seen.add(key);
      const id = `${master.uid}/${stamp(key, allDay)}`;
      const one = occurrence(master, wall, id, calendarRemoteId, fromMs, toMs);
      if (!one) continue;
      found.push(one);
      if (++count >= MAX_OCCURRENCES) break;
    }
  }

  const unique = new Map(found.map((event) => [event.id, event]));
  return [...unique.values()].sort(
    (a, b) => startMs(a) - startMs(b) || a.title.localeCompare(b.title),
  );
}

/** A rule's starts up to the window's end, at most {@link MAX_OCCURRENCES} past its start. */
function* takeStarts(
  master: Vevent,
  rule: Rule,
  notBeforeDay: number,
  toMs: number,
): Generator<number> {
  let inWindow = 0;
  const firstDay = notBeforeDay;
  for (const wall of ruleStarts(master.start, rule, notBeforeDay)) {
    const at = master.start.date
      ? zonedToUtc(dayOf(wall) * DAY, FALLBACK_ZONE)
      : zonedToUtc(wall, master.start.zone);
    if (at >= toMs) return;
    yield wall;
    if (dayOf(wall) >= firstDay && ++inWindow >= MAX_OCCURRENCES) return;
  }
}

const startMs = (event: RemoteEvent) =>
  event.allDay
    ? zonedToUtc(Date.parse(`${event.start}T00:00:00Z`), FALLBACK_ZONE)
    : Date.parse(event.start);

// ---------------------------------------------------------------------------------------------
// Writing: an event made or changed in a CalDAV calendar

/** What Slider writes of an event; days `YYYY-MM-DD` (end exclusive), times ISO instants. */
export interface IcsFields {
  title: string;
  location: string;
  notes: string;
  allDay: boolean;
  start: string;
  end: string;
}

const escapeText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A content line folded at 75 octets, never inside a character (RFC 5545 3.1). */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const utcStamp = (at: Date) => at.toISOString().replace(/[-:]|\.\d{3}/g, '');

function timingLines(fields: Pick<IcsFields, 'allDay' | 'start' | 'end'>): string[] {
  if (fields.allDay) {
    return [
      `DTSTART;VALUE=DATE:${fields.start.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${fields.end.replace(/-/g, '')}`,
    ];
  }
  return [`DTSTART:${utcStamp(new Date(fields.start))}`, `DTEND:${utcStamp(new Date(fields.end))}`];
}

function textLines(fields: Partial<IcsFields>): string[] {
  const lines: string[] = [];
  if (fields.title !== undefined) lines.push(`SUMMARY:${escapeText(fields.title)}`);
  if (fields.location) lines.push(`LOCATION:${escapeText(fields.location)}`);
  if (fields.notes) lines.push(`DESCRIPTION:${escapeText(fields.notes)}`);
  return lines;
}

/** A new calendar resource holding one event. */
export function newIcsEvent(uid: string, fields: IcsFields, now: Date): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Slider//Kalender//DE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `CREATED:${utcStamp(now)}`,
    ...timingLines(fields),
    ...textLines(fields),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(fold)
    .join('\r\n');
}

/** The UIDs of a resource's events, and whether it holds a series (a rule, extra dates, overrides). */
export function icsEventsOf(ics: string): { uids: string[]; series: boolean } {
  const found = vevents(ics);
  return {
    uids: found.map((props) => props.get('UID')?.[0]?.value.trim() ?? ''),
    series:
      found.length > 1 ||
      found.some((props) => props.has('RRULE') || props.has('RDATE') || props.has('RECURRENCE-ID')),
  };
}

/**
 * The resource's one event with the fields given changed; everything else it holds (alarms,
 * attendees, the server's own properties) stays as it was. Timing comes whole or not at all.
 */
export function changedIcsEvent(ics: string, change: Partial<IcsFields>, now: Date): string {
  const lines = unfold(ics);
  const timing = change.allDay !== undefined && change.start && change.end;
  const replaced = new Set(['DTSTAMP', 'LAST-MODIFIED', 'SEQUENCE']);
  if (timing) for (const name of ['DTSTART', 'DTEND', 'DURATION']) replaced.add(name);
  if (change.title !== undefined) replaced.add('SUMMARY');
  if (change.location !== undefined) replaced.add('LOCATION');
  if (change.notes !== undefined) replaced.add('DESCRIPTION');
  const out: string[] = [];
  const stack: string[] = [];
  let sequence = 0;
  for (const line of lines) {
    const parsed = parseLine(line);
    const inEvent = stack.length > 0 && stack.at(-1) === 'VEVENT';
    if (parsed?.name === 'BEGIN') stack.push(parsed.value.trim().toUpperCase());
    else if (parsed?.name === 'END') {
      const ended = stack.pop();
      if (ended === 'VEVENT' && !stack.includes('VEVENT')) {
        out.push(
          `DTSTAMP:${utcStamp(now)}`,
          `LAST-MODIFIED:${utcStamp(now)}`,
          `SEQUENCE:${sequence + 1}`,
          ...(timing
            ? timingLines({ allDay: change.allDay!, start: change.start!, end: change.end! })
            : []),
          ...textLines(change),
        );
      }
    } else if (inEvent && parsed && replaced.has(parsed.name)) {
      if (parsed.name === 'SEQUENCE') sequence = Number.parseInt(parsed.value, 10) || 0;
      continue;
    }
    out.push(line);
  }
  return `${out.map(fold).join('\r\n')}\r\n`;
}

/** The one event of a resource as it reads now (a single event; any date it lies on). */
export function icsSingleEvent(ics: string, calendarRemoteId: string): RemoteEvent | null {
  return (
    parseIcsEvents(
      ics,
      calendarRemoteId,
      new Date(Date.UTC(1900, 0, 1)),
      new Date(Date.UTC(2200, 0, 1)),
    )[0] ?? null
  );
}
