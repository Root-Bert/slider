import type { DomainWorkspace } from '@slider/shared';
import { Button, ListRow, type ShowToast } from '@/ui';
import { useJoinDomainWorkspace } from '../hooks/useJoinActions';
import { memberCountLabel } from '../lib/join-labels';
import { WorkspaceMark } from './WorkspaceMark';

/**
 * The company workspace of the viewer's e-mail domain (BER-148) in the switcher menu, with
 * "Beitreten" – no invitation needed, they join as member. The welcome page shows it as a card.
 */
export function DomainWorkspaceRow({
  workspace,
  onError,
  onJoined,
}: {
  workspace: DomainWorkspace;
  onError: ShowToast;
  /** Joined, right before going to the workspace (the switcher closes its menu). */
  onJoined?: () => void;
}) {
  const { pending, join } = useJoinDomainWorkspace(workspace, { onError, onJoined });
  return (
    <div className="-mx-2">
      <ListRow
        variant="flush"
        padding="wide"
        size="body"
        leading={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={32} />}
        title={workspace.name}
        subtitle={`@${workspace.domain} | ${memberCountLabel(workspace.memberCount)}`}
        trailing={
          <Button size="sm" loading={pending} onClick={join}>
            Beitreten
          </Button>
        }
      />
    </div>
  );
}
