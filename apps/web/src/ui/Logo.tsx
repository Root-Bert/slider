import type { AnimationEvent, CSSProperties } from 'react';
import { THEME } from '@slider/shared';
import { cn } from './cn';
import type { LogoAnimation } from './logo-animations';

const WORD = 'Slider';

/** Slider word mark: two stacked slides. */
export function Logo({
  className,
  withText = true,
  animation,
  onAnimationEnd,
}: {
  className?: string;
  withText?: boolean;
  /** Plays once; `onAnimationEnd` fires when the whole animation is over. */
  animation?: LogoAnimation;
  onAnimationEnd?: () => void;
}) {
  // The parts animate on their own; the root always runs the full length, so its end is the end.
  function onRootAnimationEnd(event: AnimationEvent<HTMLSpanElement>) {
    if (event.target === event.currentTarget) onAnimationEnd?.();
  }

  return (
    <span
      className={cn('inline-flex items-center gap-2 text-fg', className)}
      data-logo-anim={animation}
      onAnimationEnd={onRootAnimationEnd}
    >
      <svg width="22" height="18" viewBox="0 0 22 18" fill="none" aria-hidden data-logo-part="icon">
        <rect
          x="1"
          y="5"
          width="15"
          height="11"
          rx="2.5"
          fill="currentColor"
          fillOpacity={THEME.logoBackOpacity}
          data-logo-part="back"
        />
        <rect
          x="5"
          y="1"
          width="15"
          height="11"
          rx="2.5"
          fill="currentColor"
          data-logo-part="front"
        />
      </svg>
      {withText && (
        <span className="text-lg font-semibold tracking-tight" data-logo-part="text">
          {/* One box per letter so they can move on their own; read out as one word. */}
          <span className="sr-only">{WORD}</span>
          {[...WORD].map((letter, i) => (
            <span
              key={i}
              aria-hidden
              className="inline-block"
              style={{ '--i': i } as CSSProperties}
            >
              {letter}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
