import { Hono, type Context } from 'hono';
import {
  API_PREFIX,
  CLOUD_CONNECTION_CALLBACK_PATH,
  cloudConnectionInputSchema,
  cloudConnectionPatchSchema,
  cloudConnectionSignInPath,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { badRequest } from '../http/errors';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  addCloudConnection,
  checkCloudConnection,
  finishCloudConnectionSignIn,
  listCloudConnections,
  removeCloudConnection,
  setCloudConnectionMayChange,
  startCloudConnectionSignIn,
} from '../services/cloud-connections';

/** A path of shared (`/api/…`) as this router knows it. */
const local = (path: string) => path.slice(API_PREFIX.length);

/**
 * „Verbindungen“ (`services/cloud-connections.ts`): the services outside a person connected for
 * their agents. Each is its person's own – nobody else lists, changes or signs in to it. The
 * two GETs are where a browser goes: to the service to sign in, and back from it.
 */
export function cloudConnectionRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  /** Connecting and checking reach a server outside each time: a few a minute per person. */
  const limited = (c: Context<ViewerEnv>) =>
    assertWithinLimit(
      c,
      aiLimits(deps).connectionChecks.hit(c.var.viewer.author.id),
      'Zu viele Versuche in kurzer Zeit. Warte einen Moment.',
    );
  return new Hono<ViewerEnv>()
    .get('/workspaces/:id/cloud/connections', viewer, async (c) => {
      requireOwner(c.var.viewer);
      return c.json(await listCloudConnections(deps, c.var.viewer.author.id, c.req.param('id')));
    })
    .post('/workspaces/:id/cloud/connections', viewer, async (c) => {
      requireOwner(c.var.viewer);
      limited(c);
      const input = await readJson(c, cloudConnectionInputSchema);
      return c.json(
        await addCloudConnection(deps, c.var.viewer.author.id, c.req.param('id'), input),
        201,
      );
    })
    .get(local(CLOUD_CONNECTION_CALLBACK_PATH), viewer, async (c) => {
      requireOwner(c.var.viewer);
      const state = c.req.query('state');
      if (!state) throw badRequest('Die Anmeldung ist abgelaufen.');
      return c.redirect(
        await finishCloudConnectionSignIn(
          deps,
          c.var.viewer.author.id,
          state,
          c.req.query('code') ?? null,
        ),
      );
    })
    .get(local(cloudConnectionSignInPath(':connectionId')), viewer, async (c) => {
      requireOwner(c.var.viewer);
      return c.redirect(
        await startCloudConnectionSignIn(
          deps,
          c.var.viewer.author.id,
          c.req.param('connectionId') ?? '',
        ),
      );
    })
    .post('/cloud/connections/:connectionId/check', viewer, async (c) => {
      requireOwner(c.var.viewer);
      limited(c);
      return c.json(
        await checkCloudConnection(deps, c.var.viewer.author.id, c.req.param('connectionId')),
      );
    })
    .patch('/cloud/connections/:connectionId', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { mayChange } = await readJson(c, cloudConnectionPatchSchema);
      await setCloudConnectionMayChange(
        deps,
        c.var.viewer.author.id,
        c.req.param('connectionId'),
        mayChange,
      );
      return c.body(null, 204);
    })
    .delete('/cloud/connections/:connectionId', viewer, async (c) => {
      requireOwner(c.var.viewer);
      await removeCloudConnection(deps, c.var.viewer.author.id, c.req.param('connectionId'));
      return c.body(null, 204);
    });
}
