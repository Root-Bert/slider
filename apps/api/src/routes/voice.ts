import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import type { z } from 'zod';
import {
  MAX_VOICE_CLIP_BYTES,
  MAX_VOICE_SEGMENT_BYTES,
  documentVoiceSegmentMetaSchema,
  voiceClipMetaSchema,
  voiceSegmentMetaSchema,
} from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, badRequest } from '../http/errors';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { DocumentLive } from '../services/documents';
import { attachSpokenRecording } from '../services/media';
import {
  addDocumentVoiceSegment,
  documentVoiceInfo,
  flushDocumentVoiceSession,
  getDocumentVoiceSession,
  isDocumentVoiceSession,
  liveDocumentVoiceToken,
  startDocumentVoiceSession,
} from '../services/voice/document-session';
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

/**
 * Speaking to the AI: a session, its pieces of speech, its comments' recordings. A session is a
 * deck's or a document's (`document-session`); past its start both go by the same addresses, told
 * apart by the session's id.
 */
export function voiceRoutes(deps: AppDeps, documentLive = new DocumentLive()) {
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
      // The document's AI by name and whether it can be spoken to – what a deck says as `ai`.
      .get('/documents/:documentId/voice', viewer, async (c) =>
        c.json(await documentVoiceInfo(deps, c.var.viewer, c.req.param('documentId'))),
      )
      .post('/documents/:documentId/voice', viewer, starts, async (c) =>
        c.json(await startDocumentVoiceSession(deps, c.var.viewer, c.req.param('documentId')), 201),
      )
      .get('/voice/:sessionId', viewer, async (c) => {
        const id = c.req.param('sessionId');
        return c.json(
          isDocumentVoiceSession(id)
            ? await getDocumentVoiceSession(deps, c.var.viewer, id)
            : await getVoiceSession(deps, c.var.viewer, id),
        );
      })
      .post('/voice/:sessionId/segments', viewer, segments, tooLarge('segment'), async (c) => {
        const id = c.req.param('sessionId');
        if (isDocumentVoiceSession(id)) {
          const { audio, meta } = await formWith(c, documentVoiceSegmentMetaSchema);
          return c.json(
            await addDocumentVoiceSegment(deps, documentLive, c.var.viewer, id, meta, audio),
          );
        }
        const { audio, meta } = await formWith(c, voiceSegmentMetaSchema);
        return c.json(await addVoiceSegment(deps, c.var.viewer, id, meta, audio));
      })
      // The words as they are spoken: a token for the service's stream, per connection.
      .post('/voice/:sessionId/live', viewer, lives, async (c) => {
        const id = c.req.param('sessionId');
        return c.json(
          isDocumentVoiceSession(id)
            ? await liveDocumentVoiceToken(deps, c.var.viewer, id)
            : await liveVoiceToken(deps, c.var.viewer, id),
        );
      })
      // A pause: comments still being said are finished. `end`: and no more are taken.
      .post('/voice/:sessionId/:step{flush|end}', viewer, async (c) => {
        const id = c.req.param('sessionId');
        const options = { end: c.req.param('step') === 'end' };
        return c.json(
          isDocumentVoiceSession(id)
            ? await flushDocumentVoiceSession(deps, documentLive, c.var.viewer, id, options)
            : await flushVoiceSession(deps, c.var.viewer, id, options),
        );
      })
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
