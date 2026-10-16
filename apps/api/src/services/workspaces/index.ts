/**
 * Workspaces, members and invitations (BER-129). In the UI a workspace is an "Organisation"
 * (BER-130); its plan limits live in `../plans`.
 *
 * - `./roles`: roles, deck permissions, membership lookups (no further service imports)
 * - `./workspaces`: founding, listing, renaming, logo, deleting
 * - `./members`: member list, role changes, leaving and removing
 * - `./invites`: e-mail invites and links, previews, joining
 */

export {
  atLeast,
  deckPermissions,
  getRole,
  requireRole,
  rolesOf,
  workspaceNotFound,
} from './roles';
export {
  createWorkspace,
  deleteWorkspace,
  ensurePersonalWorkspace,
  foundWorkspace,
  getWorkspace,
  listWorkspaces,
  PERSONAL_WORKSPACE_NAME,
  removeWorkspaceLogo,
  renameWorkspace,
  resolveUploadWorkspace,
  setWorkspaceLogo,
} from './workspaces';
export { listMembers, removeMember, updateMemberRole } from './members';
export {
  acceptInviteById,
  createInvite,
  findInviteByToken,
  hasPendingEmailInvite,
  inviteState,
  inviteUrl,
  joinByToken,
  listInvites,
  maskEmail,
  pendingInvitesFor,
  previewInvite,
  revokeInvite,
} from './invites';
