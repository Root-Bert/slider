/** One-shot logo animations (styles in index.css, `[data-logo-anim]`). */
export const LOGO_ANIMATIONS = [
  'hop',
  'shuffle',
  'flip',
  'next-slide',
  'wave',
  'jelly',
  'fan',
  'swing',
  'orbit',
  'split-flap',
] as const;
export type LogoAnimation = (typeof LOGO_ANIMATIONS)[number];
