import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { ODP_MIME, OTP_MIME } from '@slider/odp';
import {
  applyEditInputSchema,
  choosePhotoInputSchema,
  createAiProposalInputSchema,
  generateEditImageInputSchema,
  pickStockPhotoInputSchema,
  revertEditInputSchema,
  sendExportInputSchema,
  stockOrientationSchema,
  updateAiProposalInputSchema,
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
  resolveProposal,
  revertProposal,
} from '../services/ai-proposals';
import { cutOutElement } from '../services/cut-outs';
import { generateEditImage } from '../services/image-generation';
import { pickPhoto, reportChosenPhotosLater, searchForDeck } from '../services/stock-photos';
import { slideLayers } from '../services/edit-backgrounds';
import { getDeckLayouts } from '../services/workspace-masters';
import {
  MAX_EDIT_IMAGE_BYTES,
  applyEdit,
  editedFile,
  editedPdf,
  editedSlidePdf,
  editedSlidePng,
  filePicture,
  getEditState,
  revertEdit,
  sendExport,
  uploadEditImage,
  uploadedPicture,
} from '../services/edits';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const renderOptionsSchema = z.object({
  priority: z.enum(['background', 'interactive']).default('interactive'),
  /** Layers for the per-element editor: live texts left out, browser-drawn elements not drawn. */
  compose: z.boolean().default(false),
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

  // Freistellen takes rembg's CPU for seconds a picture, one picture at a time per server.
  const cutOutWindow = fixedWindow({ limit: 10, windowMs: 60_000, clock: deps.clock });
  const cutOutRequests = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      cutOutWindow.hit(c.var.viewer.author.id),
      'Zu viele Bilder auf einmal freigestellt. Bitte warte einen Moment.',
    );
    await next();
  });

  // A PDF is the whole deck drawn by LibreOffice, which only draws a few files at once.
  const pdfWindow = fixedWindow({ limit: 5, windowMs: 60_000, clock: deps.clock });
  const pdfRequests = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      pdfWindow.hit(c.var.viewer.author.id),
      'Zu viele PDFs auf einmal. Bitte warte einen Moment.',
    );
    await next();
  });
  // Mailing an export: sent in the person's name with whatever they attach – a handful an hour.
  const mailWindow = fixedWindow({ limit: 20, windowMs: 60 * 60_000, clock: deps.clock });
  const mailRequests = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      mailWindow.hit(c.var.viewer.author.id),
      'Zu viele Mails auf einmal. Bitte warte ein wenig.',
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
      .get('/decks/:deckId/layouts', viewer, async (c) =>
        c.json(await getDeckLayouts(deps, c.var.viewer, c.req.param('deckId'))),
      )
      .post('/decks/:deckId/edit/operations', viewer, edits, async (c) => {
        const input = await readJson(c, applyEditInputSchema);
        return c.json(await applyEdit(deps, c.var.viewer, c.req.param('deckId'), input));
      })
      .post('/decks/:deckId/edit/slides/:slideId/layers', viewer, backgrounds, async (c) => {
        // `{ "priority": "background" }`: asked for ahead, before anyone waits for it.
        const { priority, compose } = await readJson(c, renderOptionsSchema, MAX_JSON_BODY_BYTES, {
          allowEmpty: true,
        });
        return c.json(
          await slideLayers(
            deps,
            c.var.viewer,
            c.req.param('deckId'),
            c.req.param('slideId'),
            priority,
            compose,
          ),
        );
      })
      .post('/decks/:deckId/edit/revert', viewer, edits, async (c) => {
        const input = await readJson(c, revertEditInputSchema);
        return c.json(await revertEdit(deps, c.var.viewer, c.req.param('deckId'), input));
      })
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
      .post('/decks/:deckId/edit/images/generate', viewer, edits, aiRequests, async (c) => {
        const input = await readJson(c, generateEditImageInputSchema);
        return c.json(
          await generateEditImage(deps, c.var.viewer, c.req.param('deckId'), input),
          201,
        );
      })
      .post(
        '/decks/:deckId/edit/elements/:elementId/remove-background',
        viewer,
        edits,
        cutOutRequests,
        async (c) =>
          c.json(
            await cutOutElement(
              deps,
              c.var.viewer,
              c.req.param('deckId'),
              c.req.param('elementId'),
            ),
            201,
          ),
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
      .get('/decks/:deckId/ai/proposals', viewer, async (c) =>
        c.json(await listProposals(deps, c.var.viewer, c.req.param('deckId'))),
      )
      .post('/decks/:deckId/ai/proposals', viewer, aiRequests, async (c) => {
        const input = await readJson(c, createAiProposalInputSchema);
        return c.json(await createProposal(deps, c.var.viewer, c.req.param('deckId'), input), 202);
      })
      // Its card done or open again, for everyone – as `PATCH /comments/:id` with a status.
      .patch('/decks/:deckId/ai/proposals/:proposalId', viewer, async (c) => {
        const input = await readJson(c, updateAiProposalInputSchema);
        return c.json(
          await resolveProposal(
            deps,
            c.var.viewer,
            c.req.param('deckId'),
            c.req.param('proposalId'),
            input,
          ),
        );
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
      .get('/decks/:deckId/edit/pictures', viewer, backgrounds, async (c) => {
        const path = c.req.query('path') ?? '';
        if (!path.startsWith('Pictures/') || path.length > 300) throw badRequest('Kein Bild.');
        const { bytes, mediaType } = await filePicture(
          deps,
          c.var.viewer,
          c.req.param('deckId'),
          path,
        );
        return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
          'Content-Type': mediaType,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        });
      })
      .get('/decks/:deckId/edit/images/:imageId', viewer, backgrounds, async (c) => {
        const { bytes, mediaType } = await uploadedPicture(
          deps,
          c.var.viewer,
          c.req.param('deckId'),
          c.req.param('imageId'),
        );
        return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
          'Content-Type': mediaType,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        });
      })
      .get('/decks/:deckId/edit/file', viewer, async (c) => {
        const { bytes, fileName, template } = await editedFile(
          deps,
          c.var.viewer,
          c.req.param('deckId'),
        );
        reportChosenPhotosLater(deps, c.req.param('deckId'));
        return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
          'Content-Type': template ? OTP_MIME : ODP_MIME,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          'Cache-Control': 'private, no-store',
        });
      })
      .get('/decks/:deckId/edit/pdf', viewer, pdfRequests, async (c) => {
        const { bytes, fileName } = await editedPdf(deps, c.var.viewer, c.req.param('deckId'));
        reportChosenPhotosLater(deps, c.req.param('deckId'));
        return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          'Cache-Control': 'private, no-store',
        });
      })
      // „Nur diese Folie“: one slide as a PDF (drawn anew) or as its picture.
      .get(
        '/decks/:deckId/edit/slides/:slideId/:format{pdf|png}',
        viewer,
        pdfRequests,
        async (c) => {
          const deckId = c.req.param('deckId');
          const draw = c.req.param('format') === 'pdf' ? editedSlidePdf : editedSlidePng;
          const { bytes, fileName, contentType } = await draw(
            deps,
            c.var.viewer,
            deckId,
            c.req.param('slideId'),
          );
          reportChosenPhotosLater(deps, deckId);
          return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
            'Cache-Control': 'private, no-store',
          });
        },
      )
      // Any of them mailed to someone, as an attachment.
      .post('/decks/:deckId/edit/send', viewer, mailRequests, async (c) => {
        const input = await readJson(c, sendExportInputSchema);
        await sendExport(deps, c.var.viewer, c.req.param('deckId'), input);
        reportChosenPhotosLater(deps, c.req.param('deckId'));
        return c.body(null, 204);
      })
  );
}
