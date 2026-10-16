import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { IconButton, Toolbar } from '@/ui';
import { useViewerData } from '../state/viewer-data';

/** Pill right of the slide counter: closes the review. Inviting people lives in the organisation's members. */
export function SessionControls() {
  const { deck } = useViewerData();
  const navigate = useNavigate();

  return (
    <Toolbar role={false}>
      <IconButton
        icon="close"
        label="Review schließen"
        size="sm"
        onClick={() => navigate(routes.workspace(deck.workspaceId))}
      />
    </Toolbar>
  );
}
