import Stripe from 'stripe';
import type { BillingConfig } from '../config';

/**
 * Stripe Billing behind a narrow interface (BER-152): Checkout to subscribe, the customer portal
 * for payment methods, invoices and cancelling, signed webhooks. No payment data ever reaches
 * Slider – card details stay with Stripe. Tests inject a fake (`test/fakes/billing`).
 */

/** What Slider keeps of a subscription. */
export interface SubscriptionInfo {
  id: string;
  customerId: string;
  /** Stripe's status: `active`, `trialing`, `past_due`, `unpaid`, `canceled`, … */
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface CheckoutInput {
  customerId: string;
  workspaceId: string;
  /** Who becomes the billing owner once paid. */
  userId: string;
  /** `transfer`: another admin takes over paying (BER-154); the old subscription ends then. */
  purpose: 'upgrade' | 'transfer';
  /**
   * Days of Paid before the first payment, with no payment method needed. Whoever hasn't added
   * one by then is simply cancelled – the organisation stays on Free.
   */
  trialDays?: number;
  successUrl: string;
  cancelUrl: string;
}

export interface BillingProvider {
  createCustomer(input: { email: string; name: string; workspaceId: string }): Promise<string>;
  /** URL of a Stripe Checkout session for the paid plan. */
  createCheckout(input: CheckoutInput): Promise<string>;
  /** URL of the customer portal: payment methods, invoices, cancelling. */
  createPortal(input: { customerId: string; returnUrl: string }): Promise<string>;
  /** `null` when Stripe doesn't know the subscription (any more): asking again won't help. */
  getSubscription(id: string): Promise<SubscriptionInfo | null>;
  /** Ends a subscription right away (owner left, handed over, or fell back to free). */
  cancelSubscription(id: string): Promise<void>;
  /** Checks the `Stripe-Signature` header and parses the event; throws when it doesn't match. */
  verifyEvent(payload: string, signature: string): Promise<Stripe.Event>;
}

export function toSubscriptionInfo(subscription: Stripe.Subscription): SubscriptionInfo {
  // Since API version 2025-03-31 the period lives on the items; one price, one item.
  const periodEnds = subscription.items.data.map((item) => item.current_period_end);
  const end = periodEnds.length > 0 ? Math.max(...periodEnds) : null;
  return {
    id: subscription.id,
    customerId:
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    status: subscription.status,
    currentPeriodEnd: end ? new Date(end * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

const isMissing = (error: unknown) =>
  error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing';

export class StripeBilling implements BillingProvider {
  private readonly stripe: Stripe;

  constructor(private readonly config: BillingConfig) {
    this.stripe = new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  }

  async createCustomer(input: { email: string; name: string; workspaceId: string }) {
    const customer = await this.stripe.customers.create({
      email: input.email,
      name: input.name,
      metadata: { workspaceId: input.workspaceId },
    });
    return customer.id;
  }

  async createCheckout(input: CheckoutInput) {
    const metadata = {
      workspaceId: input.workspaceId,
      userId: input.userId,
      purpose: input.purpose,
    };
    const trial = input.trialDays ? input.trialDays : null;
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: this.config.priceId, quantity: 1 }],
      client_reference_id: input.workspaceId,
      metadata,
      subscription_data: trial
        ? {
            metadata,
            trial_period_days: trial,
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
          }
        : { metadata },
      // A trial asks for no card; it can be added any time in the customer portal.
      ...(trial ? { payment_method_collection: 'if_required' as const } : {}),
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
      locale: 'de',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    if (!session.url) throw new Error('Stripe returned a checkout session without URL');
    return session.url;
  }

  async createPortal(input: { customerId: string; returnUrl: string }) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
      locale: 'de',
    });
    return session.url;
  }

  async getSubscription(id: string) {
    try {
      return toSubscriptionInfo(await this.stripe.subscriptions.retrieve(id));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async cancelSubscription(id: string) {
    try {
      await this.stripe.subscriptions.cancel(id, { prorate: true });
    } catch (error) {
      // Cancelled already (e.g. in the portal): nothing left to do.
      if (isMissing(error)) return;
      throw error;
    }
  }

  verifyEvent(payload: string, signature: string) {
    return this.stripe.webhooks.constructEventAsync(payload, signature, this.config.webhookSecret);
  }
}
