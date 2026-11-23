import { useCallback } from 'react';
import { DEFAULT_AGENT_AVATARS, type Workspace } from '@slider/shared';
import { generatedAgentAvatar } from '@/lib/generated-avatar';
import { useMe } from '@/lib/api';
import { useActiveWorkspace } from './useWorkspace';

/**
 * Draws agents as their workspace has them look (`Workspace.agentAvatars`): `workspaceId`'s, or
 * the active one's. The one way an agent's picture is made – `AgentAvatar`, calls, menus.
 */
export function useAgentAvatars(workspaceId?: string): (agentId: string) => string {
  const { data: me } = useMe();
  const active = useActiveWorkspace();
  const workspace = workspaceId
    ? me?.workspaces?.find((candidate) => candidate.id === workspaceId)
    : active;
  return useAvatarsOf(workspace);
}

/**
 * {@link useAgentAvatars} for a named workspace without the router: the call's dock stands
 * around it (`CallProvider`), where the active workspace's `useSearchParams` throws and took the
 * whole app down to a black page.
 */
export function useWorkspaceAgentAvatars(workspaceId: string): (agentId: string) => string {
  const { data: me } = useMe();
  return useAvatarsOf(me?.workspaces?.find((candidate) => candidate.id === workspaceId));
}

function useAvatarsOf(workspace: Workspace | null | undefined): (agentId: string) => string {
  const style = workspace?.agentAvatars ?? DEFAULT_AGENT_AVATARS;
  return useCallback((agentId: string) => generatedAgentAvatar(agentId, style), [style]);
}
