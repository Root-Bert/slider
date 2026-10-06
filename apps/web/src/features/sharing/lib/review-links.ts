import type { ReviewLink } from '@slider/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

export const isLinkActive = (link: ReviewLink, now: number = Date.now()): boolean =>
  link.revokedAt === null && (link.expiresAt === null || Date.parse(link.expiresAt) > now);

/** The newest usable link – there may briefly be two while one replaces the other. */
export function findActiveLink(
  links: readonly ReviewLink[],
  now: number = Date.now(),
): ReviewLink | null {
  return (
    links
      .filter((link) => isLinkActive(link, now))
      .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null
  );
}

/** Lifetime the link was created with, in whole days; `null` = never expires. */
export const linkLifetimeDays = (link: ReviewLink): number | null =>
  link.expiresAt === null
    ? null
    : Math.round((Date.parse(link.expiresAt) - Date.parse(link.createdAt)) / DAY_MS);
