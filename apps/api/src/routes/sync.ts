import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireDeckAccess } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { badRequest, fileTooLarge, notAPowerPoint } from '../http/errors';
import { isSyncEnabled } from '../services/deck-sync';
import {
  getDeckStatus,
  getRevisionDiff,
  listDeletedSlides,
  listRevisions,
} from '../services/revisions';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const UPLOAD_DECK_NOT_SYNCED =
  'Hochgeladene Präsentationen werden nicht automatisch aktualisiert. Lade eine neue Version hoch.';

/** Versions and automatic updates of a deck (BER-107, BER-108, BER-109 API). */
export function syncRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const maxBytes = deps.config.maxUploadBytes;

  return (
    new Hono<ViewerEnv>()
      /** Cheap poll for the viewer: reload slides and comments when `revisionNumber` changes. */
      .get('/decks/:deckId/status', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(
          await getDeckStatus(deps.db, deck, { forGuest: c.var.viewer.kind === 'guest' }),
        );
      })

      /** "Jetzt aktualisieren": check the source now and import a change without debounce. */
      .post('/decks/:deckId/sync', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'own');
        if (!isSyncEnabled(deck)) throw badRequest(UPLOAD_DECK_NOT_SYNCED);
        if (deck.importState.status !== 'ready') {
          throw badRequest(
            deck.importState.status === 'failed'
              ? 'Der erste Import ist fehlgeschlagen – füge den Link bitte erneut ein.'
              : 'Die Präsentation wird gerade noch importiert.',
          );
        }
        return c.json(await deps.sync.checkDeck(deck.id, { manual: true }));
      })

      .get('/decks/:deckId/revisions', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(await listRevisions(deps.db, deck));
      })

      /** A new version of an uploaded deck: slides are matched, comments stay (BER-108). */
      .post(
        '/decks/:deckId/revisions',
        viewer,
        bodyLimit({
          maxSize: maxBytes + MULTIPART_OVERHEAD_BYTES,
          onError: (c) => c.json(fileTooLarge(maxBytes).toBody(), 413),
        }),
        async (c) => {
          const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'own');
          if (isSyncEnabled(deck)) {
            throw badRequest(
              'Diese Präsentation wird automatisch aus ihrer Quelle aktualisiert – eine neue Version kommt von dort.',
            );
          }
          if (deck.importState.status !== 'ready') {
            throw badRequest('Die Präsentation wird gerade noch importiert.');
          }
          const body = await c.req.parseBody().catch(() => {
            throw badRequest('Der Upload konnte nicht gelesen werden.');
          });
          const file = body['file'];
          if (!(file instanceof File)) {
            throw badRequest('Bitte eine Datei im Feld „file“ mitsenden.');
          }
          if (!file.name.toLowerCase().endsWith('.pptx')) throw notAPowerPoint();
          if (file.size > maxBytes) throw fileTooLarge(maxBytes);
          if (file.size === 0) throw badRequest('Die Datei ist leer.');
          const bytes = new Uint8Array(await file.arrayBuffer());
          return c.json(await deps.sync.importUpload(deck.id, bytes));
        },
      )

      .get('/decks/:deckId/revisions/:revisionId/diff', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(await getRevisionDiff(deps.db, deck, c.req.param('revisionId')));
      })

      .get('/decks/:deckId/deleted-slides', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(await listDeletedSlides(deps.db, deck));
      })
  );
}
