import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { materialChatInputSchema, type MaterialChatEvent } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  answerMaterialChat,
  deleteMaterialChat,
  getMaterialChat,
  listMaterialChats,
  startMaterialChat,
} from '../services/material-chat';

/**
 * The AI on the material page (`services/material-chat.ts`), each person's own chats:
 * - `POST /decks/:deckId/material-chat` `{ chatId, text }` → `text/event-stream` of
 *   `MaterialChatEvent`s (event `chat`) until it is done; the stream closed, it stops;
 * - `GET /decks/:deckId/material-chats` → the chats, latest first; `GET …/:chatId` → one with its
 *   messages; `DELETE …/:chatId`.
 */
export function materialChatRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const asks = aiLimits(deps).materialQuestions;

  return new Hono<ViewerEnv>()
    .get('/decks/:deckId/material-chats', viewer, async (c) =>
      c.json(await listMaterialChats(deps, c.var.viewer, c.req.param('deckId'))),
    )
    .get('/decks/:deckId/material-chats/:chatId', viewer, async (c) =>
      c.json(
        await getMaterialChat(deps, c.var.viewer, c.req.param('deckId'), c.req.param('chatId')),
      ),
    )
    .delete('/decks/:deckId/material-chats/:chatId', viewer, async (c) => {
      await deleteMaterialChat(deps, c.var.viewer, c.req.param('deckId'), c.req.param('chatId'));
      return c.body(null, 204);
    })
    .post('/decks/:deckId/material-chat', viewer, async (c) => {
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
