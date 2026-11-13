import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { askMaterialInputSchema, type MaterialAnswerEvent } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { notFound } from '../http/errors';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  answerMaterialQuestion,
  deleteMaterialQuestion,
  listMaterialQuestions,
  startMaterialQuestion,
  stopMaterialQuestion,
} from '../services/material-questions';

/** The event name of an answer's stream. */
export const MATERIAL_ANSWER_EVENT = 'answer';

/**
 * „Fragen“ on the material page (`services/material-questions.ts`) – notes asked with ⌘↵, their
 * answers under them for everyone who sees the board:
 * - `GET /decks/:deckId/material-questions` → `MaterialQuestion[]`;
 * - `POST /decks/:deckId/material-questions` `{ id, noteId, question }` → `text/event-stream` of
 *   `MaterialAnswerEvent`s (event `answer`) until it is done; the stream closed, it stops;
 * - `POST /material-questions/:id/stop` → 204 („Stoppen“);
 * - `DELETE /material-questions/:id` → 204 („Antwort löschen“).
 */
export function materialQuestionsRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const asks = aiLimits(deps).materialQuestions;

  return new Hono<ViewerEnv>()
    .get('/decks/:deckId/material-questions', viewer, async (c) =>
      c.json(await listMaterialQuestions(deps, c.var.viewer, c.req.param('deckId'))),
    )
    .post('/decks/:deckId/material-questions', viewer, async (c) => {
      assertWithinLimit(
        c,
        asks.hit(c.var.viewer.author.id),
        'Zu viele Fragen auf einmal. Bitte warte einen Moment.',
      );
      const input = await readJson(c, askMaterialInputSchema);
      // Refusals (no key, no access) answer with their status before the stream starts.
      const ask = await startMaterialQuestion(deps, c.var.viewer, c.req.param('deckId'), input);
      return streamSSE(c, async (stream) => {
        const gone = new AbortController();
        stream.onAbort(() => gone.abort());
        let queue = Promise.resolve();
        const send = (event: MaterialAnswerEvent) => {
          if (stream.aborted || stream.closed) return;
          queue = queue
            .then(() =>
              stream.writeSSE({ event: MATERIAL_ANSWER_EVENT, data: JSON.stringify(event) }),
            )
            .catch(() => gone.abort());
        };
        await answerMaterialQuestion(deps, ask, send, gone.signal);
        await queue;
      });
    })
    .post('/material-questions/:questionId/stop', viewer, (c) => {
      if (!stopMaterialQuestion(c.var.viewer, c.req.param('questionId')))
        throw notFound('Diese Antwort wird nicht (mehr) geschrieben.');
      return c.body(null, 204);
    })
    .delete('/material-questions/:questionId', viewer, async (c) => {
      if (!(await deleteMaterialQuestion(deps, c.var.viewer, c.req.param('questionId'))))
        throw notFound('Diese Antwort gibt es nicht (mehr).');
      return c.body(null, 204);
    });
}
