import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { useViewerData } from '../state/viewer-data';

/**
 * Closing the presentation (the deck pill's ✕, in the desktop app the tab bar's): back to the
 * Präsentationen, or for a template being designed back to the library's templates.
 */
export function useCloseDeck(): { label: string; template: boolean; close: () => void } {
  const { deck } = useViewerData();
  const navigate = useNavigate();
  const template = deck.template != null;
  return {
    label: template ? 'Vorlage schließen' : 'Präsentation schließen',
    template,
    close: () =>
      navigate(
        template
          ? routes.workspaceMaterial(deck.workspaceId, 'vorlagen')
          : routes.workspace(deck.workspaceId),
      ),
  };
}
