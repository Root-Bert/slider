import { GlassPanel, Icon, IconButton } from '@/ui';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { ToolOptions } from './ToolOptions';

const COMING_SOON = 'Sprach- und Videokommentare folgen bald';

/** Bottom-left dock: tool options (while a tool is active) above the tool bar (Desktop-1, B2). */
export function ToolDock() {
  const { canComment } = useViewerData();
  const { tool } = useViewerState();

  if (!canComment) {
    return (
      <GlassPanel role="status" className="flex h-14 items-center gap-2 px-5 text-sm text-fg-muted">
        <Icon name="visibility" size={20} />
        Nur ansehen
      </GlassPanel>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {tool && <ToolOptions />}
      <ToolBar />
    </div>
  );
}

function ToolBar() {
  const { tool, lastStrokeTool } = useViewerState();
  const dispatch = useViewerDispatch();
  const drawing = tool !== null && tool !== 'mark';

  return (
    <GlassPanel role="toolbar" aria-label="Werkzeuge" className="flex items-center gap-2 px-3 py-2">
      <IconButton
        icon="draw"
        label="Zeichnen"
        active={drawing}
        onClick={() => dispatch({ type: 'toolSelected', tool: drawing ? null : lastStrokeTool })}
      />
      <IconButton
        icon="mic"
        label={COMING_SOON}
        aria-disabled
        className="cursor-not-allowed opacity-40"
      />
      <IconButton
        icon="formatShapes"
        label="Stelle markieren (Klick = Punkt, Ziehen = Bereich)"
        active={tool === 'mark'}
        onClick={() => dispatch({ type: 'toolSelected', tool: 'mark' })}
      />
      <IconButton
        icon="cameraVideo"
        label={COMING_SOON}
        aria-disabled
        className="cursor-not-allowed opacity-40"
      />
    </GlassPanel>
  );
}
