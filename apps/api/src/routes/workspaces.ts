import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  createWorkspaceInputSchema,
  createWorkspaceInviteInputSchema,
  updateMemberInputSchema,
  updateWorkspaceInputSchema,
  type JoinResult,
  type Viewer,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { users, type UserRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { rateLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  acceptInviteById,
  createInvite,
  deleteWorkspace,
  foundWorkspace,
  getWorkspace,
  joinByToken,
  listInvites,
  listMembers,
  listWorkspaces,
  previewInvite,
  removeMember,
  renameWorkspace,
  revokeInvite,
  updateMemberRole,
} from '../services/workspaces';

/** The signed-in account behind the viewer; guests are not members of anything (403). */
async function requireUser(deps: AppDeps, viewer: Viewer): Promise<UserRow> {
  requireOwner(viewer);
  const [user] = await deps.db.select().from(users).where(eq(users.id, viewer.author.id));
  if (!user) throw new Error(`User ${viewer.author.id} vanished`);
  return user;
}

/** Workspaces, members and invitations (BER-129). */
export function workspacesRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const limited = rateLimit({
    limit: deps.config.inviteRateLimit,
    windowMs: 60_000,
    clock: deps.clock,
  });
  const userId = (v: Viewer) => {
    requireOwner(v);
    return v.author.id;
  };

  return (
    new Hono<ViewerEnv>()
      .get('/workspaces', viewer, async (c) =>
        c.json(await listWorkspaces(deps, userId(c.var.viewer))),
      )
      .post('/workspaces', viewer, async (c) => {
        const id = userId(c.var.viewer);
        const { name } = await readJson(c, createWorkspaceInputSchema);
        const row = await foundWorkspace(deps, id, name);
        return c.json(await getWorkspace(deps, id, row.id), 201);
      })
      .get('/workspaces/:id', viewer, async (c) =>
        c.json(await getWorkspace(deps, userId(c.var.viewer), c.req.param('id'))),
      )
      .patch('/workspaces/:id', viewer, async (c) => {
        const { name } = await readJson(c, updateWorkspaceInputSchema);
        return c.json(await renameWorkspace(deps, userId(c.var.viewer), c.req.param('id'), name));
      })
      .delete('/workspaces/:id', viewer, async (c) => {
        await deleteWorkspace(deps, userId(c.var.viewer), c.req.param('id'));
        return c.body(null, 204);
      })

      .get('/workspaces/:id/members', viewer, async (c) =>
        c.json(await listMembers(deps.db, userId(c.var.viewer), c.req.param('id'))),
      )
      .patch('/workspaces/:id/members/:userId', viewer, async (c) => {
        const { role } = await readJson(c, updateMemberInputSchema);
        return c.json(
          await updateMemberRole(
            deps.db,
            userId(c.var.viewer),
            c.req.param('id'),
            c.req.param('userId'),
            role,
          ),
        );
      })
      .delete('/workspaces/:id/members/:userId', viewer, async (c) => {
        await removeMember(deps.db, userId(c.var.viewer), c.req.param('id'), c.req.param('userId'));
        return c.body(null, 204);
      })

      .get('/workspaces/:id/invites', viewer, async (c) =>
        c.json(await listInvites(deps, userId(c.var.viewer), c.req.param('id'))),
      )
      .post('/workspaces/:id/invites', viewer, async (c) => {
        const user = await requireUser(deps, c.var.viewer);
        const input = await readJson(c, createWorkspaceInviteInputSchema);
        return c.json(await createInvite(deps, user, c.req.param('id'), input), 201);
      })
      .delete('/workspace-invites/:inviteId', viewer, async (c) => {
        await revokeInvite(deps, userId(c.var.viewer), c.req.param('inviteId'));
        return c.body(null, 204);
      })
      .post('/workspace-invites/:inviteId/accept', viewer, async (c) => {
        const user = await requireUser(deps, c.var.viewer);
        const workspace = await acceptInviteById(deps, user, c.req.param('inviteId'));
        return c.json<JoinResult>({ workspace });
      })

      /** Public preview of an invite link; joining needs an account (log in first). */
      .use('/join/*', limited)
      .get('/join/:token', async (c) => c.json(await previewInvite(deps, c.req.param('token'))))
      .post('/join/:token', viewer, async (c) => {
        const user = await requireUser(deps, c.var.viewer);
        const workspace = await joinByToken(deps, user, c.req.param('token'));
        return c.json<JoinResult>({ workspace });
      })
  );
}
