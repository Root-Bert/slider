import type { AuthorColor } from '@slider/shared';
import type { CSSProperties } from 'react';
import { accentAlpha, accentColor } from '@/lib/accent';
import { TEXT_BOX_LOOK } from './text-box';

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * A sticker's surface („Text auf Folie“, also a note on the board): dark like the rest of the
 * app (light in the light theme), readable on light and dark slides. The text is the author's
 * accent lifted towards white – pure blue or red alone is too dark on the dark backdrop – or, on
 * the light theme's light surface, deepened towards black (`--color-sticker-ink`).
 */
export const textSurface = (color: AuthorColor): CSSProperties => ({
  color: `color-mix(in srgb, ${accentColor(color)} ${percent(TEXT_BOX_LOOK.textLift)}, var(--color-sticker-ink))`,
  backgroundColor: `color-mix(in srgb, var(--color-glass-solid) ${percent(TEXT_BOX_LOOK.fillAlpha)}, transparent)`,
});

/**
 * Lifted off the slide while emphasised or dragged; a soft edge and shadow at rest. With its resize
 * brackets (`CornerBrackets`) their line is its edge.
 */
export const textShadow = (color: AuthorColor, lit: boolean, bracketed = false): string =>
  bracketed
    ? 'var(--shadow-mark)'
    : lit
      ? `0 0 0 2px ${accentColor(color)}, var(--shadow-mark)`
      : `0 0 0 1px ${accentAlpha(color, Math.round(TEXT_BOX_LOOK.edgeAlpha * 100))}, 0 1px 4px var(--color-well-dark)`;
