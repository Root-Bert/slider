import { IconButton } from '@/ui';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Button in the deck pill, left of the slide counter: shows or hides the minimap of the open
 * deck (default: /konto). An action, not a lit toggle: the icon and label show what a click does.
 */
export function MinimapToggle() {
  const { showMinimap } = useViewerState();
  const dispatch = useViewerDispatch();

  return (
    <IconButton
      icon={showMinimap ? 'minimapOff' : 'minimap'}
      label={showMinimap ? 'Folienübersicht ausblenden' : 'Folienübersicht einblenden'}
      size="sm"
      onClick={() => dispatch({ type: 'showMinimapToggled' })}
    />
  );
}
