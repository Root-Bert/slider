import { and, eq, lt, lte } from 'drizzle-orm';
import { users, type UserRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { inviteMail } from '../mail/mailer';
import { deleteAccount, justAfter } from './account-deletion';
import { dataRequestToken, dataRequestUrl, sendMail } from './data-requests';
import { addMonths, DAY_MS, formatDate, retentionStep, type Reminder } from './retention-rules';
import { laterOf, unusedDeletionSince } from './unused-deletion';

/**
 * Unused accounts are deleted (BER-147): nothing personal should stay around for nobody. Use
 * counts, not logins – every visit renews `users.last_active_at` (`markActive`). After a year
 * without any, a mail says the account goes in six months; more follow 3 months, 1 month,
 * 1 week, 3, 2 and 1 day before. Any use – or "Konto behalten" in a mail – starts over.
 *
 * - Only with `DELETE_UNUSED` on (setup page): the instance admin decides. Counted from switching
 *   it on at the earliest (`unused-deletion`): the reminders all go out first.
 * - Deleted after 18 months whatever the mails did: they only inform. Without mail delivery there
 *   are none; missed reminders are not made up (`retentionStep`).
 * - Instance admins and the dev login's account are never deleted.
 * - Where the account is the only admin, the longest-standing member with the highest role takes
 *   over (`'automatic'`), a viewer only if nobody else is left.
 */

/** Months without use until deletion. */
export const UNUSED_ACCOUNT_MONTHS = 18;

/** Reminders, in order, by how long before the deletion they go out. */
export const ACCOUNT_REMINDERS: readonly Reminder[] = [
  { months: 6, when: 'in 6 Monaten' },
  { months: 3, when: 'in 3 Monaten' },
  { months: 1, when: 'in einem Monat' },
  { days: 7, when: 'in einer Woche' },
  { days: 3, when: 'in 3 Tagen' },
  { days: 2, when: 'übermorgen' },
  { days: 1, when: 'morgen' },
];

/** Sends the due reminders and deletes accounts whose time ran out. */
export async function sweepUnusedAccounts(
  deps: AppDeps,
): Promise<{ reminded: string[]; deleted: string[] }> {
  const reminded: string[] = [];
  const deleted: string[] = [];
  const since = await unusedDeletionSince(deps);
  if (!since) return { reminded, deleted };
  const now = deps.clock.now();
  // The first reminder goes out 6 months before the deletion, i.e. after 12 months unused.
  const unusedSince = addMonths(now, -(UNUSED_ACCOUNT_MONTHS - 6));
  if (since > unusedSince) return { reminded, deleted };
  const candidates = await deps.db
    .select()
    .from(users)
    .where(and(lte(users.lastActiveAt, unusedSince), eq(users.isInstanceAdmin, false)));

  for (const user of candidates) {
    if (deps.config.auth.devLogin && user.id === deps.ownerId) continue;
    const deadline = addMonths(laterOf(user.lastActiveAt, since), UNUSED_ACCOUNT_MONTHS);
    // Reminders from before it was last switched on don't count: the round starts over.
    const fresh = user.inactivityNoticeAt !== null && user.inactivityNoticeAt >= since;
    const sent = fresh ? user.inactivityNotices : 0;
    const step = retentionStep(ACCOUNT_REMINDERS, deadline, now, sent);
    if (step?.action === 'delete') {
      try {
        if (!(await deleteAccount(deps, user.id, 'automatic', user.lastActiveAt))) continue;
        deleted.push(user.id);
        deps.log.info(
          `Deleted account ${user.id}, unused since ${user.lastActiveAt.toISOString()}`,
        );
      } catch (error) {
        deps.log.error(`Could not delete unused account ${user.id}`, error);
      }
    } else if (step?.action === 'remind' && deps.mailer.configured) {
      if (await sendMail(deps, reminderMail(deps, user, step.stage, step.deletesAt))) {
        await deps.db
          .update(users)
          .set({ inactivityNotices: step.stage + 1, inactivityNoticeAt: now })
          // Used meanwhile: `markActive` reset the count, which must stay so.
          .where(and(eq(users.id, user.id), lt(users.lastActiveAt, justAfter(user.lastActiveAt))));
        reminded.push(user.id);
      }
    }
  }
  return { reminded, deleted };
}

function reminderMail(deps: AppDeps, user: UserRow, stage: number, deletesAt: Date) {
  const when = ACCOUNT_REMINDERS[stage]?.when ?? 'bald';
  const token = dataRequestToken(deps.config.secret, {
    purpose: 'keep',
    email: user.email,
    userId: user.id,
    expiresAt: new Date(deletesAt.getTime() + DAY_MS),
  });
  return inviteMail({
    to: user.email,
    url: dataRequestUrl(deps, token),
    subject: `Dein Slider-Konto wird ${when} gelöscht`,
    heading: 'Konto behalten?',
    intro: `Du hast Slider seit über einem Jahr nicht genutzt. Ungenutzte Konten werden gelöscht, damit keine Daten unnötig liegen bleiben. Deins wird am ${formatDate(deletesAt)} gelöscht, mit deinen Präsentationen. Kommentare in fremden Präsentationen bleiben ohne deinen Namen.`,
    button: 'Konto behalten',
    outro:
      'Ein Klick genügt, oder melde dich einfach an. Eine Kopie deiner Daten bekommst du nach dem Anmelden unter „Konto & Anmeldung“.',
  });
}
