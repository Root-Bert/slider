/** Public API of the workspaces feature. Route pages stay out, so they keep their own lazy chunks. */
export { AccountMenu } from './components/AccountMenu';
export { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
export { useActiveWorkspace, useWorkspace } from './hooks/useWorkspace';
export { rememberWorkspace } from './lib/last-workspace';
export { deckLimitMessage, deckState, formatDeckUsage } from './lib/plan';
export { canCreateDecks } from './lib/roles';
