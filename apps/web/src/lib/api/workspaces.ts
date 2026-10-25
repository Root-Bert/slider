import type {
  CreatedWorkspaceInvite,
  CreateWorkspaceInviteInput,
  JoinPreview,
  JoinResult,
  MemberDeparture,
  UpdateWorkspaceSsoInput,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSso,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest } from '../api-client';
import { queryKeys, workspaceKeys } from './keys';

// ── Workspaces ──────────────────────────────────────────────────────────────

function useReloadMe() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.me });
}

/** Joining or leaving a workspace changes the workspaces and the decks one can see ("Geteilt"). */
function useReloadMembership() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      queryClient.invalidateQueries({ queryKey: queryKeys.deckLists }),
    ]);
}

export function useCreateWorkspace() {
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (name: string) => api.post<Workspace>('/workspaces', { name }),
    onSuccess: () => reloadMe(),
  });
}

export function useRenameWorkspace(workspaceId: string) {
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (name: string) => api.patch<Workspace>(`/workspaces/${workspaceId}`, { name }),
    onSuccess: () => reloadMe(),
  });
}

/** Admins only. `null` removes the logo (back to the monogram). */
export function useWorkspaceLogo(workspaceId: string) {
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (file: File | null) => {
      if (!file)
        return apiRequest<Workspace>(`/workspaces/${workspaceId}/logo`, { method: 'DELETE' });
      const body = new FormData();
      body.append('file', file);
      return apiRequest<Workspace>(`/workspaces/${workspaceId}/logo`, { method: 'PUT', body });
    },
    onSuccess: () => reloadMe(),
  });
}

/**
 * Admins only (BER-148): `true` opens the workspace to the admin's e-mail domain, `false` makes
 * it private. Either answers the question after sign-up.
 */
export function useSetWorkspaceDomain(workspaceId: string) {
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.put<Workspace>(`/workspaces/${workspaceId}/domain`, { enabled }),
    onSuccess: () => reloadMe(),
  });
}

/** Joins `me.domainWorkspace`, the company workspace of the viewer's domain. */
export function useJoinByDomain() {
  const reloadMembership = useReloadMembership();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      api.post<JoinResult>(`/workspaces/${workspaceId}/domain-join`),
    onSuccess: () => reloadMembership(),
  });
}

// ── Company login (BER-162) ─────────────────────────────────────────────────

export const useWorkspaceSso = (workspaceId: string, enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.sso(workspaceId),
    queryFn: () => api.get<WorkspaceSso>(`/workspaces/${workspaceId}/sso`),
    enabled,
  });

/** Saves the provider (`verify`: looks for the DNS record instead); answers the new state. */
export function useSaveWorkspaceSso(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceSsoInput | 'verify') =>
      input === 'verify'
        ? api.post<WorkspaceSso>(`/workspaces/${workspaceId}/sso/verify`)
        : api.put<WorkspaceSso>(`/workspaces/${workspaceId}/sso`, input),
    onSuccess: (sso) => queryClient.setQueryData(workspaceKeys.sso(workspaceId), sso),
  });
}

export function useDeleteWorkspaceSso(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/workspaces/${workspaceId}/sso`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.sso(workspaceId) }),
  });
}

export function useDeleteWorkspace(workspaceId: string) {
  const reloadMe = useReloadMembership();
  return useMutation({
    mutationFn: () => api.delete(`/workspaces/${workspaceId}`),
    onSuccess: () => reloadMe(),
  });
}

// ── Members ─────────────────────────────────────────────────────────────────

export const useMembers = (workspaceId: string) =>
  useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => api.get<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`),
  });

export function useUpdateMemberRole(workspaceId: string) {
  const queryClient = useQueryClient();
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      api.patch<WorkspaceMember>(`/workspaces/${workspaceId}/members/${userId}`, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      // The caller's own role may have changed.
      void reloadMe();
    },
  });
}

/** Removes a member – or, with the caller's own id, leaves the workspace. */
export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient();
  const reloadMembership = useReloadMembership();
  return useMutation({
    /** `successor`: the last owner leaves and hands the workspace to this member. */
    mutationFn: ({ userId, successor }: { userId: string; successor?: string }) =>
      api.delete(
        `/workspaces/${workspaceId}/members/${userId}${successor ? `?successor=${encodeURIComponent(successor)}` : ''}`,
      ),
    // Awaited: after leaving, the start page must not pick the workspace just left.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      // Their linked reviews are gone, their uploads have a new owner (BER-165).
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
      return reloadMembership();
    },
  });
}

/**
 * What happens to someone's reviews if they went now (BER-165): linked ones are deleted,
 * uploads pass to the workspace owner. For the warning before; `null` while nobody is asked.
 */
export const useMemberDeparture = (
  workspaceId: string,
  userId: string | null,
  successor?: string,
) =>
  useQuery({
    queryKey: workspaceKeys.departure(workspaceId, userId ?? '', successor ?? null),
    queryFn: () =>
      api.get<MemberDeparture>(
        `/workspaces/${workspaceId}/members/${userId ?? ''}/departure${successor ? `?successor=${encodeURIComponent(successor)}` : ''}`,
      ),
    enabled: userId !== null,
    // Asked fresh each time the dialog opens: reviews come and go.
    staleTime: 0,
    gcTime: 0,
  });

// ── Invitations ─────────────────────────────────────────────────────────────

export const useWorkspaceInvites = (workspaceId: string, enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.invites(workspaceId),
    queryFn: () => api.get<WorkspaceInvite[]>(`/workspaces/${workspaceId}/invites`),
    enabled,
  });

export function useCreateWorkspaceInvite(workspaceId: string) {
  const queryClient = useQueryClient();
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInviteInput) =>
      api.post<CreatedWorkspaceInvite>(`/workspaces/${workspaceId}/invites`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.invites(workspaceId) });
      // E-mail invites hold a seat (`Workspace.usage`, BER-130).
      void reloadMe();
    },
  });
}

export function useRevokeWorkspaceInvite(workspaceId: string) {
  const queryClient = useQueryClient();
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (inviteId: string) => api.delete(`/workspace-invites/${inviteId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.invites(workspaceId) });
      // E-mail invites hold a seat (`Workspace.usage`, BER-130).
      void reloadMe();
    },
  });
}

/** Accepts an e-mail invitation listed in `me.pendingInvites`. */
export function useAcceptInvite() {
  const reloadMe = useReloadMembership();
  return useMutation({
    mutationFn: (inviteId: string) => api.post<JoinResult>(`/workspace-invites/${inviteId}/accept`),
    onSuccess: () => reloadMe(),
  });
}

export const useJoinPreview = (token: string) =>
  useQuery({
    queryKey: workspaceKeys.join(token),
    queryFn: () => api.get<JoinPreview>(`/join/${encodeURIComponent(token)}`),
    retry: false,
  });

export function useJoinWorkspace(token: string) {
  const reloadMe = useReloadMembership();
  return useMutation({
    mutationFn: () => api.post<JoinResult>(`/join/${encodeURIComponent(token)}`),
    onSuccess: () => reloadMe(),
  });
}
