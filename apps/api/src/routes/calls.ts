import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import {
  callAgentInviteSchema,
  callOrderAnswerSchema,
  callJoinSchema,
  callLeaveSchema,
  callMediaSchema,
  callPeerIdSchema,
  callPeerSchema,
  callSignalSchema,
  callHushSchema,
  callTranscriptSchema,
  MAX_CALL_UTTERANCE,
  type AccountAuthor,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { resolveViewer, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, badRequest } from '../http/errors';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import type { CallHub } from '../services/calls';
import { getCallRecord } from '../services/call-records';
import { failureMessage, isProviderError } from '../services/ai-providers';
import { liveTokenFor, SpeechProblem, transcribePiece } from '../services/voice/session';

/**
 * Bun notices a closed stream only when it writes to it: the ping is how a tab that vanished
 * without hanging up (crash, lost network) leaves – after this plus the hub's grace period. A tab
 * that is closed or loaded anew hangs up itself (`pagehide`).
 */
const HEARTBEAT_MS = 10_000;
const ACCESS_CHECK_MS = 60_000;
const CALL_EVENT = 'call';
/** A turn of at most ~30 s, 16 kHz mono 16 bit, as WAV. */
const MAX_TURN_AUDIO_BYTES = 2 * 1024 * 1024 + 64 * 1024;

/**
 * Calls (`services/calls.ts`): one stream per tab of a signed-in person, open on every page, and
 * the steps of a call – start or join one in a conversation, hang up, decline, tell what is on,
 * pass a signal to another tab; call a Cloud agent, hand over what one said (for the notes, or
 * to the agent) and get the token to write it down live. Account members only; who sees a
 * conversation may call in it, who may write to an agent may call it.
 */
const HOUR_MS = 60 * 60_000;

export function callRoutes(deps: AppDeps, calls: CallHub) {
  const viewer = viewerMiddleware(deps);
  // As for speaking to the AI (`routes/voice.ts`): a token per connection to the live stream,
  // a turn every few seconds while someone speaks for an hour – each on the workspace's keys.
  const liveWindow = fixedWindow({ limit: 240, windowMs: HOUR_MS, clock: deps.clock });
  const turnWindow = fixedWindow({ limit: 1_500, windowMs: HOUR_MS, clock: deps.clock });
  const lives = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      liveWindow.hit(c.var.viewer.author.id),
      'Die Live-Mitschrift wurde zu oft neu verbunden. Bitte warte einen Moment.',
    );
    await next();
  });
  const turns = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      turnWindow.hit(c.var.viewer.author.id),
      'Du hast in der letzten Stunde sehr viel gesprochen. Bitte warte einen Moment.',
    );
    await next();
  });
  const me = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return c.var.viewer.author as AccountAuthor;
  };
  return (
    new Hono<ViewerEnv>()
      .post('/sender/channels/:channelId/call', viewer, async (c) => {
        const input = await readJson(c, callJoinSchema);
        return c.json(await calls.join(deps, me(c), c.req.param('channelId'), input));
      })
      .post('/cloud/agents/:agentId/call', viewer, async (c) => {
        const input = await readJson(c, callPeerSchema);
        me(c);
        return c.json(await calls.callAgent(deps, c.var.viewer, c.req.param('agentId'), input));
      })
      // A call that is over: its turns, who was in it, and the notes written after it.
      .get('/calls/:callId/record', viewer, async (c) => {
        me(c);
        return c.json(await getCallRecord(deps, c.var.viewer, c.req.param('callId')));
      })
      .post('/calls/:callId/agent', viewer, async (c) => {
        const input = await readJson(c, callAgentInviteSchema);
        me(c);
        return c.json(await calls.bringAgent(deps, c.var.viewer, c.req.param('callId'), input));
      })
      .post('/calls/:callId/agent/leave', viewer, async (c) => {
        const { peerId } = await readJson(c, callPeerSchema);
        calls.sendAgentAway(c.req.param('callId'), me(c).id, peerId);
        return c.body(null, 204);
      })
      .post('/calls/:callId/orders/:orderId', viewer, async (c) => {
        const input = await readJson(c, callOrderAnswerSchema);
        me(c);
        await calls.answerOrder(
          deps,
          c.var.viewer,
          c.req.param('callId'),
          c.req.param('orderId'),
          input,
        );
        return c.body(null, 204);
      })
      /** The agent's answer in its own voice (MP3) – for a tab of the call. */
      .get('/calls/:callId/says/:sayId', viewer, async (c) => {
        const peer = callPeerIdSchema.safeParse(c.req.query('peer'));
        if (!peer.success) throw badRequest('Ungültige Tab-Kennung.');
        const audio = await calls.sayAudio(
          c.req.param('callId'),
          me(c).id,
          peer.data,
          c.req.param('sayId'),
        );
        return c.body(audio, 200, {
          'content-type': 'audio/wav',
          'cache-control': 'no-store',
        });
      })
      /** This tab's person talked over the agent: its answer stops in every tab. */
      .post('/calls/:callId/hush', viewer, async (c) => {
        const { peerId, heard } = await readJson(c, callHushSchema);
        calls.hush(c.req.param('callId'), me(c).id, peerId, heard);
        return c.body(null, 204);
      })
      /** The token for writing down live what this tab's person says (`null`: no such key). */
      .post('/calls/:callId/live', viewer, lives, async (c) => {
        const { peerId } = await readJson(c, callPeerSchema);
        const tab = calls.tabIn(c.req.param('callId'), me(c).id, peerId);
        return c.json(await liveTokenFor(deps, tab.workspaceId, tab.words));
      })
      /**
       * Without a live key: one turn of this tab's person as a WAV, written down by the
       * workspace's speech to text (a self-hosted Whisper, a service) and then heard as said.
       */
      .post(
        '/calls/:callId/heard',
        bodyLimit({
          maxSize: MAX_TURN_AUDIO_BYTES,
          onError: (c) =>
            c.json(new ApiError(413, 'file_too_large', 'Die Aufnahme ist zu groß.').toBody(), 413),
        }),
        viewer,
        turns,
        async (c) => {
          const callId = c.req.param('callId');
          const tab = calls.tabIn(callId, me(c).id, c.req.query('peer') ?? '');
          const file = (await c.req.parseBody().catch(() => ({}) as Record<string, unknown>))[
            'audio'
          ];
          if (!(file instanceof File))
            throw badRequest('Bitte die Aufnahme im Feld „audio“ mitsenden.');
          const audio = new Uint8Array(await file.arrayBuffer());
          if (audio.byteLength < 1000) return c.json({ text: '' });
          let text: string;
          try {
            text = await transcribePiece(
              deps,
              tab.workspaceId,
              { seq: 0, audio },
              { vocabulary: tab.words, names: [] },
              () => {},
            );
          } catch (error) {
            if (error instanceof ApiError) throw error;
            if (error instanceof SpeechProblem) {
              if (!isProviderError(error.cause))
                deps.log.warn('Call: turn not transcribed', error.cause);
              throw new ApiError(502, 'internal', failureMessage(error.cause, error.connection));
            }
            throw error;
          }
          text = text.replace(/\s+/g, ' ').trim().slice(0, MAX_CALL_UTTERANCE);
          if (text) calls.heard(deps, c.var.viewer, callId, c.req.query('peer') ?? '', text);
          return c.json({ text });
        },
      )
      .post('/calls/:callId/transcript', viewer, turns, async (c) => {
        const { peerId, text } = await readJson(c, callTranscriptSchema);
        me(c);
        calls.heard(deps, c.var.viewer, c.req.param('callId'), peerId, text);
        return c.body(null, 204);
      })
      .post('/calls/:callId/leave', viewer, async (c) => {
        const { peerId } = await readJson(c, callLeaveSchema);
        calls.leave(c.req.param('callId'), me(c).id, peerId);
        return c.body(null, 204);
      })
      .post('/calls/:callId/decline', viewer, (c) => {
        calls.decline(c.req.param('callId'), me(c).id);
        return c.body(null, 204);
      })
      .post('/calls/:callId/media', viewer, async (c) => {
        const input = await readJson(c, callMediaSchema);
        return c.json(calls.media(c.req.param('callId'), me(c).id, input));
      })
      .post('/calls/:callId/signal', viewer, async (c) => {
        const { from, to, signal } = await readJson(c, callSignalSchema);
        calls.signal(c.req.param('callId'), me(c).id, from, to, signal);
        return c.body(null, 204);
      })
      /** The calls the person sees and the signals for this tab – open on every page. */
      .get('/calls/live', viewer, async (c) => {
        const userId = me(c).id;
        const peer = callPeerIdSchema.safeParse(c.req.query('peer'));
        if (!peer.success) throw badRequest('Ungültige Tab-Kennung.');
        c.header('X-Accel-Buffering', 'no');
        return streamSSE(c, async (stream) => {
          const open = () => !stream.aborted && !stream.closed;
          const leave = calls.connect(userId, peer.data, (event) => {
            if (!open()) return;
            stream.writeSSE({ event: CALL_EVENT, data: JSON.stringify(event) }).catch(() => {});
          });
          stream.onAbort(leave);
          let checkedAt = Date.now();
          try {
            await stream.write(': open\n\n');
            while (open()) {
              await stream.sleep(HEARTBEAT_MS);
              if (!open()) break;
              if (Date.now() - checkedAt >= ACCESS_CHECK_MS) {
                checkedAt = Date.now();
                const current = await resolveViewer(c, deps, { readOnly: true }).catch(() => null);
                if (current?.author.id !== userId) break;
              }
              await stream.write(': ping\n\n');
            }
          } finally {
            leave();
          }
        });
      })
  );
}
