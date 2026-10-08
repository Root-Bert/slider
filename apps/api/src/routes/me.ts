import { Hono } from 'hono';
import { updateMeInputSchema, type MeResponse } from '@slider/shared';
import { clearGuestCookie, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { updateViewerColor } from '../services/users';

export function meRoutes(deps: AppDeps) {
  return new Hono<ViewerEnv>()
    .get('/me', viewerMiddleware(deps), (c) => c.json<MeResponse>({ viewer: c.var.viewer }))
    .patch('/me', viewerMiddleware(deps), async (c) => {
      const { color } = await readJson(c, updateMeInputSchema);
      const viewer = await updateViewerColor(deps.db, c.var.viewer, color);
      return c.json<MeResponse>({ viewer });
    })
    .post('/session/leave', (c) => {
      clearGuestCookie(c);
      return c.body(null, 204);
    });
}
