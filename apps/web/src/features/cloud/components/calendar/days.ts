/** Days as kept and shown: `YYYY-MM-DD` in local time, weeks from Monday (as in Germany). */

/** A day as kept (`YYYY-MM-DD`, local). */
export const iso = (day: Date) => day.toLocaleDateString('sv-SE');
/** Noon: no clock change moves it to another day. */
export const at = (day: string) => new Date(`${day}T12:00:00`);
export const noon = (year: number, month: number, date = 1) => new Date(year, month, date, 12);
export const plus = (day: Date, days: number) =>
  noon(day.getFullYear(), day.getMonth(), day.getDate() + days);
export const sameMonth = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
export const startOfMonth = (day: Date) => noon(day.getFullYear(), day.getMonth());
export const addMonths = (month: Date, by: number) =>
  noon(month.getFullYear(), month.getMonth() + by);
export const todayNoon = () => {
  const now = new Date();
  return noon(now.getFullYear(), now.getMonth(), now.getDate());
};

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const monthFormat = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
export const dayFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** The month's weeks, Monday first: as many as it reaches into (four to six). */
export function monthDays(month: Date) {
  const first = plus(month, -((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => plus(first, index));
  while (days.length > 28 && days.slice(-7).every((day) => !sameMonth(day, month))) days.splice(-7);
  return days;
}

/** The Monday of the day's week. */
export const startOfWeek = (day: Date) => plus(day, -((day.getDay() + 6) % 7));

/** The ISO week („KW“): the week holding the year's first Thursday is the first. */
export function weekNumber(day: Date) {
  const thursday = plus(day, 3 - ((day.getDay() + 6) % 7));
  const firstThursday = plus(noon(thursday.getFullYear(), 0, 4), 0);
  return (
    1 +
    Math.round(
      (startOfWeek(thursday).getTime() - startOfWeek(firstThursday).getTime()) / (7 * 86_400_000),
    )
  );
}

/** Midnight at the start of the day, local – where its hours begin. */
export const midnight = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate());
export const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
/** `HH:MM` of an instant, local. */
export const clock = (at: Date) => timeFormat.format(at);
