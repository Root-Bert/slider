import { describe, expect, it } from 'vitest';
import type { WorkspaceUsage } from '@slider/shared';
import {
  deckLimitMessage,
  deckState,
  formatDeckUsage,
  formatRatio,
  limitState,
  parseInviteToken,
  planLabel,
  seatsLine,
  seatState,
} from './plan';

const usage = (overrides: Partial<WorkspaceUsage> = {}): WorkspaceUsage => ({
  members: 3,
  seatsUsed: 4,
  maxMembers: 5,
  decks: 2,
  maxDecks: 3,
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
    expect(formatDeckUsage(usage())).toBe('2 von 3 Präsentationen');
    expect(formatDeckUsage(usage({ decks: 1, maxDecks: 1 }))).toBe('1 von 1 Präsentation');
    expect(formatDeckUsage(usage({ decks: 7, maxDecks: null }))).toBe('7 Präsentationen');
    expect(formatDeckUsage(usage({ decks: 1, maxDecks: null }))).toBe('1 Präsentation');
  });

  it('names plans', () => {
    expect(planLabel('free')).toBe('Free-Plan');
    expect(planLabel('team')).toBe('Team-Plan');
  });

  it('explains a full organisation like the API does', () => {
    expect(deckLimitMessage({ plan: 'free', usage: usage({ decks: 3 }) })).toBe(
      'Im Free-Plan sind 3 Präsentationen pro Organisation möglich. Lösche eine, um Platz zu schaffen.',
    );
    expect(deckLimitMessage({ plan: 'free', usage: usage({ maxDecks: 1 }) })).toMatch(
      /^Im Free-Plan ist eine Präsentation pro Organisation möglich\./,
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
