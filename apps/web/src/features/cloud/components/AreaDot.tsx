import type { CSSProperties } from 'react';
import { ACCENT_COLORS, type AccentColor, type CloudAreaColor } from '@slider/shared';
import { accentColor } from '@/lib/accent';
import { cn } from '@/ui';

const isAccent = (color: CloudAreaColor): color is AccentColor =>
  (ACCENT_COLORS as readonly string[]).includes(color);

/** An area's colour as CSS: an accent follows the theme, one's own colour is itself. */
export const areaColor = (color: CloudAreaColor): string =>
  isAccent(color) ? accentColor(color) : color;

const fill = (color: CloudAreaColor): CSSProperties => ({ backgroundColor: areaColor(color) });

/** An area's colour as its small square – beside its name everywhere it is named. */
export function AreaDot({
  color,
  size = 'sm',
  className,
}: {
  color: CloudAreaColor;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  if (size === 'lg') {
    return (
      <span
        aria-hidden
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-chip bg-surface-2',
          className,
        )}
      >
        <span className="size-3.5 rounded-thumb" style={fill(color)} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'shrink-0',
        size === 'md' ? 'size-3 rounded-thumb' : 'size-2.5 rounded-mark',
        className,
      )}
      style={fill(color)}
    />
  );
}
