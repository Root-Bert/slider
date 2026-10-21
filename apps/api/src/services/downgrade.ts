import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { users, workspaceMembers, workspaces, type WorkspaceRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { inviteMail } from '../mail/mailer';
import { usagePageUrl } from './billing';
import { cancelSubscriptions } from './billing-owner';
import { DAY_MS, formatDate } from './retention-rules';

/**
 * Paid organisations without a working payment (BER-155): a failed payment, or a billing owner
 * who left before anyone else paid, gives 14 days (`workspaces.downgrade_at`) – the admins get a
 * mail right away, 7 days in and the day before. A subscription cancelled to the period end
 * falls back then, without mails (they chose it). When the time is up the organisation is free
 * again; over the free limits it is locked until it fits or someone pays (`plans`). Runs in the
 * hourly sweep (`retention`), no admin tool; data is never deleted for it.
 */

/** Mails before the switch: right away, then 7 days and 1 day before. */
const REMINDER_DAYS_BEFORE = [Number.POSITIVE_INFINITY, 7, 1] as const;

const reasonText = (row: WorkspaceRow) =>
  row.downgradeReason === 'owner_changed'
    ? 'Die Person, die bisher bezahlt hat, ist nicht mehr dabei.'
    : 'Die letzte Zahlung ist fehlgeschlagen.';

async function mailAdmins(deps: AppDeps, row: WorkspaceRow, deadline: Date | null) {
  if (!deps.mailer.configured) return;
  const admins = await deps.db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, row.id), eq(workspaceMembers.role, 'admin')));
  const url = usagePageUrl(deps.config.webOrigin, row.id);
  for (const admin of admins) {
    const message = deadline
      ? inviteMail({
          to: admin.email,
          subject: `„${row.name}“ wechselt am ${formatDate(deadline)} auf Free`,
          heading: 'Zahlungsmethode hinterlegen',
          intro: `${reasonText(row)} Hinterlege eine Zahlungsmethode, sonst wechselt „${row.name}“ am ${formatDate(deadline)} auf den Free-Plan.`,
          button: 'Zur Nutzung',
          url,
          outro:
            'Im Free-Plan bleibt alles erhalten. Liegt die Organisation dann über einem Limit, kann man nur noch lesen, löschen und upgraden.',
        })
      : inviteMail({
          to: admin.email,
          subject: `„${row.name}“ ist jetzt im Free-Plan`,
          heading: 'Jetzt im Free-Plan',
          intro: `${reasonText(row)} Deshalb ist „${row.name}“ jetzt im Free-Plan.`,
          button: 'Zur Nutzung',
          url,
          outro:
            'Es wurde nichts gelöscht. Über einem Limit gehen nur Lesen, Löschen und Upgraden, bis alles wieder passt oder jemand bezahlt.',
        });
    try {
      await deps.mailer.send(message);
    } catch (error) {
      deps.log.error(`Could not send the downgrade mail for ${row.id}`, error);
    }
  }
}

/** Reminders that are due, and organisations whose time is up. */
export async function sweepDowngrades(deps: AppDeps): Promise<void> {
  const now = deps.clock.now();
  const pending = await deps.db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.plan, 'paid'), isNotNull(workspaces.downgradeAt)));
  const toCancel: (string | null)[] = [];
  for (const row of pending) {
    const deadline = row.downgradeAt;
    if (!deadline) continue;
    if (deadline <= now) {
      const [switched] = await deps.db
        .update(workspaces)
        .set({
          plan: 'free',
          downgradeAt: null,
          downgradeReason: null,
          downgradeNotices: 0,
          stripeSubscriptionId: null,
          subscriptionStatus: row.stripeSubscriptionId ? 'canceled' : row.subscriptionStatus,
          cancelAtPeriodEnd: false,
        })
        // Only if nobody paid in the meantime.
        .where(and(eq(workspaces.id, row.id), lte(workspaces.downgradeAt, now)))
        .returning({ id: workspaces.id });
      if (!switched) continue;
      // Still retried by Stripe (past due): it would charge for a plan that is gone.
      toCancel.push(row.stripeSubscriptionId);
      if (row.downgradeReason !== 'canceled') await mailAdmins(deps, row, null);
      continue;
    }
    if (row.downgradeReason === 'canceled') continue;
    const step = REMINDER_DAYS_BEFORE[row.downgradeNotices];
    if (step === undefined || deadline.getTime() - now.getTime() > step * DAY_MS) continue;
    // Several steps due at once (the server was down): one mail, the later ones counted as sent.
    let notices = row.downgradeNotices + 1;
    while (
      notices < REMINDER_DAYS_BEFORE.length &&
      deadline.getTime() - now.getTime() <= (REMINDER_DAYS_BEFORE[notices] ?? 0) * DAY_MS
    )
      notices++;
    await deps.db
      .update(workspaces)
      .set({ downgradeNotices: notices })
      .where(eq(workspaces.id, row.id));
    await mailAdmins(deps, row, deadline);
  }
  await cancelSubscriptions(deps, toCancel);
}
