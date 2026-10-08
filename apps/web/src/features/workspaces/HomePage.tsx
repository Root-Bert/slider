import { Navigate } from 'react-router';
import { routes } from '@/app/routes';
import { useAccount } from '../auth/useAccount';
import { Onboarding } from './components/Onboarding';
import { pickWorkspace, readLastWorkspaceId } from './lib/last-workspace';

/** `/`: opens the last used workspace; without any, the onboarding (create one or join an invite). */
export function Component() {
  const { workspaces } = useAccount();
  const target = pickWorkspace(workspaces, readLastWorkspaceId());
  if (target) return <Navigate to={routes.workspace(target.id)} replace />;
  return <Onboarding />;
}
