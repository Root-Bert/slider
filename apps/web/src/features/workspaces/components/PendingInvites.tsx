import { useNavigate } from 'react-router';
import type { PendingInvite } from '@slider/shared';
import { routes } from '@/app/routes';
import { useAcceptInvite } from '@/lib/workspace-queries';
import { Badge, Button, Icon, type ShowToast } from '@/ui';
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
      onSuccess: ({ workspace }) => void navigate(routes.workspace(workspace.id)),
      onError: (error) => onError(error.message, 'danger'),
    });

  return (
    <li
      className={
        compact
          ? 'flex items-center gap-3 rounded-control px-2.5 py-2'
          : 'flex items-center gap-3 rounded-control-sm p-2.5'
      }
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control-sm bg-white/6 text-fg-muted">
        <Icon name="personAdd" size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-fg">{invite.workspaceName}</span>
          <Badge>{ROLE_LABELS[invite.role]}</Badge>
        </span>
        <span className="truncate text-xs text-fg-subtle">
          {invite.inviterName ? `Von ${invite.inviterName} · ` : ''}
          {formatExpiry(invite.expiresAt)}
        </span>
      </span>
      <Button size="sm" loading={accept.isPending} onClick={join}>
        Beitreten
      </Button>
    </li>
  );
}
