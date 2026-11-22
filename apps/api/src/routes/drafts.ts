import { Hono, type Context } from 'hono';
import { senderDraftInputSchema, type AccountAuthor, type SenderDraft } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { deleteDraft, listDrafts, putDraft } from '../services/drafts';

/**
 * One's drafts in a workspace (`services/drafts.ts`) – each field one writes in keeps its words
 * here while typing (the client waits a moment between keys), so they wait on every device.
 * Account members only, each their own alone.
 */
export function draftsRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const me = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return (c.var.viewer.author as AccountAuthor).id;
  };
  // Typing all day in several fields stays far below; a loop filling the database does not.
  const writes = fixedWindow({ limit: 1200, windowMs: 10 * 60 * 1000, clock: deps.clock });
  const writing = (c: Context, userId: string) =>
    assertWithinLimit(
      c,
      writes.hit(userId),
      'Zu viele Entwürfe auf einmal. Bitte warte ein wenig.',
    );
  return new Hono<ViewerEnv>()
    .get('/workspaces/:workspaceId/drafts', viewer, async (c) =>
      c.json<SenderDraft[]>(await listDrafts(deps, me(c), c.req.param('workspaceId'))),
    )
    .put('/workspaces/:workspaceId/drafts/:key', viewer, async (c) => {
      const userId = me(c);
      writing(c, userId);
      const input = await readJson(c, senderDraftInputSchema);
      const kept = await putDraft(
        deps,
        userId,
        c.req.param('workspaceId'),
        c.req.param('key'),
        input,
      );
      return kept ? c.json<SenderDraft>(kept) : c.body(null, 204);
    })
    .delete('/workspaces/:workspaceId/drafts/:key', viewer, async (c) => {
      const userId = me(c);
      writing(c, userId);
      await deleteDraft(
        deps,
        userId,
        c.req.param('workspaceId'),
        c.req.param('key'),
        c.req.query('at'),
      );
      return c.body(null, 204);
    });
}
