import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  createMediaCommentInputSchema,
  updateTranscriptInputSchema,
  type MediaUsage,
} from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { badRequest, fileTooLarge, notFound } from '../http/errors';
import { parseRange } from '../http/range';
import { readJson } from '../http/validate';
import {
  createMediaComment,
  getMediaForViewer,
  getMediaUsage,
  updateTranscript,
} from '../services/media';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Voice and video comments (BER-116). */
export function mediaRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const maxBytes = deps.config.media.maxBytes;

  return (
    new Hono<ViewerEnv>()
      .post(
        '/decks/:deckId/media-comments',
        viewer,
        bodyLimit({
          maxSize: maxBytes + MULTIPART_OVERHEAD_BYTES,
          onError: (c) => c.json(fileTooLarge(maxBytes).toBody(), 413),
        }),
        async (c) => {
          const body = await c.req.parseBody().catch(() => {
            throw badRequest('Die Aufnahme konnte nicht gelesen werden.');
          });
          const file = body['file'];
          const comment = body['comment'];
          if (!(file instanceof File))
            throw badRequest('Bitte die Aufnahme im Feld „file“ mitsenden.');
          if (typeof comment !== 'string') throw badRequest('Das Feld „comment“ fehlt.');
          let json: unknown;
          try {
            json = JSON.parse(comment);
          } catch {
            throw badRequest('Das Feld „comment“ ist kein gültiges JSON.');
          }
          const input = createMediaCommentInputSchema.parse(json);
          const created = await createMediaComment(
            deps,
            c.var.viewer,
            c.req.param('deckId'),
            input,
            { bytes: new Uint8Array(await file.arrayBuffer()) },
          );
          return c.json(created, 201);
        },
      )

      .get('/decks/:deckId/media-usage', viewer, async (c) =>
        c.json<MediaUsage>(await getMediaUsage(deps, c.var.viewer, c.req.param('deckId'))),
      )

      .put('/media/:mediaId/transcript', viewer, async (c) => {
        const input = await readJson(c, updateTranscriptInputSchema);
        return c.json(await updateTranscript(deps, c.var.viewer, c.req.param('mediaId'), input));
      })

      // A permanent link with a permission check on every request (unlike `/files/*`).
      .get('/media/:mediaId', viewer, async (c) => {
        const row = await getMediaForViewer(deps, c.var.viewer, c.req.param('mediaId'));
        const data = await deps.media.get(row.storageKey);
        if (!data) throw notFound('Die Aufnahme ist nicht mehr gespeichert.');

        const size = data.byteLength;
        c.header('Content-Type', row.mimeType);
        c.header('Accept-Ranges', 'bytes');
        // The bytes behind an id never change; the permission check runs again after a reload.
        c.header('Cache-Control', 'private, max-age=86400');
        c.header('ETag', `"${row.sha256}"`);

        const range = parseRange(c.req.header('Range'), size);
        if (range === 'unsatisfiable') {
          c.header('Content-Range', `bytes */${size}`);
          return c.body(null, 416);
        }
        if (!range) {
          c.header('Content-Length', String(size));
          return c.body(data);
        }
        c.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        c.header('Content-Length', String(range.end - range.start + 1));
        return c.body(data.subarray(range.start, range.end + 1), 206);
      })
  );
}
