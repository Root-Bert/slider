import { Hono } from 'hono';
import { createCommentInputSchema, updateCommentInputSchema } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { createComment, deleteComment, listComments, updateComment } from '../services/comments';

export function commentsRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);

  return new Hono<ViewerEnv>()
    .get('/decks/:deckId/comments', viewer, async (c) =>
      c.json(await listComments(deps, c.var.viewer, c.req.param('deckId'))),
    )
    .post('/decks/:deckId/comments', viewer, async (c) => {
      const input = await readJson(c, createCommentInputSchema);
      return c.json(await createComment(deps, c.var.viewer, c.req.param('deckId'), input), 201);
    })
    .patch('/comments/:commentId', viewer, async (c) => {
      const input = await readJson(c, updateCommentInputSchema);
      return c.json(await updateComment(deps, c.var.viewer, c.req.param('commentId'), input));
    })
    .delete('/comments/:commentId', viewer, async (c) => {
      await deleteComment(deps, c.var.viewer, c.req.param('commentId'));
      return c.body(null, 204);
    });
}
