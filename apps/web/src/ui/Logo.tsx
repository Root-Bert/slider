import type { AnimationEvent, CSSProperties } from 'react';
import { cn } from './cn';
import type { LogoAnimation } from './logo-animations';

const WORD = 'Slider';
/** The letters' `--i` runs 0–5 whatever the word's length, so the logo animations keep their timing. */
const LETTER_SPREAD = 5;

/**
 * The mark's colours: `brand` the theme's orange ones (every app's header wears its own colours,
 * Slider's too); `onOrange` the Dock tile's colours for the mark on
 * Slider orange (the website), its white comment box edged in orange (the tile's double edge, as
 * thin as it reads this small). They override the logo tokens the parts are painted with.
 */
export type LogoTone = 'brand' | 'onOrange';
const TONES: Record<LogoTone, CSSProperties | undefined> = {
  brand: undefined,
  onOrange: {
    '--color-logo-legs': '#f7cdc5',
    '--color-logo-roll': '#e66950',
    '--color-logo-screen': '#f1ac9e',
    '--color-logo-bars': '#e3583d',
    '--color-logo-title': '#e3583d',
    '--color-logo': '#ffffff',
    '--color-logo-outline': '#e3583d',
  } as CSSProperties,
};

/**
 * Slider's mark alone, `width` px wide (the word mark's is 24): a projection screen on a tripod,
 * under its roll, a title and a bar chart on it, and a comment box over it, its bottom-left corner
 * nearly sharp – a speech bubble pointing at the slide. Drawn in 24.05 × 22.25 units, a quarter
 * of the brand guide's 96.2 × 89 ("Slider Mark", scripts/logo-files.py), so the logo animations'
 * px (index.css) are screen px at the word mark's size.
 */
export function LogoMark({
  width = 24,
  tone = 'brand',
  className,
}: {
  width?: number;
  tone?: LogoTone;
  className?: string;
}) {
  return (
    <svg
      width={width}
      height={(width * 22.25) / 24.05}
      viewBox="0 0 24.05 22.25"
      fill="none"
      aria-hidden
      className={className}
      style={TONES[tone]}
      data-logo-part="icon"
    >
      <g data-logo-part="back">
        <path
          d="M10.3774 12.6131L6.0917 21.6607M10.3774 12.6131L14.6631 21.6607M10.3774 12.6131L10.3774 20.7083"
          className="stroke-logo-legs"
          strokeWidth=".8333"
          strokeLinecap="round"
        />
        <rect
          x="1.3298"
          y="1.4226"
          width="18.0952"
          height="18.3333"
          rx="1.1905"
          className="fill-logo-screen"
        />
        <path
          d="M2.5202 4.0417h1.4286"
          className="stroke-logo-title"
          strokeWidth=".7143"
          strokeLinecap="round"
        />
        <g className="fill-logo-bars">
          <rect x="2.5202" y="13.0893" width="1.9048" height="5.4762" rx=".4762" />
          <rect x="5.1393" y="16.4226" width="1.9048" height="2.1429" rx=".4762" />
          <rect x="7.7583" y="10.9464" width="1.9048" height="7.619" rx=".4762" />
          <rect x="10.3774" y="15.2321" width="1.9048" height="3.3333" rx=".4762" />
          <rect x="12.9964" y="17.1369" width="1.9048" height="1.4286" rx=".4762" />
          <rect x="15.6155" y="9.5179" width="1.9048" height="9.0476" rx=".4762" />
        </g>
      </g>
      <g data-logo-part="front">
        <rect
          x=".3774"
          y=".2321"
          width="20"
          height="1.6667"
          rx=".8333"
          className="fill-logo-roll"
        />
      </g>
      <path
        d="M9.2726 2.6274h10.2857a4.1143 4.1143 0 0 1 4.1143 4.1143v3.3429a4.1143 4.1143 0 0 1-4.1143 4.1143H6.1869a1.0286 1.0286 0 0 1-1.0286-1.0286V6.7417a4.1143 4.1143 0 0 1 4.1143-4.1143Z"
        className="fill-logo stroke-logo-outline"
        strokeWidth=".46"
        data-logo-part="bubble"
      />
    </svg>
  );
}

/** Slider word mark: the mark beside the word, as in the brand guide (mark 96.2 × 89, 24 gap, 72 px type). */
export function Logo({
  className,
  withText = true,
  tone = 'brand',
  animation,
  onAnimationEnd,
}: {
  className?: string;
  withText?: boolean;
  /** `brand` in the app; the website's mark on orange is `onOrange`. */
  tone?: LogoTone;
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
      className={cn('inline-flex items-center gap-1.5 text-fg', className)}
      data-logo-anim={animation}
      onAnimationEnd={onRootAnimationEnd}
    >
      <LogoMark tone={tone} />
      {withText && (
        <span className="text-lg font-semibold tracking-tight" data-logo-part="text">
          {/* One box per letter so they can move on their own; read out as one word. */}
          <span className="sr-only">{WORD}</span>
          {[...WORD].map((letter, i) => (
            <span
              key={i}
              aria-hidden
              className="inline-block"
              style={{ '--i': (i * LETTER_SPREAD) / (WORD.length - 1) } as CSSProperties}
            >
              {letter}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
