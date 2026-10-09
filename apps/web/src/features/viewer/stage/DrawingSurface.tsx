import type { AccentColor, Slide } from '@slider/shared';
import type { RefObject } from 'react';
import { accentColor } from '@/lib/accent';
import { useDraftDrawing } from '../hooks/useDraftDrawing';
import type { Tool } from '../state/viewer-state';
import { RectFrame } from './RectFrame';
import { ShapeOutline } from './ShapeOutline';
import { StrokePath } from './StrokePath';

interface DrawingSurfaceProps {
  slide: Slide;
  boxRef: RefObject<HTMLElement | null>;
  tool: Tool;
  /** Box mode: the mark tool attaches to (and outlines) the PowerPoint box under it. */
  boxes: boolean;
  color: AccentColor;
  /** The draft's text box on this slide holds text. */
  hasText: boolean;
}

/**
 * Transparent layer above a slide that captures pointer input while a tool is active. With the
 * mark tool it outlines the PowerPoint shape the comment would attach to.
 * `touch-action: none` only here, so the stage stays swipeable when no tool is selected.
 */
export function DrawingSurface({
  slide,
  boxRef,
  tool,
  boxes,
  color,
  hasText,
}: DrawingSurfaceProps) {
  const { handlers, previewRect, previewStroke, targetShape } = useDraftDrawing({
    slide,
    boxRef,
    tool,
    color,
    hasText,
    boxes,
  });

  return (
    <div
      {...handlers}
      // Text too: a box is drawn first – the I-beam only appears in the placed box.
      className="absolute inset-0 z-20 cursor-crosshair touch-none select-none"
    >
      {targetShape && (
        <ShapeOutline shape={targetShape} variant="target" color={accentColor(color)} labelled />
      )}
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
