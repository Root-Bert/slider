import { Hono } from 'hono';
import { createReviewLinkInputSchema } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { createReviewLink, listReviewLinks, revokeReviewLink } from '../services/review-links';

export function reviewLinksRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);

  return new Hono<ViewerEnv>()
    .get('/decks/:deckId/review-links', viewer, async (c) =>
      c.json(await listReviewLinks(deps, c.var.viewer, c.req.param('deckId'))),
    )
    .post('/decks/:deckId/review-links', viewer, async (c) => {
      const input = await readJson(c, createReviewLinkInputSchema);
      return c.json(await createReviewLink(deps, c.var.viewer, c.req.param('deckId'), input), 201);
    })
    .delete('/review-links/:linkId', viewer, async (c) => {
      await revokeReviewLink(deps, c.var.viewer, c.req.param('linkId'));
      return c.body(null, 204);
    });
}
