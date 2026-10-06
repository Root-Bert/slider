import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Viewer } from '@slider/shared';
import { ownerAuthor } from '../authors';
import { guestSessions, reviewLinks, users } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { guestViewer } from '../services/review-links';
import { LINK_EXPIRED_MESSAGE, LINK_REVOKED_MESSAGE, reviewLinkState } from './review-link-state';

export const GUEST_COOKIE = 'slider_guest';
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type ViewerEnv = { Variables: { viewer: Viewer } };

/**
 * Resolves who is calling and exposes it as `c.var.viewer`.
 * A valid signed guest cookie makes the caller a guest scoped to one deck. Anyone else is
 * the dev owner – Microsoft login is not configured yet (BER-92), so this prototype trusts
 * every cookie-less request. That is the one thing to replace before exposing it publicly.
 */
export function viewerMiddleware(deps: AppDeps) {
  return createMiddleware<ViewerEnv>(async (c, next) => {
    c.set('viewer', await resolveViewer(c, deps));
    await next();
  });
}

async function resolveViewer(c: Context, deps: AppDeps): Promise<Viewer> {
  const sessionId = await getSignedCookie(c, deps.config.secret, GUEST_COOKIE);
  if (sessionId) {
    const guest = await loadGuestViewer(deps, sessionId);
    if (guest) return guest;
    // Unknown session (e.g. after a reseed): drop the stale cookie.
    clearGuestCookie(c);
  }
  return loadOwnerViewer(deps);
}

async function loadGuestViewer(deps: AppDeps, sessionId: string): Promise<Viewer | null> {
  const [row] = await deps.db
    .select({ session: guestSessions, link: reviewLinks })
    .from(guestSessions)
    .innerJoin(reviewLinks, eq(reviewLinks.id, guestSessions.reviewLinkId))
    .where(eq(guestSessions.id, sessionId));
  if (!row) return null;

  const state = reviewLinkState(row.link, deps.clock.now());
  if (state === 'revoked') throw new ApiError(403, 'link_revoked', LINK_REVOKED_MESSAGE);
  if (state === 'expired') throw new ApiError(403, 'link_expired', LINK_EXPIRED_MESSAGE);

  return guestViewer(row.session, row.link);
}

export async function loadOwnerViewer(deps: AppDeps): Promise<Viewer> {
  const [owner] = await deps.db.select().from(users).where(eq(users.id, deps.ownerId));
  if (!owner) throw new Error(`Dev owner ${deps.ownerId} does not exist`);
  return { kind: 'owner', author: ownerAuthor(owner) };
}

export async function setGuestCookie(c: Context, deps: AppDeps, sessionId: string): Promise<void> {
  await setSignedCookie(c, GUEST_COOKIE, sessionId, deps.config.secret, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: deps.config.env === 'production',
    maxAge: GUEST_COOKIE_MAX_AGE,
  });
}

export function clearGuestCookie(c: Context): void {
  deleteCookie(c, GUEST_COOKIE, { path: '/' });
}
