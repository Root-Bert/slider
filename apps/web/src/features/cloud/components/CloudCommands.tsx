import { usePageCommands } from '@/features/commands';
import { useCloud } from '../hooks/useCloud';
import { useCloudNewActions } from '../hooks/useNewActions';

/** Lends the command panel (⌘K) Cloud's „Neu“ while a Cloud page is open. */
export function CloudCommands() {
  const ui = useCloud();
  usePageCommands({ group: 'Neu', actions: useCloudNewActions(), workspaceId: ui.workspace.id });
  return null;
}
