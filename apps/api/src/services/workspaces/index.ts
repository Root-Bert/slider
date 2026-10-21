/**
 * Workspaces, members and invitations (BER-129). In the UI a workspace is an "Organisation"
 * (BER-130); its plan limits live in `../plans`.
 *
 * - `./roles`: roles, deck permissions, membership lookups (no further service imports)
 * - `./workspaces`: founding, listing, renaming, logo, deleting
 * - `./members`: member list, role changes, leaving and removing
 * - `./departure`: what happens to the decks of someone who goes (BER-165)
 * - `./invites`: e-mail invites and links, previews, joining
 * - `./domains`: company organisations found and joined by e-mail domain (BER-148)
 * - `./sso`: an organisation's own company login (BER-162)
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
export { deleteDeckFiles, departDecks, departurePreview } from './departure';
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
export {
  domainWorkspaceFor,
  findDomainWorkspace,
  foundAtSignUp,
  joinByDomain,
  nameFromDomain,
  setWorkspaceDomain,
} from './domains';
export {
  anyWorkspaceSso,
  deleteWorkspaceSso,
  findSsoForEmail,
  findSsoForWorkspace,
  getWorkspaceSso,
  saveWorkspaceSso,
  verifyWorkspaceSso,
  type ActiveSso,
} from './sso';
