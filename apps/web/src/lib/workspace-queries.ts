import type {
  AuthProviders,
  CreatedWorkspaceInvite,
  CreateWorkspaceInviteInput,
  JoinPreview,
  JoinResult,
  LoginIdentity,
  LoginResult,
  Passkey,
  VerifyEmailCodeInput,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { registerPasskey } from '@/features/auth/lib/passkeys';
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
  passkeys: ['account', 'passkeys'] as const,
  identities: ['account', 'identities'] as const,
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

/** The 6-digit code from the login mail; the web app then navigates to `redirectTo`. */
export const useVerifyEmailCode = () =>
  useMutation({
    mutationFn: (input: VerifyEmailCodeInput) => api.post<LoginResult>('/auth/email/code', input),
  });

// ── Account: connected logins and passkeys ──────────────────────────────────

export const useIdentities = () =>
  useQuery({
    queryKey: workspaceKeys.identities,
    queryFn: () => api.get<LoginIdentity[]>('/me/identities'),
  });

export const usePasskeys = (enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.passkeys,
    queryFn: () => api.get<Passkey[]>('/passkeys'),
    enabled,
  });

export function useRegisterPasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => registerPasskey(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.passkeys }),
  });
}

export function useRenamePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<Passkey>(`/passkeys/${id}`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.passkeys }),
  });
}

export function useDeletePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/passkeys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.passkeys }),
  });
}

/** Signs out. The caller then loads the login page fresh, which also drops every cached response. */
export const useLogout = () => useMutation({ mutationFn: () => api.post<void>('/auth/logout') });

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
    mutationFn: (userId: string) => api.delete(`/workspaces/${workspaceId}/members/${userId}`),
    // Awaited: after leaving, the start page must not pick the workspace just left.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      return reloadMembership();
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
  const reloadMe = useReloadMembership();
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
  const reloadMe = useReloadMembership();
  return useMutation({
    mutationFn: () => api.post<JoinResult>(`/join/${token}`),
    onSuccess: () => reloadMe(),
  });
}
