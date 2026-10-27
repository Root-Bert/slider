import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import {
  applyEditInputSchema,
  choosePhotoInputSchema,
  createAiProposalInputSchema,
  pickStockPhotoInputSchema,
  saveEditInputSchema,
  stockOrientationSchema,
} from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { badRequest, fileTooLarge } from '../http/errors';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { MAX_JSON_BODY_BYTES, readJson } from '../http/validate';
import {
  cancelProposal,
  choosePhoto,
  createProposal,
  listProposals,
  reapplyProposal,
  revertProposal,
} from '../services/ai-proposals';
import { pickPhoto, reportChosenPhotosLater, searchForDeck } from '../services/stock-photos';
import { elementCutout, slideLayers, textBackground } from '../services/edit-backgrounds';
import {
  MAX_EDIT_IMAGE_BYTES,
  applyEdit,
  editedFile,
  getEditState,
  moveEdit,
  saveEdit,
  uploadEditImage,
} from '../services/edits';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const renderOptionsSchema = z.object({
  priority: z.enum(['background', 'interactive']).default('interactive'),
});

/** Editing a deck in Slider (BER-180, BER-181, BER-182). Needs the right to manage the deck. */
export function editsRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  // Every edit draws slides with LibreOffice: generous for a person dragging, a stop for a script.
  const window = fixedWindow({ limit: 120, windowMs: 60_000, clock: deps.clock });
  // The pictures texts are typed over are asked for ahead too (every text of the slide shown):
  // a line of their own, so looking around never uses up the edits'.
  const backgroundWindow = fixedWindow({ limit: 600, windowMs: 60_000, clock: deps.clock });
  const backgrounds = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      backgroundWindow.hit(c.var.viewer.author.id),
      'Zu viele Anfragen auf einmal. Bitte warte einen Moment.',
    );
    await next();
  });
  const edits = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      window.hit(c.var.viewer.author.id),
      'Zu viele Änderungen auf einmal. Bitte warte einen Moment.',
    );
    await next();
  });
  // Each AI request runs on the workspace's Anthropic key: a person asks a few a minute at most.
  const aiWindow = fixedWindow({ limit: 20, windowMs: 60_000, clock: deps.clock });
  const aiRequests = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      aiWindow.hit(c.var.viewer.author.id),
      'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
    );
    await next();
  });

  // Every search costs the server's Unsplash allowance (50 an hour for a demo app).
  const stockWindow = fixedWindow({ limit: 30, windowMs: 60_000, clock: deps.clock });
  const stockRequests = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      stockWindow.hit(c.var.viewer.author.id),
      'Zu viele Fotosuchen auf einmal. Bitte warte einen Moment.',
    );
    await next();
  });

  return (
    new Hono<ViewerEnv>()
      .get('/decks/:deckId/edit', viewer, async (c) =>
        c.json(await getEditState(deps, c.var.viewer, c.req.param('deckId'))),
      )
      .post('/decks/:deckId/edit/operations', viewer, edits, async (c) => {
        const input = await readJson(c, applyEditInputSchema);
        return c.json(await applyEdit(deps, c.var.viewer, c.req.param('deckId'), input));
      })
      // The picture the live editor types an element's text over: drawn while it waits.
      .post(
        '/decks/:deckId/edit/elements/:elementId/background',
        viewer,
        backgrounds,
        async (c) => {
          // `{ "priority": "background" }`: asked for ahead, before anyone waits for it.
          const { priority } = await readJson(c, renderOptionsSchema, MAX_JSON_BODY_BYTES, {
            allowEmpty: true,
          });
          return c.json(
            await textBackground(
              deps,
              c.var.viewer,
              c.req.param('deckId'),
              c.req.param('elementId'),
              priority,
            ),
          );
        },
      )
      .post('/decks/:deckId/edit/elements/:elementId/cutout', viewer, backgrounds, async (c) => {
        // `{ "priority": "background" }`: asked for ahead, before anyone waits for it.
        const { priority } = await readJson(c, renderOptionsSchema, MAX_JSON_BODY_BYTES, {
          allowEmpty: true,
        });
        return c.json(
          await elementCutout(
            deps,
            c.var.viewer,
            c.req.param('deckId'),
            c.req.param('elementId'),
            priority,
          ),
        );
      })
      .post('/decks/:deckId/edit/slides/:slideId/layers', viewer, backgrounds, async (c) => {
        // `{ "priority": "background" }`: asked for ahead, before anyone waits for it.
        const { priority } = await readJson(c, renderOptionsSchema, MAX_JSON_BODY_BYTES, {
          allowEmpty: true,
        });
        return c.json(
          await slideLayers(
            deps,
            c.var.viewer,
            c.req.param('deckId'),
            c.req.param('slideId'),
            priority,
          ),
        );
      })
      .post('/decks/:deckId/edit/undo', viewer, edits, async (c) =>
        c.json(await moveEdit(deps, c.var.viewer, c.req.param('deckId'), -1)),
      )
      .post('/decks/:deckId/edit/redo', viewer, edits, async (c) =>
        c.json(await moveEdit(deps, c.var.viewer, c.req.param('deckId'), 1)),
      )
      .post(
        '/decks/:deckId/edit/images',
        viewer,
        edits,
        bodyLimit({
          maxSize: MAX_EDIT_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES,
          onError: (c) => c.json(fileTooLarge(MAX_EDIT_IMAGE_BYTES).toBody(), 413),
        }),
        async (c) => {
          const body = await c.req.parseBody().catch(() => {
            throw badRequest('Das Bild konnte nicht gelesen werden.');
          });
          const file = body['file'];
          if (!(file instanceof File)) throw badRequest('Bitte ein Bild im Feld „file“ mitsenden.');
          const bytes = new Uint8Array(await file.arrayBuffer());
          return c.json(
            await uploadEditImage(deps, c.var.viewer, c.req.param('deckId'), bytes),
            201,
          );
        },
      )
      .get('/decks/:deckId/stock/photos', viewer, stockRequests, async (c) => {
        const orientation = stockOrientationSchema
          .optional()
          .safeParse(c.req.query('orientation') || undefined);
        const photos = await searchForDeck(
          deps,
          c.var.viewer,
          c.req.param('deckId'),
          (c.req.query('q') ?? '').slice(0, 200),
          orientation.data,
        );
        return c.json({ photos });
      })
      .post('/decks/:deckId/stock/photos/:photoId', viewer, edits, async (c) => {
        const input = await readJson(c, pickStockPhotoInputSchema);
        return c.json(
          await pickPhoto(
            deps,
            c.var.viewer,
            c.req.param('deckId'),
            c.req.param('photoId'),
            input.aspect ?? null,
          ),
          201,
        );
      })
      .post('/decks/:deckId/edit/save', viewer, async (c) => {
        const input = await readJson(c, saveEditInputSchema);
        const state = await saveEdit(deps, c.var.viewer, c.req.param('deckId'), input);
        // The file left Slider: the AI's photos in it are used now.
        reportChosenPhotosLater(deps, c.req.param('deckId'));
        return c.json(state);
      })
      .get('/decks/:deckId/ai/proposals', viewer, async (c) =>
        c.json(await listProposals(deps, c.var.viewer, c.req.param('deckId'))),
      )
      .post('/decks/:deckId/ai/proposals', viewer, aiRequests, async (c) => {
        const input = await readJson(c, createAiProposalInputSchema);
        return c.json(await createProposal(deps, c.var.viewer, c.req.param('deckId'), input), 202);
      })
      .post('/decks/:deckId/ai/proposals/:proposalId/cancel', viewer, edits, async (c) => {
        await cancelProposal(deps, c.var.viewer, c.req.param('deckId'), c.req.param('proposalId'));
        return c.body(null, 204);
      })
      .post('/decks/:deckId/ai/proposals/:proposalId/revert', viewer, edits, async (c) =>
        c.json(
          await revertProposal(
            deps,
            c.var.viewer,
            c.req.param('deckId'),
            c.req.param('proposalId'),
          ),
        ),
      )
      .post('/decks/:deckId/ai/proposals/:proposalId/photo', viewer, edits, async (c) => {
        const input = await readJson(c, choosePhotoInputSchema);
        return c.json(
          await choosePhoto(
            deps,
            c.var.viewer,
            c.req.param('deckId'),
            c.req.param('proposalId'),
            input.photoId,
          ),
        );
      })
      .post('/decks/:deckId/ai/proposals/:proposalId/reapply', viewer, edits, async (c) =>
        c.json(
          await reapplyProposal(
            deps,
            c.var.viewer,
            c.req.param('deckId'),
            c.req.param('proposalId'),
          ),
        ),
      )
      .get('/decks/:deckId/edit/file', viewer, async (c) => {
        const { bytes, fileName } = await editedFile(deps, c.var.viewer, c.req.param('deckId'));
        reportChosenPhotosLater(deps, c.req.param('deckId'));
        return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
          'Content-Type': 'application/vnd.oasis.opendocument.presentation',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          'Cache-Control': 'private, no-store',
        });
      })
  );
}
