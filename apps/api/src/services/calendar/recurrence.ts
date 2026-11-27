/*
 * Series in the workspace's own calendars: an event row with an RRULE, walked from its first one
 * in the person's zone (`ical.ts` walks it). The rule is built here from what the panel offers
 * (`EventRepeat`), never taken as written. One of a series is known by the series' id and the
 * start it was planned for; one left out („nur dieser“ changed or deleted) is in `exdates` by
 * that start – a changed one lives on as an event of its own.
 */
import type { EventRepeat } from '@slider/shared';
import type { CalendarEventRow } from '../../db/schema';
import { badRequest } from '../../http/errors';
import { knownZone, seriesStarts, zonedToUtc } from './ical';

const DAY = 86_400_000;
/** A series made without a zone, or with one the runtime does not know: Slider's people sit here. */
export const DEFAULT_ZONE = 'Europe/Berlin';
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export const zoneOr = (zone: string | null | undefined) =>
  zone && knownZone(zone) ? zone : DEFAULT_ZONE;

/** The day (`YYYY-MM-DD`) an instant falls on in `zone`. */
export function localDay(at: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(at));
}

const dayBefore = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

/** Where its `until` day ends: an all-day series' next midnight, else that day's last second. */
function untilEnd(until: string, allDay: boolean, zone: string): number {
  return allDay
    ? Date.parse(`${until}T00:00:00Z`) + DAY
    : zonedToUtc(Date.parse(`${until}T23:59:59Z`), zone) + 1000;
}

/** The RRULE of a repeat; `start` (the first one) must not lie after its last day. */
export function ruleOf(repeat: EventRepeat, start: number, allDay: boolean, zone: string): string {
  const parts = [`FREQ=${repeat.freq.toUpperCase()}`];
  if (repeat.interval > 1) parts.push(`INTERVAL=${repeat.interval}`);
  if (repeat.freq === 'weekly' && repeat.days?.length) {
    const days = [...new Set(repeat.days)].sort((a, b) => a - b);
    parts.push(`BYDAY=${days.map((day) => WEEKDAYS[day]).join(',')}`);
  }
  if (repeat.until) {
    if (untilEnd(repeat.until, allDay, zone) <= start) {
      throw badRequest('Die Wiederholung endet vor dem ersten Termin.');
    }
    const end = untilEnd(repeat.until, allDay, zone) - 1000;
    parts.push(
      `UNTIL=${allDay ? repeat.until.replace(/-/g, '') : new Date(end).toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
    );
  }
  return parts.join(';');
}

/** A stored rule as the panel shows it (only {@link ruleOf}'s own come back). */
export function repeatOf(rule: string, allDay: boolean, zone: string): EventRepeat | null {
  const parts = new Map(
    rule.split(';').map((part) => part.split('=', 2) as [string, string | undefined]),
  );
  const freq = parts.get('FREQ')?.toLowerCase();
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') return null;
  const until = parts.get('UNTIL');
  const days = (parts.get('BYDAY') ?? '')
    .split(',')
    .map((day) => WEEKDAYS.indexOf(day))
    .filter((day) => day >= 0);
  return {
    freq,
    interval: Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1),
    ...(days.length > 0 && { days }),
    until: !until
      ? null
      : allDay
        ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`
        : localDay(
            Date.parse(
              `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`,
            ),
            zone,
          ),
  };
}

/** Where a series' last one ends at the latest – `null`: it has no end. */
export function repeatsUntilOf(
  repeat: EventRepeat,
  allDay: boolean,
  zone: string,
  lengthMs: number,
): Date | null {
  return repeat.until ? new Date(untilEnd(repeat.until, allDay, zone) + lengthMs) : null;
}

/** A repeat that ends on the day before `at` (its „following“ cut off), never later than it did. */
export function endedBefore(repeat: EventRepeat, at: number, allDay: boolean, zone: string) {
  const last = dayBefore(allDay ? new Date(at).toISOString().slice(0, 10) : localDay(at, zone));
  return { ...repeat, until: repeat.until && repeat.until < last ? repeat.until : last };
}

/** How an occurrence is left out of its series. */
export const exKey = (at: number, allDay: boolean) =>
  allDay ? new Date(at).toISOString().slice(0, 10) : new Date(at).toISOString();

const stamp = (at: number, allDay: boolean) =>
  allDay
    ? new Date(at).toISOString().slice(0, 10).replace(/-/g, '')
    : new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, '');

export const occurrenceId = (seriesId: string, at: number, allDay: boolean) =>
  `${seriesId}@${stamp(at, allDay)}`;

/** The series and planned start an occurrence's id names – `null`: not one of a series. */
export function seriesRef(eventId: string): { seriesId: string; at: number } | null {
  const m = /^([^@]+)@(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(eventId);
  if (!m) return null;
  const at = Date.parse(`${m[2]}-${m[3]}-${m[4]}T${m[5] ?? '00'}:${m[6] ?? '00'}:${m[7] ?? '00'}Z`);
  return Number.isNaN(at) ? null : { seriesId: m[1]!, at };
}

type SeriesRow = Pick<
  CalendarEventRow,
  'startsAt' | 'endsAt' | 'allDay' | 'recurrence' | 'timeZone' | 'exdates'
>;

/** A series' occurrences that overlap `[from, to)` – the ones left out not among them. */
export function occurrencesOf(row: SeriesRow, from: number, to: number) {
  const length = row.endsAt.getTime() - row.startsAt.getTime();
  const skip = new Set(row.exdates);
  return seriesStarts(
    row.recurrence ?? '',
    row.startsAt.getTime(),
    row.allDay,
    zoneOr(row.timeZone),
    length,
    from,
    to,
  )
    .filter((at) => !skip.has(exKey(at, row.allDay)))
    .map((at) => ({ startsAt: new Date(at), endsAt: new Date(at + length) }));
}

/** The occurrence planned for `at` – `null` where the series has none then (or left it out). */
export function occurrenceAt(row: SeriesRow, at: number) {
  return occurrencesOf(row, at, at + 1).find((one) => one.startsAt.getTime() === at) ?? null;
}
