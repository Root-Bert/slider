/** German UI copy helpers – short, relative, like the Figma design ("vor 5 Min.", "gestern"). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const shortDate = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/** "3. Okt." – a day without the year (PowerPoint comments show their original date). */
export const formatShortDate = (iso: string): string => shortDate.format(new Date(iso));

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diff = now.getTime() - date.getTime();

  if (diff < MINUTE) return 'jetzt';
  if (diff < HOUR) return `vor ${Math.floor(diff / MINUTE)} Min.`;
  if (diff < DAY) return `vor ${Math.floor(diff / HOUR)} Std.`;
  if (diff < 2 * DAY) return 'gestern';
  if (diff < 7 * DAY) return `vor ${Math.floor(diff / DAY)} Tagen`;
  if (diff < 14 * DAY) return 'vor 1 Woche';
  return formatDay(date, now);
}

/** "3. Okt." – "3. Okt. 2025" outside the year of `now`. */
export function formatDay(at: Date | number | string, now: Date = new Date()): string {
  const date = new Date(at);
  return date.getFullYear() === now.getFullYear() ? shortDate.format(date) : longDate.format(date);
}

/** Absolute timestamp for tooltips (`title` attributes). */
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Upload sizes: whole KB (at least 1) below 1 MB, else MB with one decimal – `300` → `1 KB`,
 * `12.4 * 1024 * 1024` → `12,4 MB`. For recordings and storage use {@link formatFileSize}.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

/**
 * Recording and storage sizes from bytes up to GB; one decimal below 10 of a unit –
 * `512` → `512 B`, `1_536_000` → `1,5 MB`. Uploads use {@link formatBytes}.
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: digits })} ${units[unit]}`;
}

/** Media clock: `83_000` → `1:23`; negative → `0:00`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
