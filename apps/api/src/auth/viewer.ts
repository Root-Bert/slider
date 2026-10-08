import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Viewer } from '@slider/shared';
import { ownerAuthor } from '../authors';
import { guestSessions, reviewLinks, users, type UserRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { guestViewer } from '../services/review-links';
import { LINK_EXPIRED_MESSAGE, LINK_REVOKED_MESSAGE, reviewLinkState } from './review-link-state';
import { loadSessionUser } from './session';

export const GUEST_COOKIE = 'slider_guest';
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type ViewerEnv = { Variables: { viewer: Viewer } };
/** For routes anonymous callers may use too (login, public previews). */
export type OptionalViewerEnv = { Variables: { viewer: Viewer | null } };

export const unauthorized = () => new ApiError(401, 'unauthorized', 'Bitte melde dich an.');

/**
 * Resolves who is calling and exposes it as `c.var.viewer`; anonymous callers get 401.
 * Order: a valid signed guest cookie (a guest scoped to one deck) → the login session cookie
 * (a signed-in account, `kind: 'owner'`) → with `auth.devLogin` the dev owner → nobody.
 */
export function viewerMiddleware(deps: AppDeps) {
  return createMiddleware<ViewerEnv>(async (c, next) => {
    const viewer = await resolveViewer(c, deps);
    if (!viewer) throw unauthorized();
    c.set('viewer', viewer);
    await next();
  });
}

/** Like {@link viewerMiddleware}, but lets anonymous callers through with `viewer: null`. */
export function optionalViewerMiddleware(deps: AppDeps) {
  return createMiddleware<OptionalViewerEnv>(async (c, next) => {
    c.set('viewer', await resolveViewer(c, deps));
    await next();
  });
}

export async function resolveViewer(c: Context, deps: AppDeps): Promise<Viewer | null> {
  const sessionId = await getSignedCookie(c, deps.config.secret, GUEST_COOKIE);
  let linkError: ApiError | null = null;
  if (sessionId) {
    try {
      const guest = await loadGuestViewer(deps, sessionId);
      if (guest) return guest;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      linkError = error;
    }
    // Unknown, revoked or expired session: drop the stale cookie – a signed-in account behind
    // it must not be locked out by a review link it once opened.
    clearGuestCookie(c);
  }
  const user = await loadSessionUser(c, deps);
  if (user) return userViewer(user);
  // Only a pure guest learns why the link stopped working.
  if (linkError) throw linkError;
  if (deps.config.auth.devLogin && deps.ownerId) return loadOwnerViewer(deps, deps.ownerId);
  return null;
}

export const userViewer = (user: UserRow): Viewer => ({ kind: 'owner', author: ownerAuthor(user) });

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

async function loadOwnerViewer(deps: AppDeps, userId: string): Promise<Viewer> {
  const [owner] = await deps.db.select().from(users).where(eq(users.id, userId));
  if (!owner) throw new Error(`Dev owner ${userId} does not exist`);
  return userViewer(owner);
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
