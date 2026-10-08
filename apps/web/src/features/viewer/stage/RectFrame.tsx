import type { Rect } from '@slider/shared';
import type { ReactNode } from 'react';
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
