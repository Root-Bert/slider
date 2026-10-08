import { randomBytes } from 'node:crypto';
import { count, desc, eq } from 'drizzle-orm';
import {
  ACCENT_COLORS,
  type createReviewLinkInputSchema,
  type InviteInfo,
  type JoinInviteInput,
  type ReviewLink,
  type Viewer,
} from '@slider/shared';
import type { z } from 'zod';
import { requireDeckAccess } from '../auth/access';
import {
  LINK_EXPIRED_MESSAGE,
  LINK_REVOKED_MESSAGE,
  reviewLinkState,
} from '../auth/review-link-state';
import { guestAuthor } from '../authors';
import {
  decks,
  guestSessions,
  reviewLinks,
  users,
  type GuestSessionRow,
  type ReviewLinkRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, notFound } from '../http/errors';
import { toDeckDto } from './decks';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 256 random bits, URL-safe. */
export const newReviewToken = () => randomBytes(32).toString('base64url');

export function toReviewLinkDto(row: ReviewLinkRow): ReviewLink {
  return {
    id: row.id,
    deckId: row.deckId,
    token: row.token,
    // Every link is view-only now (BER-130), old `comment` links included.
    role: 'view',
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listReviewLinks(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<ReviewLink[]> {
  await requireDeckAccess(deps.db, viewer, deckId, 'own');
  const rows = await deps.db
    .select()
    .from(reviewLinks)
    .where(eq(reviewLinks.deckId, deckId))
    .orderBy(desc(reviewLinks.createdAt));
  return rows.map(toReviewLinkDto);
}

export async function createReviewLink(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: z.output<typeof createReviewLinkInputSchema>,
): Promise<ReviewLink> {
  await requireDeckAccess(deps.db, viewer, deckId, 'own');
  const now = deps.clock.now();
  const [row] = await deps.db
    .insert(reviewLinks)
    .values({
      id: crypto.randomUUID(),
      deckId,
      token: newReviewToken(),
      role: input.role,
      expiresAt:
        input.expiresInDays === null
          ? null
          : new Date(now.getTime() + input.expiresInDays * DAY_MS),
      createdAt: now,
    })
    .returning();
  if (!row) throw new Error('Review link insert returned no row');
  return toReviewLinkDto(row);
}

/** Revoking is idempotent; guests holding the link lose access immediately (BER-102). */
export async function revokeReviewLink(
  deps: AppDeps,
  viewer: Viewer,
  linkId: string,
): Promise<void> {
  const [link] = await deps.db.select().from(reviewLinks).where(eq(reviewLinks.id, linkId));
  if (!link) throw notFound('Diesen Review-Link gibt es nicht.');
  await requireDeckAccess(deps.db, viewer, link.deckId, 'own');
  if (link.revokedAt) return;
  await deps.db
    .update(reviewLinks)
    .set({ revokedAt: deps.clock.now() })
    .where(eq(reviewLinks.id, linkId));
}

/** Looks up an invite token; unknown → 404, revoked/expired → 410. */
async function requireActiveLink(deps: AppDeps, token: string): Promise<ReviewLinkRow> {
  const [link] = await deps.db.select().from(reviewLinks).where(eq(reviewLinks.token, token));
  if (!link) throw notFound('Diesen Review-Link gibt es nicht.');
  const state = reviewLinkState(link, deps.clock.now());
  if (state === 'revoked') throw new ApiError(410, 'link_revoked', LINK_REVOKED_MESSAGE);
  if (state === 'expired') throw new ApiError(410, 'link_expired', LINK_EXPIRED_MESSAGE);
  return link;
}

export async function getInviteInfo(deps: AppDeps, token: string): Promise<InviteInfo> {
  const link = await requireActiveLink(deps, token);
  const [row] = await deps.db.select().from(decks).where(eq(decks.id, link.deckId));
  if (!row) throw notFound('Diesen Review-Link gibt es nicht.');
  const deck = await toDeckDto(deps.db, row);
  return {
    deckTitle: deck.title,
    slideCount: deck.slideCount,
    thumbnailUrl: deck.thumbnailUrl,
    ownerName: deck.owner.name,
    role: 'view',
    participants: deck.participants,
  };
}

/** Creates a guest session for the invite; the caller turns `sessionId` into the cookie. */
export async function joinInvite(
  deps: AppDeps,
  token: string,
  input: JoinInviteInput,
): Promise<{ sessionId: string; viewer: Viewer }> {
  const link = await requireActiveLink(deps, token);
  const [row] = await deps.db
    .insert(guestSessions)
    .values({
      id: crypto.randomUUID(),
      reviewLinkId: link.id,
      name: input.name,
      email: input.email ?? null,
      color: await nextGuestColor(deps, link.deckId),
      createdAt: deps.clock.now(),
    })
    .returning();
  if (!row) throw new Error('Guest session insert returned no row');
  return { sessionId: row.id, viewer: guestViewer(row, link) };
}

/** Hands out the accent colours round-robin per deck, skipping the owner's own colour. */
async function nextGuestColor(deps: AppDeps, deckId: string) {
  const [[owner], [sessions]] = await Promise.all([
    deps.db
      .select({ color: users.color })
      .from(users)
      .innerJoin(decks, eq(decks.ownerId, users.id))
      .where(eq(decks.id, deckId)),
    deps.db
      .select({ count: count() })
      .from(guestSessions)
      .innerJoin(reviewLinks, eq(reviewLinks.id, guestSessions.reviewLinkId))
      .where(eq(reviewLinks.deckId, deckId)),
  ]);
  const palette = ACCENT_COLORS.filter((color) => color !== owner?.color);
  return palette[(sessions?.count ?? 0) % palette.length] ?? 'blue';
}

export const guestViewer = (
  session: GuestSessionRow,
  link: Pick<ReviewLinkRow, 'deckId'>,
): Viewer => ({
  kind: 'guest',
  author: guestAuthor(session),
  deckId: link.deckId,
  // Guests only look (BER-130), whatever an old link says.
  role: 'view',
});
