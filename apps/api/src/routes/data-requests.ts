import { Hono } from 'hono';
import {
  confirmDataDeletionInputSchema,
  createDataRequestInputSchema,
  type DataRequestInfo,
  type SuccessorChoice,
} from '@slider/shared';
import { endSession, loadSessionUser } from '../auth/session';
import type { AppDeps } from '../deps';
import { badRequest } from '../http/errors';
import { fixedWindow, rateLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { successorChoices } from '../services/account-deletion';
import { exportAccount } from '../services/account-export';
import { normalizeEmail } from '../services/accounts';
import {
  deleteRequested,
  exportInvites,
  requestData,
  resolveDataRequest,
} from '../services/data-requests';
import { markActive } from '../services/users';
import { zipResponse } from './me';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Data requests without login (BER-146): `/datenanfrage` asks, the mailed link (`/daten/:token`)
 * acts. No session needed – the token proves the mailbox.
 */
export function dataRequestsRoutes(deps: AppDeps) {
  const perClient = rateLimit({ limit: 10, windowMs: HOUR_MS, clock: deps.clock });
  // Per address: nobody fills someone's mailbox. Over the limit nothing is sent, the answer stays.
  const perAddress = fixedWindow({ limit: 3, windowMs: HOUR_MS, clock: deps.clock });

  return (
    new Hono()
      .post('/data-requests', perClient, async (c) => {
        const { email, purpose } = await readJson(c, createDataRequestInputSchema);
        if (perAddress.hit(normalizeEmail(email)).allowed) await requestData(deps, email, purpose);
        return c.json({ ok: true }, 202);
      })
      .get('/data-requests/:token', async (c) => {
        const request = await resolveDataRequest(deps, c.req.param('token'));
        c.header('Cache-Control', 'no-store');
        return c.json<DataRequestInfo>({
          purpose: request.purpose,
          email: request.user?.email ?? request.email,
          hasAccount: request.user !== null,
          expiresAt: request.expiresAt.toISOString(),
        });
      })
      .get('/data-requests/:token/export', async (c) => {
        const request = await resolveDataRequest(deps, c.req.param('token'));
        if (request.purpose !== 'export')
          throw badRequest('Dieser Link ist nicht zum Herunterladen.');
        return zipResponse(
          c,
          request.user
            ? await exportAccount(deps, request.user.id)
            : await exportInvites(deps, request.email),
        );
      })
      /** Where the account is the only admin: who could take over (chosen on the page). */
      .get('/data-requests/:token/successors', async (c) => {
        const request = await resolveDataRequest(deps, c.req.param('token'));
        if (request.purpose !== 'delete') throw badRequest('Dieser Link ist nicht zum Löschen.');
        return c.json<SuccessorChoice[]>(
          request.user ? await successorChoices(deps.db, request.user.id) : [],
        );
      })
      .post('/data-requests/:token/delete', async (c) => {
        const request = await resolveDataRequest(deps, c.req.param('token'));
        if (request.purpose !== 'delete') throw badRequest('Dieser Link ist nicht zum Löschen.');
        // Without a body: nothing chosen (enough for invitations only).
        const { successors } = c.req.header('content-type')?.includes('json')
          ? await readJson(c, confirmDataDeletionInputSchema)
          : { successors: {} };
        // Only sign out if this browser is the deleted account – not someone else opening the link.
        const signedIn = request.user ? await loadSessionUser(c, deps, { readOnly: true }) : null;
        await deleteRequested(deps, request, successors);
        if (signedIn && signedIn.id === request.user?.id) await endSession(c, deps);
        return c.body(null, 204);
      })
      .post('/data-requests/:token/keep', async (c) => {
        const request = await resolveDataRequest(deps, c.req.param('token'));
        if (request.purpose !== 'keep' || !request.user) {
          throw badRequest('Dieser Link ist nicht zum Behalten des Kontos.');
        }
        await markActive(deps.db, request.user.id, deps.clock.now());
        return c.body(null, 204);
      })
  );
}
