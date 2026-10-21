import { useEffect } from 'react';
import { Navigate, Outlet, useParams } from 'react-router';
import { routes } from '@/lib/routes';
import { useAccount } from '@/features/auth';
import { AudienceDialog } from './components/AudienceDialog';
import { PlanBanner } from './components/PlanBanner';
import { rememberWorkspace } from './lib/last-workspace';

/**
 * `/w/:workspaceId/*`: remembers the workspace for `/`. Workspaces the account doesn't (or no
 * longer) belong to – just left, deleted, or a foreign link – go to `/`, which opens another one.
 * An organisation founded at sign-up asks its admin once whether it is private or the company's.
 * Over the plan's limits, about to fall back to free or asked to pay: a banner to "Nutzung".
 */
export function Component() {
  const { workspaceId = '' } = useParams();
  const { workspaces, user, domainJoin } = useAccount();
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);

  useEffect(() => {
    if (workspace) rememberWorkspace(workspace.id);
  }, [workspace]);

  if (!workspace) return <Navigate to={routes.reviews()} replace />;
  // A fresh page per organisation: /w/A → /w/B matches the same route, and without the key its
  // pages keep A's state (running bulk re-render, search, tab) – see WorkspaceLayout.test.tsx.
  return (
    <>
      <PlanBanner workspace={workspace} userId={user.id} />
      <Outlet key={workspace.id} />
      {/* Founded at sign-up: private or the company's? (BER-148) */}
      {domainJoin && workspace.audiencePending && workspace.role === 'admin' && (
        <AudienceDialog key={workspace.id} workspace={workspace} email={user.email} />
      )}
    </>
  );
}
