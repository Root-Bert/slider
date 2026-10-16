import { useNavigate } from 'react-router';
import type { PendingInvite } from '@slider/shared';
import { routes } from '@/lib/routes';
import { useAcceptInvite } from '@/lib/api';
import { Badge, Button, Icon, IconTile, ListRow, type ShowToast } from '@/ui';
import { formatExpiry, ROLE_LABELS } from '../lib/roles';

/** E-mail invitations for the signed-in address, each with "Beitreten". */
export function PendingInvites({
  invites,
  onError,
  compact = false,
}: {
  invites: readonly PendingInvite[];
  onError: ShowToast;
  /** In the switcher menu: tighter rows. */
  compact?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {invites.map((invite) => (
        <PendingInviteRow key={invite.id} invite={invite} onError={onError} compact={compact} />
      ))}
    </ul>
  );
}

function PendingInviteRow({
  invite,
  onError,
  compact,
}: {
  invite: PendingInvite;
  onError: ShowToast;
  compact: boolean;
}) {
  const navigate = useNavigate();
  const accept = useAcceptInvite();
  const join = () =>
    accept.mutate(invite.id, {
      onSuccess: ({ workspace, deckId }) =>
        void navigate(deckId ? routes.deck(deckId) : routes.workspace(workspace.id)),
      onError: (error) => onError(error.message, 'danger'),
    });

  return (
    <ListRow
      variant="flush"
      padding={compact ? 'wide' : 'md'}
      size="body"
      leading={
        <IconTile size={36}>
          <Icon name="personAdd" size={18} />
        </IconTile>
      }
      title={invite.workspaceName}
      badge={<Badge>{ROLE_LABELS[invite.role]}</Badge>}
      subtitle={
        <>
          {invite.deck ? `„${invite.deck.title}“ · ` : ''}
          {invite.inviterName ? `Von ${invite.inviterName} · ` : ''}
          {formatExpiry(invite.expiresAt)}
        </>
      }
      trailing={
        <Button size="sm" loading={accept.isPending} onClick={join}>
          Beitreten
        </Button>
      }
    />
  );
}
