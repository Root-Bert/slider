import type {
  AuthProviders,
  EmailLoginResult,
  LoginIdentity,
  LoginResult,
  NextcloudLoginStart,
  NextcloudSignInPoll,
  Passkey,
  SignedInAccount,
  SsoLogin,
  StartEmailLoginInput,
  StartNextcloudSignInInput,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, currentAccount, leavingAccount, onAccountChanged } from '../api-client';
import { forgetDrafts, forgetOffline } from '../offline';
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

/** The company login of the address's workspace (BER-162); 404 when it has none. */
export const discoverSso = (email: string) => api.post<SsoLogin>('/auth/sso/discover', { email });

/** The link from the confirmation mail of a new account through Nextcloud. */
export const confirmNextcloudSignUp = (token: string) =>
  api.post<LoginResult>('/auth/nextcloud/confirm', { token });

/** "Mit E-Mail fortfahren" (BER-168): mails a login link – the same answer for every address. */
export const startEmailLogin = (input: StartEmailLoginInput) =>
  api.post<void>('/auth/email/start', input);

/** The link from the login mail: signs in, or creates the account. */
export const confirmEmailLogin = (token: string) =>
  api.post<EmailLoginResult>('/auth/email/confirm', { token });

/** The code from the login mail, typed in this browser – where its link was asked for. */
export const confirmEmailCode = (code: string) =>
  api.post<EmailLoginResult>('/auth/email/code', { code });

// ── Account: connected logins and passkeys ──────────────────────────────────

export const useIdentities = () =>
  useQuery({
    queryKey: workspaceKeys.identities,
    queryFn: () => api.get<LoginIdentity[]>('/me/identities'),
  });

/** Only while another login remains. */
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

// ── More accounts on one browser ────────────────────────────────────────────

/** The other accounts signed in on this browser, each with its workspaces. */
export const useOtherAccounts = (enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.otherAccounts,
    queryFn: () => api.get<SignedInAccount[]>('/auth/accounts'),
    enabled,
  });

/**
 * Tabs of this browser hear here that another tab changed the account. One object per tab: what
 * it posts reaches the other tabs, never itself.
 */
let accountChannel: BroadcastChannel | null | undefined;
const channel = () =>
  (accountChannel ??=
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('slider-account'));

/**
 * Switches this browser to another account signed in here. What the browser kept of the one in
 * use for offline goes first – its queued edits must not go out under the other account; every
 * other tab starts over (`followAccountSwitches`). The caller then loads the new account's page.
 */
export function useSwitchAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      // Requests on their way come back `account_changed`: this page is leaving anyway.
      leavingAccount(true);
      try {
        await api.post<void>('/auth/accounts/switch', { userId });
      } catch (error) {
        leavingAccount(false);
        throw error;
      }
      // Only once switched: a switch refused keeps what the browser holds for this account.
      await forgetOffline();
      announceAccountChange();
    },
    // Signed out there meanwhile: no longer offered.
    onError: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.otherAccounts }),
  });
}

/**
 * Signs the account in use out, here only: the next one signed in on this browser takes over
 * (none left: the login). As switching – what the browser kept of it goes first.
 */
export function useSignOutAccount() {
  return useMutation({
    mutationFn: async () => {
      const account = currentAccount();
      const signedOut = account ? { userId: account } : null;
      leavingAccount(true);
      try {
        await api.post<void>('/auth/accounts/logout');
      } catch (error) {
        leavingAccount(false);
        throw error;
      }
      // Its drafts go with it; the other accounts' stay theirs.
      await forgetOffline(signedOut);
      announceAccountChange();
    },
  });
}

/** Signs another account signed in on this browser out; the one in use stays as it is. */
export function useSignOutOtherAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.post<void>('/auth/accounts/logout', { userId });
      forgetDrafts({ userId });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.otherAccounts }),
  });
}

/** Tells the other tabs that this browser's account changed. */
export function announceAccountChange(): void {
  channel()?.postMessage('changed');
}

/** Another tab changed the account: this one starts over on the start page, in the new one. */
export function followAccountSwitches(): void {
  const listening = channel();
  if (listening) listening.onmessage = () => window.location.assign('/');
  // Signed in as another account on a fresh page (no switch announced it): the tabs still open
  // for the first one start over too.
  onAccountChanged(announceAccountChange);
}

/**
 * Signs out; what the browser kept of the account for offline goes with it. The caller then loads
 * the login page fresh, which also drops every cached response.
 */
export const useLogout = () =>
  useMutation({
    mutationFn: async () => {
      await api.post<void>('/auth/logout');
      // Every account signed in here is signed out.
      await forgetOffline('everyone');
      announceAccountChange();
    },
  });
