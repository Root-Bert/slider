import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { cloudChatInputSchema, type CloudChatEvent } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { answerCloudChat, startCloudChat } from '../services/cloud-chat';

/**
 * The AI in Cloud (`services/cloud-chat.ts`): one message in, the answer streamed as events –
 * its words, what it does, `changed` when files were touched. Signed-in members only.
 */
export function cloudChatRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const asks = aiLimits(deps).materialQuestions;
  return new Hono<ViewerEnv>().post('/workspaces/:id/cloud/chat', viewer, async (c) => {
    requireOwner(c.var.viewer);
    const userId = c.var.viewer.author.id;
    const input = await readJson(c, cloudChatInputSchema);
    assertWithinLimit(c, asks.hit(userId), 'Zu viele Fragen auf einmal. Bitte warte einen Moment.');
    // Refusals (no key, not a member) answer with their status before the stream starts.
    const chat = await startCloudChat(deps, c.var.viewer, c.req.param('id'), input);
    return streamSSE(c, async (stream) => {
      const gone = new AbortController();
      stream.onAbort(() => gone.abort());
      // Gone before the stream began (sent, the tab closed at once): nobody to write for.
      const request = c.req.raw.signal;
      if (request.aborted) gone.abort();
      else request.addEventListener('abort', () => gone.abort(), { once: true });
      let queue = Promise.resolve();
      const send = (event: CloudChatEvent) => {
        if (stream.aborted || stream.closed) return;
        queue = queue
          .then(() => stream.writeSSE({ event: 'chat', data: JSON.stringify(event) }))
          .catch(() => gone.abort());
      };
      await answerCloudChat(deps, chat, send, gone.signal);
      await queue;
    });
  });
}
