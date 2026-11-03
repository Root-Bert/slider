import { useRef, type HTMLAttributes, type RefObject } from 'react';
import { cn } from '@/ui';
import { BRACKET_GRIPS } from './corners';
import { FrameOutline } from './FrameOutline';
import { useFrameSize } from './hooks/useFrameSize';
import { useNearHandles } from './hooks/useNearHandles';
import type { RectCorner } from './hooks/useRectEdit';
import type { FrameHandle } from './lib/frame-outline';

interface CornerBracketsProps {
  /** The box they are drawn on (positioned: they lie inside it, over its edge). */
  frameRef: RefObject<HTMLElement | null>;
  color: string;
  /** Corners that resize: the line runs out around each as a bracket. */
  corners: readonly RectCorner[];
  /** Lit (emphasised or dragged): the soft band along the line. */
  halo?: boolean;
  /** What a corner's grip does (its pointer handlers). */
  grip: (corner: RectCorner) => HTMLAttributes<HTMLSpanElement>;
  title?: string;
}

/**
 * A picked box's line with its resize brackets, as a picked element shows while editing
 * (`EditableFrame` on an element's edge): one stroke on the box's edge that runs out around each
 * corner as the pointer nears it. For boxes that are not an `EditableFrame` (a comment's text) –
 * every box on the slide resizes with one look.
 */
export function CornerBrackets({
  frameRef,
  color,
  corners,
  halo = false,
  grip,
  title = 'Größe ändern',
}: CornerBracketsProps) {
  const size = useFrameSize(frameRef, true);
  const grips = useRef<Partial<Record<FrameHandle, HTMLSpanElement | null>>>({});
  const side = size ? Math.round(Math.min(size.width, size.height) * size.scale) : 0;
  const near = useNearHandles(size !== null, side, grips);
  if (!size) return null;
  return (
    <>
      <FrameOutline
        width={size.width}
        height={size.height}
        scale={size.scale}
        color={color}
        corners={corners}
        near={near}
        dome={false}
        halo={halo}
      />
      {corners.map((corner) => (
        <span
          key={corner}
          ref={(element) => {
            grips.current[corner] = element;
          }}
          role="presentation"
          title={title}
          {...grip(corner)}
          // Only where to grab the bracket the line runs around.
          className={cn('pointer-events-auto absolute touch-none', BRACKET_GRIPS[corner])}
        />
      ))}
    </>
  );
}
