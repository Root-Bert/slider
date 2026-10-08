import type { AccentColor, Slide } from '@slider/shared';
import type { RefObject } from 'react';
import { accentColor } from '@/lib/accent';
import { cn } from '@/ui';
import { useDraftDrawing } from '../hooks/useDraftDrawing';
import type { Tool } from '../state/viewer-state';
import { RectFrame } from './RectFrame';
import { StrokePath } from './StrokePath';

interface DrawingSurfaceProps {
  slide: Slide;
  boxRef: RefObject<HTMLElement | null>;
  tool: Tool;
  color: AccentColor;
  /** The draft's text box on this slide holds text. */
  hasText: boolean;
}

/**
 * Transparent layer above a slide that captures pointer input while a tool is active.
 * `touch-action: none` only here, so the stage stays swipeable when no tool is selected.
 */
export function DrawingSurface({ slide, boxRef, tool, color, hasText }: DrawingSurfaceProps) {
  const { handlers, previewRect, previewStroke } = useDraftDrawing({
    slide,
    boxRef,
    tool,
    color,
    hasText,
  });

  return (
    <div
      {...handlers}
      className={cn(
        'absolute inset-0 z-20 touch-none select-none',
        tool === 'text' ? 'cursor-text' : 'cursor-crosshair',
      )}
    >
      {previewRect && <RectFrame rect={previewRect} color={accentColor(color)} dashed />}
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
