/** German UI copy helpers – short, relative, like the Figma design ("vor 5 Min.", "gestern"). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const shortDate = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diff = now.getTime() - date.getTime();

  if (diff < MINUTE) return 'jetzt';
  if (diff < HOUR) return `vor ${Math.floor(diff / MINUTE)} Min.`;
  if (diff < DAY) return `vor ${Math.floor(diff / HOUR)} Std.`;
  if (diff < 2 * DAY) return 'gestern';
  if (diff < 7 * DAY) return `vor ${Math.floor(diff / DAY)} Tagen`;
  if (diff < 14 * DAY) return 'vor 1 Woche';
  return date.getFullYear() === now.getFullYear() ? shortDate.format(date) : longDate.format(date);
}

/** Absolute timestamp for tooltips (`title` attributes). */
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}
