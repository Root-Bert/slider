import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { materialChatInputSchema, type MaterialChatEvent } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { answerMaterialChat, startMaterialChat } from '../services/material-chat';

/**
 * The AI on the material page (`services/material-chat.ts`):
 * - `POST /decks/:deckId/material-chat` `{ messages }` → `text/event-stream` of
 *   `MaterialChatEvent`s (event `chat`) until it is done; the stream closed, it stops.
 */
export function materialChatRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const asks = aiLimits(deps).materialQuestions;

  return new Hono<ViewerEnv>().post('/decks/:deckId/material-chat', viewer, async (c) => {
    const input = await readJson(c, materialChatInputSchema);
    assertWithinLimit(
      c,
      asks.hit(c.var.viewer.author.id),
      'Zu viele Fragen auf einmal. Bitte warte einen Moment.',
    );
    // Refusals (no key, no access) answer with their status before the stream starts.
    const chat = await startMaterialChat(deps, c.var.viewer, c.req.param('deckId'), input);
    return streamSSE(c, async (stream) => {
      const gone = new AbortController();
      stream.onAbort(() => gone.abort());
      // Gone before the stream began (sent, the tab closed at once): nobody to write for.
      const request = c.req.raw.signal;
      if (request.aborted) gone.abort();
      else request.addEventListener('abort', () => gone.abort(), { once: true });
      let queue = Promise.resolve();
      const send = (event: MaterialChatEvent) => {
        if (stream.aborted || stream.closed) return;
        queue = queue
          .then(() => stream.writeSSE({ event: 'chat', data: JSON.stringify(event) }))
          .catch(() => gone.abort());
      };
      await answerMaterialChat(deps, chat, send, gone.signal);
      await queue;
    });
  });
}
