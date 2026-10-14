import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { updateMeInputSchema, type MeResponse, type Viewer } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { users } from '../db/schema';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { updateViewerColor } from '../services/users';
import { canCreateWorkspace } from '../services/plans';
import { listWorkspaces, pendingInvitesFor } from '../services/workspaces';

/** The signed-in account with its workspaces and invitations. */
async function meResponse(deps: AppDeps, viewer: Viewer): Promise<MeResponse> {
  const [user] = await deps.db.select().from(users).where(eq(users.id, viewer.author.id));
  if (!user) return { viewer };
  const [workspaces, pendingInvites, mayFound] = await Promise.all([
    listWorkspaces(deps, user.id),
    pendingInvitesFor(deps.db, user, deps.clock.now()),
    canCreateWorkspace(deps.db, deps.config, user.id),
  ]);
  return {
    viewer,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      color: user.color,
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
    });
}
