import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { LIVE_EVENT, livePresenceInputSchema } from '@slider/shared';
import { requireDeckAccess } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { notFound } from '../http/errors';
import { readJson } from '../http/validate';
import type { LiveHub } from '../realtime/live-hub';

/**
 * Keeps idle streams open through proxies and runtimes that close quiet connections (Bun's
 * default idle timeout is 10 s); a comment line, ignored by `EventSource`.
 */
const HEARTBEAT_MS = 5_000;

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
        return streamSSE(c, async (stream) => {
          const connectionId = hub.join(
            deck.id,
            author,
            (event) => {
              if (stream.aborted || stream.closed) return;
              stream
                .writeSSE({ event: LIVE_EVENT, data: JSON.stringify(event) })
                .catch(() => hub.leave(connectionId));
            },
            tab,
          );
          stream.onAbort(() => hub.leave(connectionId));
          try {
            // Ends once the hub dropped the connection (goodbye, timeout): the browser reconnects.
            while (!stream.aborted && !stream.closed && hub.has(connectionId)) {
              await stream.sleep(HEARTBEAT_MS);
              await stream.write(': ping\n\n');
            }
          } finally {
            hub.leave(connectionId);
          }
        });
      })

      /**
       * Presence of one connection, posted while the pointer moves (throttled by the client).
       * No session lookup per move: the connection id from `hello` is the credential.
       */
      .post('/live/:connectionId', async (c) => {
        const input = await readJson(c, livePresenceInputSchema);
        if (!hub.update(c.req.param('connectionId'), input)) {
          throw notFound('Diese Live-Verbindung gibt es nicht mehr.');
        }
        return c.body(null, 204);
      })

      /** Goodbye (viewer closed, tab gone – sent as a beacon): the others drop the cursor now. */
      .post('/live/:connectionId/leave', (c) => {
        hub.leave(c.req.param('connectionId'));
        return c.body(null, 204);
      })
  );
}
