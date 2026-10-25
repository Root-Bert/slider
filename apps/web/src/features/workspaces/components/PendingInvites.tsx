import type { PendingInvite } from '@slider/shared';
import { Badge, Button, Icon, IconTile, ListRow, type ShowToast } from '@/ui';
import { useAcceptPendingInvite } from '../hooks/useJoinActions';
import { inviteDetails } from '../lib/join-labels';
import { ROLE_LABELS } from '../lib/roles';

/**
 * E-mail invitations for the signed-in address in the switcher menu, each with "Beitreten". The
 * welcome page shows them as cards.
 */
export function PendingInvites({
  invites,
  onError,
  onJoined,
}: {
  invites: readonly PendingInvite[];
  onError: ShowToast;
  /** Accepted, right before going to the workspace or deck (the switcher closes its menu). */
  onJoined?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {invites.map((invite) => (
        <PendingInviteRow key={invite.id} invite={invite} onError={onError} onJoined={onJoined} />
      ))}
    </ul>
  );
}

function PendingInviteRow({
  invite,
  onError,
  onJoined,
}: {
  invite: PendingInvite;
  onError: ShowToast;
  onJoined?: () => void;
}) {
  const { pending, join } = useAcceptPendingInvite(invite, { onError, onJoined });
  return (
    <ListRow
      variant="flush"
      padding="wide"
      size="body"
      leading={
        <IconTile size={36}>
          <Icon name="personAdd" size={18} />
        </IconTile>
      }
      title={invite.workspaceName}
      badge={<Badge>{ROLE_LABELS[invite.role]}</Badge>}
      subtitle={inviteDetails(invite)}
      trailing={
        <Button size="sm" loading={pending} onClick={join}>
          Beitreten
        </Button>
      }
    />
  );
}
