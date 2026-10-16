import { and, eq } from 'drizzle-orm';
import type { DeckPermissions, WorkspaceRole } from '@slider/shared';
import type { Executor } from '../../db/client';
import { workspaceMembers } from '../../db/schema';
import { forbidden, notFound } from '../../http/errors';

/** Workspace roles and what they allow (BER-129). */

export const RANK: Record<WorkspaceRole, number> = {
  admin: 3,
  member: 2,
  reviewer: 1,
  viewer: 0,
};
export const atLeast = (role: WorkspaceRole, min: WorkspaceRole) => RANK[role] >= RANK[min];
export const stronger = (a: WorkspaceRole, b: WorkspaceRole) => (RANK[a] >= RANK[b] ? a : b);

export const workspaceNotFound = () => notFound('Diese Organisation gibt es nicht (mehr).');

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

export async function getRole(
  db: Executor,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row?.role ?? null;
}

/** All memberships of a user, by workspace id. */
export async function rolesOf(db: Executor, userId: string): Promise<Map<string, WorkspaceRole>> {
  const rows = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  return new Map(rows.map((row) => [row.workspaceId, row.role]));
}

/**
 * The caller's role in the workspace, or throws: non-members get 404 (no existence leak),
 * members below `min` get 403.
 */
export async function requireRole(
  db: Executor,
  workspaceId: string,
  userId: string,
  min: WorkspaceRole = 'viewer',
  message = 'Dafür brauchst du mehr Rechte in dieser Organisation.',
): Promise<WorkspaceRole> {
  const role = await getRole(db, workspaceId, userId);
  if (!role) throw workspaceNotFound();
  if (!atLeast(role, min)) throw forbidden(message);
  return role;
}
