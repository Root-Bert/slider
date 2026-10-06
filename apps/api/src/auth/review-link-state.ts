import type { ReviewLinkRow } from '../db/schema';

export type ReviewLinkState = 'active' | 'revoked' | 'expired';

export function reviewLinkState(
  link: Pick<ReviewLinkRow, 'revokedAt' | 'expiresAt'>,
  now: Date,
): ReviewLinkState {
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

export const LINK_REVOKED_MESSAGE = 'Dieser Review-Link wurde zurückgezogen.';
export const LINK_EXPIRED_MESSAGE = 'Dieser Review-Link ist abgelaufen.';
