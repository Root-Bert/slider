import { useParams } from 'react-router';
import { useInvite } from '@/lib/queries';
import { GuestBackdrop } from './components/GuestBackdrop';
import { InviteCard } from './components/InviteCard';
import { InviteError, InviteSkeleton } from './components/InviteStatus';
/** C2 guest entry for review links `/r/:token` (BER-102). */
export function Component() {
  const { token = '' } = useParams();
  const invite = useInvite(token);

  return (
    <GuestBackdrop thumbnailUrl={invite.data?.thumbnailUrl ?? null}>
      {invite.isPending ? (
        <InviteSkeleton />
      ) : invite.isError ? (
        <InviteError error={invite.error} onRetry={() => void invite.refetch()} />
      ) : (
        <InviteCard token={token} invite={invite.data} />
      )}
    </GuestBackdrop>
  );
}
