import type { AuthProviders, LoginIdentity, Passkey } from '@slider/shared';
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

/** Unlinking Microsoft also drops its file access, which `/me` reports. */
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

/** Signs out. The caller then loads the login page fresh, which also drops every cached response. */
export const useLogout = () => useMutation({ mutationFn: () => api.post<void>('/auth/logout') });
