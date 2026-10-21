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
}

/**
 * The outline of a PowerPoint shape (text box, picture, …) on the slide image, positioned in
 * percent of the slide box. Comments attach to these shapes (BER-98), which the raster image
 * itself does not show. Never a pointer target.
 */
export function ShapeOutline({ shape, variant, color }: ShapeOutlineProps) {
  const { bbox } = shape;
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
        left: `${bbox.x * 100}%`,
        top: `${bbox.y * 100}%`,
        width: `${bbox.w * 100}%`,
        height: `${bbox.h * 100}%`,
        borderColor: variant === 'faint' ? undefined : color,
        backgroundColor:
          variant === 'faint' || !color
            ? undefined
            : `color-mix(in srgb, ${color} ${variant === 'target' ? 10 : 6}%, transparent)`,
      }}
    />
  );
}
