/** Times and days of messages, in German. */
const clock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const full = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export const timeOf = (iso: string) => clock.format(new Date(iso));

/** The day a message stands under: „Heute“, „Gestern“, else the date (with the year when not this one). */
export function dayOf(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const start = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const days = Math.round((start(now) - start(date)) / 86_400_000);
  if (days === 0) return 'Heute';
  if (days === 1) return 'Gestern';
  return date.getFullYear() === now.getFullYear() ? weekday.format(date) : full.format(date);
}

export const dayKey = (iso: string) => new Date(iso).toDateString();

/** The full time, for the tooltip of a message's time. */
export const stampOf = (iso: string) =>
  `${full.format(new Date(iso))}, ${clock.format(new Date(iso))}`;
