import { Hono } from 'hono';
import { todoChangeSchema, todoInputSchema, type AccountAuthor } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { createTodo, deleteTodo, getTodo, listTodos, updateTodo } from '../services/todos';

/**
 * To-dos (`services/todos.ts`): a workspace's overview (one's own and the areas' one sees), an
 * area's list, one to-do; making, changing, deleting them. Account members only.
 */
export function todoRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const me = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return (c.var.viewer.author as AccountAuthor).id;
  };
  return new Hono<ViewerEnv>()
    .get('/workspaces/:workspaceId/todos', viewer, async (c) =>
      c.json(
        await listTodos(deps, me(c), c.req.param('workspaceId'), {
          areaId: c.req.query('area') || undefined,
        }),
      ),
    )
    .post('/workspaces/:workspaceId/todos', viewer, async (c) => {
      const input = await readJson(c, todoInputSchema);
      return c.json(
        await createTodo(deps, me(c), c.req.param('workspaceId'), input, { viewer: c.var.viewer }),
        201,
      );
    })
    .get('/todos/:todoId', viewer, async (c) =>
      c.json(await getTodo(deps, me(c), c.req.param('todoId'))),
    )
    .patch('/todos/:todoId', viewer, async (c) => {
      const change = await readJson(c, todoChangeSchema);
      return c.json(
        await updateTodo(deps, me(c), c.req.param('todoId'), change, { viewer: c.var.viewer }),
      );
    })
    .delete('/todos/:todoId', viewer, async (c) => {
      await deleteTodo(deps, me(c), c.req.param('todoId'));
      return c.body(null, 204);
    });
}
