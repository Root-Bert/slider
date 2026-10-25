import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  billingRedirectSchema,
  billingTransferAcceptResultSchema,
  workspaceSchema,
  workspaceUsageDetailsSchema,
  type WorkspaceRole,
} from '@slider/shared';
import { users, workspaceMembers, workspaces } from '../src/db/schema';
import { RecordingMailer } from '../src/mail/mailer';
import { deleteAccount } from '../src/services/account-deletion';
import { DOWNGRADE_GRACE_DAYS } from '../src/services/billing-owner';
import { deleteRequested } from '../src/services/data-requests';
import { sweepDowngrades } from '../src/services/downgrade';
import {
  BILLING_TEST_CONFIG,
  FakeBilling,
  GOOD_SIGNATURE,
  stripeEvents,
  stripeSubscription,
} from './billing-helpers';
import { createTestContext, signedInUser, type TestContext } from './helpers';

/** BER-152 (paid plan through Stripe), BER-154 (billing owner), BER-155 (grace period). */

const DAY = 86_400_000;
let ctx: TestContext;
let stripe: FakeBilling;
let mailer: RecordingMailer;

beforeEach(async () => {
  stripe = new FakeBilling();
  mailer = new RecordingMailer();
  ctx = await createTestContext({
    config: { billing: BILLING_TEST_CONFIG },
    billing: stripe,
    mailer,
  });
});
afterEach(() => ctx.cleanup());

async function person(name: string, role: WorkspaceRole = 'admin') {
  const user = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: user.user.id, role });
  return user;
}

const post = (path: string, cookie?: string, json?: unknown) =>
  ctx.request(`/api/workspaces/${ctx.workspaceId}${path}`, { method: 'POST', cookie, json });

const row = async () =>
  (await ctx.deps.db.select().from(workspaces).where(eq(workspaces.id, ctx.workspaceId)))[0]!;

const details = async (cookie?: string) =>
  workspaceUsageDetailsSchema.parse(
    await (await ctx.request(`/api/workspaces/${ctx.workspaceId}/usage`, { cookie })).json(),
  );

const webhook = (event: unknown, signature = GOOD_SIGNATURE) =>
  ctx.request('/api/billing/webhook', {
    method: 'POST',
    headers: { 'Stripe-Signature': signature },
    body: JSON.stringify(event),
  });

/** The dev owner upgrades through checkout and Stripe confirms it. */
async function upgrade(subscription = 'sub_1', customer = 'cus_1') {
  stripe.subscriptions.set(subscription, {
    id: subscription,
    customerId: customer,
    status: 'active',
    currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    cancelAtPeriodEnd: false,
  });
  const res = await webhook(
    stripeEvents.checkoutCompleted({
      workspaceId: ctx.workspaceId,
      userId: ctx.ownerId,
      subscription,
      customer,
    }),
  );
  expect(res.status).toBe(200);
}

/** The running subscription is Ada's (the dev owner can't delete their account). */
const payingAda = (adaId: string) =>
  ctx.deps.db
    .update(workspaces)
    .set({ billingOwnerId: adaId })
    .where(eq(workspaces.id, ctx.workspaceId));

/** A renewal fails: Stripe marks the subscription past due and sends the invoice event. */
async function failPayment(subscription = 'sub_1') {
  stripe.subscriptions.set(subscription, {
    ...(await stripe.getSubscription(subscription))!,
    status: 'past_due',
  });
  await webhook(stripeEvents.paymentFailed(subscription));
}

describe('paid plan through Stripe', () => {
  it('opens checkout for the billing owner only, with one customer', async () => {
    const res = await post('/billing/checkout');
    expect(res.status).toBe(200);
    expect(billingRedirectSchema.parse(await res.json()).url).toMatch(/checkout\.stripe\.test/);
    expect(stripe.checkouts[0]).toMatchObject({
      workspaceId: ctx.workspaceId,
      userId: ctx.ownerId,
      purpose: 'upgrade',
    });
    await post('/billing/checkout');
    expect(stripe.customers).toHaveLength(1);

    const other = await person('Ada');
    const refused = await post('/billing/checkout', other.cookie);
    expect(refused.status).toBe(403);
    const member = await person('Ben', 'member');
    expect((await post('/billing/checkout', member.cookie)).status).toBe(403);
  });

  it('refuses webhooks without a valid signature', async () => {
    const event = stripeEvents.checkoutCompleted({
      workspaceId: ctx.workspaceId,
      userId: ctx.ownerId,
      subscription: 'sub_1',
      customer: 'cus_1',
    });
    expect((await webhook(event, 'forged')).status).toBe(400);
    expect((await row()).plan).toBe('free');
  });

  it('switches to paid on checkout, once per event, with the paid limits', async () => {
    await upgrade();
    const paid = await row();
    expect(paid).toMatchObject({
      plan: 'paid',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      billingOwnerId: ctx.ownerId,
      subscriptionStatus: 'active',
    });
    const workspace = workspaceSchema.parse(
      await (await ctx.request(`/api/workspaces/${ctx.workspaceId}`)).json(),
    );
    expect(workspace.usage).toMatchObject({
      maxMembers: 100,
      maxDecks: null,
      maxStorageBytes: 100 * 1024 ** 3,
    });
    expect(workspace.billing).toMatchObject({ enabled: true, isOwner: true, status: 'active' });
    expect(workspace.billing.renewsAt).not.toBeNull();

    // Stripe sends events at least once: the same one again changes nothing.
    const event = stripeEvents.subscriptionDeleted(stripeSubscription({ id: 'sub_1' }));
    expect((await webhook(event)).status).toBe(200);
    expect((await row()).plan).toBe('free');
    await ctx.deps.db
      .update(workspaces)
      .set({ plan: 'paid', stripeSubscriptionId: 'sub_1' })
      .where(eq(workspaces.id, ctx.workspaceId));
    expect((await webhook(event)).status).toBe(200);
    expect((await row()).plan).toBe('paid');
  });

  it('starts the first subscription with 14 days of Paid and no card, only once', async () => {
    expect((await details()).billing).toMatchObject({ trialAvailable: true, trialEndsAt: null });
    await post('/billing/checkout');
    expect(stripe.checkouts[0]?.trialDays).toBe(14);

    const trialEnd = new Date(Date.now() + 14 * DAY);
    stripe.subscriptions.set('sub_1', {
      id: 'sub_1',
      customerId: 'cus_1',
      status: 'trialing',
      currentPeriodEnd: trialEnd,
      cancelAtPeriodEnd: false,
    });
    await webhook(
      stripeEvents.checkoutCompleted({
        workspaceId: ctx.workspaceId,
        userId: ctx.ownerId,
        subscription: 'sub_1',
        customer: 'cus_1',
      }),
    );
    const trial = await details();
    expect(trial.plan).toBe('paid');
    expect(trial.billing).toMatchObject({
      status: 'trialing',
      renewsAt: null,
      trialAvailable: false,
      trialEndsAt: trialEnd.toISOString(),
    });

    // No card by the end: Stripe cancels, the workspace is back on Free – and the trial is used.
    await webhook(
      stripeEvents.subscriptionDeleted(
        stripeSubscription({ id: 'sub_1', status: 'trialing', periodEnd: trialEnd }),
      ),
    );
    const after = await details();
    expect(after.plan).toBe('free');
    expect(after.billing).toMatchObject({ trialAvailable: false, trialEndsAt: null });
    await post('/billing/checkout');
    expect(stripe.checkouts[1]?.trialDays).toBeUndefined();
  });

  it('does not start a second subscription', async () => {
    await upgrade();
    const res = await post('/billing/checkout');
    expect(res.status).toBe(400);
    expect((await post('/billing/portal')).status).toBe(200);
  });

  it('falls back to free at the period end after cancelling, without extra grace', async () => {
    await upgrade();
    const periodEnd = new Date(Date.now() + 10 * DAY);
    await webhook(
      stripeEvents.subscriptionUpdated(
        stripeSubscription({ id: 'sub_1', cancelAtPeriodEnd: true, periodEnd }),
      ),
    );
    expect(await row()).toMatchObject({
      plan: 'paid',
      cancelAtPeriodEnd: true,
      downgradeReason: 'canceled',
    });
    expect((await row()).downgradeAt?.getTime()).toBe(
      Math.floor(periodEnd.getTime() / 1000) * 1000,
    );
    expect((await details()).billing.endsAt).not.toBeNull();

    ctx.clock.advance(11 * DAY);
    await webhook(stripeEvents.subscriptionDeleted(stripeSubscription({ id: 'sub_1', periodEnd })));
    expect(await row()).toMatchObject({
      plan: 'free',
      stripeSubscriptionId: null,
      downgradeAt: null,
    });
    // No "add a payment method" mails for a cancellation someone chose.
    expect(mailer.sent).toHaveLength(0);
  });

  it('keeps paying workspaces paid for 14 days after a failed payment', async () => {
    await upgrade();
    await failPayment();
    const failing = await row();
    expect(failing.plan).toBe('paid');
    expect(failing.downgradeReason).toBe('payment_failed');
    expect(failing.downgradeAt!.getTime() - Date.now()).toBeGreaterThan(13.9 * DAY);

    // Paid within the grace: stays paid.
    await webhook(stripeEvents.subscriptionUpdated(stripeSubscription({ id: 'sub_1' })));
    expect(await row()).toMatchObject({ plan: 'paid', downgradeAt: null, downgradeReason: null });
  });

  it('starts no grace for a failed payment delivered after the card worked', async () => {
    await upgrade();
    // The retry went through (subscription active again) before the failure arrived.
    await webhook(stripeEvents.paymentFailed('sub_1'));
    expect(await row()).toMatchObject({ plan: 'paid', downgradeAt: null, downgradeReason: null });
  });

  it('takes the event as it is when Stripe no longer knows the subscription', async () => {
    await upgrade();
    stripe.missing.add('sub_1');
    const periodEnd = new Date(Date.now() + 10 * DAY);
    const cancelled = stripeEvents.subscriptionUpdated(
      stripeSubscription({ id: 'sub_1', cancelAtPeriodEnd: true, periodEnd }),
    );
    // No 500: Stripe would retry an answer that can never change for three days.
    expect((await webhook(cancelled)).status).toBe(200);
    expect(await row()).toMatchObject({ cancelAtPeriodEnd: true, downgradeReason: 'canceled' });
    expect((await webhook(stripeEvents.paymentFailed('sub_1'))).status).toBe(200);
    expect(await row()).toMatchObject({ plan: 'paid', downgradeReason: 'payment_failed' });

    stripe.missing.add('sub_2');
    const checkout = stripeEvents.checkoutCompleted({
      workspaceId: ctx.workspaceId,
      userId: ctx.ownerId,
      subscription: 'sub_2',
      customer: 'cus_1',
    });
    expect((await webhook(checkout)).status).toBe(200);
    expect((await row()).stripeSubscriptionId).toBe('sub_1');
  });

  it('applies the subscription as it is now when an older event arrives late', async () => {
    await upgrade();
    const periodEnd = new Date(Date.now() + 10 * DAY);
    const cancelled = stripeEvents.subscriptionUpdated(
      stripeSubscription({ id: 'sub_1', cancelAtPeriodEnd: true, periodEnd }),
    );
    const resumed = stripeEvents.subscriptionUpdated(stripeSubscription({ id: 'sub_1' }));
    // Cancelled, then resumed in the portal – the resume is delivered first.
    await webhook(resumed);
    await webhook(cancelled);
    expect(await row()).toMatchObject({
      plan: 'paid',
      cancelAtPeriodEnd: false,
      downgradeAt: null,
      downgradeReason: null,
    });
  });
});

describe('downgrade after the grace period (BER-155)', () => {
  beforeEach(async () => {
    await upgrade();
    await failPayment();
  });

  it('reminds the admins right away, 7 days in and the day before, then switches to free', async () => {
    await sweepDowngrades(ctx.deps);
    expect(mailer.sent.map((m) => m.subject)).toEqual([
      expect.stringMatching(/wechselt am .* auf Free/),
    ]);
    await sweepDowngrades(ctx.deps);
    expect(mailer.sent).toHaveLength(1);

    ctx.clock.advance(7 * DAY + 60_000);
    await sweepDowngrades(ctx.deps);
    expect(mailer.sent).toHaveLength(2);

    ctx.clock.advance(6 * DAY);
    await sweepDowngrades(ctx.deps);
    expect(mailer.sent).toHaveLength(3);
    expect((await row()).plan).toBe('paid');

    ctx.clock.advance(DAY);
    await sweepDowngrades(ctx.deps);
    expect(await row()).toMatchObject({
      plan: 'free',
      stripeSubscriptionId: null,
      downgradeAt: null,
    });
    expect(stripe.cancelled).toEqual(['sub_1']);
    expect(mailer.sent.at(-1)?.subject).toMatch(/jetzt im Free-Plan/);
  });

  it('stays paid when someone pays within the grace', async () => {
    ctx.clock.advance(10 * DAY);
    await webhook(stripeEvents.subscriptionUpdated(stripeSubscription({ id: 'sub_1' })));
    ctx.clock.advance(10 * DAY);
    await sweepDowngrades(ctx.deps);
    expect((await row()).plan).toBe('paid');
  });
});

describe('billing owner (BER-154)', () => {
  it('starts with the founder and hands a free workspace over at once', async () => {
    expect((await row()).billingOwnerId).toBe(ctx.ownerId);
    const ada = await person('Ada');
    const res = await post('/billing/transfer', undefined, { userId: ada.user.id });
    expect(res.status).toBe(200);
    expect((await row()).billingOwnerId).toBe(ada.user.id);
    expect((await details(ada.cookie)).billing.isOwner).toBe(true);
  });

  it('hands over only to another admin', async () => {
    const ben = await person('Ben', 'member');
    const res = await post('/billing/transfer', undefined, { userId: ben.user.id });
    expect(res.status).toBe(400);
  });

  it('hands a paid workspace over only once the new owner paid', async () => {
    await upgrade();
    const ada = await person('Ada');
    await post('/billing/transfer', undefined, { userId: ada.user.id });
    expect((await row()).billingOwnerId).toBe(ctx.ownerId);
    expect((await details()).billing.transfer?.to.id).toBe(ada.user.id);
    expect(mailer.sent.map((m) => m.to)).toEqual(['ada@firma.de']);

    // Someone else can't take the request.
    const ben = await person('Ben');
    expect((await post('/billing/transfer/accept', ben.cookie)).status).toBe(400);

    const accepted = billingTransferAcceptResultSchema.parse(
      await (await post('/billing/transfer/accept', ada.cookie)).json(),
    );
    expect(accepted.url).toMatch(/checkout/);
    expect(stripe.checkouts.at(-1)).toMatchObject({ userId: ada.user.id, purpose: 'transfer' });
    // Without paying, nothing changes.
    expect((await row()).billingOwnerId).toBe(ctx.ownerId);

    stripe.subscriptions.set('sub_2', {
      id: 'sub_2',
      customerId: 'cus_2',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * DAY),
      cancelAtPeriodEnd: false,
    });
    await webhook(
      stripeEvents.checkoutCompleted({
        workspaceId: ctx.workspaceId,
        userId: ada.user.id,
        subscription: 'sub_2',
        customer: 'cus_2',
        purpose: 'transfer',
      }),
    );
    expect(await row()).toMatchObject({
      billingOwnerId: ada.user.id,
      stripeSubscriptionId: 'sub_2',
      billingTransferToId: null,
      plan: 'paid',
    });
    expect(stripe.cancelled).toEqual(['sub_1']);
  });

  it('keeps a paying owner until someone else pays: no leaving, no removal, no account deletion', async () => {
    await upgrade();
    const ada = await person('Ada');
    const member = (id: string, cookie?: string) =>
      ctx.request(`/api/workspaces/${ctx.workspaceId}/members/${id}`, {
        method: 'DELETE',
        cookie,
      });
    const left = await member(ctx.ownerId);
    expect(left.status).toBe(400);
    expect((await left.json()) as unknown).toMatchObject({
      error: { message: expect.stringMatching(/^Du bezahlst für den Workspace\. Übergib/) },
    });
    const removed = await member(ctx.ownerId, ada.cookie);
    expect(removed.status).toBe(400);
    expect((await removed.json()) as unknown).toMatchObject({
      error: { message: expect.stringMatching(/^Diese Person bezahlt für den Workspace/) },
    });
    expect(await row()).toMatchObject({
      billingOwnerId: ctx.ownerId,
      stripeSubscriptionId: 'sub_1',
      plan: 'paid',
    });
    expect(stripe.cancelled).toEqual([]);

    // Other admins come and go as before.
    const ben = await person('Ben');
    expect((await member(ben.user.id)).status).toBe(204);

    // Nor does a paying admin delete their account from under the subscription.
    await payingAda(ada.user.id);
    await expect(deleteAccount(ctx.deps, ada.user.id, {})).rejects.toThrow(
      /^Du bezahlst für „.*“\. Übergib zuerst die Zahlung/,
    );
    expect((await row()).billingOwnerId).toBe(ada.user.id);
    expect(stripe.cancelled).toEqual([]);

    // An erasure confirmed by mail goes through (signing in to hand over may be impossible):
    // the subscription ends, the next owner gets the grace.
    const [adaRow] = await ctx.deps.db.select().from(users).where(eq(users.id, ada.user.id));
    await deleteRequested(
      ctx.deps,
      { purpose: 'delete', email: adaRow!.email, user: adaRow!, expiresAt: new Date() },
      {},
    );
    expect(await row()).toMatchObject({
      billingOwnerId: ctx.ownerId,
      stripeSubscriptionId: null,
      downgradeReason: 'owner_changed',
    });
    expect(stripe.cancelled).toEqual(['sub_1']);
  });

  it('a free workspace passes the billing role on when its owner leaves', async () => {
    const ada = await person('Ada');
    const res = await ctx.request(`/api/workspaces/${ctx.workspaceId}/members/${ctx.ownerId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    expect((await row()).billingOwnerId).toBe(ada.user.id);
  });

  it('passes on to the longest-standing admin when an unused paying account is deleted; paid gets the grace', async () => {
    await upgrade();
    const ada = await person('Ada');
    await payingAda(ada.user.id);
    const ben = await person('Ben');
    // The unused-account sweep: nobody is left to ask.
    expect(await deleteAccount(ctx.deps, ada.user.id, 'automatic')).toBe(true);
    const after = await row();
    expect(after).toMatchObject({
      billingOwnerId: ctx.ownerId,
      plan: 'paid',
      stripeSubscriptionId: null,
      downgradeReason: 'owner_changed',
    });
    expect(after.downgradeAt!.getTime() - Date.now()).toBeGreaterThan(
      (DOWNGRADE_GRACE_DAYS - 0.1) * DAY,
    );
    expect(stripe.cancelled).toEqual(['sub_1']);

    // The new owner pays within the grace: paid, no downgrade.
    expect((await details()).billing).toMatchObject({
      isOwner: true,
      downgradeReason: 'owner_changed',
    });
    expect((await post('/billing/checkout')).status).toBe(200);
    expect((await details(ben.cookie)).billing.isOwner).toBe(false);
  });

  it('promotes the longest-standing person when the owner deletes the account and no admin is left', async () => {
    const ada = await person('Ada');
    await ctx.deps.db
      .update(workspaces)
      .set({ billingOwnerId: ada.user.id })
      .where(eq(workspaces.id, ctx.workspaceId));
    // The dev owner (longest there) is only a member now; Ada is the one admin.
    await ctx.deps.db
      .update(workspaceMembers)
      .set({ role: 'member' })
      .where(eq(workspaceMembers.userId, ctx.ownerId));
    await person('Cleo', 'reviewer');
    await deleteAccount(ctx.deps, ada.user.id, 'automatic');
    expect((await row()).billingOwnerId).toBe(ctx.ownerId);
    const [role] = await ctx.deps.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, ctx.ownerId));
    expect(role?.role).toBe('admin');
  });

  it('keeps a paying owner admin until someone else pays', async () => {
    await upgrade();
    await person('Ada');
    const res = await ctx.request(`/api/workspaces/${ctx.workspaceId}/members/${ctx.ownerId}`, {
      method: 'PATCH',
      json: { role: 'member' },
    });
    expect(res.status).toBe(400);
  });

  it('lets only the paying admin delete a paid workspace, which cancels the subscription', async () => {
    await upgrade();
    const ada = await person('Ada');
    const other = await ctx.request(`/api/workspaces/${ctx.workspaceId}`, {
      method: 'DELETE',
      cookie: ada.cookie,
    });
    expect(other.status).toBe(403);
    expect((await other.json()) as unknown).toMatchObject({
      error: { message: expect.stringMatching(/Nur die Person, die für den Workspace bezahlt/) },
    });
    expect(stripe.cancelled).toEqual([]);

    const res = await ctx.request(`/api/workspaces/${ctx.workspaceId}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(stripe.cancelled).toEqual(['sub_1']);
  });

  it('lets a paying owner go once the subscription is cancelled for the end of the period', async () => {
    await upgrade();
    /** `ownerId` pays for a subscription that runs out at the end of the period. */
    const endingWith = (ownerId: string) =>
      ctx.deps.db
        .update(workspaces)
        .set({
          billingOwnerId: ownerId,
          plan: 'paid',
          stripeSubscriptionId: 'sub_1',
          subscriptionStatus: 'active',
          cancelAtPeriodEnd: true,
        })
        .where(eq(workspaces.id, ctx.workspaceId));
    const ada = await person('Ada');
    const ben = await person('Ben');
    // Leaving…
    await endingWith(ada.user.id);
    const left = await ctx.request(`/api/workspaces/${ctx.workspaceId}/members/${ada.user.id}`, {
      method: 'DELETE',
      cookie: ada.cookie,
    });
    expect(left.status).toBe(204);
    expect((await row()).billingOwnerId).not.toBe(ada.user.id);
    // …deleting the account…
    await endingWith(ben.user.id);
    expect(await deleteAccount(ctx.deps, ben.user.id, {})).toBe(true);
    expect((await row()).billingOwnerId).not.toBe(ben.user.id);
    // …and another admin deleting the workspace.
    const cleo = await person('Cleo');
    await endingWith(ctx.ownerId);
    const res = await ctx.request(`/api/workspaces/${ctx.workspaceId}`, {
      method: 'DELETE',
      cookie: cleo.cookie,
    });
    expect(res.status).toBe(204);
  });

  it('lets any admin delete once the subscription ended', async () => {
    await upgrade();
    const ada = await person('Ada');
    await webhook(stripeEvents.subscriptionDeleted(stripeSubscription({ id: 'sub_1' })));
    const res = await ctx.request(`/api/workspaces/${ctx.workspaceId}`, {
      method: 'DELETE',
      cookie: ada.cookie,
    });
    expect(res.status).toBe(204);
  });
});

describe('without Stripe', () => {
  it('has no billing routes', async () => {
    const plain = await createTestContext();
    const res = await plain.request(`/api/workspaces/${plain.workspaceId}/billing/checkout`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    const usage = workspaceUsageDetailsSchema.parse(
      await (await plain.request(`/api/workspaces/${plain.workspaceId}/usage`)).json(),
    );
    expect(usage.billing.enabled).toBe(false);
    await plain.cleanup();
  });
});
