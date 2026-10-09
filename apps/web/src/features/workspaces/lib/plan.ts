import type { Workspace, WorkspaceUsage } from '@slider/shared';

/**
 * Plan limits on the client (BER-130) – only to show usage and disable what would fail. The API
 * enforces the limits (`apps/api/src/services/plans.ts`) and answers `plan_limit`.
 */

/** `#einladen` on the settings page – the share dialog links here. */
export const INVITE_SECTION_ID = 'einladen';

const PLAN_LABELS: Record<string, string> = { free: 'Free-Plan' };

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

/** "3/5" – or just "3" without a limit. */
export const formatRatio = ({ used, max }: Pick<LimitState, 'used' | 'max'>) =>
  max === null ? String(used) : `${used}/${max}`;

const decksWord = (n: number) => (n === 1 ? 'Präsentation' : 'Präsentationen');

/** Overview: "2 von 3 Präsentationen" / "5 Präsentationen". */
export function formatDeckUsage(usage: WorkspaceUsage): string {
  const { used, max } = deckState(usage);
  return max === null ? `${used} ${decksWord(used)}` : `${used} von ${max} ${decksWord(max)}`;
}

/** Why "Neue Review" is off, matching the API's `plan_limit` message. */
export function deckLimitMessage(workspace: Pick<Workspace, 'plan' | 'usage'>): string {
  const max = workspace.usage.maxDecks ?? 0;
  return `Im ${planLabel(workspace.plan)} ${max === 1 ? 'ist eine Präsentation' : `sind ${max} Präsentationen`} pro Organisation möglich. Lösche eine, um Platz zu schaffen.`;
}

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
