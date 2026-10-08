import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { updateMeInputSchema, type MeResponse, type Viewer } from '@slider/shared';
import { clearGuestCookie, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { users } from '../db/schema';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { fileUrl } from '../storage/blob-storage';
import { updateViewerColor } from '../services/users';
import { canCreateWorkspace } from '../services/plans';
import { listWorkspaces, pendingInvitesFor } from '../services/workspaces';

/** Guests get their viewer; signed-in accounts also their account, workspaces and invitations. */
async function meResponse(deps: AppDeps, viewer: Viewer): Promise<MeResponse> {
  if (viewer.kind === 'guest') return { viewer };
  const [user] = await deps.db.select().from(users).where(eq(users.id, viewer.author.id));
  if (!user) return { viewer };
  const [workspaces, pendingInvites, mayFound] = await Promise.all([
    listWorkspaces(deps, user.id),
    pendingInvitesFor(deps.db, user, deps.clock.now()),
    canCreateWorkspace(deps.db, user.id),
  ]);
  return {
    viewer,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      color: user.color,
      avatarUrl: user.avatarKey ? fileUrl(user.avatarKey) : null,
      isInstanceAdmin: user.isInstanceAdmin,
      microsoftConnected: user.msRefreshToken !== null,
    },
    workspaces,
    pendingInvites,
    limits: { canCreateWorkspace: mayFound },
  };
}

export function meRoutes(deps: AppDeps) {
  return new Hono<ViewerEnv>()
    .get('/me', viewerMiddleware(deps), async (c) =>
      c.json<MeResponse>(await meResponse(deps, c.var.viewer)),
    )
    .patch('/me', viewerMiddleware(deps), async (c) => {
      const { color } = await readJson(c, updateMeInputSchema);
      const viewer = await updateViewerColor(deps.db, c.var.viewer, color);
      return c.json<MeResponse>(await meResponse(deps, viewer));
    })
    .post('/session/leave', (c) => {
      clearGuestCookie(c);
      return c.body(null, 204);
    });
}
