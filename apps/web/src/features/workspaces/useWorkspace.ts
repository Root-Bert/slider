import { useParams, useSearchParams } from 'react-router';
import type { Workspace } from '@slider/shared';
import { useMe } from '@/lib/queries';
import { useAccount } from '../auth/useAccount';
import { pickWorkspace, readLastWorkspaceId } from './lib/last-workspace';

/** The workspace of the `/w/:workspaceId` route. Only below `WorkspaceLayout`, which checks it exists. */
export function useWorkspace(): Workspace {
  const { workspaceId } = useParams();
  const { workspaces } = useAccount();
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) throw new Error('useWorkspace must be used below <WorkspaceLayout>');
  return workspace;
}

/**
 * The workspace the header and `/neu` work in: the route's, else `?workspace=`, else the last
 * used one, else the first. `null` for signed-out visitors and accounts without a workspace.
 */
export function useActiveWorkspace(): Workspace | null {
  const { workspaceId } = useParams();
  const [searchParams] = useSearchParams();
  const { data: me } = useMe();
  const workspaces = me?.workspaces ?? [];
  const wanted = workspaceId ?? searchParams.get('workspace') ?? readLastWorkspaceId();
  return pickWorkspace(workspaces, wanted);
}
