import type { Shape } from '@slider/shared';
import { cn } from '@/ui';
import { shapeLabel } from '../comments/lib/labels';
import { ON_MARK_TEXT } from './lib/mark-chrome';

interface ShapeOutlineProps {
  shape: Shape;
  /**
   * `faint`: one of all boxes ("Boxen zeigen"). `target`: where a comment would attach, or the
   * draft's box. `emphasis`: the box of the hovered/focused comment.
   */
  variant: 'faint' | 'target' | 'emphasis';
  /** CSS colour for `target`/`emphasis`. */
  color?: string;
  /** Show the name chip above the box. */
  labelled?: boolean;
}

/**
 * The outline of a PowerPoint shape (text box, picture, …) on the slide image, positioned in
 * percent of the slide box. Comments attach to these shapes (BER-98), which the raster image
 * itself does not show. Never a pointer target.
 */
export function ShapeOutline({ shape, variant, color, labelled = false }: ShapeOutlineProps) {
  const { bbox } = shape;
  // Near the top edge the name goes inside the box instead of above it.
  const labelInside = bbox.y < 0.06;
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
    >
      {labelled && (
        <span
          className={cn(
            'absolute left-0 max-w-80 truncate rounded-mark px-1.5 py-0.5',
            'text-caption leading-tight font-medium whitespace-nowrap shadow-mark',
            ON_MARK_TEXT,
            labelInside ? 'top-0' : 'bottom-full mb-0.5',
          )}
          style={{ backgroundColor: color ?? 'var(--color-scrim-strong)' }}
        >
          {shapeLabel(shape)}
        </span>
      )}
    </div>
  );
}
