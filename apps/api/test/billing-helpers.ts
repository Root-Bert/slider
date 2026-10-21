import type Stripe from 'stripe';
import {
  toSubscriptionInfo,
  type BillingProvider,
  type CheckoutInput,
  type SubscriptionInfo,
} from '../src/billing/stripe-billing';
import type { BillingConfig } from '../src/config';

/** Stripe settings for tests; the fake below never talks to Stripe. */
export const BILLING_TEST_CONFIG: BillingConfig = {
  secretKey: 'sk_test_fake',
  webhookSecret: 'whsec_fake',
  priceId: 'price_paid',
};

/** The `Stripe-Signature` the fake accepts. */
export const GOOD_SIGNATURE = 't=1,v1=fake';

/**
 * Stripe Billing without the network: records checkouts, portals and cancellations; webhooks are
 * "signed" with {@link GOOD_SIGNATURE} and parsed as they are.
 */
export class FakeBilling implements BillingProvider {
  readonly customers: { id: string; email: string; workspaceId: string }[] = [];
  readonly checkouts: CheckoutInput[] = [];
  readonly cancelled: string[] = [];
  readonly subscriptions = new Map<string, SubscriptionInfo>();
  /** Subscriptions Stripe answers `resource_missing` for. */
  readonly missing = new Set<string>();

  async createCustomer(input: { email: string; name: string; workspaceId: string }) {
    const id = `cus_${this.customers.length + 1}`;
    this.customers.push({ id, email: input.email, workspaceId: input.workspaceId });
    return id;
  }

  async createCheckout(input: CheckoutInput) {
    this.checkouts.push(input);
    return `https://checkout.stripe.test/${this.checkouts.length}`;
  }

  async createPortal(input: { customerId: string; returnUrl: string }) {
    return `https://billing.stripe.test/${input.customerId}`;
  }

  async getSubscription(id: string) {
    if (this.missing.has(id)) return null;
    const subscription = this.subscriptions.get(id);
    if (!subscription) throw new Error(`No subscription ${id}`);
    return subscription;
  }

  async cancelSubscription(id: string) {
    this.cancelled.push(id);
  }

  async verifyEvent(payload: string, signature: string) {
    if (signature !== GOOD_SIGNATURE) throw new Error('Bad signature');
    const event = JSON.parse(payload) as Stripe.Event;
    this.observe(event);
    return event;
  }

  /** When each subscription last changed, by the `created` of its newest event. */
  private readonly changedAt = new Map<string, number>();

  /**
   * Stripe's own state follows its newest event, whatever order they arrive in: a subscription
   * event older than the one seen last leaves it as it is.
   */
  private observe(event: Stripe.Event) {
    if (!event.type.startsWith('customer.subscription.')) return;
    const subscription = event.data.object as Stripe.Subscription;
    if ((this.changedAt.get(subscription.id) ?? 0) > event.created) return;
    this.changedAt.set(subscription.id, event.created);
    this.subscriptions.set(subscription.id, toSubscriptionInfo(subscription));
  }
}

let eventCounter = 0;

const event = (type: string, object: unknown, id = `evt_${++eventCounter}`) => ({
  id,
  object: 'event',
  type,
  // Seconds in Stripe; a counter keeps the order of creation here.
  created: eventCounter,
  data: { object },
});

/** A subscription object as Stripe sends it in webhooks (only the fields Slider reads). */
export function stripeSubscription(input: {
  id: string;
  customer?: string;
  status?: string;
  periodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  workspaceId?: string;
}) {
  return {
    id: input.id,
    object: 'subscription',
    customer: input.customer ?? 'cus_1',
    status: input.status ?? 'active',
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    metadata: input.workspaceId ? { workspaceId: input.workspaceId } : {},
    items: {
      data: [
        {
          current_period_end: Math.floor(
            (input.periodEnd ?? new Date(Date.now() + 30 * 86_400_000)).getTime() / 1000,
          ),
        },
      ],
    },
  };
}

export const stripeEvents = {
  checkoutCompleted: (input: {
    workspaceId: string;
    userId: string;
    subscription: string;
    customer: string;
    purpose?: 'upgrade' | 'transfer';
  }) =>
    event('checkout.session.completed', {
      id: `cs_${eventCounter}`,
      object: 'checkout.session',
      mode: 'subscription',
      customer: input.customer,
      subscription: input.subscription,
      metadata: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        purpose: input.purpose ?? 'upgrade',
      },
    }),
  subscriptionUpdated: (subscription: ReturnType<typeof stripeSubscription>) =>
    event('customer.subscription.updated', subscription),
  subscriptionDeleted: (subscription: ReturnType<typeof stripeSubscription>) =>
    event('customer.subscription.deleted', { ...subscription, status: 'canceled' }),
  paymentFailed: (subscriptionId: string) =>
    event('invoice.payment_failed', {
      id: `in_${eventCounter}`,
      object: 'invoice',
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: subscriptionId },
      },
    }),
};
