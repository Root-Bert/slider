import { INSTANCE_INTERVALS, type InstanceBucket, type InstanceInterval } from '@slider/shared';
import { formatDay } from '@/lib/format';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A measure of what was created: accounts, organisations or reviews. */
export type Metric = keyof Omit<InstanceBucket, 'start'>;

/** Per window width: its label above the dashboard, and "in 31 Tagen" after a count of it. */
const INTERVAL_COPY: Record<InstanceInterval, { label: string; phrase: string }> = {
  '1d': { label: '1 Tag', phrase: 'in 24 Stunden' },
  '7d': { label: '7 Tage', phrase: 'in 7 Tagen' },
  '31d': { label: '31 Tage', phrase: 'in 31 Tagen' },
  '1y': { label: '1 Jahr', phrase: 'in einem Jahr' },
};

export const INTERVAL_SEGMENTS = (Object.keys(INTERVAL_COPY) as InstanceInterval[]).map(
  (value) => ({ value, label: INTERVAL_COPY[value].label }),
);

export const intervalPhrase = (interval: InstanceInterval) => INTERVAL_COPY[interval].phrase;

/** How long the stretches of `buckets` are, from their spacing; `fallback` with fewer than two. */
export function stretchHoursOf(buckets: readonly InstanceBucket[], fallback: number): number {
  const [first, second] = buckets;
  return first && second
    ? Math.round((Date.parse(second.start) - Date.parse(first.start)) / HOUR_MS)
    : fallback;
}

/** "je Stunde" … "je Woche". */
export function stretchName(stretchHours: number): string {
  if (stretchHours <= 1) return 'Stunde';
  if (stretchHours < 24) return `${stretchHours} Stunden`;
  return stretchHours === 24 ? 'Tag' : 'Woche';
}

/**
 * Where a window ending around `at` really ends: on the next full hour (six-hour stretches: 0, 6,
 * 12 or 18 o'clock), else at the next local midnight – so its stretches are whole hours and days
 * on the clock.
 */
export function alignEnd(at: number, interval: InstanceInterval): number {
  const date = new Date(at);
  const step: number = INSTANCE_INTERVALS[interval].stretchHours;
  if (step < 24) {
    date.setMinutes(0, 0, 0);
    if (date.getTime() < at) date.setHours(date.getHours() + 1);
    while (date.getHours() % step !== 0) date.setHours(date.getHours() + 1);
    return date.getTime();
  }
  date.setHours(0, 0, 0, 0);
  if (date.getTime() < at) date.setDate(date.getDate() + 1);
  return date.getTime();
}

/**
 * Where a moved window ends: on whole stretches back from now, never past now nor before the
 * history (`minEnd`). `null` once it is back at now – it follows the time again.
 */
export function snapEnd(wanted: number, liveEnd: number, stepMs: number, minEnd: number) {
  const snapped = liveEnd - Math.round((liveEnd - wanted) / stepMs) * stepMs;
  const clamped = Math.min(liveEnd, Math.max(minEnd, snapped));
  return clamped >= liveEnd ? null : clamped;
}

/** The hour a stretch ends: midnight is 24, not 0. */
const endHour = (at: number) => new Date(at).getHours() || 24;

/** Where a point of the line starts (axis labels): the hour for hourly stretches, else the day. */
export const bucketStart = (bucket: InstanceBucket, stretchHours: number) =>
  stretchHours <= 1 ? `${new Date(bucket.start).getHours()} Uhr` : formatDay(bucket.start);

/**
 * What a point covers: "21. Okt., 14–15 Uhr", "21. Okt., 12–18 Uhr", "21. Okt." or
 * "3. Okt. – 9. Okt.".
 */
export function bucketSpan(bucket: InstanceBucket | undefined, stretchHours: number): string {
  if (!bucket) return '';
  const start = Date.parse(bucket.start);
  const end = start + stretchHours * HOUR_MS;
  if (stretchHours < 24) {
    return `${formatDay(start)}, ${new Date(start).getHours()}–${endHour(end)} Uhr`;
  }
  if (stretchHours === 24) return formatDay(start);
  return `${formatDay(start)} – ${formatDay(end - DAY_MS)}`;
}

/** "21. Sept. – 21. Okt." – the window, its last day included; a day with its hours. */
export const windowSpan = (from: number, to: number) =>
  to - from <= DAY_MS
    ? `${formatDay(from)}, ${new Date(from).getHours()}–${endHour(to)} Uhr`
    : `${formatDay(from)} – ${formatDay(to - 1)}`;

/** Ticks of a count axis: 0, a round middle, a round top at or above `max`. */
export function countTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 2;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((f) => f * magnitude).find((s) => s >= rough) ?? rough;
  const top = Math.max(step * 2, Math.ceil(max / step) * step);
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

/** 1.284 / 129.000 / 1,3 Mio. – German compact notation shortens from a million on. */
const compact = new Intl.NumberFormat('de-DE', {
  notation: 'compact',
  maximumFractionDigits: 1,
  // Compact notation drops the thousands dot below 10.000 otherwise.
  useGrouping: 'always',
});
export const formatCount = (value: number) => compact.format(value);
