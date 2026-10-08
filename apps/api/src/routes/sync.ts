import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { insertSlideInputSchema, type RerenderResult } from '@slider/shared';
import { requireDeckAccess } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { badRequest, fileTooLarge, notAPowerPoint } from '../http/errors';
import { readJson } from '../http/validate';
import { hasPdfRenderer } from '../import/office-pages';
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
          await getDeckStatus(deps.db, deck, {
            forGuest: c.var.viewer.kind === 'guest',
            progress: deps.rendering?.progress,
          }),
        );
      })

      /**
       * "Folienbilder neu erzeugen": draws the current revision's slides again with Office or
       * LibreOffice, in the background (BER-94). Progress shows in `GET …/status`.
       */
      .post('/decks/:deckId/rerender', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'own');
        if (deck.importState.status !== 'ready' || !deck.currentRevisionId) {
          throw badRequest('Die Präsentation wird gerade noch importiert.');
        }
        const rendering = deps.rendering;
        if (!rendering || !hasPdfRenderer(rendering.renderers, deck)) {
          throw badRequest(
            isSyncEnabled(deck)
              ? 'Folienbilder von PowerPoint gibt es nur mit Microsoft-Anmeldung oder installiertem LibreOffice.'
              : 'Für hochgeladene Präsentationen braucht der Server LibreOffice, um die Folienbilder wie in PowerPoint zu erzeugen.',
          );
        }
        const renderedAt = rendering.progress.renderedAt(deck.id);
        const running = rendering.progress.get(deck.id);
        if (running) {
          return c.json({ status: running.status, renderedAt } satisfies RerenderResult, 202);
        }
        rendering.progress.queued(deck.id);
        deps.queue.enqueue({
          deckId: deck.id,
          revisionId: deck.currentRevisionId,
          kind: 'rerender',
        });
        return c.json({ status: 'queued', renderedAt } satisfies RerenderResult, 202);
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

      /** ⊕ between slides: an empty slide, written straight into the linked PowerPoint (BER-128). */
      .post('/decks/:deckId/slides', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'own');
        const { afterSlideId } = await readJson(c, insertSlideInputSchema);
        return c.json(await deps.sync.insertSlide(deck.id, afterSlideId));
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
