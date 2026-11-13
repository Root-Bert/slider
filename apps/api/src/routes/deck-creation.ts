import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { startDeckCreationInputSchema } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  cancelCreation,
  dismissCreation,
  getCreation,
  startCreation,
} from '../services/deck-creation';

/**
 * A new deck built by the AI from the prompt on Folie 1 (`services/deck-creation`):
 * - `GET /decks/:deckId/creation` → `DeckCreation | null` (everyone who sees the deck);
 * - `POST /decks/:deckId/creation` `{ description, kind, pages, templateId }` → 202 `DeckCreation`;
 * - `POST /decks/:deckId/creation/cancel` → 204 („Abbrechen“, the slides built stay);
 * - `POST /decks/:deckId/creation/dismiss` → 204 („Leer anfangen“).
 */
export function deckCreationRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  // A deck is built a few times a day at most – shared with the KI-Apps' build_presentation.
  const window = aiLimits(deps).deckCreations;
  const starts = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      window.hit(c.var.viewer.author.id),
      'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
    );
    await next();
  });

  return new Hono<ViewerEnv>()
    .get('/decks/:deckId/creation', viewer, async (c) =>
      c.json(await getCreation(deps, c.var.viewer, c.req.param('deckId'))),
    )
    .post('/decks/:deckId/creation', viewer, starts, async (c) => {
      const input = await readJson(c, startDeckCreationInputSchema);
      return c.json(await startCreation(deps, c.var.viewer, c.req.param('deckId'), input), 202);
    })
    .post('/decks/:deckId/creation/cancel', viewer, async (c) => {
      await cancelCreation(deps, c.var.viewer, c.req.param('deckId'));
      return c.body(null, 204);
    })
    .post('/decks/:deckId/creation/dismiss', viewer, async (c) => {
      await dismissCreation(deps, c.var.viewer, c.req.param('deckId'));
      return c.body(null, 204);
    });
}
