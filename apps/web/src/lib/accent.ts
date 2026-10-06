import type { AccentColor } from '@slider/shared';

/*
 * Variable names are spelled out literally (not built from a template string) so Tailwind sees
 * them in the source and emits the theme variables.
 */

const ACCENT: Record<AccentColor, string> = {
  red: 'var(--color-accent-red)',
  blue: 'var(--color-accent-blue)',
  violet: 'var(--color-accent-violet)',
  yellow: 'var(--color-accent-yellow)',
};

const RING: Record<AccentColor, string> = {
  red: 'var(--color-ring-red)',
  blue: 'var(--color-ring-blue)',
  violet: 'var(--color-ring-violet)',
  yellow: 'var(--color-ring-yellow)',
};

/** CSS colour for a reviewer's pins, lines and drawings (BER-99). */
export const accentColor = (color: AccentColor): string => ACCENT[color];

/** Translucent variant of a reviewer accent (glows, fills). */
export const accentAlpha = (color: AccentColor, percent: number): string =>
  `color-mix(in srgb, ${ACCENT[color]} ${percent}%, transparent)`;

/** Softer pastel used for avatar rings and presence. */
export const ringColor = (color: AccentColor): string => RING[color];
