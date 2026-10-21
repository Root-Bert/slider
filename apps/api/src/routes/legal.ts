import { Hono } from 'hono';
import { updateLegalTextsInputSchema, type LegalTexts } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { requireInstanceAdmin } from '../services/instance-admin';
import { getLegalTexts, saveLegalTexts } from '../services/legal';

/** Privacy policy and imprint (BER-141): anyone reads them, the instance admin writes them. */
export function legalRoutes(deps: AppDeps) {
  return new Hono<ViewerEnv>()
    .get('/legal', async (c) => c.json<LegalTexts>(await getLegalTexts(deps.db)))
    .put('/legal', viewerMiddleware(deps), async (c) => {
      await requireInstanceAdmin(
        deps.db,
        c.var.viewer,
        'Nur der Instanz-Admin pflegt Impressum und Datenschutz.',
      );
      const texts = await readJson(c, updateLegalTextsInputSchema);
      await saveLegalTexts(deps.db, texts, deps.clock.now());
      return c.json<LegalTexts>(await getLegalTexts(deps.db));
    });
}
