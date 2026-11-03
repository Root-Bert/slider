import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  LIVE_EVENT,
  liveTextJoinInputSchema,
  liveTextLeaveInputSchema,
  liveTextUpdateInputSchema,
  livePresenceInputSchema,
} from '@slider/shared';
import { requireDeckAccess } from '../auth/access';
import { resolveViewer, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, notFound } from '../http/errors';
import { readJson } from '../http/validate';
import type { LiveHub } from '../realtime/live-hub';
import type { LiveTexts } from '../realtime/live-texts';
import { liveParagraphsOf } from '../services/edits';
import type { WorkspacePresence } from '../realtime/workspace-presence';
import { getRole } from '../services/workspaces';

/** A tab id from the query (`?tab=…&replaces=…`): something short and plain, else none. */
const tabId = (value: string | undefined) => (value && /^[\w-]{8,64}$/.test(value) ? value : null);

/** Realtime in the viewer (BER-104): presence, live cursors, live comments. */
export function liveRoutes(
  deps: AppDeps,
  hub: LiveHub,
  presence: WorkspacePresence,
  texts: LiveTexts,
) {
  const viewer = viewerMiddleware(deps);
  const gone = () => notFound('Diese Live-Verbindung gibt es nicht mehr.');

  return (
    new Hono<ViewerEnv>()
      /** The deck's event stream (SSE); open as long as the viewer is. */
      .get('/decks/:deckId/live', viewer, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'view');
        const author = c.var.viewer.author;
        const tab = { tab: tabId(c.req.query('tab')), replaces: tabId(c.req.query('replaces')) };
        // Before the stream starts: the browser backs off and retries (the client's reconnect).
        if (!hub.admits(deck.id, author.id, tab)) {
          c.header('Retry-After', '30');
          throw new ApiError(
            429,
            'rate_limited',
            'Du hast Slider in sehr vielen Tabs offen. Schließ ein paar davon und lade die Seite neu.',
          );
        }
        // Someone in a deck is online in its workspace too – members only, not guests by link.
        const member =
          author.type === 'owner' && (await getRole(deps.db, deck.workspaceId, author.id)) !== null;
        const markOnline = () => {
          if (member) presence.touch(deck.workspaceId, author);
        };
        // nginx & co. would otherwise buffer the stream.
        c.header('X-Accel-Buffering', 'no');
        /**
         * Still signed in as the same person, and still allowed to see the deck? Typing in a text
         * together needs the right to edit it (as joining did): lost, the connection leaves its
         * texts – its updates are refused from then on, and joining again is too.
         */
        const stillAllowed = async (key: string) => {
          try {
            // Read-only: the response is already streaming, so a cookie write would throw.
            const current = await resolveViewer(c, deps, { readOnly: true });
            if (current?.author.id !== author.id) return false;
            await requireDeckAccess(deps, current, deck.id, 'view');
            if (texts.typesIn(key)) {
              await requireDeckAccess(deps, current, deck.id, 'own').catch((error: unknown) => {
                if (!(error instanceof ApiError)) throw error;
                texts.leaveAll(key);
              });
            }
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
          markOnline();
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
                if (!(await stillAllowed(connectionKey))) break;
              }
              markOnline();
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
       * are turned away before the body is read; posts faster than the client ever sends are
       * dropped unread (still 204 – nothing for a client to retry).
       */
      .post('/live/:key', async (c) => {
        const key = c.req.param('key');
        if (!hub.has(key)) throw gone();
        if (!hub.admitPost(key)) return c.body(null, 204);
        const input = await readJson(c, livePresenceInputSchema);
        if (!hub.update(key, input)) throw gone();
        return c.body(null, 204);
      })

      /**
       * Starts typing in a text together with the others there (the live editor), or picks it up
       * again after the stream dropped: the shared text so far. Only for who may edit the deck –
       * the connection's own person, signed in.
       */
      .post('/live/:key/text/:elementId/join', viewer, async (c) => {
        const key = c.req.param('key');
        const elementId = c.req.param('elementId');
        const connection = hub.connectionOf(key);
        if (!connection || connection.author.id !== c.var.viewer.author.id) throw gone();
        await requireDeckAccess(deps, c.var.viewer, connection.deckId, 'own');
        const input = await readJson(c, liveTextJoinInputSchema);
        const joined = await texts.join(
          key,
          elementId,
          () => liveParagraphsOf(deps, c.var.viewer, connection.deckId, elementId),
          input,
        );
        if (joined === null) throw gone();
        if (joined === 'invalid') throw badRequest('Der Stand des Textes ist nicht lesbar.');
        return c.json(joined);
      })

      /**
       * What one typed in a text typed in together: on to the others typing in it. Like presence,
       * the secret key is the credential (checked when it joined).
       */
      .post('/live/:key/text/:elementId', async (c) => {
        const key = c.req.param('key');
        if (!hub.has(key)) throw gone();
        const { member, update } = await readJson(c, liveTextUpdateInputSchema);
        const outcome = texts.update(key, member, c.req.param('elementId'), update);
        if (outcome === 'gone') throw notFound('Du tippst in diesem Text gerade nicht mit.');
        if (outcome === 'busy') {
          throw new ApiError(429, 'rate_limited', 'Zu viele Änderungen auf einmal.');
        }
        if (outcome === 'invalid') throw badRequest('Diese Änderung am Text ist nicht lesbar.');
        if (outcome === 'too_long') {
          throw new ApiError(413, 'bad_request', 'Der Text ist zu lang für ein Element.');
        }
        return c.body(null, 204);
      })

      .post('/live/:key/text/:elementId/leave', async (c) => {
        const { member } = await readJson(c, liveTextLeaveInputSchema);
        texts.leave(c.req.param('key'), member, c.req.param('elementId'));
        return c.body(null, 204);
      })

      /** Goodbye (viewer closed, tab gone – sent as a beacon): the others drop the cursor now. */
      .post('/live/:key/leave', (c) => {
        hub.leave(c.req.param('key'));
        return c.body(null, 204);
      })
  );
}
