import { useMe } from '@/lib/api';

/**
 * The signed-in account, its workspaces and pending invitations. Only below `AccountGate`,
 * which renders its children once `/me` returned an account.
 */
export function useAccount() {
  const { data } = useMe();
  if (!data?.user) throw new Error('useAccount must be used below <AccountGate>');
  return {
    viewer: data.viewer,
    user: data.user,
    workspaces: data.workspaces ?? [],
    pendingInvites: data.pendingInvites ?? [],
    /** The company organisation of the viewer's e-mail domain, not joined yet (BER-148). */
    domainWorkspace: data.domainWorkspace ?? null,
    /** One self-founded organisation per account (BER-130); older servers send no limits. */
    canCreateWorkspace: data.limits?.canCreateWorkspace ?? true,
    /** Organisations can be opened to a company domain (`SIGNUP` is not `invite`, BER-148). */
    domainJoin: data.limits?.domainJoin ?? false,
  };
}
