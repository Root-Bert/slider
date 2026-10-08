import type { PathStroke } from '@slider/shared';
import { accentColor } from '@/lib/accent';
import { STROKE_STYLE, strokePath } from '../lib/stroke-path';

interface StrokePathProps {
  stroke: Pick<PathStroke, 'tool' | 'color' | 'points'>;
  aspectRatio: number;
  /** Multiplies the tool's own opacity (dimming). */
  opacity?: number;
  emphasized?: boolean;
  /** A comment's mark: connector lines pass behind it. */
  isMark?: boolean;
}

/** One drawing inside the slide's `0 0 1 1` SVG; stroke width stays in screen pixels. */
export function StrokePath({
  stroke,
  aspectRatio,
  opacity = 1,
  emphasized = false,
  isMark = false,
}: StrokePathProps) {
  const style = STROKE_STYLE[stroke.tool];
  return (
    <path
      data-mark={isMark ? 'stroke' : undefined}
      d={strokePath(stroke, aspectRatio)}
      fill="none"
      // CSS (not the presentation attribute) so the colour may be a `var()`.
      style={{ stroke: accentColor(stroke.color) }}
      strokeWidth={style.width + (emphasized ? 1 : 0)}
      strokeOpacity={style.opacity * opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      className="transition-[stroke-opacity] duration-200"
    />
  );
}
