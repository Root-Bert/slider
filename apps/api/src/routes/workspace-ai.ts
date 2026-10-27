import { Hono } from 'hono';
import { addWorkspaceAiKeyInputSchema, updateWorkspaceAiKeyInputSchema } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import {
  addWorkspaceAiKey,
  getWorkspaceAi,
  removeWorkspaceAiKey,
  updateWorkspaceAiKey,
  workspaceAiModels,
} from '../services/workspace-ai';

/** The workspace's AI keys (BER-183) – several, one active, each with its model; admins only. */
export function workspaceAiRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  return new Hono<ViewerEnv>()
    .get('/workspaces/:workspaceId/ai', viewer, async (c) =>
      c.json(await getWorkspaceAi(deps, c.var.viewer, c.req.param('workspaceId'))),
    )
    .post('/workspaces/:workspaceId/ai/keys', viewer, async (c) => {
      const input = await readJson(c, addWorkspaceAiKeyInputSchema);
      return c.json(await addWorkspaceAiKey(deps, c.var.viewer, c.req.param('workspaceId'), input));
    })
    .patch('/workspaces/:workspaceId/ai/keys/:keyId', viewer, async (c) => {
      const input = await readJson(c, updateWorkspaceAiKeyInputSchema);
      return c.json(
        await updateWorkspaceAiKey(
          deps,
          c.var.viewer,
          c.req.param('workspaceId'),
          c.req.param('keyId'),
          input,
        ),
      );
    })
    .delete('/workspaces/:workspaceId/ai/keys/:keyId', viewer, async (c) =>
      c.json(
        await removeWorkspaceAiKey(
          deps,
          c.var.viewer,
          c.req.param('workspaceId'),
          c.req.param('keyId'),
        ),
      ),
    )
    .get('/workspaces/:workspaceId/ai/keys/:keyId/models', viewer, async (c) =>
      c.json(
        await workspaceAiModels(
          deps,
          c.var.viewer,
          c.req.param('workspaceId'),
          c.req.param('keyId'),
        ),
      ),
    );
}
