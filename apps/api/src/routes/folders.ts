import { Hono } from 'hono';
import { deckFolderInputSchema } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { createFolder, deleteFolder, listFolders, renameFolder } from '../services/folders';

/** Folders to sort a workspace's decks into. */
export function foldersRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const userId = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return c.var.viewer.author.id;
  };

  return new Hono<ViewerEnv>()
    .get('/workspaces/:id/folders', viewer, async (c) =>
      c.json(await listFolders(deps.db, userId(c), c.req.param('id'))),
    )
    .post('/workspaces/:id/folders', viewer, async (c) => {
      const id = userId(c);
      const { name } = await readJson(c, deckFolderInputSchema);
      const folder = await createFolder(deps.db, id, c.req.param('id'), name, deps.clock.now());
      return c.json(folder, 201);
    })
    .patch('/folders/:folderId', viewer, async (c) => {
      const id = userId(c);
      const { name } = await readJson(c, deckFolderInputSchema);
      return c.json(await renameFolder(deps.db, id, c.req.param('folderId'), name));
    })
    .delete('/folders/:folderId', viewer, async (c) => {
      await deleteFolder(deps.db, userId(c), c.req.param('folderId'));
      return c.body(null, 204);
    });
}
