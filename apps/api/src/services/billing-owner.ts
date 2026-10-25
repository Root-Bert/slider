import { and, asc, eq, ne } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { workspaceMembers, workspaces, type WorkspaceRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, forbidden } from '../http/errors';
import { DAY_MS } from './retention-rules';

/**
 * Who pays for a workspace (BER-154): one admin, the billing owner, apart from the admin
 * role. When they leave – account deleted, left, removed or no admin any more – the role passes
 * on by itself: to the longest-standing other admin, else the longest-standing person, who is
 * made admin. A paid subscription is the old owner's and ends; the new owner has the grace
 * period (`services/downgrade`) to pay, else the workspace falls back to free (BER-155).
 */

/** Grace period before a paid workspace without payment falls back to free (BER-155). */
export const DOWNGRADE_GRACE_DAYS = 14;

export const graceEnd = (now: Date) => new Date(now.getTime() + DOWNGRADE_GRACE_DAYS * DAY_MS);

/** Stripe statuses of a subscription that is over: nothing runs, nothing to pay. */
export const ENDED_STATUSES: ReadonlySet<string> = new Set(['canceled', 'incomplete_expired']);

/** A paid workspace whose subscription still runs – its billing owner pays for it. */
export const isPaying = (
  row: Pick<WorkspaceRow, 'plan' | 'stripeSubscriptionId' | 'subscriptionStatus'>,
) =>
  row.plan === 'paid' &&
  row.stripeSubscriptionId !== null &&
  !ENDED_STATUSES.has(row.subscriptionStatus ?? '');

/**
 * A subscription that renews – the one the guards below protect. One cancelled for the end of the
 * period ends anyway: its billing owner may go (and the workspace be deleted) before that.
 */
export const isRenewing = (
  row: Pick<
    WorkspaceRow,
    'plan' | 'stripeSubscriptionId' | 'subscriptionStatus' | 'cancelAtPeriodEnd'
  >,
) => isPaying(row) && !row.cancelAtPeriodEnd;

/** The refusal when the paying admin would go: they hand over paying first (under „Nutzung“). */
export const paidOwnerStays = (self: boolean) =>
  badRequest(
    self
      ? 'Du bezahlst für den Workspace. Übergib zuerst die Zahlung an einen anderen Admin (unter „Nutzung“).'
      : 'Diese Person bezahlt für den Workspace. Sie muss zuerst die Zahlung an einen anderen Admin übergeben (unter „Nutzung“).',
  );

/**
 * While a subscription runs, whoever pays for it stays (BER-154): they can't step down, leave or
 * be removed, and their account can't be deleted from under it – any of that would end the
 * subscription the others work with. They hand over paying first. Free workspaces, and one
 * whose subscription is cancelled for the end of the period, just pass the role on
 * ({@link reassignBillingOwner}). Call it under the workspace lock.
 */
export async function assertBillingOwnerMayGo(
  tx: Executor,
  workspaceId: string,
  userId: string,
  self: boolean,
): Promise<void> {
  const [row] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (row?.billingOwnerId === userId && isRenewing(row)) throw paidOwnerStays(self);
}

/**
 * Deleting a paid workspace ends its subscription: while one runs, only the person paying
 * for it decides that – not another admin.
 */
export async function assertMayDeletePaid(
  db: Executor,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (row && isRenewing(row) && row.billingOwnerId !== userId) {
    throw forbidden(
      'Nur die Person, die für den Workspace bezahlt, kann ihn löschen – dabei endet das laufende Abo.',
    );
  }
}

export interface BillingHandover {
  /** The new billing owner; `null` when nobody else is left. */
  newOwnerId: string | null;
  /** The old owner's subscription, to cancel at Stripe once the transaction committed. */
  cancelSubscriptionId: string | null;
}

/**
 * The longest-standing other admin, else the longest-standing other person. `promoted` counts as
 * admin already – the successor a leaving last admin names, for the preview before they go.
 */
export async function successorOf(
  tx: Executor,
  workspaceId: string,
  leaverId: string,
  promoted?: string,
): Promise<{ userId: string; isAdmin: boolean } | null> {
  const rows = await tx
    .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), ne(workspaceMembers.userId, leaverId)),
    )
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.userId));
  const admin = rows.find((row) => row.role === 'admin' || row.userId === promoted);
  if (admin) return { userId: admin.userId, isAdmin: true };
  const first = rows[0];
  return first ? { userId: first.userId, isAdmin: false } : null;
}

/**
 * Inside the transaction that takes `leaverId` out of the billing owner's place (call it while
 * the workspace row is locked). Nothing happens when they are not the billing owner – except
 * that a handover asked of them is dropped.
 */
export async function reassignBillingOwner(
  tx: Executor,
  workspaceId: string,
  leaverId: string,
  now: Date,
): Promise<BillingHandover> {
  const [row] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  const none: BillingHandover = { newOwnerId: null, cancelSubscriptionId: null };
  if (!row) return none;
  if (row.billingOwnerId !== leaverId && row.billingOwnerId !== null) {
    if (row.billingTransferToId === leaverId) {
      await tx
        .update(workspaces)
        .set({ billingTransferToId: null, billingTransferAt: null })
        .where(eq(workspaces.id, workspaceId));
    }
    return none;
  }
  const successor = await successorOf(tx, workspaceId, leaverId);
  if (!successor) return none;
  if (!successor.isAdmin) {
    await tx
      .update(workspaceMembers)
      .set({ role: 'admin' })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, successor.userId),
        ),
      );
  }
  // A running subscription is the old owner's: it ends, the new owner pays within the grace.
  const paying = row.plan === 'paid' && row.stripeSubscriptionId !== null;
  await tx
    .update(workspaces)
    .set({
      billingOwnerId: successor.userId,
      billingTransferToId: null,
      billingTransferAt: null,
      ...(paying
        ? {
            stripeSubscriptionId: null,
            stripeCustomerId: null,
            // Not null: that would read as "never subscribed" and offer the trial again.
            subscriptionStatus: 'canceled',
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            downgradeAt: graceEnd(now),
            downgradeReason: 'owner_changed' as const,
            downgradeNotices: 0,
          }
        : {}),
    })
    .where(eq(workspaces.id, workspaceId));
  return {
    newOwnerId: successor.userId,
    cancelSubscriptionId: paying ? row.stripeSubscriptionId : null,
  };
}

/** After the transaction: ends a subscription that nobody pays for any more. Best effort. */
export async function cancelSubscriptions(
  deps: Pick<AppDeps, 'billing' | 'log'>,
  ids: readonly (string | null)[],
): Promise<void> {
  for (const id of ids) {
    if (!id) continue;
    try {
      await deps.billing?.cancelSubscription(id);
    } catch (error) {
      deps.log.error(`Could not cancel Stripe subscription ${id}`, error);
    }
  }
}
