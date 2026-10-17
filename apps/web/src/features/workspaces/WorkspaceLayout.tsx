import { useEffect } from 'react';
import { Navigate, Outlet, useParams } from 'react-router';
import { routes } from '@/lib/routes';
import { useAccount } from '@/features/auth';
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
  // A fresh page per organisation: /w/A → /w/B matches the same route, and without the key its
  // pages keep A's state (running bulk re-render, search, tab) – see WorkspaceLayout.test.tsx.
  return <Outlet key={workspace.id} />;
}
