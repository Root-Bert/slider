import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import type { z } from 'zod';
import {
  MAX_VOICE_CLIP_BYTES,
  MAX_VOICE_SEGMENT_BYTES,
  voiceClipMetaSchema,
  voiceSegmentMetaSchema,
} from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, badRequest } from '../http/errors';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { attachSpokenRecording } from '../services/media';
import {
  addVoiceSegment,
  flushVoiceSession,
  getVoiceSession,
  liveVoiceToken,
  startVoiceSession,
  voiceItemForRecording,
} from '../services/voice/session';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const HOUR_MS = 60 * 60_000;

/** A file and its JSON description from a form (`audio` and `meta`). */
async function formWith<S extends z.ZodType>(
  c: Context<ViewerEnv>,
  schema: S,
): Promise<{ audio: Uint8Array<ArrayBuffer>; meta: z.output<S> }> {
  const body = await c.req.parseBody().catch(() => {
    throw badRequest('Die Aufnahme konnte nicht gelesen werden.');
  });
  const file = body['audio'];
  const meta = body['meta'];
  if (!(file instanceof File)) throw badRequest('Bitte die Aufnahme im Feld „audio“ mitsenden.');
  if (typeof meta !== 'string') throw badRequest('Das Feld „meta“ fehlt.');
  let json: unknown;
  try {
    json = JSON.parse(meta);
  } catch {
    throw badRequest('Das Feld „meta“ ist kein gültiges JSON.');
  }
  return { audio: new Uint8Array(await file.arrayBuffer()), meta: schema.parse(json) };
}

const tooLarge = (what: string) =>
  bodyLimit({
    maxSize:
      (what === 'segment' ? MAX_VOICE_SEGMENT_BYTES : MAX_VOICE_CLIP_BYTES) +
      MULTIPART_OVERHEAD_BYTES,
    onError: (c) =>
      c.json(new ApiError(413, 'file_too_large', 'Die Aufnahme ist zu groß.').toBody(), 413),
  });

/** Speaking to the AI: a session, its pieces of speech, its comments' recordings. */
export function voiceRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  // A piece every few seconds while someone speaks for an hour; each is a paid request on the
  // workspace's speech key and its AI.
  const segmentWindow = fixedWindow({ limit: 1_500, windowMs: HOUR_MS, clock: deps.clock });
  const segments = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      segmentWindow.hit(c.var.viewer.author.id),
      'Du hast in der letzten Stunde sehr viel gesprochen. Bitte warte einen Moment.',
    );
    await next();
  });
  const sessionWindow = fixedWindow({ limit: 60, windowMs: HOUR_MS, clock: deps.clock });
  const starts = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      sessionWindow.hit(c.var.viewer.author.id),
      'Zu viele Sprech-Sitzungen gestartet. Bitte warte einen Moment.',
    );
    await next();
  });

  // A token per connection to the live stream – reconnecting after a drop asks again.
  const liveWindow = fixedWindow({ limit: 240, windowMs: HOUR_MS, clock: deps.clock });
  const lives = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      liveWindow.hit(c.var.viewer.author.id),
      'Die Live-Mitschrift wurde zu oft neu verbunden. Bitte warte einen Moment.',
    );
    await next();
  });

  return (
    new Hono<ViewerEnv>()
      .post('/decks/:deckId/voice', viewer, starts, async (c) =>
        c.json(await startVoiceSession(deps, c.var.viewer, c.req.param('deckId')), 201),
      )
      .get('/voice/:sessionId', viewer, async (c) =>
        c.json(await getVoiceSession(deps, c.var.viewer, c.req.param('sessionId'))),
      )
      .post('/voice/:sessionId/segments', viewer, segments, tooLarge('segment'), async (c) => {
        const { audio, meta } = await formWith(c, voiceSegmentMetaSchema);
        return c.json(
          await addVoiceSegment(deps, c.var.viewer, c.req.param('sessionId'), meta, audio),
        );
      })
      // The words as they are spoken: a token for the service's stream, per connection.
      .post('/voice/:sessionId/live', viewer, lives, async (c) =>
        c.json(await liveVoiceToken(deps, c.var.viewer, c.req.param('sessionId'))),
      )
      // A pause: comments still being said are finished.
      .post('/voice/:sessionId/flush', viewer, async (c) =>
        c.json(await flushVoiceSession(deps, c.var.viewer, c.req.param('sessionId'))),
      )
      .post('/voice/:sessionId/end', viewer, async (c) =>
        c.json(
          await flushVoiceSession(deps, c.var.viewer, c.req.param('sessionId'), { end: true }),
        ),
      )
      .put(
        '/voice/:sessionId/items/:commentId/recording',
        viewer,
        segments,
        tooLarge('clip'),
        async (c) => {
          const { audio, meta } = await formWith(c, voiceClipMetaSchema);
          const commentId = c.req.param('commentId');
          const item = voiceItemForRecording(
            deps,
            c.var.viewer,
            c.req.param('sessionId'),
            commentId,
          );
          const comment = await attachSpokenRecording(
            deps,
            c.var.viewer,
            commentId,
            meta,
            item.transcript,
            { bytes: audio },
          );
          item.markRecorded();
          return c.json(comment);
        },
      )
  );
}
