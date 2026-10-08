import { useMe } from '@/lib/queries';

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
  };
}
