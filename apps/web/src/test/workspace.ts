import type { WorkspaceBilling } from '@slider/shared';

/** `Workspace.billing` of an instance without Stripe (self-hosting) – patch what a test needs. */
export const billingFixture = (patch: Partial<WorkspaceBilling> = {}): WorkspaceBilling => ({
  enabled: false,
  owner: null,
  isOwner: false,
  status: null,
  renewsAt: null,
  trialAvailable: false,
  trialEndsAt: null,
  endsAt: null,
  downgradeAt: null,
  downgradeReason: null,
  transfer: null,
  granted: false,
  ...patch,
});
