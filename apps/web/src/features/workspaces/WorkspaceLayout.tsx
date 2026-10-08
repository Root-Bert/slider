import { useEffect } from 'react';
import { Navigate, Outlet, useParams } from 'react-router';
import { routes } from '@/app/routes';
import { useAccount } from '../auth/useAccount';
import { rememberWorkspace } from './lib/last-workspace';

/**
 * `/w/:workspaceId/*`: remembers the workspace for `/`. Workspaces the account doesn't (or no
 * longer) belong to – just left, deleted, or a foreign link – go to `/`, which opens another one.
 */
export function Component() {
  const { workspaceId = '' } = useParams();
  const { workspaces } = useAccount();
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);

  useEffect(() => {
    if (workspace) rememberWorkspace(workspace.id);
  }, [workspace]);

  if (!workspace) return <Navigate to={routes.reviews()} replace />;
  return <Outlet />;
}
