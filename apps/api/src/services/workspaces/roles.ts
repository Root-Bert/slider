import { and, eq, isNull } from 'drizzle-orm';
import type { DeckPermissions, WorkspaceRole } from '@slider/shared';
import type { Executor } from '../../db/client';
import { workspaceMembers, workspaces } from '../../db/schema';
import { ApiError, forbidden, notFound } from '../../http/errors';

/** Workspace roles and what they allow (BER-129). */

export const RANK: Record<WorkspaceRole, number> = {
  admin: 3,
  member: 2,
  reviewer: 1,
  viewer: 0,
};
/**
 * Viewers (guests) take a workspace over only as the last resort, when nobody else is left:
 * it goes only with its last member (account deletion, leaving).
 */
export const VIEWER_LAST_RESORT =
  'Betrachter übernehmen den Workspace nur, wenn sonst niemand mehr da ist. Wähle ein anderes Mitglied.';

export const atLeast = (role: WorkspaceRole, min: WorkspaceRole) => RANK[role] >= RANK[min];
export const stronger = (a: WorkspaceRole, b: WorkspaceRole) => (RANK[a] >= RANK[b] ? a : b);

export const workspaceNotFound = () => notFound('Diesen Workspace gibt es nicht (mehr).');

/** The instance admin blocked the workspace (BER-167): members see why, nothing more. */
export const workspaceBlocked = () =>
  new ApiError(
    403,
    'workspace_blocked',
    'Dieser Workspace wurde von der Person gesperrt, die Slider hier betreibt. Austreten geht weiter.',
  );

/**
 * What a member may do with a deck: viewers only look, reviewers also comment, members also
 * manage the decks they created, admins manage every deck.
 */
export function deckPermissions(
  role: WorkspaceRole | null,
  deckOwnerId: string,
  userId: string,
): DeckPermissions {
  if (!role) return { canManage: false, canComment: false };
  const canManage = atLeast(role, 'admin') || (role === 'member' && deckOwnerId === userId);
  return { canManage, canComment: atLeast(role, 'reviewer') };
}

/** The member's role, also in a blocked workspace; `null` for non-members. */
export async function getRole(
  db: Executor,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  return (await membership(db, workspaceId, userId))?.role ?? null;
}

/** Memberships of a user in workspaces that are not blocked, by workspace id: what they can open. */
export async function rolesOf(db: Executor, userId: string): Promise<Map<string, WorkspaceRole>> {
  const rows = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.blockedAt)));
  return new Map(rows.map((row) => [row.workspaceId, row.role]));
}

/**
 * The caller's role in the workspace, or throws: non-members get 404 (no existence leak),
 * members below `min` get 403, and so do members of a blocked workspace (BER-167) – except where
 * `allowBlocked` says the way out still works: leaving it and handing over or cancelling paying.
 */
export async function requireRole(
  db: Executor,
  workspaceId: string,
  userId: string,
  min: WorkspaceRole = 'viewer',
  message = 'Dafür brauchst du mehr Rechte in diesem Workspace.',
  { allowBlocked = false }: { allowBlocked?: boolean } = {},
): Promise<WorkspaceRole> {
  const member = await membership(db, workspaceId, userId);
  if (!member) throw workspaceNotFound();
  if (member.blocked && !allowBlocked) throw workspaceBlocked();
  if (!atLeast(member.role, min)) throw forbidden(message);
  return member.role;
}

/** The role, and whether the workspace is blocked; `null` for non-members. */
export async function membership(
  db: Executor,
  workspaceId: string,
  userId: string,
): Promise<{ role: WorkspaceRole; blocked: boolean } | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role, blockedAt: workspaces.blockedAt })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row ? { role: row.role, blocked: row.blockedAt !== null } : null;
}
