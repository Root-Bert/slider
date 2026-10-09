import type { AccentColor, Slide } from '@slider/shared';
import type { RefObject } from 'react';
import { useDraftDrawing } from '../hooks/useDraftDrawing';
import type { Tool } from '../state/viewer-state';
import { StrokePath } from './StrokePath';

interface DrawingSurfaceProps {
  slide: Slide;
  boxRef: RefObject<HTMLElement | null>;
  tool: Tool;
  color: AccentColor;
}

/**
 * Transparent layer above a slide that captures pointer input while a pen is picked.
 * `touch-action: none` only here, so the stage stays swipeable when no pen is selected.
 */
export function DrawingSurface({ slide, boxRef, tool, color }: DrawingSurfaceProps) {
  const { handlers, previewStroke } = useDraftDrawing({ slide, boxRef, tool, color });

  return (
    <div {...handlers} className="absolute inset-0 z-20 cursor-crosshair touch-none select-none">
      {previewStroke && (
        <svg
          className="absolute inset-0 size-full overflow-visible"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden
        >
          <StrokePath stroke={previewStroke} aspectRatio={slide.aspectRatio} />
        </svg>
      )}
    </div>
  );
}
