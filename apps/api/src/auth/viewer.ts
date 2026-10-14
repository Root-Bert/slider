import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Viewer } from '@slider/shared';
import { ownerAuthor } from '../authors';
import { users, type UserRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { loadSessionUser } from './session';

export type ViewerEnv = { Variables: { viewer: Viewer } };
/** For routes anonymous callers may use too (login, public previews). */
export type OptionalViewerEnv = { Variables: { viewer: Viewer | null } };

export const unauthorized = () => new ApiError(401, 'unauthorized', 'Bitte melde dich an.');

/**
 * Resolves who is calling and exposes it as `c.var.viewer`; anonymous callers get 401.
 * Order: the login session cookie (a signed-in account, `kind: 'owner'`) → with `auth.devLogin`
 * the dev owner → nobody. There are no guests: every viewer is an account (members only).
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
  const user = await loadSessionUser(c, deps);
  if (user) return userViewer(user);
  if (deps.config.auth.devLogin && deps.ownerId) return loadOwnerViewer(deps, deps.ownerId);
  return null;
}

export const userViewer = (user: UserRow): Viewer => ({ kind: 'owner', author: ownerAuthor(user) });

async function loadOwnerViewer(deps: AppDeps, userId: string): Promise<Viewer> {
  const [owner] = await deps.db.select().from(users).where(eq(users.id, userId));
  if (!owner) throw new Error(`Dev owner ${userId} does not exist`);
  return userViewer(owner);
}
