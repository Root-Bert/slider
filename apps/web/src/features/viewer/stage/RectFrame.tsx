import type { Rect } from '@slider/shared';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/ui';

interface RectFrameProps {
  rect: Rect;
  color: string;
  emphasized?: boolean;
  dashed?: boolean;
  /** A comment's mark: connector lines pass behind it. */
  isMark?: boolean;
  className?: string;
  children?: ReactNode;
}

/** A 2px rounded frame around a marked area, positioned in percent of the slide box. */
export function RectFrame({
  rect,
  color,
  emphasized = false,
  dashed = false,
  isMark = false,
  className,
  children,
}: RectFrameProps) {
  return (
    <div
      data-mark={isMark ? 'frame' : undefined}
      className={cn('absolute rounded-thumb border-2', dashed && 'border-dashed', className)}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
        borderColor: color,
        boxShadow: emphasized
          ? `0 0 0 3px color-mix(in srgb, ${color} 30%, transparent)`
          : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** Width (px) of the band along a frame's border that takes the pointer. */
const EDGE_BAND = 12;
/** The bands straddle the 2px border; offsets count from the padding box. */
const EDGE_OUT = -(EDGE_BAND / 2 + 1);

const EDGES: CSSProperties[] = [
  { top: EDGE_OUT, left: EDGE_OUT, right: EDGE_OUT, height: EDGE_BAND },
  { bottom: EDGE_OUT, left: EDGE_OUT, right: EDGE_OUT, height: EDGE_BAND },
  { top: EDGE_OUT, bottom: EDGE_OUT, left: EDGE_OUT, width: EDGE_BAND },
  { top: EDGE_OUT, bottom: EDGE_OUT, right: EDGE_OUT, width: EDGE_BAND },
];

/**
 * Invisible bands along a frame's border that take hover and clicks, so a frame only counts by
 * its border – drawings and marks inside it stay reachable. Put them inside a frame with
 * `pointer-events-none`; their events bubble to it.
 */
export function FrameEdges({ active = true }: { active?: boolean }) {
  return EDGES.map((style, index) => (
    <span
      key={index}
      aria-hidden
      className={cn('absolute', active ? 'pointer-events-auto' : 'pointer-events-none')}
      style={style}
    />
  ));
}
