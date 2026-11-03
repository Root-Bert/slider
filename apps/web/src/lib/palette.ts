/*
 * The few design tokens TypeScript needs as values rather than classes: canvas drawing (sketch
 * sheet, screen compositor) and anything else that can't take a `var(--…)`. They mirror
 * `styles/index.css` (`@theme`). Components use the token classes instead.
 */

/** `--color-canvas`: page background, dot-grid base. */
export const CANVAS = '#000000';

/** `--color-glass-solid`: opaque glass (tooltips, image backdrops, pending tiles). */
export const GLASS_SOLID = '#141414';

/** White alpha of `--color-hairline-strong` (field edges, elevated edges). */
export const HAIRLINE_STRONG_ALPHA = 0.16;

/** Black alpha of `--shadow-float` (`0 8px 32px`). */
export const FLOAT_SHADOW_ALPHA = 0.5;

/**
 * "Hilfslinien zeigen": PowerPoint's drawing guides (its own cyan) and the boxes that stick out
 * over them, as PowerPoint shows them – deliberately not the reviewer accents or `danger`, so a
 * guide never reads as somebody's mark.
 */
export const GUIDE_COLORS = { guide: 'rgb(6 182 212)', overflow: 'rgb(239 68 68)' } as const;

/**
 * Grounds of the generated avatars (DiceBear "slice", "Bold Pop" preset), as DiceBear takes them:
 * hex without `#`. Illustration colours drawn into the avatar image, not UI tokens.
 */
export const GENERATED_AVATAR_GROUNDS: readonly string[] = [
  'ff5d8f',
  'ffb703',
  '43aa8b',
  '4d96ff',
  'b57bff',
];

/**
 * The current value of a CSS custom property on `:root` (e.g. `readToken('--color-accent-red',
 * GLASS_SOLID)`), or `fallback` when it is unset or there is no DOM (tests, SSR).
 */
export function readToken(name: `--${string}`, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
