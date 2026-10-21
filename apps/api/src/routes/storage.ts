import { Hono } from 'hono';
import { requireDeckAccess } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { getDeckStorage, pruneOlderVersions } from '../services/deck-storage';

/** Storage of a review and "Alles außer der neuesten Version löschen" – for its managers only. */
export function storageRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);

  return new Hono<ViewerEnv>()
    .get('/decks/:deckId/storage', viewer, async (c) => {
      const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'own');
      return c.json(await getDeckStorage(deps, deck));
    })
    .post('/decks/:deckId/storage/prune', viewer, async (c) => {
      const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'own');
      return c.json(await pruneOlderVersions(deps, deck.id));
    });
}
