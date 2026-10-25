import { IconButton, useIsNarrow } from '@/ui';
import { hasPortraitSlides } from '../state/frame-format';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Button in the deck pill, next to the minimap toggle – only for decks with portrait pages: shows
 * every portrait page in a 16:9 frame, on track and minimap, the page filling it (the wheel moves
 * the part it shows), or every page whole again. Like the minimap toggle an action: icon and label
 * show what a click does. Remembered per browser. Not on a phone (`useFrameAspects`).
 */
export function WideFramesToggle() {
  const { slides } = useViewerData();
  const { wideFrames } = useViewerState();
  const dispatch = useViewerDispatch();
  const narrow = useIsNarrow();
  if (narrow || !hasPortraitSlides(slides)) return null;

  return (
    <IconButton
      icon={wideFrames ? 'framePage' : 'frameWide'}
      label={wideFrames ? 'Ganze Seiten zeigen' : 'Seiten auf 16:9 füllen'}
      size="sm"
      onClick={() => dispatch({ type: 'wideFramesToggled' })}
    />
  );
}
