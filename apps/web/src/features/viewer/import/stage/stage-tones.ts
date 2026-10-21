/**
 * The import stage's greys in one place: its placeholders mimic the viewer's slides, thumbnails
 * and controls without any of their content, so each shade is a design token (docs §2) – the
 * dark slot and thumbnail fills from the surface tokens, the sketched content and chrome from the
 * white overlay ladder.
 */
export const STAGE_TONE = {
  /** A slide placeholder on the track: its edge, and its fill until it has printed … */
  slot: 'ring-hairline',
  slotFill: 'bg-glass-solid',
  /** … and once it has. */
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
  /** Icons and labels in the ghost controls. */
  ghostControl: 'bg-hover',
  /** The ghost split handle. */
  handle: 'bg-handle',
} as const;
