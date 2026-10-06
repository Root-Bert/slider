import type { AccentColor } from '@slider/shared';

/** CSS colour for a reviewer's pins, lines and drawings. */
export const accentColor = (color: AccentColor): string => `var(--color-accent-${color})`;

/** Softer pastel used for avatar rings and presence. */
export const ringColor = (color: AccentColor): string => `var(--color-ring-${color})`;
