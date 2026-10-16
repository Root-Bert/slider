import type { AccentColor, AuthorColor } from '@slider/shared';

/*
 * Variable names are spelled out literally (not built from a template string) so Tailwind sees
 * them in the source and emits the theme variables.
 */

const ACCENT: Record<AuthorColor, string> = {
  red: 'var(--color-accent-red)',
  yellow: 'var(--color-accent-yellow)',
  green: 'var(--color-accent-green)',
  cyan: 'var(--color-accent-cyan)',
  blue: 'var(--color-accent-blue)',
  violet: 'var(--color-accent-violet)',
  // PowerPoint authors without a Slider account.
  powerpoint: 'var(--color-powerpoint)',
};

const RING: Record<AuthorColor, string> = {
  red: 'var(--color-ring-red)',
  yellow: 'var(--color-ring-yellow)',
  green: 'var(--color-ring-green)',
  cyan: 'var(--color-ring-cyan)',
  blue: 'var(--color-ring-blue)',
  violet: 'var(--color-ring-violet)',
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
  yellow: 'Gelb',
  green: 'Grün',
  cyan: 'Cyan',
  blue: 'Blau',
  violet: 'Violett',
};

const LIGHT: ReadonlySet<AuthorColor> = new Set(['yellow', 'green', 'cyan']);

/** Bright accents need black text/icons on top; the rest take white. */
export const isLightAccent = (color: AuthorColor): boolean => LIGHT.has(color);
