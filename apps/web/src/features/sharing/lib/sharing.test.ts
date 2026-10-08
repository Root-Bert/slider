import type { ReviewLink } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { participantsSentence } from './participants-sentence';
import { findActiveLink, linkLifetimeDays } from './review-links';

const link = (overrides: Partial<ReviewLink>): ReviewLink => ({
  id: 'l1',
  deckId: 'd1',
  token: 'tok',
  role: 'view',
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

describe('findActiveLink', () => {
  const now = Date.parse('2026-10-06T00:00:00Z');

  it('ignores revoked and expired links and prefers the newest', () => {
    const links = [
      link({ id: 'revoked', revokedAt: '2026-10-02T00:00:00Z', createdAt: '2026-10-05T00:00:00Z' }),
      link({ id: 'expired', expiresAt: '2026-10-05T00:00:00Z', createdAt: '2026-10-04T00:00:00Z' }),
      link({ id: 'old', createdAt: '2026-10-01T00:00:00Z' }),
      link({ id: 'new', createdAt: '2026-10-03T00:00:00Z' }),
    ];
    expect(findActiveLink(links, now)?.id).toBe('new');
    expect(findActiveLink([links[0]!, links[1]!], now)).toBeNull();
  });
});

describe('linkLifetimeDays', () => {
  it('derives the lifetime from creation and expiry', () => {
    expect(linkLifetimeDays(link({}))).toBeNull();
    expect(linkLifetimeDays(link({ expiresAt: '2026-10-08T00:00:00Z' }))).toBe(7);
  });
});

describe('participantsSentence', () => {
  const people = (...names: string[]) => names.map((name) => ({ name }));

  it('summarises by first name', () => {
    expect(participantsSentence([])).toBeNull();
    expect(participantsSentence(people('Lena Wolf'))).toBe('Lena ist im Review');
    expect(participantsSentence(people('Lena Wolf', 'Max Kern'))).toBe(
      'Lena und Max sind im Review',
    );
    expect(participantsSentence(people('Lena', 'Max', 'Anna', 'Tom'))).toBe(
      'Lena, Max und 2 weitere sind im Review',
    );
  });
});
