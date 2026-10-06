import { describe, expect, it } from 'vitest';
import { makeDeck } from './deck-fixture';
import { hasUnseenChanges } from './last-visits';
import { deriveNotifications, groupByDay, notificationTitle } from './notifications';

const now = Date.parse('2026-10-06T12:00:00Z');

describe('deriveNotifications', () => {
  const decks = [
    makeDeck({ id: 'fb', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-06T11:00:00Z' }),
    makeDeck({ id: 'imp', createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:01:00Z' }),
    makeDeck({
      id: 'fail',
      import: { status: 'failed', error: 'Datei beschädigt' },
      updatedAt: '2026-10-05T09:00:00Z',
    }),
    makeDeck({ id: 'running', import: { status: 'queued' }, updatedAt: '2026-10-06T11:30:00Z' }),
    makeDeck({ id: 'old', updatedAt: '2026-08-01T00:00:00Z' }),
    makeDeck({ id: 'arch', archivedAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' }),
  ];

  it('classifies recent, finished changes and skips running, old and archived decks', () => {
    const items = deriveNotifications(decks, () => true, now);
    expect(items.map((item) => [item.deck.id, item.kind])).toEqual([
      ['fb', 'feedback'],
      ['imp', 'imported'],
      ['fail', 'import_failed'],
    ]);
    expect(notificationTitle(items[0]!)).toBe('Neues Feedback in „Q4 Strategie“');
  });

  it('marks items unread based on the last visit', () => {
    const visits = { baseline: Date.parse('2026-10-06T10:30:00Z'), decks: {} };
    const items = deriveNotifications(decks, (deck) => hasUnseenChanges(visits, deck), now);
    expect(items.map((item) => item.unread)).toEqual([true, false, false]);
  });

  it('groups by calendar day', () => {
    const items = deriveNotifications(decks, () => true, now);
    const { today, earlier } = groupByDay(items, new Date(now));
    expect(today.map((item) => item.deck.id)).toEqual(['fb', 'imp']);
    expect(earlier.map((item) => item.deck.id)).toEqual(['fail']);
  });
});

describe('hasUnseenChanges', () => {
  const deck = makeDeck({ id: 'x', updatedAt: '2026-10-06T10:00:00Z' });

  it('uses the per-deck visit when present, else the baseline', () => {
    const baseline = Date.parse('2026-10-06T09:00:00Z');
    expect(hasUnseenChanges({ baseline, decks: {} }, deck)).toBe(true);
    expect(
      hasUnseenChanges({ baseline, decks: { x: Date.parse('2026-10-06T10:05:00Z') } }, deck),
    ).toBe(false);
  });
});
