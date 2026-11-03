import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import {
  addIntegrationKeyInputSchema,
  instanceListQuerySchema,
  integrationKindSchema,
  instanceTimelineQuerySchema,
  setBlockedInputSchema,
  setWorkspacePlanInputSchema,
  updateIntegrationKeyInputSchema,
  updateIntegrationPolicyInputSchema,
  type InstanceAiUsage,
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
import { keyCheckLimit } from './integrations';
import { instanceAiUsage } from '../services/ai-usage';
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
import {
  addIntegrationKey,
  getIntegrations,
  integrationKeyModels,
  removeIntegrationKey,
  setIntegrationPolicy,
  updateIntegrationKey,
} from '../services/integrations';

/**
 * The instance admin's dashboard `/instanz` (BER-167) and the instance's integrations – its keys
 * for every workspace, and its rules for them (own keys, what they take over): instance admin only.
 */
export function instanceAdminRoutes(deps: AppDeps) {
  const limit = keyCheckLimit(deps);
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
    .get('/instance/ai-usage', async (c) =>
      c.json<InstanceAiUsage>(
        await instanceAiUsage(deps, instanceTimelineQuerySchema.parse(c.req.query())),
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
    })
    .get('/instance/integrations', async (c) =>
      c.json(await getIntegrations(deps, c.var.viewer, null)),
    )
    .patch('/instance/integrations/:kind', async (c) => {
      const kind = integrationKindSchema.parse(c.req.param('kind'));
      const { workspaceId, rule, model } = await readJson(c, updateIntegrationPolicyInputSchema);
      // A model is checked with the key's service.
      if (model) limit(c);
      return c.json(await setIntegrationPolicy(deps, kind, workspaceId, rule, model));
    })
    .post('/instance/integrations/keys', async (c) => {
      limit(c);
      const input = await readJson(c, addIntegrationKeyInputSchema);
      return c.json(await addIntegrationKey(deps, c.var.viewer, null, input));
    })
    .patch('/instance/integrations/keys/:keyId', async (c) => {
      limit(c);
      const input = await readJson(c, updateIntegrationKeyInputSchema);
      return c.json(
        await updateIntegrationKey(deps, c.var.viewer, null, c.req.param('keyId'), input),
      );
    })
    .delete('/instance/integrations/keys/:keyId', async (c) =>
      c.json(await removeIntegrationKey(deps, c.var.viewer, null, c.req.param('keyId'))),
    )
    .get('/instance/integrations/keys/:keyId/models', async (c) => {
      limit(c);
      return c.json(await integrationKeyModels(deps, c.var.viewer, null, c.req.param('keyId')));
    });
}
