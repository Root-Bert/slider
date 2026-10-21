import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { updateLegalTextsInputSchema, type LegalTexts } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { users } from '../db/schema';
import type { AppDeps } from '../deps';
import { forbidden } from '../http/errors';
import { readJson } from '../http/validate';
import { getLegalTexts, saveLegalTexts } from '../services/legal';

/** Privacy policy and imprint (BER-141): anyone reads them, the instance admin writes them. */
export function legalRoutes(deps: AppDeps) {
  return new Hono<ViewerEnv>()
    .get('/legal', async (c) => c.json<LegalTexts>(await getLegalTexts(deps.db)))
    .put('/legal', viewerMiddleware(deps), async (c) => {
      requireOwner(c.var.viewer);
      const [row] = await deps.db
        .select({ admin: users.isInstanceAdmin })
        .from(users)
        .where(eq(users.id, c.var.viewer.author.id));
      if (!row?.admin) throw forbidden('Nur der Instanz-Admin pflegt Impressum und Datenschutz.');
      const texts = await readJson(c, updateLegalTextsInputSchema);
      await saveLegalTexts(deps.db, texts, deps.clock.now());
      return c.json<LegalTexts>(await getLegalTexts(deps.db));
    });
}
