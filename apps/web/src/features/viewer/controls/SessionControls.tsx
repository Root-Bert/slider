import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { IconButton } from '@/ui';
import { useViewerData } from '../state/viewer-data';

/** Last button of the deck pill: closes the review. Inviting people lives in the organisation's members. */
export function SessionControls() {
  const { deck } = useViewerData();
  const navigate = useNavigate();

  return (
    <IconButton
      icon="close"
      label="Review schließen"
      size="sm"
      onClick={() => navigate(routes.workspace(deck.workspaceId))}
    />
  );
}
