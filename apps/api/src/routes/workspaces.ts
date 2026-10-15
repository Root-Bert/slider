import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  createWorkspaceInputSchema,
  createWorkspaceInviteInputSchema,
  updateMemberInputSchema,
  shareDeckInputSchema,
  updateWorkspaceInputSchema,
  WORKSPACE_LOGO_MAX_BYTES,
  type JoinResult,
  type Viewer,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { users, type UserRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, fileTooLarge } from '../http/errors';
import { rateLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  acceptInviteById,
  createInvite,
  deleteWorkspace,
  foundWorkspace,
  getWorkspace,
  joinByToken,
  listDeckShares,
  listInvites,
  listMembers,
  listWorkspaces,
  previewInvite,
  removeMember,
  removeWorkspaceLogo,
  renameWorkspace,
  revokeInvite,
  setWorkspaceLogo,
  shareDeck,
  updateMemberRole,
} from '../services/workspaces';

/** The signed-in account behind the viewer. */
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
      .put(
        '/workspaces/:id/logo',
        viewer,
        bodyLimit({
          maxSize: WORKSPACE_LOGO_MAX_BYTES + 64 * 1024,
          onError: (c) => c.json(fileTooLarge(WORKSPACE_LOGO_MAX_BYTES).toBody(), 413),
        }),
        async (c) => {
          const body = await c.req.parseBody().catch(() => {
            throw badRequest('Das Logo konnte nicht gelesen werden.');
          });
          const file = body['file'];
          if (!(file instanceof File)) throw badRequest('Bitte das Logo im Feld „file“ mitsenden.');
          if (file.size > WORKSPACE_LOGO_MAX_BYTES) throw fileTooLarge(WORKSPACE_LOGO_MAX_BYTES);
          const bytes = new Uint8Array(await file.arrayBuffer());
          return c.json(
            await setWorkspaceLogo(deps, userId(c.var.viewer), c.req.param('id'), bytes),
          );
        },
      )
      .delete('/workspaces/:id/logo', viewer, async (c) =>
        c.json(await removeWorkspaceLogo(deps, userId(c.var.viewer), c.req.param('id'))),
      )
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
        // `?successor=<userId>`: the last owner leaves and hands the organisation to them.
        await removeMember(
          deps.db,
          userId(c.var.viewer),
          c.req.param('id'),
          c.req.param('userId'),
          c.req.query('successor') || undefined,
        );
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
      /** Sharing a deck invites into its organisation as `viewer` (no guests). */
      .get('/decks/:deckId/share', viewer, async (c) =>
        c.json(await listDeckShares(deps, userId(c.var.viewer), c.req.param('deckId'))),
      )
      .post('/decks/:deckId/share', viewer, async (c) => {
        const user = await requireUser(deps, c.var.viewer);
        const input = await readJson(c, shareDeckInputSchema);
        return c.json(await shareDeck(deps, user, c.req.param('deckId'), input), 201);
      })
      .delete('/workspace-invites/:inviteId', viewer, async (c) => {
        await revokeInvite(deps, userId(c.var.viewer), c.req.param('inviteId'));
        return c.body(null, 204);
      })
      .post('/workspace-invites/:inviteId/accept', viewer, async (c) => {
        const user = await requireUser(deps, c.var.viewer);
        return c.json<JoinResult>(await acceptInviteById(deps, user, c.req.param('inviteId')));
      })

      /** Public preview of an invite link; joining needs an account (log in first). */
      .use('/join/*', limited)
      .get('/join/:token', async (c) => c.json(await previewInvite(deps, c.req.param('token'))))
      .post('/join/:token', viewer, async (c) => {
        const user = await requireUser(deps, c.var.viewer);
        return c.json<JoinResult>(await joinByToken(deps, user, c.req.param('token')));
      })
  );
}
