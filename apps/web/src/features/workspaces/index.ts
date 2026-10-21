/** Public API of the workspaces feature. Route pages stay out, so they keep their own lazy chunks. */
export { AccountMenu } from './components/AccountMenu';
export { UsageOverview } from './components/UsageOverview';
export { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
export { useActiveWorkspace, useWorkspace } from './hooks/useWorkspace';
export { pickWorkspace, readLastWorkspaceId, rememberWorkspace } from './lib/last-workspace';
export {
  deckLimitMessage,
  deckState,
  formatDeckUsage,
  LOCKED_MESSAGE,
  newReviewBlockedMessage,
} from './lib/plan';
export { canCreateDecks, ROLE_LABELS } from './lib/roles';
