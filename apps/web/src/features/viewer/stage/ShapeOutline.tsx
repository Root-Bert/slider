import type { TurnedBox } from '@slider/shared';
import { cn } from '@/ui';
import { markTint } from './lib/mark-chrome';
import { shapeOutlineStyle } from './lib/shape-outline-style';

interface ShapeOutlineProps {
  /** Its box – turned and tilted as it shows, when it is. */
  shape: TurnedBox;
  /**
   * `faint`: one of all boxes in box mode (`BoxHints`), barely there – white blended by
   * difference, so it darkens a light slide and lightens a dark one, wherever it runs. `target`:
   * where a comment would attach, or the draft's box. `emphasis`: the box of the hovered/focused
   * comment.
   */
  variant: 'faint' | 'target' | 'emphasis';
  /** CSS colour for `target`/`emphasis`. */
  color?: string;
}

/**
 * The outline of a slide element (text box, picture, …) on the slide image, positioned in percent
 * of the slide box and turned and tilted as the element shows – the same outline in box mode and
 * while editing (`EditLayer`), only a click does something else. Comments attach to these shapes
 * (BER-98), which the raster image itself does not show. Never a pointer target.
 */
export function ShapeOutline({ shape, variant, color }: ShapeOutlineProps) {
  return (
    <div
      aria-hidden
      data-shape-outline={variant}
      className={cn(
        'pointer-events-none absolute rounded-mark',
        variant === 'faint' ? 'border border-white/30 mix-blend-difference' : 'border-[1.5px]',
      )}
      style={{
        ...shapeOutlineStyle(shape),
        borderColor: variant === 'faint' ? undefined : color,
        backgroundColor:
          variant === 'faint' || !color
            ? undefined
            : markTint(color, variant === 'target' ? 10 : 6),
      }}
    />
  );
}
