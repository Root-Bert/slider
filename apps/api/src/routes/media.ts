import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import {
  createMediaCommentInputSchema,
  MAX_COMMENT_IMAGES,
  MAX_IMAGE_BYTES,
  type MediaUsage,
} from '@slider/shared';
import { requireDeckAccess } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, notFound } from '../http/errors';
import { parseRange } from '../http/range';
import { clientAddress, fixedWindow } from '../http/rate-limit';
import { createMediaComment, getMediaForViewer, getMediaUsage } from '../services/media';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Recordings and images per account and hour. Each one may be ~210 MB that the server buffers
 * and stores; generous for reviewing, but one account cannot fill memory or disk in a loop.
 */
export const MEDIA_UPLOADS_PER_HOUR = { limited: 60, unlimited: 300 } as const;
/** Uploads one account may have in flight at once – each is buffered whole in memory. */
export const MEDIA_UPLOADS_IN_FLIGHT = 2;
/**
 * All accounts together: bounds the memory of parallel uploads (up to ~210 MB each – a recording
 * plus ten images – held twice while parsed and copied).
 */
export const MEDIA_UPLOADS_IN_FLIGHT_TOTAL = 5;
/** Per address: several people behind one office NAT share it. */
const CLIENT_FACTOR = 5;
const HOUR_MS = 60 * 60_000;

/** How long the browser keeps a recording without asking again (as `/files` keeps deck files). */
const MEDIA_MAX_AGE_S = 5 * 60;

const tooMany = (message: string) => new ApiError(429, 'rate_limited', message);

/**
 * Runs before the body is read: the deck must exist and allow commenting (so an account without
 * access cannot make the server buffer anything), the hourly budget must not be spent, and the
 * account – and the server as a whole – may only stream a few uploads at a time.
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
  let total = 0;

  return createMiddleware<ViewerEnv>(async (c, next) => {
    const userId = c.var.viewer.author.id;
    await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId') ?? '', 'comment');
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
    if (running >= MEDIA_UPLOADS_IN_FLIGHT || total >= MEDIA_UPLOADS_IN_FLIGHT_TOTAL) {
      c.header('Retry-After', '5');
      throw tooMany(
        running >= MEDIA_UPLOADS_IN_FLIGHT
          ? 'Deine anderen Aufnahmen werden noch hochgeladen. Bitte warte einen Moment.'
          : 'Gerade werden viele Aufnahmen gleichzeitig hochgeladen. Bitte versuch es gleich noch einmal.',
      );
    }
    inFlight.set(userId, running + 1);
    total += 1;
    try {
      await next();
    } finally {
      total -= 1;
      const left = (inFlight.get(userId) ?? 1) - 1;
      if (left > 0) inFlight.set(userId, left);
      else inFlight.delete(userId);
    }
  });
}

/** Voice and video comments (BER-116), and images (drawn, pasted or picked) with an optional voice memo. */
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
          maxSize: maxBytes + MAX_COMMENT_IMAGES * MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES,
          onError: (c) =>
            c.json(
              new ApiError(
                413,
                'file_too_large',
                `Die Aufnahme oder die Bilder sind zu groß (Aufnahme maximal ${Math.floor(maxBytes / 1024 / 1024)} MB, Bilder je ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} MB).`,
              ).toBody(),
              413,
            ),
        }),
        async (c) => {
          // `all`: several images come as repeated `image` fields, in their order.
          const body = await c.req.parseBody({ all: true }).catch(() => {
            throw badRequest('Die Aufnahme konnte nicht gelesen werden.');
          });
          const file = body['file'];
          const images = [body['image'] ?? []].flat().filter((part) => part instanceof File);
          const comment = body['comment'];
          if (!(file instanceof File) && images.length === 0)
            throw badRequest(
              'Bitte die Aufnahme im Feld „file“ oder ein Bild im Feld „image“ mitsenden.',
            );
          if (images.length > MAX_COMMENT_IMAGES)
            throw badRequest(`Höchstens ${MAX_COMMENT_IMAGES} Bilder pro Kommentar.`);
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
              images: await Promise.all(
                images.map(async (image) => ({ bytes: new Uint8Array(await image.arrayBuffer()) })),
              ),
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
        // The bytes behind an id never change: after the permission check, a cached copy is still
        // the recording. Kept only briefly, like a deck's files, so a revoked access closes it too.
        const etag = `"${row.sha256}"`;
        const cacheControl = `private, max-age=${MEDIA_MAX_AGE_S}`;
        if (c.req.header('If-None-Match') === etag) {
          c.header('Cache-Control', cacheControl);
          c.header('ETag', etag);
          return c.body(null, 304);
        }
        // Only the requested bytes are read: players fetch long recordings in many small ranges.
        const size = await deps.media.size(row.storageKey);
        if (size === null) throw gone();
        c.header('Cache-Control', cacheControl);
        c.header('ETag', etag);
        c.header('Content-Type', row.mimeType);
        c.header('Accept-Ranges', 'bytes');

        const range = parseRange(c.req.header('Range'), size);
        if (range === 'unsatisfiable') {
          c.header('Content-Range', `bytes */${size}`);
          return c.body(null, 416);
        }
        // HEAD runs this GET route and drops the body unread: no file is opened for it.
        const head = c.req.method === 'HEAD';
        if (!range) {
          c.header('Content-Length', String(size));
          if (size === 0 || head) return c.body(null);
          const body = await deps.media.stream(row.storageKey);
          if (!body) throw gone();
          return c.body(body);
        }
        c.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        c.header('Content-Length', String(range.end - range.start + 1));
        if (head) return c.body(null, 206);
        const body = await deps.media.stream(row.storageKey, range);
        if (!body) throw gone();
        return c.body(body, 206);
      })
  );
}
