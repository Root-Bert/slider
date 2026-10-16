import type { AccentColor } from '@slider/shared';

/*
 * The few design tokens TypeScript needs as values rather than classes: canvas drawing (sketch
 * sheet, screen compositor) and anything else that can't take a `var(--…)`. They mirror
 * `styles/index.css` (`@theme`); `palette.test.ts` fails when the two drift apart. Components use
 * the token classes instead.
 */

/** `--color-canvas`: page background, dot-grid base. */
export const CANVAS = '#000000';

/** `--color-glass-solid`: opaque glass (tooltips, image backdrops, pending tiles). */
export const GLASS_SOLID = '#141414';

/** White alpha of `--color-hairline-strong` (field edges, elevated edges). */
export const HAIRLINE_STRONG_ALPHA = 0.16;

/** Black alpha of `--shadow-float` (`0 8px 32px`). */
export const FLOAT_SHADOW_ALPHA = 0.5;

/** `--color-accent-*`: reviewer accents (pins, connector lines, drawings). */
export const ACCENT_HEX: Readonly<Record<AccentColor, string>> = {
  red: '#ff1f5a',
  yellow: '#ffd000',
  green: '#00c853',
  cyan: '#00e0ff',
  blue: '#0048ff',
  violet: '#a259ff',
};

/** `--color-powerpoint`: PowerPoint authors without a Slider account. */
export const POWERPOINT_HEX = '#d35230';

/**
 * The current value of a CSS custom property on `:root` (e.g. `readToken('--color-accent-red',
 * ACCENT_HEX.red)`), or `fallback` when it is unset or there is no DOM (tests, SSR).
 */
export function readToken(name: `--${string}`, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
