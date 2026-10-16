import { THEME } from '@slider/shared';
import { cn } from './cn';

/** Slider word mark: two stacked slides. */
export function Logo({
  className,
  withText = true,
  onAnimationEnd,
}: {
  className?: string;
  withText?: boolean;
  onAnimationEnd?: () => void;
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-fg', className)}
      onAnimationEnd={onAnimationEnd}
    >
      <svg width="22" height="18" viewBox="0 0 22 18" fill="none" aria-hidden>
        <rect
          x="1"
          y="5"
          width="15"
          height="11"
          rx="2.5"
          fill="currentColor"
          fillOpacity={THEME.logoBackOpacity}
        />
        <rect x="5" y="1" width="15" height="11" rx="2.5" fill="currentColor" />
      </svg>
      {withText && <span className="text-lg font-semibold tracking-tight">Slider</span>}
    </span>
  );
}
