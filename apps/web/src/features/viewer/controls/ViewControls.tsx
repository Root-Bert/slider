import { GlassPanel, IconButton } from '@/ui';

interface ViewControlsProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  fullscreenSupported: boolean;
}

/** Fullscreen (`cropFree`) at the right end of the controls row (Figma 87:369). */
export function ViewControls({
  isFullscreen,
  onToggleFullscreen,
  fullscreenSupported,
}: ViewControlsProps) {
  if (!fullscreenSupported) return null;
  return (
    <GlassPanel className="flex items-center gap-2 px-3">
      <IconButton
        icon={isFullscreen ? 'fullscreenExit' : 'cropFree'}
        label={isFullscreen ? 'Vollbild beenden (F)' : 'Vollbild (F)'}
        size="sm"
        iconSize={24}
        onClick={onToggleFullscreen}
      />
    </GlassPanel>
  );
}
