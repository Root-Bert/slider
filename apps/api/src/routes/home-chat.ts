import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { homeChatInputSchema, type HomeChatEvent } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { answerHomeChat, startHomeChat } from '../services/home-chat';

/**
 * The AI on Slider's start (`services/home-chat.ts`): one message in, the answer streamed as events –
 * its words, what it does, `changed` when presentations were touched. Signed-in members only.
 */
export function homeChatRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const asks = aiLimits(deps).materialQuestions;
  return new Hono<ViewerEnv>().post('/workspaces/:id/chat', viewer, async (c) => {
    requireOwner(c.var.viewer);
    const userId = c.var.viewer.author.id;
    const person = c.var.viewer;
    const input = await readJson(c, homeChatInputSchema);
    assertWithinLimit(c, asks.hit(userId), 'Zu viele Fragen auf einmal. Bitte warte einen Moment.');
    // Refusals (no key, not a member) answer with their status before the stream starts.
    const chat = await startHomeChat(deps, person, c.req.param('id'), input);
    return streamSSE(c, async (stream) => {
      const gone = new AbortController();
      stream.onAbort(() => gone.abort());
      // Gone before the stream began (sent, the tab closed at once): nobody to write for.
      const request = c.req.raw.signal;
      if (request.aborted) gone.abort();
      else request.addEventListener('abort', () => gone.abort(), { once: true });
      let queue = Promise.resolve();
      const send = (event: HomeChatEvent) => {
        if (stream.aborted || stream.closed) return;
        queue = queue
          .then(() => stream.writeSSE({ event: 'chat', data: JSON.stringify(event) }))
          .catch(() => gone.abort());
      };
      await answerHomeChat(deps, chat, send, gone.signal);
      await queue;
    });
  });
}
