import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  isPictureAttachment,
  MAX_ATTACHMENT_BYTES,
  isAudioAttachment,
  isVideoAttachment,
  MAX_VIDEO_ATTACHMENT_BYTES,
  type AccountAuthor,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, notFound } from '../http/errors';
import { parseRange } from '../http/range';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import {
  attachmentFile,
  attachmentRow,
  dropAttachment,
  uploadAttachment,
} from '../services/attachments';
import { attachmentPage, attachmentPages, attachmentSmallPage } from '../services/attachment-pages';
import { suggestVideoCuts } from '../services/video-cuts';
import { digestVideo, MAX_VIDEO_STILLS } from '../services/video-digest';

/** A page of a sent document as a JPEG: drawn of bytes that never change, so kept by the browser. */
function sendPage(c: Context, bytes: Uint8Array | null): Response {
  if (!bytes) throw notFound('Davon gibt es kein Bild.');
  c.header('Content-Type', 'image/jpeg');
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.body(bytes as Uint8Array<ArrayBuffer>);
}

/**
 * Files put on what one writes (`services/attachments.ts`): up into the workspace, taken off
 * again while waiting, a taken one's bytes for the workspace's members. Account members only.
 */
export function attachmentRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const me = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return (c.var.viewer.author as AccountAuthor).id;
  };
  // Plenty for a day's messages, not a store.
  const uploads = fixedWindow({ limit: 300, windowMs: 60 * 60 * 1000, clock: deps.clock });
  const tooBig = 'Diese Datei ist zu groß – höchstens 25 MB je Datei, 200 MB je Video.';
  // Each asks speech to text and the AI: a few an hour are plenty for recordings.
  const cutsAsked = fixedWindow({ limit: 30, windowMs: 60 * 60 * 1000, clock: deps.clock });
  // Each digest with sound goes to the workspace's speech to text: as often as videos go up.
  const digests = fixedWindow({ limit: 60, windowMs: 60 * 60 * 1000, clock: deps.clock });
  return (
    new Hono<ViewerEnv>()
      /** A file put on something being written (multipart, field `file`). */
      .post(
        '/workspaces/:workspaceId/attachments',
        viewer,
        (c, next) => {
          assertWithinLimit(
            c,
            uploads.hit(me(c)),
            'Zu viele Dateien auf einmal. Bitte warte ein wenig.',
          );
          return next();
        },
        bodyLimit({
          // The biggest file (a video) and the form around it; the rest is held to less after.
          maxSize: MAX_VIDEO_ATTACHMENT_BYTES + 64 * 1024,
          onError: (c) => c.json(new ApiError(413, 'file_too_large', tooBig).toBody(), 413),
        }),
        async (c) => {
          const file = (await c.req.parseBody().catch(() => ({}) as Record<string, unknown>))[
            'file'
          ];
          if (!(file instanceof File))
            throw badRequest('Bitte die Datei im Feld „file“ mitsenden.');
          return c.json(
            await uploadAttachment(deps, me(c), c.req.param('workspaceId'), {
              name: file.name,
              type: file.type,
              bytes: new Uint8Array(await file.arrayBuffer()),
            }),
            201,
          );
        },
      )
      /**
       * „KI-Schnitt“ (Beta): where a recorded video's pauses and slips are – from its sound alone
       * (multipart, field `file`, 16 kHz WAV); nothing is kept.
       */
      .post(
        '/workspaces/:workspaceId/video-cuts',
        viewer,
        (c, next) => {
          assertWithinLimit(
            c,
            cutsAsked.hit(me(c)),
            'Zu viele KI-Schnitte auf einmal. Bitte warte ein wenig.',
          );
          return next();
        },
        bodyLimit({
          maxSize: MAX_ATTACHMENT_BYTES + 64 * 1024,
          onError: (c) =>
            c.json(new ApiError(413, 'file_too_large', 'Die Aufnahme ist zu lang.').toBody(), 413),
        }),
        async (c) => {
          const file = (await c.req.parseBody().catch(() => ({}) as Record<string, unknown>))[
            'file'
          ];
          if (!(file instanceof File)) throw badRequest('Bitte den Ton im Feld „file“ mitsenden.');
          return c.json(
            await suggestVideoCuts(deps, me(c), c.req.param('workspaceId'), {
              name: file.name || 'aufnahme.wav',
              type: file.type || 'audio/wav',
              bytes: new Uint8Array(await file.arrayBuffer()),
            }),
          );
        },
      )
      /**
       * A video just put up, as the AI reads it (`services/video-digest.ts`): its stills (fields
       * `still`, JPEG, with their times in `at`, a JSON list of seconds), its length (`duration`)
       * and its sound (`speech`, 16 kHz WAV) – taken by the browser, the server sees no video.
       */
      .post(
        '/attachments/:id/digest',
        viewer,
        bodyLimit({
          maxSize: MAX_ATTACHMENT_BYTES + MAX_VIDEO_STILLS * 600_000 + 64 * 1024,
          onError: (c) =>
            c.json(new ApiError(413, 'file_too_large', 'Das Video ist zu lang.').toBody(), 413),
        }),
        async (c) => {
          assertWithinLimit(
            c,
            digests.hit(me(c)),
            'Zu viele Videos auf einmal. Bitte warte ein wenig.',
          );
          const body = await c.req
            .parseBody({ all: true })
            .catch(() => ({}) as Record<string, unknown>);
          const files = (value: unknown) =>
            (Array.isArray(value) ? value : [value]).filter((one) => one instanceof File);
          const stills = files(body['still']);
          let at: unknown;
          try {
            at = JSON.parse(typeof body['at'] === 'string' ? body['at'] : '[]');
          } catch {
            throw badRequest('Die Zeiten der Bilder fehlen.');
          }
          const times = Array.isArray(at) ? at.map(Number) : [];
          const [speech] = files(body['speech']);
          const duration = Number(body['duration']);
          await digestVideo(deps, me(c), c.req.param('id'), {
            duration: Number.isFinite(duration) ? duration : null,
            stills: await Promise.all(
              stills.slice(0, MAX_VIDEO_STILLS).map(async (still, index) => ({
                at: times[index] ?? Number.NaN,
                bytes: new Uint8Array(await still.arrayBuffer()),
              })),
            ),
            speech: speech
              ? {
                  name: speech.name || 'ton.wav',
                  type: speech.type || 'audio/wav',
                  bytes: new Uint8Array(await speech.arrayBuffer()),
                }
              : null,
          });
          return c.body(null, 204);
        },
      )
      // A sent document's pages for its preview (`services/attachment-pages.ts`): how many and
      // the first one's shape – 404 when it is none this server can show …
      .get('/attachments/:id/pages', viewer, async (c) => {
        const pages = await attachmentPages(deps, me(c), c.req.param('id'));
        if (!pages) throw notFound('Diese Datei lässt sich hier nicht zeigen.');
        c.header('Cache-Control', 'private, no-cache');
        return c.json(pages);
      })
      // … the first page drawn small, until the sharp one is there …
      .get('/attachments/:id/thumbnail', viewer, async (c) =>
        sendPage(c, await attachmentSmallPage(deps, me(c), c.req.param('id'))),
      )
      // … and each page drawn sharp.
      .get('/attachments/:id/pages/:page', viewer, async (c) => {
        const page = Number(c.req.param('page'));
        if (!Number.isInteger(page) || page < 1 || page > 5000) throw notFound();
        return sendPage(c, await attachmentPage(deps, me(c), c.req.param('id'), page));
      })
      .delete('/attachments/:id', viewer, async (c) => {
        await dropAttachment(deps, me(c), c.req.param('id'));
        return c.body(null, 204);
      })
      .get('/attachments/:id', viewer, async (c) => {
        const download = !!c.req.query('download');
        const row = await attachmentRow(deps, me(c), c.req.param('id'));
        if ((isVideoAttachment(row.type) || isAudioAttachment(row.type)) && !download) {
          // Played in the message (a video, a voice message): inline, a byte range at a time
          // (seeking, Safari at all).
          c.header('Content-Type', row.type);
          c.header(
            'Content-Disposition',
            `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
          );
          c.header('Cache-Control', 'private, max-age=31536000, immutable');
          c.header('Content-Security-Policy', "sandbox; default-src 'none'");
          c.header('X-Content-Type-Options', 'nosniff');
          c.header('Accept-Ranges', 'bytes');
          const range = parseRange(c.req.header('Range'), row.size);
          if (range === 'unsatisfiable') {
            c.header('Content-Range', `bytes */${row.size}`);
            return c.body(null, 416);
          }
          const body = await deps.storage.stream(row.key, range ?? undefined);
          if (!body) throw notFound('Die Datei ist nicht mehr gespeichert.');
          if (!range) {
            c.header('Content-Length', String(row.size));
            return c.body(body);
          }
          c.header('Content-Range', `bytes ${range.start}-${range.end}/${row.size}`);
          c.header('Content-Length', String(range.end - range.start + 1));
          return c.body(body, 206);
        }
        const found = await attachmentFile(deps, me(c), c.req.param('id'));
        // Only pictures show in the page; anything else (HTML, SVG …) is a download – never a
        // page of its own under the app's address.
        const shown = isPictureAttachment(found.type) && !download;
        c.header('Content-Type', shown ? found.type : 'application/octet-stream');
        c.header(
          'Content-Disposition',
          `${shown ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(found.name)}`,
        );
        // Its bytes never change: kept by the browser.
        c.header('Cache-Control', 'private, max-age=31536000, immutable');
        c.header('Content-Security-Policy', "sandbox; default-src 'none'");
        c.header('X-Content-Type-Options', 'nosniff');
        return c.body(new Uint8Array(found.bytes));
      })
  );
}
