import { useNavigate } from 'react-router';
import { routes } from '@/app/routes';
import { GlassPanel, IconButton } from '@/ui';
import { useViewerData } from '../state/viewer-data';

/** Pill right of the slide counter: closes the review. Inviting people lives in the organisation's members. */
export function SessionControls() {
  const { deck } = useViewerData();
  const navigate = useNavigate();

  return (
    <GlassPanel className="flex items-center gap-1 p-1">
      <IconButton
        icon="close"
        label="Review schließen"
        size="sm"
        onClick={() => navigate(routes.workspace(deck.workspaceId))}
      />
    </GlassPanel>
  );
}
