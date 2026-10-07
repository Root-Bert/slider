import { GlassPanel, IconButton } from '@/ui';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

interface ViewControlsProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  fullscreenSupported: boolean;
}

/**
 * Filmstrip toggle (`bottomPanelOpen`) and fullscreen (`cropFree`), right of the zoom pill
 * (Figma 87:369). Hiding the filmstrip moves the comments up; zoom doesn't depend on it.
 */
export function ViewControls({
  isFullscreen,
  onToggleFullscreen,
  fullscreenSupported,
}: ViewControlsProps) {
  const { filmstripOpen } = useViewerState();
  const dispatch = useViewerDispatch();

  return (
    <GlassPanel className="flex items-center gap-2 px-3">
      <IconButton
        icon="bottomPanelOpen"
        label={filmstripOpen ? 'Folienleiste ausblenden' : 'Folienleiste einblenden'}
        active={filmstripOpen}
        size="sm"
        iconSize={24}
        onClick={() => dispatch({ type: 'filmstripToggled' })}
      />
      {fullscreenSupported && (
        <IconButton
          icon={isFullscreen ? 'fullscreenExit' : 'cropFree'}
          label={isFullscreen ? 'Vollbild beenden (F)' : 'Vollbild (F)'}
          size="sm"
          iconSize={24}
          onClick={onToggleFullscreen}
        />
      )}
    </GlassPanel>
  );
}
