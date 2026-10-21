/** Date arithmetic and reminder steps for the deletion deadlines (`retention`, BER-143). */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Invitations stay this long after they expired, were accepted or withdrawn (shown as such). */
export const INVITE_KEEP_DAYS = 30;

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export interface Reminder {
  months?: number;
  days?: number;
  /** "in 6 Monaten", "morgen" – for the subject. */
  when: string;
}

export const reminderTime = (deadline: Date, { months = 0, days = 0 }: Reminder) =>
  new Date(addMonths(deadline, -months).getTime() - days * DAY_MS);

export const formatDate = (date: Date) =>
  date.toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  });

/**
 * What to do now for something due for deletion at `deadline`, with `sent` reminders out: delete
 * once the deadline is reached – reminders only inform, none is waited for – else send reminder
 * `stage` (the latest due; missed ones are not made up), or nothing.
 */
export function retentionStep(
  reminders: readonly Reminder[],
  deadline: Date,
  now: Date,
  sent: number,
): { action: 'remind'; stage: number; deletesAt: Date } | { action: 'delete' } | null {
  if (now >= deadline) return { action: 'delete' };
  let stage = -1;
  reminders.forEach((reminder, index) => {
    if (now >= reminderTime(deadline, reminder)) stage = index;
  });
  if (stage < 0 || stage < sent) return null;
  return { action: 'remind', stage, deletesAt: deadline };
}
