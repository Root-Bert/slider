import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import {
  instanceListQuerySchema,
  instanceTimelineQuerySchema,
  setBlockedInputSchema,
  setWorkspacePlanInputSchema,
  type InstanceHistory,
  type InstanceOverview,
  type InstanceTimeline,
  type InstanceUser,
  type InstanceUserList,
  type InstanceWorkspace,
  type InstanceWorkspaceList,
} from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import {
  instanceHistory,
  instanceOverview,
  instanceTimeline,
  listInstanceUsers,
  listInstanceWorkspaces,
  requireInstanceAdmin,
  setUserBlocked,
  setWorkspaceBlocked,
  setWorkspacePlan,
} from '../services/instance-admin';

/** The instance admin's dashboard `/instanz` (BER-167): instance admin only. */
export function instanceAdminRoutes(deps: AppDeps) {
  const admin = createMiddleware<ViewerEnv>(async (c, next) => {
    await requireInstanceAdmin(deps.db, c.var.viewer);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  return new Hono<ViewerEnv>()
    .use('/instance/*', viewerMiddleware(deps), admin)
    .get('/instance/overview', async (c) => c.json<InstanceOverview>(await instanceOverview(deps)))
    .get('/instance/timeline', async (c) =>
      c.json<InstanceTimeline>(
        await instanceTimeline(deps, instanceTimelineQuerySchema.parse(c.req.query())),
      ),
    )
    .get('/instance/history', async (c) => c.json<InstanceHistory>(await instanceHistory(deps)))
    .get('/instance/users', async (c) =>
      c.json<InstanceUserList>(
        await listInstanceUsers(deps, instanceListQuerySchema.parse(c.req.query())),
      ),
    )
    .put('/instance/users/:userId/blocked', async (c) => {
      const { blocked } = await readJson(c, setBlockedInputSchema);
      return c.json<InstanceUser>(
        await setUserBlocked(deps, c.var.viewer.author.id, c.req.param('userId'), blocked),
      );
    })
    .get('/instance/workspaces', async (c) =>
      c.json<InstanceWorkspaceList>(
        await listInstanceWorkspaces(deps, instanceListQuerySchema.parse(c.req.query())),
      ),
    )
    .put('/instance/workspaces/:workspaceId/blocked', async (c) => {
      const { blocked } = await readJson(c, setBlockedInputSchema);
      return c.json<InstanceWorkspace>(
        await setWorkspaceBlocked(deps, c.req.param('workspaceId'), blocked),
      );
    })
    .put('/instance/workspaces/:workspaceId/plan', async (c) => {
      const { plan } = await readJson(c, setWorkspacePlanInputSchema);
      return c.json<InstanceWorkspace>(
        await setWorkspacePlan(deps, c.req.param('workspaceId'), plan),
      );
    });
}
