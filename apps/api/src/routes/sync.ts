import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import type { RerenderResult } from '@slider/shared';
import { deckAccess, requireDeckAccess } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { toDeckBytes } from '../import/any-file';
import { sha256Hex } from '../import/common';
import { badRequest, fileTooLarge, forbidden } from '../http/errors';
import { deckUploadSlot, importLimit } from '../http/import-limit';
import { hasPdfRenderer } from '../import/office-pages';
import { isSyncEnabled } from '../services/deck-sync';
import {
  getDeckStatus,
  getRevisionDiff,
  listDeletedSlides,
  listRevisions,
} from '../services/revisions';
import { listSlideVersions } from '../services/slide-versions';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Versions and automatic updates of a deck (BER-107, BER-108, BER-109 API). */
export function syncRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const imports = importLimit(deps);
  const uploads = deckUploadSlot(deps);
  const maxBytes = deps.config.maxUploadBytes;

  return (
    new Hono<ViewerEnv>()
      /** Cheap poll for the viewer: reload slides and comments when `revisionNumber` changes. */
      .get('/decks/:deckId/status', viewer, async (c) => {
        const { deck, permissions } = await deckAccess(
          deps,
          c.var.viewer,
          c.req.param('deckId'),
          'view',
        );
        return c.json(
          await getDeckStatus(deps.db, deck, {
            hideLoginUrl: !permissions.canManage,
            progress: deps.rendering?.progress,
          }),
        );
      })

      /**
       * "Neu rendern": draws the current revision's slides again, Office first, then LibreOffice,
       * in the background (BER-94). Progress shows in `GET …/status`. A linked file that changed
       * meanwhile (e.g. pictures compressed so Office accepts it) is imported as a new version
       * instead – Office cannot render the old revision from the new file. Anyone who may
       * comment asks for it (BER-165): the source is read with the owner's access, not theirs.
       */
      .post('/decks/:deckId/rerender', viewer, imports, async (c) => {
        // Everyone who may comment (BER-165): it renders with the owner's accounts, not theirs.
        const { deck, permissions } = await deckAccess(
          deps,
          c.var.viewer,
          c.req.param('deckId'),
          'view',
        );
        if (!permissions.canComment) {
          throw forbidden('Als Betrachter kannst du Präsentationen nicht neu rendern lassen.');
        }
        if (deck.importState.status !== 'ready' || !deck.currentRevisionId) {
          throw badRequest('Die Präsentation wird gerade noch importiert.');
        }
        if (isSyncEnabled(deck)) {
          const sync = await deps.sync.checkDeck(deck.id, { manual: true });
          if (sync.status === 'updated' || sync.status === 'queued') {
            const renderedAt = deps.rendering?.progress.renderedAt(deck.id) ?? null;
            return c.json({ status: 'newVersion', renderedAt } satisfies RerenderResult, 202);
          }
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

      .get('/decks/:deckId/revisions', viewer, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(await listRevisions(deps.db, deck));
      })

      /** A new version of an uploaded deck: slides are matched, comments stay (BER-108). */
      .post(
        '/decks/:deckId/revisions',
        viewer,
        // Before a single byte is buffered: only the owner, only for an uploaded, imported deck.
        createMiddleware<ViewerEnv>(async (c, next) => {
          const deckId = c.req.param('deckId') ?? '';
          const deck = await requireDeckAccess(deps, c.var.viewer, deckId, 'own');
          if (isSyncEnabled(deck)) {
            throw badRequest(
              'Diese Präsentation wird automatisch aus ihrer Quelle aktualisiert – eine neue Version kommt von dort.',
            );
          }
          if (deck.importState.status !== 'ready') {
            throw badRequest('Die Präsentation wird gerade noch importiert.');
          }
          await next();
        }),
        imports,
        uploads,
        bodyLimit({
          maxSize: maxBytes + MULTIPART_OVERHEAD_BYTES,
          onError: (c) => c.json(fileTooLarge(maxBytes).toBody(), 413),
        }),
        async (c) => {
          const deckId = c.req.param('deckId');
          const body = await c.req.parseBody().catch(() => {
            throw badRequest('Der Upload konnte nicht gelesen werden.');
          });
          const file = body['file'];
          if (!(file instanceof File)) {
            throw badRequest('Bitte eine Datei im Feld „file“ mitsenden.');
          }
          if (file.size > maxBytes) throw fileTooLarge(maxBytes);
          if (file.size === 0) throw badRequest('Die Datei ist leer.');
          // A PowerPoint or a PDF as it is; any other file becomes a PDF.
          const original = new Uint8Array(await file.arrayBuffer());
          const bytes = await toDeckBytes(file.name, original, deps.documentPdf);
          return c.json(await deps.sync.importUpload(deckId, bytes, sha256Hex(original)));
        },
      )

      .get('/decks/:deckId/revisions/:revisionId/diff', viewer, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(await getRevisionDiff(deps.db, deck, c.req.param('revisionId')));
      })

      .get('/decks/:deckId/deleted-slides', viewer, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(await listDeletedSlides(deps.db, deck));
      })

      /** One slide in every revision, for "Alt/Neu" on a comment (BER-109). */
      .get('/decks/:deckId/slides/:slideId/versions', viewer, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(await listSlideVersions(deps.db, deck, c.req.param('slideId')));
      })
  );
}
