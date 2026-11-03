import { Hono, type Context } from 'hono';
import {
  addIntegrationKeyInputSchema,
  integrationKindSchema,
  setInheritedModelInputSchema,
  updateIntegrationKeyInputSchema,
  updateWorkspaceAiInputSchema,
} from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  addIntegrationKey,
  getIntegrations,
  inheritedModels,
  integrationKeyModels,
  removeIntegrationKey,
  setInheritedModel,
  updateIntegrationKey,
  updateWorkspaceAi,
} from '../services/integrations';

/**
 * Every key added, changed or listed is asked of its service: limited per person, so the server
 * is no oracle for leaked keys and sends no flood of requests to a service on anyone's behalf.
 */
export function keyCheckLimit(deps: AppDeps) {
  const perPerson = fixedWindow({ limit: 60, windowMs: 15 * 60_000, clock: deps.clock });
  return (c: Context<ViewerEnv>) =>
    assertWithinLimit(
      c,
      perPerson.hit(c.var.viewer.author.id),
      'Zu viele Prüfungen von API-Keys. Bitte kurz warten und erneut versuchen.',
    );
}

/**
 * A workspace's integrations (BER-183): the AI's name and the keys of the AI, speech to text and
 * photos – several per kind, one active; admins only, and only the kinds the instance lets them
 * store keys of – and the model the instance's key runs on, where the instance lets them pick it.
 * The instance's own: `instanceAdminRoutes`.
 */
export function integrationsRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const limit = keyCheckLimit(deps);
  return new Hono<ViewerEnv>()
    .get('/workspaces/:workspaceId/integrations', viewer, async (c) =>
      c.json(await getIntegrations(deps, c.var.viewer, c.req.param('workspaceId'))),
    )
    .patch('/workspaces/:workspaceId/ai', viewer, async (c) => {
      const input = await readJson(c, updateWorkspaceAiInputSchema);
      return c.json(await updateWorkspaceAi(deps, c.var.viewer, c.req.param('workspaceId'), input));
    })
    .post('/workspaces/:workspaceId/integrations/keys', viewer, async (c) => {
      limit(c);
      const input = await readJson(c, addIntegrationKeyInputSchema);
      return c.json(await addIntegrationKey(deps, c.var.viewer, c.req.param('workspaceId'), input));
    })
    .patch('/workspaces/:workspaceId/integrations/keys/:keyId', viewer, async (c) => {
      limit(c);
      const input = await readJson(c, updateIntegrationKeyInputSchema);
      return c.json(
        await updateIntegrationKey(
          deps,
          c.var.viewer,
          c.req.param('workspaceId'),
          c.req.param('keyId'),
          input,
        ),
      );
    })
    .delete('/workspaces/:workspaceId/integrations/keys/:keyId', viewer, async (c) =>
      c.json(
        await removeIntegrationKey(
          deps,
          c.var.viewer,
          c.req.param('workspaceId'),
          c.req.param('keyId'),
        ),
      ),
    )
    .get('/workspaces/:workspaceId/integrations/keys/:keyId/models', viewer, async (c) => {
      limit(c);
      return c.json(
        await integrationKeyModels(
          deps,
          c.var.viewer,
          c.req.param('workspaceId'),
          c.req.param('keyId'),
        ),
      );
    })
    .get('/workspaces/:workspaceId/integrations/instance/:kind/models', viewer, async (c) => {
      limit(c);
      const kind = integrationKindSchema.parse(c.req.param('kind'));
      return c.json(await inheritedModels(deps, c.var.viewer, c.req.param('workspaceId'), kind));
    })
    .put('/workspaces/:workspaceId/integrations/instance/:kind/model', viewer, async (c) => {
      limit(c);
      const kind = integrationKindSchema.parse(c.req.param('kind'));
      const input = await readJson(c, setInheritedModelInputSchema);
      return c.json(
        await setInheritedModel(deps, c.var.viewer, c.req.param('workspaceId'), kind, input),
      );
    });
}
