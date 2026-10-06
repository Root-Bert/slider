import { Hono } from 'hono';
import type { MeResponse } from '@slider/shared';
import { clearGuestCookie, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';

export function meRoutes(deps: AppDeps) {
  return new Hono<ViewerEnv>()
    .get('/me', viewerMiddleware(deps), (c) => c.json<MeResponse>({ viewer: c.var.viewer }))
    .post('/session/leave', (c) => {
      clearGuestCookie(c);
      return c.body(null, 204);
    });
}
