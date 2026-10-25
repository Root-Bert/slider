import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  deleteAccountInputSchema,
  domainJoinAllowed,
  updateMeInputSchema,
  type DisconnectNextcloudResult,
  type GoogleConnection,
  type MeResponse,
  type MicrosoftConnection,
  type NextcloudConnection,
  type SuccessorChoice,
  type Viewer,
} from '@slider/shared';
import type { Context } from 'hono';
import type { InstanceGate } from '../auth/instance-gate';
import { endSession } from '../auth/session';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { users } from '../db/schema';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { deleteAccount, successorChoices } from '../services/account-deletion';
import { exportAccount } from '../services/account-export';
import { updateViewerColor, updateViewerName } from '../services/users';
import {
  disconnectMicrosoft,
  listMicrosoftConnections,
  microsoftConnectionSummary,
} from '../services/microsoft-connections';
import { disconnectGoogle, listGoogleConnections } from '../services/google-connections';
import { disconnectNextcloud, listNextcloudConnections } from '../services/nextcloud-connections';
import { requireOwner } from '../auth/access';
import { badRequest, notFound } from '../http/errors';
import { canCreateWorkspace } from '../services/plans';
import { domainWorkspaceFor, listWorkspaces, pendingInvitesFor } from '../services/workspaces';

/** The signed-in account with its workspaces and invitations. */
async function meResponse(
  deps: AppDeps,
  gate: InstanceGate,
  c: Context,
  viewer: Viewer,
): Promise<MeResponse> {
  const instanceClaimed = !(await gate.mustClaim(c));
  const [user] = await deps.db.select().from(users).where(eq(users.id, viewer.author.id));
  if (!user) return { viewer, instanceClaimed };
  const [workspaces, pendingInvites, domainWorkspace, mayFound, microsoft] = await Promise.all([
    listWorkspaces(deps, user.id),
    pendingInvitesFor(deps.db, user, deps.clock.now()),
    domainWorkspaceFor(deps, user),
    canCreateWorkspace(deps.db, deps.config, user.id),
    microsoftConnectionSummary(deps.db, user.id),
  ]);
  return {
    viewer,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      color: user.color,
      isInstanceAdmin: user.isInstanceAdmin,
      microsoftConnected: microsoft.usable > 0,
      microsoftConnections: microsoft.total,
    },
    workspaces,
    pendingInvites,
    domainWorkspace,
    limits: {
      canCreateWorkspace: mayFound,
      domainJoin: domainJoinAllowed(deps.config.auth.signup),
    },
    instanceClaimed,
  };
}

/** A ZIP download that is never cached (it holds personal data). */
export function zipResponse(
  c: Context,
  { fileName, bytes }: { fileName: string; bytes: Uint8Array },
) {
  return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  });
}

export function meRoutes(deps: AppDeps, gate: InstanceGate) {
  return (
    new Hono<ViewerEnv>()
      .get('/me', viewerMiddleware(deps), async (c) =>
        c.json<MeResponse>(await meResponse(deps, gate, c, c.var.viewer)),
      )
      .patch('/me', viewerMiddleware(deps), async (c) => {
        const { color, name } = await readJson(c, updateMeInputSchema);
        let viewer = c.var.viewer;
        if (color) viewer = await updateViewerColor(deps.db, viewer, color);
        if (name && name !== viewer.author.name) {
          const renamed = await updateViewerName(deps.db, viewer, name);
          viewer = renamed.viewer;
          for (const deckId of renamed.deckIds) deps.live?.commentsChanged(deckId);
        }
        return c.json<MeResponse>(await meResponse(deps, gate, c, viewer));
      })
      /** Everything stored about the viewer, as a ZIP (BER-145, DSGVO Art. 15/20). */
      .get('/me/export', viewerMiddleware(deps), async (c) => {
        requireOwner(c.var.viewer);
        return zipResponse(c, await exportAccount(deps, c.var.viewer.author.id));
      })
      /** Before deleting: workspaces that need a new admin, and who could take over. */
      .get('/me/deletion', viewerMiddleware(deps), async (c) => {
        requireOwner(c.var.viewer);
        return c.json<SuccessorChoice[]>(await successorChoices(deps.db, c.var.viewer.author.id));
      })
      /**
       * Deletes the viewer's account (BER-145); they confirm with their e-mail address and choose
       * a new admin where they are the only one.
       */
      .delete('/me', viewerMiddleware(deps), async (c) => {
        requireOwner(c.var.viewer);
        const { confirmEmail, successors } = await readJson(c, deleteAccountInputSchema);
        const [user] = await deps.db
          .select()
          .from(users)
          .where(eq(users.id, c.var.viewer.author.id));
        if (!user) throw notFound('Dieses Konto gibt es nicht.');
        if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
          throw badRequest('Die E-Mail-Adresse stimmt nicht mit deinem Konto überein.');
        }
        await deleteAccount(deps, user.id, successors);
        await endSession(c, deps);
        return c.body(null, 204);
      })
      /** The Microsoft accounts connected for OneDrive/SharePoint – only the viewer's own. */
      .get('/me/microsoft', viewerMiddleware(deps), async (c) => {
        requireOwner(c.var.viewer);
        return c.json<MicrosoftConnection[]>(
          await listMicrosoftConnections(deps.db, c.var.viewer.author.id),
        );
      })
      .delete('/me/microsoft/:id', viewerMiddleware(deps), async (c) => {
        requireOwner(c.var.viewer);
        const removed = await disconnectMicrosoft(deps, c.var.viewer.author.id, [
          c.req.param('id'),
        ]);
        if (removed === 0) throw notFound('Dieses Microsoft-Konto ist nicht verbunden.');
        return c.body(null, 204);
      })
      /** The Nextcloud accounts connected for file access (BER-135) – only the viewer's own. */
      .get('/me/nextcloud', viewerMiddleware(deps), async (c) => {
        requireOwner(c.var.viewer);
        return c.json<NextcloudConnection[]>(
          await listNextcloudConnections(deps.db, c.var.viewer.author.id),
        );
      })
      /** Revokes the app password at Nextcloud too; `revoked: false` → the person must do it there. */
      .delete('/me/nextcloud/:id', viewerMiddleware(deps), async (c) => {
        requireOwner(c.var.viewer);
        const result = await disconnectNextcloud(deps, c.var.viewer.author.id, c.req.param('id'));
        if (!result) throw notFound('Dieses Nextcloud-Konto ist nicht verbunden.');
        return c.json<DisconnectNextcloudResult>(result);
      })
      /** The Google accounts connected for Google Drive (BER-119) – only the viewer's own. */
      .get('/me/google', viewerMiddleware(deps), async (c) => {
        requireOwner(c.var.viewer);
        return c.json<GoogleConnection[]>(
          await listGoogleConnections(deps.db, c.var.viewer.author.id),
        );
      })
      /** Revokes the grant at Google too (best effort). */
      .delete('/me/google/:id', viewerMiddleware(deps), async (c) => {
        requireOwner(c.var.viewer);
        const removed = await disconnectGoogle(deps, c.var.viewer.author.id, c.req.param('id'));
        if (!removed) throw notFound('Dieses Google-Konto ist nicht verbunden.');
        return c.body(null, 204);
      })
  );
}
