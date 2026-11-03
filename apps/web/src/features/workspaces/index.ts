/** Public API of the workspaces feature. Route pages stay out, so they keep their own lazy chunks. */
export { AccountMenu } from './components/AccountMenu';
export { OnlineMembers } from './components/OnlineMembers';
export { PlanBadge } from './components/PlanUsage';
export { UsageOverview } from './components/UsageOverview';
export { WorkspaceMark } from './components/WorkspaceMark';
export { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
export { IntegrationsButton } from './components/IntegrationsButton';
export { ViewToolbar } from './components/ViewToolbar';
export { ViewSearch } from './components/ViewSearch';
export { WorkspaceViews } from './components/WorkspaceViews';
export { useActiveWorkspace, useWorkspace } from './hooks/useWorkspace';
export { pickWorkspace, readLastWorkspaceId, rememberWorkspace } from './lib/last-workspace';
export {
  deckLimitMessage,
  deckState,
  formatDeckUsage,
  LOCKED_MESSAGE,
  newReviewBlockedMessage,
  storageParts,
} from './lib/plan';
export { canCreateDecks, ROLE_LABELS } from './lib/roles';
export { Stars } from './components/Stars';
export { LayoutPicture } from './components/material/MasterCollection';
export { stars } from './lib/stars';
export { atLeast } from './lib/roles';
export {
  MASTER_ACCEPT,
  FONT_ACCEPT,
  useMaterialUpload,
  type UploadedKind,
} from './hooks/useMaterialUpload';
