import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { IconButton } from '@/ui';
import { useViewerData } from '../state/viewer-data';

/**
 * Last button of the deck pill: closes the review – back to the ideas, or for a template being
 * designed back to the library's templates. Inviting people lives in the workspace's members.
 */
export function SessionControls() {
  const { deck } = useViewerData();
  const navigate = useNavigate();
  const isTemplate = deck.template != null;

  return (
    <IconButton
      icon="close"
      label={isTemplate ? 'Vorlage schließen' : 'Präsentation schließen'}
      size="sm"
      onClick={() =>
        navigate(
          isTemplate
            ? routes.workspaceMaterial(deck.workspaceId, 'vorlagen')
            : routes.workspace(deck.workspaceId),
        )
      }
    />
  );
}
