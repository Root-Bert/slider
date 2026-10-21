import type { StorageCategory, Workspace, WorkspaceBilling, WorkspaceUsage } from '@slider/shared';

/**
 * Plan limits on the client (BER-130) – only to show usage and disable what would fail. The API
 * enforces the limits (`apps/api/src/services/plans.ts`) and answers `plan_limit`.
 */

/** `#einladen` on the settings page – the share dialog links here. */
export const INVITE_SECTION_ID = 'einladen';

const PLAN_LABELS: Record<string, string> = { free: 'Free-Plan', paid: 'Paid-Plan' };

export const planLabel = (plan: string) =>
  PLAN_LABELS[plan] ?? `${plan.charAt(0).toUpperCase()}${plan.slice(1)}-Plan`;

export interface LimitState {
  used: number;
  /** `null` = unlimited. */
  max: number | null;
  /** Nothing more fits. */
  full: boolean;
  /** Free slots; `null` = unlimited. */
  remaining: number | null;
  /** 0–1 for a meter; `null` when unlimited. */
  ratio: number | null;
}

export function limitState(used: number, max: number | null): LimitState {
  if (max === null) return { used, max, full: false, remaining: null, ratio: null };
  return {
    used,
    max,
    full: used >= max,
    remaining: Math.max(0, max - used),
    ratio: max === 0 ? 1 : Math.min(1, used / max),
  };
}

/** Seats: members plus pending e-mail invites. */
export const seatState = (usage: WorkspaceUsage) => limitState(usage.seatsUsed, usage.maxMembers);
export const deckState = (usage: WorkspaceUsage) => limitState(usage.decks, usage.maxDecks);
export const storageState = (usage: WorkspaceUsage) =>
  limitState(usage.storageBytes, usage.maxStorageBytes);

/** From this share of a limit on, the "Nutzung" page warns before it is reached. */
export const NEAR_LIMIT_RATIO = 0.8;
export const nearLimit = (state: LimitState) =>
  state.ratio !== null && state.ratio >= NEAR_LIMIT_RATIO;

/** No limit at all (self-hosting): no plan to name, only the numbers. */
export const unlimitedUsage = (usage: WorkspaceUsage) =>
  usage.maxMembers === null && usage.maxDecks === null && usage.maxStorageBytes === null;

/** "3/5" – or just "3" without a limit. */
export const formatRatio = ({ used, max }: Pick<LimitState, 'used' | 'max'>) =>
  max === null ? String(used) : `${used}/${max}`;

const decksWord = (n: number) => (n === 1 ? 'Review' : 'Reviews');

/** Overview: "2 von 3 Reviews" / "5 Reviews". */
export function formatDeckUsage(usage: WorkspaceUsage): string {
  const { used, max } = deckState(usage);
  return max === null ? `${used} ${decksWord(used)}` : `${used} von ${max} ${decksWord(max)}`;
}

/** Why "Neue Review" is off, matching the API's `plan_limit` message. */
export function deckLimitMessage(workspace: Pick<Workspace, 'plan' | 'usage'>): string {
  const max = workspace.usage.maxDecks ?? 0;
  return `Im ${planLabel(workspace.plan)} ${max === 1 ? 'ist eine Review' : `sind ${max} Reviews`} pro Organisation möglich. Lösche eine, um Platz zu schaffen.`;
}

/**
 * Over a limit of the plan (BER-155, "Sperrmodus"): new reviews, uploads, invitations and
 * comments are off until the organisation is back within its plan. The API answers
 * `plan_over_limit`. Tooltip of every action that is off for this reason.
 */
export const LOCKED_MESSAGE =
  'Die Organisation liegt über dem Limit ihres Plans. Unter „Nutzung“ siehst du, was zu tun ist.';

/** Why "Neue Review" is off – over the plan's limits or no review left – or `null`. */
export function newReviewBlockedMessage(
  workspace: Pick<Workspace, 'plan' | 'usage' | 'locked'>,
): string | null {
  if (workspace.locked) return LOCKED_MESSAGE;
  return deckState(workspace.usage).full ? deckLimitMessage(workspace) : null;
}

/** "Nutzung": the bar's parts, in the order of `STORAGE_CATEGORIES`. */
export const STORAGE_LABELS: Record<StorageCategory, string> = {
  originals: 'Originaldateien',
  slideImages: 'Folien-Renderings',
  images: 'Bilder',
  videos: 'Videos',
  audio: 'Sprachaufnahmen',
  other: 'Sonstiges',
};

/** Design-token colours of the bar's parts (theme variables, so Tailwind emits them). */
export const STORAGE_COLORS: Record<StorageCategory, string> = {
  originals: 'bg-powerpoint',
  slideImages: 'bg-accent-blue',
  images: 'bg-accent-violet',
  videos: 'bg-accent-cyan',
  audio: 'bg-accent-green',
  other: 'bg-fg-faint',
};

/** "19. Oktober 2026". */
export const formatPlanDate = (iso: string) =>
  new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * A paid organisation about to fall back to free because nobody pays (a payment failed, the
 * paying admin left) – someone can still act. A cancellation is wanted: no warning for it.
 */
export const pendingDowngrade = (billing: WorkspaceBilling): string | null =>
  billing.downgradeAt &&
  (billing.downgradeReason === 'payment_failed' || billing.downgradeReason === 'owner_changed')
    ? billing.downgradeAt
    : null;

/** Stripe statuses after which a subscription no longer runs – the API's `ENDED_STATUSES`. */
const ENDED_STATUSES: ReadonlySet<string> = new Set(['canceled', 'incomplete_expired']);

/**
 * A paid organisation whose subscription runs and renews (BER-154): its billing owner stays
 * until someone else pays, and only they may delete it – that ends the subscription. Once it's
 * cancelled to the period end (`endsAt`), neither holds any more. Mirrors the API's guard
 * (`isPaying` in billing-owner): the billing DTO's `status` is non-null exactly when a
 * subscription is stored (the API writes Stripe's status together with the subscription id).
 */
export const subscriptionRenews = (workspace: Pick<Workspace, 'plan' | 'billing'>): boolean =>
  workspace.plan === 'paid' &&
  workspace.billing.status !== null &&
  !ENDED_STATUSES.has(workspace.billing.status) &&
  workspace.billing.endsAt === null;

/** "Wechselt am 3. November 2026 auf Free – Zahlungsmethode hinterlegen." */
export const downgradeMessage = (downgradeAt: string) =>
  `Wechselt am ${formatPlanDate(downgradeAt)} auf Free – Zahlungsmethode hinterlegen.`;

/** Invite form: "Noch 2 Plätze frei" / "Alle 5 Plätze belegt" / `null` without a limit. */
export function seatsLine(usage: WorkspaceUsage): string | null {
  const seats = seatState(usage);
  if (seats.max === null || seats.remaining === null) return null;
  if (seats.full)
    return `Alle ${seats.max} Plätze sind belegt (Mitglieder und offene Einladungen).`;
  return seats.remaining === 1 ? 'Noch 1 Platz frei.' : `Noch ${seats.remaining} Plätze frei.`;
}

/**
 * What someone pasted to join: an invite link (`https://…/join/<token>`), a path or the bare
 * code. `null` when it is none of these.
 */
export function parseInviteToken(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const fromPath = /(?:^|\/)join\/([\w-]{16,})(?:[/?#]|$)/.exec(value);
  if (fromPath) return fromPath[1] ?? null;
  return /^[\w-]{16,}$/.test(value) ? value : null;
}
