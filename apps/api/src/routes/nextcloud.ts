import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import {
  startNextcloudLoginInputSchema,
  type NextcloudListing,
  type NextcloudLoginPoll,
  type NextcloudSettings,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, notFound } from '../http/errors';
import { fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  NextcloudUnauthorized,
  nextcloudLoginRequired,
  normalizePath,
  type NextcloudClient,
} from '../sources/nextcloud';
import { findNextcloudConnection } from '../services/nextcloud-connections';
import { userEmail } from '../services/users';

/**
 * Nextcloud (BER-135): connecting an account with Login Flow v2, and the file browser – Nextcloud
 * has no picker to embed, so the API lists folders, shares and search results and proxies the
 * thumbnails; the app password stays here. A picked file is imported with
 * `POST /decks/nextcloud-item`.
 */

/** Login flows per account and hour: each one makes the server call an address it was given. */
const LOGINS_PER_HOUR = 20;

export function nextcloudRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const logins = fixedWindow({ limit: LOGINS_PER_HOUR, windowMs: 60 * 60_000, clock: deps.clock });
  const loginLimit = createMiddleware<ViewerEnv>(async (c, next) => {
    const hit = logins.hit(c.var.viewer.author.id);
    if (!hit.allowed) {
      c.header('Retry-After', String(hit.retryAfterS));
      throw new ApiError(
        429,
        'rate_limited',
        'Zu viele Anmeldeversuche bei Nextcloud. Bitte versuch es später noch einmal.',
      );
    }
    await next();
  });

  /** Runs `run` with one of the viewer's connections; a refused app password asks to reconnect. */
  const browse = async <T>(
    userId: string,
    connectionId: string,
    run: (client: NextcloudClient) => Promise<T>,
  ): Promise<T> => {
    const client = await deps.sources.nextcloud.client(userId, connectionId);
    try {
      const value = await run(client);
      await deps.nextcloud.markUsed(connectionId);
      return value;
    } catch (error) {
      if (!(error instanceof NextcloudUnauthorized)) throw error;
      await deps.nextcloud.markRefused(connectionId);
      throw nextcloudLoginRequired(client.credentials.server);
    }
  };

  return new Hono<ViewerEnv>()
    .get('/nextcloud/settings', viewer, (c) =>
      c.json<NextcloudSettings>({ server: deps.config.nextcloud.server }),
    )

    .post('/nextcloud/login', viewer, loginLimit, async (c) => {
      requireOwner(c.var.viewer);
      const { server } = await readJson(c, startNextcloudLoginInputSchema);
      const userId = c.var.viewer.author.id;
      // Nextcloud's grant page names the account asking: a forwarded request shows a stranger.
      const email = await userEmail(deps.db, userId);
      return c.json(
        await deps.nextcloud.startLogin(userId, server, {
          requester: email ? `für ${email}` : undefined,
        }),
      );
    })

    .post('/nextcloud/login/:id/poll', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const userId = c.var.viewer.author.id;
      const result = await deps.nextcloud.pollLogin(userId, c.req.param('id'));
      if (result.status !== 'done') return c.json<NextcloudLoginPoll>(result);
      const connection = await findNextcloudConnection(deps.db, userId, result.connectionId);
      if (!connection) throw new Error(`Nextcloud connection ${result.connectionId} vanished`);
      return c.json<NextcloudLoginPoll>({ status: 'done', connection });
    })

    .get('/nextcloud/:connectionId/files', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const path = normalizePath(c.req.query('path') ?? '/');
      if (path.split('/').includes('..')) throw badRequest('Ungültiger Ordner.');
      const entries = await browse(c.var.viewer.author.id, c.req.param('connectionId'), (nc) =>
        nc.listFolder(path),
      );
      return c.json<NextcloudListing>({ path, entries });
    })

    .get('/nextcloud/:connectionId/shared', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const entries = await browse(c.var.viewer.author.id, c.req.param('connectionId'), (nc) =>
        nc.sharedWithMe(),
      );
      return c.json<NextcloudListing>({ path: null, entries });
    })

    .get('/nextcloud/:connectionId/search', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const query = (c.req.query('q') ?? '').trim().slice(0, 100);
      if (query.length < 2) return c.json<NextcloudListing>({ path: null, entries: [] });
      const entries = await browse(c.var.viewer.author.id, c.req.param('connectionId'), (nc) =>
        nc.searchByName(query),
      );
      return c.json<NextcloudListing>({ path: null, entries });
    })

    .get('/nextcloud/:connectionId/preview/:fileId', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const fileId = c.req.param('fileId');
      if (!/^\d+$/.test(fileId)) throw notFound();
      const { bytes, contentType } = await browse(
        c.var.viewer.author.id,
        c.req.param('connectionId'),
        (nc) => nc.preview(fileId),
      );
      c.header('Content-Type', contentType);
      c.header('Cache-Control', 'private, max-age=300');
      c.header('X-Content-Type-Options', 'nosniff');
      return c.body(bytes as Uint8Array<ArrayBuffer>);
    });
}
