import type { CloudAgentRepeatRule } from '@slider/shared';

/** The date and time a moment is in a time zone. */
function inZone(zone: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const of = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: of('year'),
    month: of('month'),
    day: of('day'),
    hour: of('hour'),
    minute: of('minute'),
  };
}

/** The moment at which a zone's clock shows this date and time. */
function fromZone(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  // Twice: the first step may cross a change of the clock, the second lands.
  for (let step = 0; step < 2; step += 1) {
    const shown = inZone(zone, new Date(guess));
    guess -= Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute) - wanted;
  }
  return new Date(guess);
}

/** The moment a zone's clock shows `YYYY-MM-DD` and `HH:MM`. */
export function atInZone(zone: string, day: string, time: string): Date {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return fromZone(zone, year, month, date, hour, minute);
}

/** Whether the name is a time zone this server knows. */
export function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * When a repeated order runs next after a moment: the next day that fits its rhythm, at its
 * time on the clock of the person's zone – so 08:00 stays 08:00 over summer and winter time.
 */
export function nextRun(rule: CloudAgentRepeatRule, after: Date): Date {
  const [hour = 0, minute = 0] = rule.at.split(':').map(Number);
  const today = inZone(rule.zone, after);
  for (let ahead = 0; ahead <= 8; ahead += 1) {
    // The calendar day `ahead` days on, whatever the month's length.
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead));
    const weekday = day.getUTCDay();
    if (rule.every === 'weekdays' && (weekday === 0 || weekday === 6)) continue;
    if (rule.every === 'week' && weekday !== (rule.day ?? 1)) continue;
    const at = fromZone(
      rule.zone,
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      hour,
      minute,
    );
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error(`No next run for ${JSON.stringify(rule)}`);
}
