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
  admin: 'Admin',
  member: 'Mitglied',
  reviewer: 'Reviewer',
  viewer: 'Betrachter',
};

export const ROLE_HINTS: Record<WorkspaceRole, string> = {
  viewer: 'Reviews nur ansehen – so teilst du eine Review.',
  reviewer: 'Reviews ansehen und kommentieren.',
  member: 'Zusätzlich eigene Reviews anlegen.',
  admin: 'Alles: Mitglieder, Einladungen, alle Reviews, die Organisation umbenennen und löschen.',
};

/** Not a role – who founded the organisation. Nobody becomes creator, you are or aren't. */
export const CREATOR_LABEL = 'Creator';
export const CREATOR_HINT = 'Hat die Organisation gegründet. Keine Rolle, die man vergeben kann.';

export const INVITE_ROLES = WORKSPACE_ROLES satisfies readonly InviteRole[];

/** Lower index = stronger role. */
const rank = (role: WorkspaceRole) => WORKSPACE_ROLES.indexOf(role);

export const atLeast = (role: WorkspaceRole, min: WorkspaceRole) => rank(role) <= rank(min);

/** "Neue Review": members and up. */
export const canCreateDecks = (role: WorkspaceRole) => atLeast(role, 'member');
export const canRenameWorkspace = (role: WorkspaceRole) => atLeast(role, 'admin');
export const canManageMembers = (role: WorkspaceRole) => atLeast(role, 'admin');
export const canDeleteWorkspace = (role: WorkspaceRole) => atLeast(role, 'admin');

/** Roles the actor may give anyone: all of them for admins, none below. Includes the current one. */
export const assignableRoles = (actor: WorkspaceRole): WorkspaceRole[] =>
  canManageMembers(actor) ? [...WORKSPACE_ROLES] : [];

/** Removing someone else: admins remove anyone. (Leaving is separate.) */
export const canRemoveMember = (actor: WorkspaceRole) => canManageMembers(actor);

/** The last admin can neither leave nor be demoted – the API refuses, the UI says why upfront. */
export const isLastAdmin = (role: WorkspaceRole, adminCount: number) =>
  role === 'admin' && adminCount <= 1;

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
