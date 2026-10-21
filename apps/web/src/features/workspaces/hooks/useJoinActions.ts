import { useNavigate } from 'react-router';
import type { DomainWorkspace, PendingInvite } from '@slider/shared';
import { useAcceptInvite, useJoinByDomain } from '@/lib/api';
import { routes } from '@/lib/routes';
import type { ShowToast } from '@/ui';

interface JoinOptions {
  onError: ShowToast;
  /** Joined, right before going to the organisation (the switcher closes its menu). */
  onJoined?: () => void;
}

/**
 * "Beitreten" for the company organisation of the viewer's domain (BER-148): no invitation
 * needed, they join as member and land in it.
 */
export function useJoinDomainWorkspace(
  workspace: DomainWorkspace,
  { onError, onJoined }: JoinOptions,
) {
  const navigate = useNavigate();
  const join = useJoinByDomain();
  return {
    pending: join.isPending,
    join: () =>
      join.mutate(workspace.id, {
        onSuccess: ({ workspace: joined }) => {
          onJoined?.();
          void navigate(routes.workspace(joined.id));
        },
        onError: (error) => onError(error.message, 'danger'),
      }),
  };
}

/** "Beitreten" for an e-mail invitation: into the organisation, or straight to its review. */
export function useAcceptPendingInvite(invite: PendingInvite, { onError, onJoined }: JoinOptions) {
  const navigate = useNavigate();
  const accept = useAcceptInvite();
  return {
    pending: accept.isPending,
    join: () =>
      accept.mutate(invite.id, {
        onSuccess: ({ workspace, deckId }) => {
          onJoined?.();
          void navigate(deckId ? routes.deck(deckId) : routes.workspace(workspace.id));
        },
        onError: (error) => onError(error.message, 'danger'),
      }),
  };
}
