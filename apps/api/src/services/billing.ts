import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import type {
  BillingRedirect,
  BillingTransferAcceptResult,
  WorkspaceBilling,
  WorkspaceUsageDetails,
} from '@slider/shared';
import type { Executor } from '../db/client';
import { stripeEvents, users, workspaces, type WorkspaceRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, forbidden } from '../http/errors';
import { inviteMail } from '../mail/mailer';
import { toSubscriptionInfo, type SubscriptionInfo } from '../billing/stripe-billing';
import { cancelSubscriptions, ENDED_STATUSES, graceEnd, isPaying } from './billing-owner';
import { isOverLimit, lockWorkspaceRow, workspaceUsages } from './plans';
import { workspaceStorageUsage } from './workspace-storage';
import { getRole, requireRole, workspaceNotFound } from './workspaces/roles';

/**
 * The paid plan through Stripe Billing (BER-152), paid per organisation by its billing owner
 * (BER-154). Slider never sees payment data: Checkout takes the payment method, the customer
 * portal manages it, and signed webhooks switch `workspaces.plan`. Without Stripe (self-hosting,
 * `config.billing` null) none of this exists – no limits, nothing to pay.
 */

type BillingDeps = Pick<AppDeps, 'db' | 'config' | 'clock' | 'billing' | 'mailer' | 'log'>;

const ACTIVE_STATUSES = new Set(['active', 'trialing']);
/** The first subscription of an organisation starts with this many days of Paid, no card needed. */
export const TRIAL_DAYS = 14;
/** Stripe still retries the payment: paid for now, the grace period runs (BER-155). */
const FAILING_STATUSES = new Set(['past_due', 'unpaid', 'incomplete']);

const notConfigured = () =>
  new ApiError(404, 'not_found', 'Auf dieser Instanz gibt es keine Bezahlung.');
const ownerOnly = () =>
  forbidden(
    'Nur die Person, die für die Organisation bezahlt, kann das. Frag sie oder übernimm die Zahlung.',
  );

function requireProvider(deps: BillingDeps) {
  if (!deps.config.billing || !deps.billing) throw notConfigured();
  return deps.billing;
}

/** `/nutzung?organisation=<id>` – where checkout and portal lead back to. */
export const usagePageUrl = (webOrigin: string, workspaceId: string, extra = '') =>
  `${webOrigin}/nutzung?organisation=${encodeURIComponent(workspaceId)}${extra}`;

// ── DTOs ────────────────────────────────────────────────────────────────────

type BillingColumns = Pick<
  WorkspaceRow,
  | 'id'
  | 'plan'
  | 'billingOwnerId'
  | 'billingTransferToId'
  | 'billingTransferAt'
  | 'stripeSubscriptionId'
  | 'subscriptionStatus'
  | 'currentPeriodEnd'
  | 'cancelAtPeriodEnd'
  | 'downgradeAt'
  | 'downgradeReason'
>;

/** Names of the billing owners and asked admins of these workspaces, by user id. */
export async function billingNames(
  db: Executor,
  rows: readonly BillingColumns[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(rows.flatMap((row) => [row.billingOwnerId, row.billingTransferToId])),
  ].filter((id): id is string => id !== null);
  if (ids.length === 0) return new Map();
  const found = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(found.map((user) => [user.id, user.name]));
}

export function toBillingDto(
  row: BillingColumns,
  viewerId: string,
  names: ReadonlyMap<string, string>,
  enabled: boolean,
): WorkspaceBilling {
  const person = (id: string | null) =>
    id && names.has(id) ? { id, name: names.get(id) ?? '' } : null;
  const subscribed = row.stripeSubscriptionId !== null;
  const trialing = subscribed && row.subscriptionStatus === 'trialing';
  const transferTo = person(row.billingTransferToId);
  return {
    enabled,
    owner: person(row.billingOwnerId),
    isOwner: row.billingOwnerId === viewerId,
    status: subscribed ? row.subscriptionStatus : null,
    renewsAt:
      subscribed && !trialing && !row.cancelAtPeriodEnd && row.currentPeriodEnd
        ? row.currentPeriodEnd.toISOString()
        : null,
    // Never subscribed: the status is set by the first checkout and never cleared again.
    trialAvailable: enabled && row.subscriptionStatus === null,
    trialEndsAt: trialing && row.currentPeriodEnd ? row.currentPeriodEnd.toISOString() : null,
    endsAt:
      subscribed && row.cancelAtPeriodEnd && row.currentPeriodEnd
        ? row.currentPeriodEnd.toISOString()
        : null,
    downgradeAt: row.downgradeAt?.toISOString() ?? null,
    downgradeReason: row.downgradeReason,
    transfer:
      transferTo && row.billingTransferAt
        ? { to: transferTo, requestedAt: row.billingTransferAt.toISOString() }
        : null,
  };
}

async function loadWorkspace(db: Executor, workspaceId: string): Promise<WorkspaceRow> {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!row) throw workspaceNotFound();
  return row;
}

/** `GET /workspaces/:id/usage` – members only. */
export async function getUsageDetails(
  deps: BillingDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceUsageDetails> {
  await requireRole(deps.db, workspaceId, userId);
  const row = await loadWorkspace(deps.db, workspaceId);
  const [usages, storage, names] = await Promise.all([
    workspaceUsages(deps.db, deps.config, [row], deps.clock.now()),
    workspaceStorageUsage(deps.db, workspaceId),
    billingNames(deps.db, [row]),
  ]);
  const usage = usages.get(workspaceId);
  if (!usage) throw workspaceNotFound();
  return {
    workspaceId,
    plan: row.plan,
    usage,
    storage,
    billing: toBillingDto(row, userId, names, deps.config.billing !== null),
    locked: isOverLimit(usage),
  };
}

// ── Checkout and portal ─────────────────────────────────────────────────────

/** The billing owner (an admin); with nobody set yet, any admin – they become it by paying. */
async function requireBillingOwner(
  deps: BillingDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRow> {
  await requireRole(deps.db, workspaceId, userId, 'admin', ownerOnly().message);
  const row = await loadWorkspace(deps.db, workspaceId);
  if (row.billingOwnerId !== null && row.billingOwnerId !== userId) throw ownerOnly();
  return row;
}

async function userOf(db: Executor, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`User ${userId} vanished`);
  return user;
}

/** `POST /workspaces/:id/billing/checkout`: Stripe Checkout for the paid plan. */
export async function startCheckout(
  deps: BillingDeps,
  userId: string,
  workspaceId: string,
): Promise<BillingRedirect> {
  const provider = requireProvider(deps);
  const row = await requireBillingOwner(deps, userId, workspaceId);
  if (row.stripeSubscriptionId && !ENDED_STATUSES.has(row.subscriptionStatus ?? '')) {
    throw badRequest(
      row.cancelAtPeriodEnd
        ? 'Das Abo ist zum Periodenende gekündigt. Unter „Zahlung verwalten“ kannst du es fortsetzen.'
        : 'Die Organisation ist bereits im Paid-Plan. Zahlungsmethode und Rechnungen findest du unter „Zahlung verwalten“.',
    );
  }
  let customerId = row.billingOwnerId === userId ? row.stripeCustomerId : null;
  if (!customerId) {
    const user = await userOf(deps.db, userId);
    customerId = await provider.createCustomer({ email: user.email, name: user.name, workspaceId });
    await deps.db
      .update(workspaces)
      .set({ stripeCustomerId: customerId, billingOwnerId: userId })
      .where(eq(workspaces.id, workspaceId));
  }
  const url = await provider.createCheckout({
    customerId,
    workspaceId,
    userId,
    purpose: 'upgrade',
    ...(row.subscriptionStatus === null ? { trialDays: TRIAL_DAYS } : {}),
    successUrl: usagePageUrl(deps.config.webOrigin, workspaceId, '&checkout=success'),
    cancelUrl: usagePageUrl(deps.config.webOrigin, workspaceId),
  });
  return { url };
}

/** `POST /workspaces/:id/billing/portal`: payment methods, invoices, cancelling. */
export async function openPortal(
  deps: BillingDeps,
  userId: string,
  workspaceId: string,
): Promise<BillingRedirect> {
  const provider = requireProvider(deps);
  const row = await requireBillingOwner(deps, userId, workspaceId);
  if (!row.stripeCustomerId) throw badRequest('Für diese Organisation wurde noch nie bezahlt.');
  return {
    url: await provider.createPortal({
      customerId: row.stripeCustomerId,
      returnUrl: usagePageUrl(deps.config.webOrigin, workspaceId),
    }),
  };
}

// ── Handing over (BER-154) ──────────────────────────────────────────────────

/**
 * `POST /workspaces/:id/billing/transfer`: the billing owner asks another admin to pay from now
 * on. Free organisations hand over at once – there is nothing to pay. Paid ones only once the
 * admin paid through their own checkout ({@link acceptTransfer}); until then nothing changes.
 */
export async function requestTransfer(
  deps: BillingDeps,
  userId: string,
  workspaceId: string,
  targetId: string,
): Promise<WorkspaceUsageDetails> {
  await requireBillingOwner(deps, userId, workspaceId);
  if (targetId === userId) throw badRequest('Du bezahlst schon für diese Organisation.');
  if ((await getRole(deps.db, workspaceId, targetId)) !== 'admin') {
    throw badRequest(
      'Die Zahlung kann nur ein anderer Admin übernehmen. Ernenne die Person zuerst.',
    );
  }
  const now = deps.clock.now();
  const handedOver = await deps.db.transaction(async (tx) => {
    await lockWorkspaceRow(tx, workspaceId);
    const row = await loadWorkspace(tx, workspaceId);
    if (!isPaying(row)) {
      await tx
        .update(workspaces)
        .set({ billingOwnerId: targetId, billingTransferToId: null, billingTransferAt: null })
        .where(eq(workspaces.id, workspaceId));
      return true;
    }
    await tx
      .update(workspaces)
      .set({ billingTransferToId: targetId, billingTransferAt: now })
      .where(eq(workspaces.id, workspaceId));
    return false;
  });
  if (!handedOver) await mailTransferRequest(deps, userId, workspaceId, targetId);
  return getUsageDetails(deps, userId, workspaceId);
}

async function mailTransferRequest(
  deps: BillingDeps,
  fromId: string,
  workspaceId: string,
  targetId: string,
): Promise<void> {
  if (!deps.mailer.configured) return;
  try {
    const [from, target, row] = await Promise.all([
      userOf(deps.db, fromId),
      userOf(deps.db, targetId),
      loadWorkspace(deps.db, workspaceId),
    ]);
    await deps.mailer.send(
      inviteMail({
        to: target.email,
        subject: `${from.name} bittet dich, die Zahlung für „${row.name}“ zu übernehmen`,
        heading: 'Zahlung übernehmen',
        intro: `${from.name} bezahlt bisher für „${row.name}“ auf Slider und möchte das an dich übergeben. Sobald du deine Zahlungsmethode hinterlegt hast, läuft das Abo über dich.`,
        button: 'Anfrage ansehen',
        url: usagePageUrl(deps.config.webOrigin, workspaceId),
        outro: 'Bis dahin ändert sich nichts. Du kannst die Anfrage auch ablehnen.',
      }),
    );
  } catch (error) {
    deps.log.error(`Could not send the billing handover mail for ${workspaceId}`, error);
  }
}

/** `DELETE /workspaces/:id/billing/transfer`: withdrawn by the owner, or declined by the asked admin. */
export async function cancelTransfer(
  deps: BillingDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceUsageDetails> {
  await requireRole(deps.db, workspaceId, userId);
  const row = await loadWorkspace(deps.db, workspaceId);
  if (row.billingOwnerId !== userId && row.billingTransferToId !== userId) throw ownerOnly();
  await deps.db
    .update(workspaces)
    .set({ billingTransferToId: null, billingTransferAt: null })
    .where(eq(workspaces.id, workspaceId));
  return getUsageDetails(deps, userId, workspaceId);
}

/**
 * `POST /workspaces/:id/billing/transfer/accept` (the asked admin): on a paid organisation their
 * own checkout – once paid, the webhook makes them the owner and ends the old subscription. On a
 * free one (it fell back meanwhile) the handover is done at once.
 */
export async function acceptTransfer(
  deps: BillingDeps,
  userId: string,
  workspaceId: string,
): Promise<BillingTransferAcceptResult> {
  await requireRole(deps.db, workspaceId, userId, 'admin');
  const row = await loadWorkspace(deps.db, workspaceId);
  if (row.billingTransferToId !== userId) {
    throw badRequest('Diese Anfrage gibt es nicht mehr.');
  }
  if (!isPaying(row)) {
    await deps.db
      .update(workspaces)
      .set({ billingOwnerId: userId, billingTransferToId: null, billingTransferAt: null })
      .where(eq(workspaces.id, workspaceId));
    return { url: null, details: await getUsageDetails(deps, userId, workspaceId) };
  }
  const provider = requireProvider(deps);
  const user = await userOf(deps.db, userId);
  const customerId = await provider.createCustomer({
    email: user.email,
    name: user.name,
    workspaceId,
  });
  const url = await provider.createCheckout({
    customerId,
    workspaceId,
    userId,
    purpose: 'transfer',
    successUrl: usagePageUrl(deps.config.webOrigin, workspaceId, '&checkout=success'),
    cancelUrl: usagePageUrl(deps.config.webOrigin, workspaceId),
  });
  return { url, details: await getUsageDetails(deps, userId, workspaceId) };
}

// ── Webhook ─────────────────────────────────────────────────────────────────

const idOf = (value: string | { id: string } | null | undefined) =>
  value == null ? null : typeof value === 'string' ? value : value.id;

/**
 * Applies a subscription's state to its workspace (BER-152, BER-155): active → paid; payment
 * failing → paid with the 14-day grace; cancelled to the period end → free from then on; ended →
 * free, unless a payment grace still runs (the sweep switches when it ends).
 */
function subscriptionState(
  row: WorkspaceRow,
  sub: { status: string; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean },
  now: Date,
): Partial<WorkspaceRow> {
  const base = {
    subscriptionStatus: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };
  if (ENDED_STATUSES.has(sub.status)) {
    const graceRuns = row.downgradeAt !== null && row.downgradeAt > now;
    return {
      ...base,
      stripeSubscriptionId: null,
      cancelAtPeriodEnd: false,
      ...(graceRuns
        ? {}
        : { plan: 'free', downgradeAt: null, downgradeReason: null, downgradeNotices: 0 }),
    };
  }
  if (FAILING_STATUSES.has(sub.status)) {
    return {
      ...base,
      plan: 'paid',
      ...(row.downgradeReason === 'payment_failed' && row.downgradeAt
        ? {}
        : { downgradeAt: graceEnd(now), downgradeReason: 'payment_failed', downgradeNotices: 0 }),
    };
  }
  if (sub.cancelAtPeriodEnd) {
    return {
      ...base,
      plan: 'paid',
      downgradeAt: sub.currentPeriodEnd ?? now,
      downgradeReason: 'canceled',
      downgradeNotices: 0,
    };
  }
  if (ACTIVE_STATUSES.has(sub.status)) {
    return { ...base, plan: 'paid', downgradeAt: null, downgradeReason: null, downgradeNotices: 0 };
  }
  return base;
}

/**
 * `POST /billing/webhook` after the signature check. Each event once (`stripe_events`, in the
 * same transaction as its effect, so a failure lets Stripe's retry run it again).
 */
export async function handleStripeEvent(deps: BillingDeps, event: Stripe.Event): Promise<void> {
  const provider = requireProvider(deps);
  const now = deps.clock.now();
  const toCancel: (string | null)[] = [];

  // Read from Stripe before the transaction: no network call while rows are locked.
  let checkout: {
    workspaceId: string;
    userId: string;
    customerId: string;
    subscription: SubscriptionInfo;
  } | null = null;
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const workspaceId = session.metadata?.['workspaceId'];
    const userId = session.metadata?.['userId'];
    const subscriptionId = idOf(session.subscription);
    const customerId = idOf(session.customer);
    if (session.mode === 'subscription' && workspaceId && userId && subscriptionId && customerId) {
      const subscription = await provider.getSubscription(subscriptionId);
      // Unknown to Stripe: nothing to claim – an error would only make Stripe retry for days.
      if (subscription) checkout = { workspaceId, userId, customerId, subscription };
    }
  }
  // Stripe doesn't keep events in order, and a failed delivery comes again hours later: what
  // counts is the subscription as it is now, not as the event saw it. Deleted is final. One
  // Stripe no longer knows (`null`) is taken as the event has it.
  const current =
    event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated'
      ? await provider.getSubscription(event.data.object.id)
      : null;
  // Same for a failed payment: one delivered late, after the card worked, starts no grace. One
  // Stripe no longer knows is taken as the invoice has it: failed.
  const failedSubscriptionId =
    event.type === 'invoice.payment_failed'
      ? idOf(event.data.object.parent?.subscription_details?.subscription)
      : null;
  const failingStatus = failedSubscriptionId
    ? ((await provider.getSubscription(failedSubscriptionId))?.status ?? 'past_due')
    : null;

  await deps.db.transaction(async (tx) => {
    const [fresh] = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (!fresh) return;

    switch (event.type) {
      case 'checkout.session.completed': {
        if (!checkout) return;
        const { workspaceId, userId, customerId, subscription } = checkout;
        if (!(await lockWorkspaceRow(tx, workspaceId))) {
          toCancel.push(subscription.id);
          return;
        }
        const row = await loadWorkspace(tx, workspaceId);
        // Paid by someone no longer an admin there: nobody to own it, so it ends again.
        if ((await getRole(tx, workspaceId, userId)) !== 'admin') {
          toCancel.push(subscription.id);
          return;
        }
        if (row.stripeSubscriptionId && row.stripeSubscriptionId !== subscription.id) {
          toCancel.push(row.stripeSubscriptionId);
        }
        await tx
          .update(workspaces)
          .set({
            ...subscriptionState(row, subscription, now),
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            billingOwnerId: userId,
            billingTransferToId: null,
            billingTransferAt: null,
          })
          .where(eq(workspaces.id, workspaceId));
        return;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const [row] = await tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.stripeSubscriptionId, subscription.id))
          .for('update');
        // Not (or no longer) any workspace's subscription – its checkout event claims a new one.
        if (!row) return;
        const info = current ?? toSubscriptionInfo(subscription);
        if (event.type === 'customer.subscription.deleted') info.status = 'canceled';
        await tx
          .update(workspaces)
          .set(subscriptionState(row, info, now))
          .where(eq(workspaces.id, row.id));
        return;
      }
      case 'invoice.payment_failed': {
        if (!failedSubscriptionId || !FAILING_STATUSES.has(failingStatus ?? '')) return;
        const [row] = await tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.stripeSubscriptionId, failedSubscriptionId))
          .for('update');
        if (!row || (row.downgradeReason === 'payment_failed' && row.downgradeAt)) return;
        await tx
          .update(workspaces)
          .set({
            downgradeAt: graceEnd(now),
            downgradeReason: 'payment_failed',
            downgradeNotices: 0,
          })
          .where(eq(workspaces.id, row.id));
        return;
      }
      default:
        return;
    }
  });
  await cancelSubscriptions(deps, toCancel);
}
