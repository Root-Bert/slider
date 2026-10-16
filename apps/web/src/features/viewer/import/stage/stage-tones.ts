/**
 * The import stage's greys in one place: its placeholders mimic the viewer's slides, thumbnails
 * and controls without any of their content, so each shade is a design token (docs §2) – the
 * dark slot and thumbnail fills from the surface tokens, the sketched content and chrome from the
 * white overlay ladder.
 */
export const STAGE_TONE = {
  /** A slide placeholder on the track (the `skeleton` shimmer while it waits to be counted). */
  slot: 'bg-glass-solid ring-hairline',
  /** A slide placeholder once it has printed. */
  slotPrinted: 'bg-placeholder',
  /** Minimap thumbnail: not rendered yet. */
  thumbPending: 'bg-glass-solid',
  /** Minimap thumbnail: rendering right now (lit edge). */
  thumbCurrent: 'bg-placeholder ring-1 ring-border-focus',
  /** Minimap thumbnail: rendered. */
  thumbRendered: 'bg-surface-raised',
  /** The title bar sketched on a rendered thumbnail. */
  thumbSketch: 'bg-selected',
  /** Sketched slide content: titles, bars, bullets. */
  sketchBar: 'bg-surface-3',
  /** Sketched slide content: text lines and boxes. */
  sketchSoft: 'bg-surface-2',
  /** The sheen sweeping over a placeholder as it dissolves. */
  sheen: 'bg-[linear-gradient(105deg,transparent_30%,var(--color-surface-4)_50%,transparent_70%)]',
  /** The vertical line between two slide placeholders. */
  gapLine: 'bg-hairline-strong',
  /** Icons and labels in the ghost controls. */
  ghostControl: 'bg-hover',
  /** The ghost split handle. */
  handle: 'bg-handle',
} as const;
