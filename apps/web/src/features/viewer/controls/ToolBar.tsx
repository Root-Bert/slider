import type { MediaKind } from '@slider/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { cn, GlassPanel, Icon, IconButton } from '@/ui';
import { useViewerData } from '../state/viewer-data';
import { isPenTool, useViewerDispatch, useViewerState } from '../state/viewer-state';
import { ToolOptions } from './ToolOptions';

/** Room the tool options pill needs next to the tool bar (its height plus the gap). */
const OPTIONS_ROOM = 48;

/**
 * Tool bar at the left of the controls row (Figma D1): draw, voice, text, video – a compact pill
 * as tall as the filter pill. While the pen is picked, its options (variant, colour, undo/redo)
 * open anchored to it: above, over the minimap, or below when there is no room above.
 * "Text auf Folie" has no options: it writes in the author's colour.
 */
export function ToolBar({ className }: { className?: string }) {
  const { canComment } = useViewerData();
  const { tool } = useViewerState();
  const penOptions = isPenTool(tool);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!penOptions || !anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      // The viewer root is the fullscreen element; outside fullscreen it fills the window.
      const bounds = anchor.closest('[data-viewer-root]')?.getBoundingClientRect();
      const top = bounds?.top ?? 0;
      const bottom = bounds?.bottom ?? window.innerHeight;
      const above = rect.top - top;
      const below = bottom - rect.bottom;
      setPlacement(above >= OPTIONS_ROOM || above >= below ? 'above' : 'below');
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [penOptions]);

  if (!canComment) {
    return (
      <GlassPanel
        role="status"
        className={cn(
          'flex h-10 shrink-0 items-center gap-2 px-3 text-sm text-fg-muted',
          className,
        )}
      >
        <Icon name="visibility" size={18} />
        Nur ansehen
      </GlassPanel>
    );
  }

  return (
    <div ref={anchorRef} className={cn('relative shrink-0', className)}>
      <ToolButtons />
      {penOptions && (
        <div
          data-tool-options
          data-placement={placement}
          className={cn(
            // As wide as the timeline allows (container width minus the row's padding).
            'absolute left-0 z-10 w-max max-w-[calc(100cqw-32px)]',
            placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          <ToolOptions />
        </div>
      )}
    </div>
  );
}

function ToolButtons() {
  const { tool, lastPenTool, activeSlideId, draft } = useViewerState();
  const dispatch = useViewerDispatch();
  const drawing = isPenTool(tool);
  const record = (kind: MediaKind) => {
    if (activeSlideId) dispatch({ type: 'mediaDraftStarted', slideId: activeSlideId, kind });
  };

  return (
    <GlassPanel role="toolbar" aria-label="Werkzeuge" className="flex items-center gap-1 p-1">
      <IconButton
        icon="draw"
        label="Zeichnen"
        size="sm"
        active={drawing}
        onClick={() => dispatch({ type: 'toolSelected', tool: drawing ? null : lastPenTool })}
      />
      <IconButton
        icon="mic"
        label="Sprachkommentar"
        size="sm"
        active={draft?.recordKind === 'audio'}
        onClick={() => record('audio')}
      />
      <IconButton
        icon="formatShapes"
        label="Text auf Folie"
        size="sm"
        active={tool === 'text'}
        onClick={() => dispatch({ type: 'toolSelected', tool: 'text' })}
      />
      <IconButton
        icon="cameraVideo"
        label="Videokommentar"
        size="sm"
        active={draft?.recordKind === 'video'}
        onClick={() => record('video')}
      />
    </GlassPanel>
  );
}
