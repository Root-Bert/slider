import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { LIVE_EVENT, livePresenceInputSchema } from '@slider/shared';
import { requireDeckAccess } from '../auth/access';
import { resolveViewer, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, notFound } from '../http/errors';
import { readJson } from '../http/validate';
import type { LiveHub } from '../realtime/live-hub';

/** A tab id from the query (`?tab=…&replaces=…`): something short and plain, else none. */
const tabId = (value: string | undefined) => (value && /^[\w-]{8,64}$/.test(value) ? value : null);

/** Realtime in the viewer (BER-104): presence, live cursors, live comments. */
export function liveRoutes(deps: AppDeps, hub: LiveHub) {
  const viewer = viewerMiddleware(deps);

  return (
    new Hono<ViewerEnv>()
      /** The deck's event stream (SSE); open as long as the viewer is. */
      .get('/decks/:deckId/live', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'view');
        const author = c.var.viewer.author;
        const tab = { tab: tabId(c.req.query('tab')), replaces: tabId(c.req.query('replaces')) };
        // nginx & co. would otherwise buffer the stream.
        c.header('X-Accel-Buffering', 'no');
        /** Still signed in as the same person, and still allowed to see the deck? */
        const stillAllowed = async () => {
          try {
            const current = await resolveViewer(c, deps);
            if (current?.author.id !== author.id) return false;
            await requireDeckAccess(deps.db, current, deck.id, 'view');
            return true;
          } catch (error) {
            // Removed from the workspace, deck deleted: end. A database hiccup: keep going.
            if (error instanceof ApiError) return false;
            deps.log.warn(`Live access check for deck ${deck.id} failed`, error);
            return true;
          }
        };
        return streamSSE(c, async (stream) => {
          const connectionKey = hub.join(
            deck.id,
            author,
            (event) => {
              if (stream.aborted || stream.closed) return;
              stream
                .writeSSE({ event: LIVE_EVENT, data: JSON.stringify(event) })
                .catch(() => hub.leave(connectionKey));
            },
            tab,
            () => {
              void stream.close().catch(() => {});
            },
          );
          stream.onAbort(() => hub.leave(connectionKey));
          const open = () => !stream.aborted && !stream.closed && hub.has(connectionKey);
          let checkedAt = Date.now();
          try {
            // Ends once the hub dropped the connection (goodbye, timeout, shutdown) or access is
            // gone; the browser reconnects – and gets a 404 if it may no longer see the deck.
            while (open()) {
              await stream.sleep(hub.heartbeatMs);
              if (!open()) break;
              if (Date.now() - checkedAt >= hub.accessCheckMs) {
                checkedAt = Date.now();
                if (!(await stillAllowed())) break;
              }
              await stream.write(': ping\n\n');
            }
          } finally {
            hub.leave(connectionKey);
          }
        });
      })

      /**
       * Presence of one connection, posted while the pointer moves (throttled by the client).
       * No session lookup per move: the secret key from `hello` is the credential. Unknown keys
       * are turned away before the body is read.
       */
      .post('/live/:key', async (c) => {
        const key = c.req.param('key');
        const gone = () => notFound('Diese Live-Verbindung gibt es nicht mehr.');
        if (!hub.has(key)) throw gone();
        const input = await readJson(c, livePresenceInputSchema);
        if (!hub.update(key, input)) throw gone();
        return c.body(null, 204);
      })

      /** Goodbye (viewer closed, tab gone – sent as a beacon): the others drop the cursor now. */
      .post('/live/:key/leave', (c) => {
        hub.leave(c.req.param('key'));
        return c.body(null, 204);
      })
  );
}
