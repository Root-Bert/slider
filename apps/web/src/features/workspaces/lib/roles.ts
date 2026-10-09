import {
  WORKSPACE_ROLES,
  type InviteRole,
  type WorkspaceInvite,
  type WorkspaceRole,
} from '@slider/shared';

/**
 * Workspace role rules on the client – mirrors `apps/api/src/services/workspaces.ts`, only to
 * show or hide controls. The API stays the authority; its errors are shown as toasts.
 */

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Mitglied',
  reviewer: 'Reviewer',
};

export const ROLE_HINTS: Record<WorkspaceRole, string> = {
  reviewer: 'Präsentationen ansehen und kommentieren.',
  member: 'Zusätzlich eigene Präsentationen anlegen.',
  admin: 'Zusätzlich Mitglieder, Einladungen und alle Präsentationen verwalten.',
  owner: 'Alles, auch die Organisation umbenennen, löschen und Owner ernennen.',
};

export const INVITE_ROLES = [
  'admin',
  'member',
  'reviewer',
] as const satisfies readonly InviteRole[];

/** Lower index = stronger role. */
const rank = (role: WorkspaceRole) => WORKSPACE_ROLES.indexOf(role);

export const atLeast = (role: WorkspaceRole, min: WorkspaceRole) => rank(role) <= rank(min);

/** "Neue Review": members and up. */
export const canCreateDecks = (role: WorkspaceRole) => atLeast(role, 'member');
export const canRenameWorkspace = (role: WorkspaceRole) => atLeast(role, 'admin');
export const canManageMembers = (role: WorkspaceRole) => atLeast(role, 'admin');
export const canDeleteWorkspace = (role: WorkspaceRole) => role === 'owner';

/**
 * Roles the actor may give the target. Empty when the actor can't change the target's role:
 * below admin, or an admin facing an owner. Only owners appoint owners. Includes the current role.
 */
export function assignableRoles(actor: WorkspaceRole, target: WorkspaceRole): WorkspaceRole[] {
  if (!canManageMembers(actor)) return [];
  if (target === 'owner' && actor !== 'owner') return [];
  return actor === 'owner' ? [...WORKSPACE_ROLES] : ['admin', 'member', 'reviewer'];
}

/** Removing someone else: admins remove non-owners, owners remove anyone. (Leaving is separate.) */
export const canRemoveMember = (actor: WorkspaceRole, target: WorkspaceRole) =>
  canManageMembers(actor) && (target !== 'owner' || actor === 'owner');

/** The last owner can neither leave nor be demoted – the API refuses, the UI says why upfront. */
export const isLastOwner = (role: WorkspaceRole, ownerCount: number) =>
  role === 'owner' && ownerCount <= 1;

export const INVITE_STATE_LABELS: Record<WorkspaceInvite['state'], string> = {
  valid: 'Offen',
  expired: 'Abgelaufen',
  revoked: 'Zurückgezogen',
  used: 'Angenommen',
};

/** Open invites first (newest first), then the rest (newest first). */
export function sortInvites(invites: readonly WorkspaceInvite[]): WorkspaceInvite[] {
  return invites.toSorted((a, b) => {
    const open = Number(b.state === 'valid') - Number(a.state === 'valid');
    return open || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

const DAY = 24 * 60 * 60 * 1000;

/** "noch 6 Tage gültig" / "noch heute gültig" / "abgelaufen". */
export function formatExpiry(iso: string, now: Date = new Date()): string {
  const left = Date.parse(iso) - now.getTime();
  if (left <= 0) return 'abgelaufen';
  const days = Math.floor(left / DAY);
  if (days === 0) return 'noch heute gültig';
  return days === 1 ? 'noch 1 Tag gültig' : `noch ${days} Tage gültig`;
}
