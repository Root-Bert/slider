import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { billingTransferInputSchema } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, badRequest } from '../http/errors';
import { readJson } from '../http/validate';
import {
  acceptTransfer,
  cancelTransfer,
  getUsageDetails,
  handleStripeEvent,
  openPortal,
  requestTransfer,
  startCheckout,
} from '../services/billing';

/** Stripe signs webhook bodies of a few KB; anything far bigger is not from Stripe. */
const MAX_WEBHOOK_BYTES = 512 * 1024;

/** "Nutzung" (BER-153), the paid plan (BER-152) and who pays (BER-154). */
export function billingRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const userId = (c: { var: { viewer: ViewerEnv['Variables']['viewer'] } }) => {
    requireOwner(c.var.viewer);
    return c.var.viewer.author.id;
  };

  return (
    new Hono<ViewerEnv>()
      .get('/workspaces/:id/usage', viewer, async (c) =>
        c.json(await getUsageDetails(deps, userId(c), c.req.param('id'))),
      )
      .post('/workspaces/:id/billing/checkout', viewer, async (c) =>
        c.json(await startCheckout(deps, userId(c), c.req.param('id'))),
      )
      .post('/workspaces/:id/billing/portal', viewer, async (c) =>
        c.json(await openPortal(deps, userId(c), c.req.param('id'))),
      )
      .post('/workspaces/:id/billing/transfer', viewer, async (c) => {
        const { userId: targetId } = await readJson(c, billingTransferInputSchema);
        return c.json(await requestTransfer(deps, userId(c), c.req.param('id'), targetId));
      })
      .delete('/workspaces/:id/billing/transfer', viewer, async (c) =>
        c.json(await cancelTransfer(deps, userId(c), c.req.param('id'))),
      )
      .post('/workspaces/:id/billing/transfer/accept', viewer, async (c) =>
        c.json(await acceptTransfer(deps, userId(c), c.req.param('id'))),
      )
      /** Stripe → Slider: no session, the signature over the raw body is the authentication. */
      .post(
        '/billing/webhook',
        // Refused while it streams in: nobody makes the server hold a huge body before the check.
        bodyLimit({
          maxSize: MAX_WEBHOOK_BYTES,
          onError: (c) => c.json(badRequest('Zu groß.').toBody(), 400),
        }),
        async (c) => {
          if (!deps.billing || !deps.config.billing) {
            throw new ApiError(404, 'not_found', 'Auf dieser Instanz gibt es keine Bezahlung.');
          }
          const signature = c.req.header('stripe-signature');
          if (!signature) throw badRequest('Stripe-Signatur fehlt.');
          const payload = await c.req.text();
          let event;
          try {
            event = await deps.billing.verifyEvent(payload, signature);
          } catch {
            throw badRequest('Ungültige Stripe-Signatur.');
          }
          await handleStripeEvent(deps, event);
          return c.json({ received: true });
        },
      )
  );
}
