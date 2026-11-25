import { Hono } from 'hono';
import {
  milestoneChangeSchema,
  milestoneInputSchema,
  projectChangeSchema,
  projectInputSchema,
  todoChangeSchema,
  todoInputSchema,
  type AccountAuthor,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  createMilestone,
  createProject,
  createTodo,
  deleteMilestone,
  deleteProject,
  deleteTodo,
  getTodo,
  listMilestones,
  listProjects,
  listTodos,
  newTodoAgent,
  sendTodoAgent,
  updateMilestone,
  updateProject,
  updateTodo,
} from '../services/todos';

/**
 * To-dos (`services/todos.ts`): a workspace's overview (one's own and the areas' one sees), an
 * area's list, one to-do; making, changing, deleting them; a new agent for one, the agent given
 * one sent on it; the milestones they lead to; an area's projects. Account members only.
 */
export function todoRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  // „Losschicken“ starts an agent's run: counted as the agents' orders are.
  const asks = aiLimits(deps).materialQuestions;
  const TOO_MANY = 'Zu viele Aufträge auf einmal. Bitte warte einen Moment.';
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
    .post('/todos/:todoId/agent', viewer, async (c) => {
      me(c);
      return c.json(await newTodoAgent(deps, c.var.viewer, c.req.param('todoId')), 201);
    })
    .post('/todos/:todoId/send', viewer, async (c) => {
      assertWithinLimit(c, asks.hit(me(c)), TOO_MANY);
      return c.json(await sendTodoAgent(deps, c.var.viewer, c.req.param('todoId')));
    })
    .delete('/todos/:todoId', viewer, async (c) => {
      await deleteTodo(deps, me(c), c.req.param('todoId'));
      return c.body(null, 204);
    })
    .get('/workspaces/:workspaceId/todo-milestones', viewer, async (c) =>
      c.json(
        await listMilestones(deps, me(c), c.req.param('workspaceId'), {
          areaId: c.req.query('area') || undefined,
        }),
      ),
    )
    .post('/workspaces/:workspaceId/todo-milestones', viewer, async (c) => {
      const input = await readJson(c, milestoneInputSchema);
      return c.json(await createMilestone(deps, me(c), c.req.param('workspaceId'), input), 201);
    })
    .patch('/todo-milestones/:milestoneId', viewer, async (c) => {
      const change = await readJson(c, milestoneChangeSchema);
      return c.json(await updateMilestone(deps, me(c), c.req.param('milestoneId'), change));
    })
    .delete('/todo-milestones/:milestoneId', viewer, async (c) => {
      await deleteMilestone(deps, me(c), c.req.param('milestoneId'));
      return c.body(null, 204);
    })
    .get('/workspaces/:workspaceId/todo-projects', viewer, async (c) =>
      c.json(
        await listProjects(deps, me(c), c.req.param('workspaceId'), {
          areaId: c.req.query('area') || undefined,
        }),
      ),
    )
    .post('/workspaces/:workspaceId/todo-projects', viewer, async (c) => {
      const input = await readJson(c, projectInputSchema);
      return c.json(await createProject(deps, me(c), c.req.param('workspaceId'), input), 201);
    })
    .patch('/todo-projects/:projectId', viewer, async (c) => {
      const change = await readJson(c, projectChangeSchema);
      return c.json(await updateProject(deps, me(c), c.req.param('projectId'), change));
    })
    .delete('/todo-projects/:projectId', viewer, async (c) => {
      await deleteProject(deps, me(c), c.req.param('projectId'));
      return c.body(null, 204);
    });
}
