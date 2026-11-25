/*
 * „Später senden“: the times a right click on „Senden“ offers, and the day and time typed in
 * („Zeit wählen …“) – local time, as the clock on the wall.
 */

const at9 = (from: Date, days: number) => {
  const day = new Date(from);
  day.setDate(day.getDate() + days);
  day.setHours(9, 0, 0, 0);
  return day;
};

/** „In 1 Stunde“, „Morgen um 9:00“, „Montag um 9:00“ (not on a Sunday: that is tomorrow). */
export function laterChoices(now = new Date()): { label: string; at: Date }[] {
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { label: 'In 1 Stunde', at: new Date(now.getTime() + 3_600_000) },
    { label: 'Morgen um 9:00', at: at9(now, 1) },
    ...(toMonday > 1 ? [{ label: 'Montag um 9:00', at: at9(now, toMonday) }] : []),
  ];
}

const pad = (value: number) => String(value).padStart(2, '0');
/** A day for `<input type="date">`: 2026-11-25. */
export const dayInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** A time for `<input type="time">`: 09:00. */
export const timeInput = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** The day and time typed in, as a moment – `null` while one is incomplete. */
export function fromInputs(day: string, time: string): Date | null {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  if (!year || !month || !date || hours === undefined || minutes === undefined) return null;
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return new Date(year, month - 1, date, hours, minutes);
}

const clock = new Intl.DateTimeFormat('de-DE', { hour: 'numeric', minute: '2-digit' });
const dated = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
});

/** When a planned message goes: „heute um 14:30“, „morgen um 9:00“, „Mo., 30.11. um 9:00“. */
export function whenPlanned(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const start = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const days = Math.round((start(date) - start(now)) / 86_400_000);
  const day = days === 0 ? 'heute' : days === 1 ? 'morgen' : dated.format(date);
  return `${day} um ${clock.format(date)}`;
}
