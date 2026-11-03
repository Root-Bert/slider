import type { AnimationEvent, CSSProperties } from 'react';
import { cn } from './cn';
import type { LogoAnimation } from './logo-animations';

const WORD = 'Slider';
/** The letters' `--i` runs 0–5 whatever the word's length, so the logo animations keep their timing. */
const LETTER_SPREAD = 5;

/**
 * The mark's colours: `brand` the theme's orange ones; `mono` the brand guide's monochrome icon
 * (greys per theme – the app's own header); `onOrange` the app icon's (`public/app-icon.svg`) for
 * the mark on Slider orange – the AI's avatar, its comment box outlined in orange as the app icon's
 * (4 at 256); the grey one's is not. They override the logo tokens the parts are
 * painted with.
 */
export type LogoTone = 'brand' | 'mono' | 'onOrange';
const TONES: Record<LogoTone, CSSProperties | undefined> = {
  brand: undefined,
  mono: {
    '--color-logo-back': 'var(--color-logo-mono-back)',
    '--color-logo-front': 'var(--color-logo-mono-front)',
    '--color-logo-lines': 'var(--color-logo-mono-lines)',
    '--color-logo': 'var(--color-logo-mono-bubble)',
  } as CSSProperties,
  onOrange: {
    '--color-logo-back': '#eb8a77',
    '--color-logo-front': '#f1ac9e',
    '--color-logo-lines': '#e3583d',
    '--color-logo': '#ffffff',
    '--color-logo-outline': '#e3583d',
  } as CSSProperties,
};

/**
 * Slider's mark alone, `width` px wide (the word mark's is 24): two stacked slides (the deck) with
 * a comment box over them, its bottom-left corner nearly sharp – a speech bubble pointing at the
 * slides. Drawn in 24 × 20 units, a quarter of the brand guide's 96 × 80, so the logo animations'
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
      height={(width * 20) / 24}
      viewBox="0 0 24 20"
      fill="none"
      aria-hidden
      className={className}
      style={TONES[tone]}
      data-logo-part="icon"
    >
      <g data-logo-part="back">
        <rect width="20" height="11.25" rx="3" className="fill-logo-back" />
        <path
          d="M2.875 1.875h8.25"
          className="stroke-logo-lines"
          strokeWidth=".75"
          strokeLinecap="round"
        />
      </g>
      <g data-logo-part="front">
        <rect x="2.5" y="8.75" width="20" height="11.25" rx="3" className="fill-logo-front" />
        <path
          d="M5.375 15.5H6M7.75 15.5H18M5.375 17.625H6M7.75 17.625h6.75"
          className="stroke-logo-lines"
          strokeWidth=".75"
          strokeLinecap="round"
        />
      </g>
      <path
        d="M10 2.375h10a4 4 0 0 1 4 4v3.25a4 4 0 0 1-4 4H7a1 1 0 0 1-1-1V6.375a4 4 0 0 1 4-4Z"
        className="fill-logo stroke-logo-outline"
        strokeWidth=".46"
        data-logo-part="bubble"
      />
    </svg>
  );
}

/** Slider word mark: the mark beside the word, as in the brand guide (mark 96 × 80, 24 gap, 72 px type). */
export function Logo({
  className,
  withText = true,
  tone = 'brand',
  animation,
  onAnimationEnd,
}: {
  className?: string;
  withText?: boolean;
  /** The app's own header is `mono`; the website wears the orange (`brand`). */
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
