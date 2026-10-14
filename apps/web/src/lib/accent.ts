import type { AccentColor, AuthorColor } from '@slider/shared';

/*
 * Variable names are spelled out literally (not built from a template string) so Tailwind sees
 * them in the source and emits the theme variables.
 */

const ACCENT: Record<AuthorColor, string> = {
  red: 'var(--color-accent-red)',
  blue: 'var(--color-accent-blue)',
  violet: 'var(--color-accent-violet)',
  yellow: 'var(--color-accent-yellow)',
  // PowerPoint authors without a Slider account.
  powerpoint: 'var(--color-powerpoint)',
};

const RING: Record<AuthorColor, string> = {
  red: 'var(--color-ring-red)',
  blue: 'var(--color-ring-blue)',
  violet: 'var(--color-ring-violet)',
  yellow: 'var(--color-ring-yellow)',
  powerpoint: 'var(--color-ring-powerpoint)',
};

/** CSS colour for a reviewer's pins, lines and drawings (BER-99). */
export const accentColor = (color: AuthorColor): string => ACCENT[color];

/** Translucent variant of a reviewer accent (glows, fills). */
export const accentAlpha = (color: AuthorColor, percent: number): string =>
  `color-mix(in srgb, ${ACCENT[color]} ${percent}%, transparent)`;

/** Softer pastel used for avatar rings and presence. */
export const ringColor = (color: AuthorColor): string => RING[color];

/** German names of the reviewer colours, for pickers. */
export const ACCENT_COLOR_NAMES: Record<AccentColor, string> = {
  red: 'Rot',
  blue: 'Blau',
  violet: 'Violett',
  yellow: 'Gelb',
};
