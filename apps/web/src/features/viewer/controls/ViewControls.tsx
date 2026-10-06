import { GlassPanel, IconButton } from '@/ui';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

interface ViewControlsProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  fullscreenSupported: boolean;
}

/** Filmstrip toggle and fullscreen (`cropFree`), right of the zoom pill. */
export function ViewControls({
  isFullscreen,
  onToggleFullscreen,
  fullscreenSupported,
}: ViewControlsProps) {
  const { filmstripOpen } = useViewerState();
  const dispatch = useViewerDispatch();

  return (
    <GlassPanel className="flex h-10 items-center gap-1 px-1">
      <IconButton
        icon="bottomPanelOpen"
        label={filmstripOpen ? 'Folienleiste ausblenden' : 'Folienleiste einblenden'}
        active={filmstripOpen}
        size="sm"
        onClick={() => dispatch({ type: 'filmstripToggled' })}
      />
      {fullscreenSupported && (
        <IconButton
          icon={isFullscreen ? 'fullscreenExit' : 'cropFree'}
          label={isFullscreen ? 'Vollbild beenden (F)' : 'Vollbild (F)'}
          size="sm"
          onClick={onToggleFullscreen}
        />
      )}
    </GlassPanel>
  );
}
