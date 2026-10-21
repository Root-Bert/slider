import { Navigate } from 'react-router';
import { routes } from '@/lib/routes';
import { useAccount } from '@/features/auth';
import { WorkspaceOnboarding } from './components/WorkspaceOnboarding';
import { pickWorkspace, readLastWorkspaceId } from './lib/last-workspace';

/** `/`: opens the last used workspace; without any, the onboarding (create one or join an invite). */
export function Component() {
  const { workspaces } = useAccount();
  const target = pickWorkspace(workspaces, readLastWorkspaceId());
  if (target) return <Navigate to={routes.workspace(target.id)} replace />;
  return <WorkspaceOnboarding />;
}
