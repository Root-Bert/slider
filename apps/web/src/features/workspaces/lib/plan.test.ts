import { describe, expect, it } from 'vitest';
import type { WorkspaceUsage } from '@slider/shared';
import {
  deckLimitMessage,
  deckState,
  formatDeckUsage,
  formatRatio,
  limitState,
  LOCKED_MESSAGE,
  nearLimit,
  newReviewBlockedMessage,
  parseInviteToken,
  pendingDowngrade,
  planLabel,
  seatsLine,
  seatState,
  storageState,
  subscriptionRenews,
  unlimitedUsage,
} from './plan';
import { billingFixture } from '@/test/workspace';

const usage = (overrides: Partial<WorkspaceUsage> = {}): WorkspaceUsage => ({
  members: 3,
  seatsUsed: 4,
  maxMembers: 5,
  decks: 2,
  maxDecks: 3,
  storageBytes: 0,
  maxStorageBytes: null,
  ...overrides,
});

describe('limitState', () => {
  it('reports free slots, fullness and a meter ratio', () => {
    expect(limitState(2, 3)).toEqual({ used: 2, max: 3, full: false, remaining: 1, ratio: 2 / 3 });
    expect(limitState(3, 3)).toMatchObject({ full: true, remaining: 0, ratio: 1 });
    // Above the limit (an organisation from before the plan): full, never negative.
    expect(limitState(4, 3)).toMatchObject({ full: true, remaining: 0, ratio: 1 });
  });

  it('treats null as unlimited', () => {
    expect(limitState(12, null)).toEqual({
      used: 12,
      max: null,
      full: false,
      remaining: null,
      ratio: null,
    });
  });

  it('counts seats with pending invites, not only members', () => {
    expect(seatState(usage())).toMatchObject({ used: 4, remaining: 1 });
    expect(seatState(usage({ seatsUsed: 5 })).full).toBe(true);
    expect(deckState(usage()).full).toBe(false);
    expect(deckState(usage({ decks: 3 })).full).toBe(true);
  });
});

describe('formatting', () => {
  it('formats usage for the settings and the overview', () => {
    expect(formatRatio(limitState(3, 5))).toBe('3/5');
    expect(formatRatio(limitState(3, null))).toBe('3');
    expect(formatDeckUsage(usage())).toBe('2 von 3 Reviews');
    expect(formatDeckUsage(usage({ decks: 1, maxDecks: 1 }))).toBe('1 von 1 Review');
    expect(formatDeckUsage(usage({ decks: 7, maxDecks: null }))).toBe('7 Reviews');
    expect(formatDeckUsage(usage({ decks: 1, maxDecks: null }))).toBe('1 Review');
  });

  it('names plans', () => {
    expect(planLabel('free')).toBe('Free-Plan');
    expect(planLabel('team')).toBe('Team-Plan');
  });

  it('explains a full organisation like the API does', () => {
    expect(deckLimitMessage({ plan: 'free', usage: usage({ decks: 3 }) })).toBe(
      'Im Free-Plan sind 3 Reviews pro Organisation möglich. Lösche eine, um Platz zu schaffen.',
    );
    expect(deckLimitMessage({ plan: 'free', usage: usage({ maxDecks: 1 }) })).toMatch(
      /^Im Free-Plan ist eine Review pro Organisation möglich\./,
    );
  });

  it('says how many seats are left', () => {
    expect(seatsLine(usage())).toBe('Noch 1 Platz frei.');
    expect(seatsLine(usage({ seatsUsed: 2 }))).toBe('Noch 3 Plätze frei.');
    expect(seatsLine(usage({ seatsUsed: 5 }))).toMatch(/^Alle 5 Plätze sind belegt/);
    expect(seatsLine(usage({ maxMembers: null }))).toBeNull();
  });
});

describe('parseInviteToken', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

  it('takes links, paths and bare codes', () => {
    expect(parseInviteToken(`https://slider.example/join/${token}`)).toBe(token);
    expect(parseInviteToken(`  http://localhost:5173/join/${token}?x=1  `)).toBe(token);
    expect(parseInviteToken(`/join/${token}`)).toBe(token);
    expect(parseInviteToken(token)).toBe(token);
  });

  it('rejects anything else', () => {
    expect(parseInviteToken('')).toBeNull();
    expect(parseInviteToken('hallo')).toBeNull();
    expect(parseInviteToken(`https://slider.example/r/${token}`)).toBeNull();
    expect(parseInviteToken('https://evil.example/join/short')).toBeNull();
  });
});

describe('plan limits (BER-151, BER-155)', () => {
  it('names the paid plan', () => {
    expect(planLabel('paid')).toBe('Paid-Plan');
  });

  it('warns from 80 % of a limit, never without one', () => {
    expect(nearLimit(storageState(usage({ storageBytes: 79, maxStorageBytes: 100 })))).toBe(false);
    expect(nearLimit(storageState(usage({ storageBytes: 80, maxStorageBytes: 100 })))).toBe(true);
    expect(nearLimit(storageState(usage({ storageBytes: 999 })))).toBe(false);
  });

  it('is unlimited only without any limit', () => {
    expect(unlimitedUsage(usage({ maxMembers: null, maxDecks: null }))).toBe(true);
    expect(unlimitedUsage(usage({ maxMembers: null, maxDecks: null, maxStorageBytes: 100 }))).toBe(
      false,
    );
  });

  it('turns "Neue Review" off over the plan before the deck limit', () => {
    expect(newReviewBlockedMessage({ plan: 'free', usage: usage(), locked: false })).toBeNull();
    expect(
      newReviewBlockedMessage({ plan: 'free', usage: usage({ decks: 3 }), locked: false }),
    ).toContain('Lösche eine');
    expect(
      newReviewBlockedMessage({ plan: 'free', usage: usage({ decks: 3 }), locked: true }),
    ).toBe(LOCKED_MESSAGE);
  });

  it('warns about a fall-back to free only when nobody pays, not after a cancellation', () => {
    const at = '2026-11-02T10:00:00.000Z';
    expect(
      pendingDowngrade(billingFixture({ downgradeAt: at, downgradeReason: 'payment_failed' })),
    ).toBe(at);
    expect(
      pendingDowngrade(billingFixture({ downgradeAt: at, downgradeReason: 'owner_changed' })),
    ).toBe(at);
    expect(
      pendingDowngrade(billingFixture({ downgradeAt: at, downgradeReason: 'canceled' })),
    ).toBeNull();
    expect(pendingDowngrade(billingFixture())).toBeNull();
  });
});

describe('subscriptionRenews', () => {
  const renews = (billing: Parameters<typeof billingFixture>[0], plan: 'free' | 'paid' = 'paid') =>
    subscriptionRenews({ plan, billing: billingFixture(billing) });

  it('holds while a paid subscription runs on', () => {
    expect(renews({ status: 'active' })).toBe(true);
    expect(renews({ status: 'past_due' })).toBe(true);
  });

  it('not without one, once it ended, or once it is cancelled to the period end', () => {
    expect(renews({ status: null })).toBe(false);
    expect(renews({ status: 'active' }, 'free')).toBe(false);
    expect(renews({ status: 'canceled' })).toBe(false);
    expect(renews({ status: 'incomplete_expired' })).toBe(false);
    expect(renews({ status: 'active', endsAt: '2026-11-30T00:00:00.000Z' })).toBe(false);
  });
});
