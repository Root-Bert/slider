import type { Shape } from '@slider/shared';
import { cn } from '@/ui';

interface ShapeOutlineProps {
  shape: Shape;
  /**
   * `faint`: one of all boxes ("Boxen zeigen"). `target`: where a comment would attach, or the
   * draft's box. `emphasis`: the box of the hovered/focused comment.
   */
  variant: 'faint' | 'target' | 'emphasis';
  /** CSS colour for `target`/`emphasis`. */
  color?: string;
  /** Box mode: drawn a little outside the shape, so the outline does not sit on its edge. */
  padded?: boolean;
}

/** How far a `padded` outline stands off the shape, in px. */
const PAD = 3;

/**
 * The outline of a PowerPoint shape (text box, picture, …) on the slide image, positioned in
 * percent of the slide box. Comments attach to these shapes (BER-98), which the raster image
 * itself does not show. Never a pointer target.
 */
export function ShapeOutline({ shape, variant, color, padded }: ShapeOutlineProps) {
  const { bbox } = shape;
  const pad = padded ? PAD : 0;
  return (
    <div
      aria-hidden
      data-shape-outline={variant}
      className={cn(
        'pointer-events-none absolute rounded-mark',
        variant === 'faint'
          ? 'border border-dashed border-fg-subtle mix-blend-difference'
          : 'border-[1.5px]',
      )}
      style={{
        left: `calc(${bbox.x * 100}% - ${pad}px)`,
        top: `calc(${bbox.y * 100}% - ${pad}px)`,
        width: `calc(${bbox.w * 100}% + ${2 * pad}px)`,
        height: `calc(${bbox.h * 100}% + ${2 * pad}px)`,
        borderColor: variant === 'faint' ? undefined : color,
        backgroundColor:
          variant === 'faint' || !color
            ? undefined
            : `color-mix(in srgb, ${color} ${variant === 'target' ? 10 : 6}%, transparent)`,
      }}
    />
  );
}
