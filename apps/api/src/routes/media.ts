import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { createMediaCommentInputSchema, MAX_IMAGE_BYTES, type MediaUsage } from '@slider/shared';
import { requireDeckAccess } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, fileTooLarge, notFound } from '../http/errors';
import { parseRange } from '../http/range';
import { clientAddress, fixedWindow } from '../http/rate-limit';
import { createMediaComment, getMediaForViewer, getMediaUsage } from '../services/media';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Recordings and drawings per account and hour. Each one may be ~110 MB that the server buffers
 * and stores; generous for reviewing, but one account cannot fill memory or disk in a loop.
 */
export const MEDIA_UPLOADS_PER_HOUR = { limited: 60, unlimited: 300 } as const;
/** Uploads one account may have in flight at once – each is buffered whole in memory. */
export const MEDIA_UPLOADS_IN_FLIGHT = 2;
/** Per address: several people behind one office NAT share it. */
const CLIENT_FACTOR = 5;
const HOUR_MS = 60 * 60_000;

const tooMany = (message: string) => new ApiError(429, 'rate_limited', message);

/**
 * Runs before the body is read: the deck must exist and allow commenting (so an account without
 * access cannot make the server buffer anything), the hourly budget must not be spent, and the
 * account may only stream a few uploads at a time.
 */
function mediaUploadGuard(deps: AppDeps) {
  const perUser = deps.config.limited
    ? MEDIA_UPLOADS_PER_HOUR.limited
    : MEDIA_UPLOADS_PER_HOUR.unlimited;
  const byUser = fixedWindow({ limit: perUser, windowMs: HOUR_MS, clock: deps.clock });
  const byClient = fixedWindow({
    limit: perUser * CLIENT_FACTOR,
    windowMs: HOUR_MS,
    clock: deps.clock,
  });
  const inFlight = new Map<string, number>();

  return createMiddleware<ViewerEnv>(async (c, next) => {
    const userId = c.var.viewer.author.id;
    await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId') ?? '', 'comment');
    const user = byUser.hit(userId);
    const client = byClient.hit(clientAddress(c));
    if (!user.allowed || !client.allowed) {
      const retryAfterS = Math.max(
        user.allowed ? 0 : user.retryAfterS,
        client.allowed ? 0 : client.retryAfterS,
      );
      c.header('Retry-After', String(retryAfterS));
      throw tooMany(
        `Du hast gerade sehr viele Aufnahmen gesendet. Bitte versuch es in ${Math.ceil(retryAfterS / 60)} Minuten noch einmal.`,
      );
    }
    const running = inFlight.get(userId) ?? 0;
    if (running >= MEDIA_UPLOADS_IN_FLIGHT) {
      c.header('Retry-After', '5');
      throw tooMany('Deine anderen Aufnahmen werden noch hochgeladen. Bitte warte einen Moment.');
    }
    inFlight.set(userId, running + 1);
    try {
      await next();
    } finally {
      const left = (inFlight.get(userId) ?? 1) - 1;
      if (left > 0) inFlight.set(userId, left);
      else inFlight.delete(userId);
    }
  });
}

/** Voice and video comments (BER-116) and drawn images with an optional voice memo. */
export function mediaRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const maxBytes = deps.config.media.maxBytes;
  const guard = mediaUploadGuard(deps);

  return (
    new Hono<ViewerEnv>()
      .post(
        '/decks/:deckId/media-comments',
        viewer,
        guard,
        bodyLimit({
          maxSize: maxBytes + MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES,
          onError: (c) => c.json(fileTooLarge(maxBytes).toBody(), 413),
        }),
        async (c) => {
          const body = await c.req.parseBody().catch(() => {
            throw badRequest('Die Aufnahme konnte nicht gelesen werden.');
          });
          const file = body['file'];
          const image = body['image'];
          const comment = body['comment'];
          if (!(file instanceof File) && !(image instanceof File))
            throw badRequest(
              'Bitte die Aufnahme im Feld „file“ oder ein Bild im Feld „image“ mitsenden.',
            );
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
            {
              ...(file instanceof File && {
                recording: { bytes: new Uint8Array(await file.arrayBuffer()) },
              }),
              ...(image instanceof File && {
                image: { bytes: new Uint8Array(await image.arrayBuffer()) },
              }),
            },
          );
          return c.json(created, 201);
        },
      )

      .get('/decks/:deckId/media-usage', viewer, async (c) =>
        c.json<MediaUsage>(await getMediaUsage(deps, c.var.viewer, c.req.param('deckId'))),
      )

      // A permanent link with a permission check on every request (unlike `/files/*`).
      .get('/media/:mediaId', viewer, async (c) => {
        const row = await getMediaForViewer(deps, c.var.viewer, c.req.param('mediaId'));
        const gone = () => notFound('Die Aufnahme ist nicht mehr gespeichert.');
        // Only the requested bytes are read: players fetch long recordings in many small ranges.
        const size = await deps.media.size(row.storageKey);
        if (size === null) throw gone();
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
          if (size === 0) return c.body(null);
          const body = await deps.media.stream(row.storageKey);
          if (!body) throw gone();
          return c.body(body);
        }
        const body = await deps.media.stream(row.storageKey, range);
        if (!body) throw gone();
        c.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        c.header('Content-Length', String(range.end - range.start + 1));
        return c.body(body, 206);
      })
  );
}
