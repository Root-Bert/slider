import { useNavigate } from 'react-router';
import type { DomainWorkspace } from '@slider/shared';
import { routes } from '@/lib/routes';
import { useJoinByDomain } from '@/lib/api';
import { Button, ListRow, type ShowToast } from '@/ui';
import { WorkspaceMark } from './WorkspaceMark';

/**
 * The company organisation of the viewer's e-mail domain (BER-148) with "Beitreten" – no
 * invitation needed, they join as member.
 */
export function DomainWorkspaceRow({
  workspace,
  onError,
  onJoined,
  compact = false,
}: {
  workspace: DomainWorkspace;
  onError: ShowToast;
  /** Joined, right before going to the organisation (the switcher closes its menu). */
  onJoined?: () => void;
  /** In the switcher menu: tighter row. */
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const join = useJoinByDomain();
  const members =
    workspace.memberCount === 1 ? '1 Mitglied' : `${workspace.memberCount} Mitglieder`;

  return (
    <div className="-mx-2">
      <ListRow
        variant="flush"
        padding={compact ? 'wide' : 'md'}
        size="body"
        leading={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={32} />}
        title={workspace.name}
        subtitle={`@${workspace.domain} | ${members}`}
        trailing={
          <Button
            size="sm"
            loading={join.isPending}
            onClick={() =>
              join.mutate(workspace.id, {
                onSuccess: ({ workspace: joined }) => {
                  onJoined?.();
                  void navigate(routes.workspace(joined.id));
                },
                onError: (error) => onError(error.message, 'danger'),
              })
            }
          >
            Beitreten
          </Button>
        }
      />
    </div>
  );
}
