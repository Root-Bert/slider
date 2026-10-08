import type {
  AuthProviders,
  CreatedWorkspaceInvite,
  CreateWorkspaceInviteInput,
  JoinPreview,
  JoinResult,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { queryKeys } from './queries';

/**
 * Login, workspaces, members and invitations (BER-129). The list of the account's workspaces
 * and pending invitations comes with `GET /me`, so mutations that change them reload `me`.
 */
export const workspaceKeys = {
  providers: ['auth', 'providers'] as const,
  members: (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const,
  invites: (workspaceId: string) => ['workspaces', workspaceId, 'invites'] as const,
  join: (token: string) => ['join', token] as const,
};

// ── Login ───────────────────────────────────────────────────────────────────

export const useAuthProviders = () =>
  useQuery({
    queryKey: workspaceKeys.providers,
    queryFn: () => api.get<AuthProviders>('/auth/providers'),
    staleTime: Infinity,
  });

export const useStartEmailLogin = () =>
  useMutation({
    mutationFn: (input: { email: string; returnTo: string }) =>
      api.post<void>('/auth/email/start', input),
  });

/** Signs out. The caller then loads the login page fresh, which also drops every cached response. */
export const useLogout = () => useMutation({ mutationFn: () => api.post<void>('/auth/logout') });

// ── Workspaces ──────────────────────────────────────────────────────────────

function useReloadMe() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.me });
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

export function useDeleteWorkspace(workspaceId: string) {
  const reloadMe = useReloadMe();
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
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/workspaces/${workspaceId}/members/${userId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      void reloadMe();
    },
  });
}

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
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: (inviteId: string) => api.post<JoinResult>(`/workspace-invites/${inviteId}/accept`),
    onSuccess: () => reloadMe(),
  });
}

export const useJoinPreview = (token: string) =>
  useQuery({
    queryKey: workspaceKeys.join(token),
    queryFn: () => api.get<JoinPreview>(`/join/${token}`),
    retry: false,
  });

export function useJoinWorkspace(token: string) {
  const reloadMe = useReloadMe();
  return useMutation({
    mutationFn: () => api.post<JoinResult>(`/join/${token}`),
    onSuccess: () => reloadMe(),
  });
}
