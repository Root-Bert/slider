import type {
  AuthProviders,
  LoginIdentity,
  LoginResult,
  MicrosoftConnection,
  NextcloudLoginStart,
  NextcloudSignInPoll,
  Passkey,
  SsoLogin,
  StartNextcloudSignInInput,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { registerPasskey } from '../passkeys';
import { queryKeys, workspaceKeys } from './keys';

// ── Login ───────────────────────────────────────────────────────────────────

export const useAuthProviders = () =>
  useQuery({
    queryKey: workspaceKeys.providers,
    queryFn: () => api.get<AuthProviders>('/auth/providers'),
    staleTime: Infinity,
  });

/** Sign in with any Nextcloud (Login Flow v2); the caller opens `loginUrl` and polls. */
export const startNextcloudSignIn = (input: StartNextcloudSignInInput) =>
  api.post<NextcloudLoginStart>('/auth/nextcloud/flow', input);

export const pollNextcloudSignIn = (id: string) =>
  api.post<NextcloudSignInPoll>(`/auth/nextcloud/flow/${encodeURIComponent(id)}/poll`);

/** The company login of the address's organisation (BER-162); 404 when it has none. */
export const discoverSso = (email: string) => api.post<SsoLogin>('/auth/sso/discover', { email });

/** The link from the confirmation mail of a new account through Nextcloud. */
export const confirmNextcloudSignUp = (token: string) =>
  api.post<LoginResult>('/auth/nextcloud/confirm', { token });

// ── Account: connected logins and passkeys ──────────────────────────────────

export const useIdentities = () =>
  useQuery({
    queryKey: workspaceKeys.identities,
    queryFn: () => api.get<LoginIdentity[]>('/me/identities'),
  });

/** Only while another login remains; the Microsoft file access stays connected. */
export function useUnlinkIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/me/identities/${encodeURIComponent(id)}`),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKeys.identities }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      ]),
  });
}

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

// ── Account: Microsoft accounts for OneDrive and SharePoint ─────────────────

export const useMicrosoftConnections = (enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.microsoft,
    queryFn: () => api.get<MicrosoftConnection[]>('/me/microsoft'),
    enabled,
  });

/** Reviews that synced through it stop updating until an account with access takes over. */
export function useDisconnectMicrosoft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/me/microsoft/${encodeURIComponent(id)}`),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKeys.microsoft }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
      ]),
  });
}

/** Signs out. The caller then loads the login page fresh, which also drops every cached response. */
export const useLogout = () => useMutation({ mutationFn: () => api.post<void>('/auth/logout') });
