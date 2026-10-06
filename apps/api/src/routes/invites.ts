import { Hono } from 'hono';
import { joinInviteInputSchema, type MeResponse } from '@slider/shared';
import { setGuestCookie } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { rateLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { getInviteInfo, joinInvite } from '../services/review-links';

/** Public: anyone holding a token may look at the invite and join as a guest (BER-102). */
export function invitesRoutes(deps: AppDeps) {
  const limited = rateLimit({
    limit: deps.config.inviteRateLimit,
    windowMs: 60_000,
    clock: deps.clock,
  });

  return new Hono()
    .use('/invites/*', limited)
    .get('/invites/:token', async (c) => c.json(await getInviteInfo(deps, c.req.param('token'))))
    .post('/invites/:token/join', async (c) => {
      const input = await readJson(c, joinInviteInputSchema);
      const { sessionId, viewer } = await joinInvite(deps, c.req.param('token'), input);
      await setGuestCookie(c, deps, sessionId);
      return c.json<MeResponse>({ viewer });
    });
}
