/*
 * The only places where component source may use raw values instead of tokens, enforced by
 * `design-tokens.test.ts`. Paths are relative to `apps/web/src`. Every entry names the exact
 * values it permits and why; the guard also fails when an entry no longer matches anything, so
 * the list cannot go stale. Do not add an entry for something a token or utility can express
 * (apps/web/design-system.md §2–7).
 */

export interface RawValueException {
  /** A file, or a directory prefix ending in `/`. */
  path: string;
  /** `'all'`, or the values (as the scanner reports them) that are fine here. */
  allow: 'all' | readonly RegExp[];
  reason: string;
}

const HEX = /^\[?#[0-9a-fA-F]{3,8}\]?$/;
const RGB = /^rgba?\($/;

/** Raw colours (rule 1) that stay, each with the reason. */
export const PERMANENT: readonly RawValueException[] = [
  {
    path: 'ui/brand/',
    allow: [HEX, /^text-white$/],
    reason:
      'Provider and app marks (Google, Microsoft hex colours; white "P" on the PowerPoint orange) keep their brand colours.',
  },
  {
    path: 'ui/CountBubble.tsx',
    allow: [/^text-white$/],
    reason: 'Comment count on an accent fill: white on every accent, as in the design.',
  },
  {
    path: 'lib/accent.ts',
    allow: [/^text-(?:black|white)$/],
    reason:
      'onAccentClass(): black or white text on an author accent, decided by isLightAccent – the one place on-accent text is chosen.',
  },
  {
    path: 'lib/palette.ts',
    allow: [HEX, RGB],
    reason:
      'TypeScript mirror of @theme values for canvas drawing and non-CSS consumers; palette.test.ts keeps it in sync with index.css.',
  },
  {
    path: 'features/viewer/connectors/ConnectorLines.tsx',
    allow: [/^"(?:white|black)"$/],
    reason: 'SVG mask paint: white keeps, black cuts out – luminance, not a visible colour.',
  },
  {
    path: 'features/viewer/connectors/hooks/useConnectorLayout.ts',
    allow: [/^"black"$/],
    reason:
      'SVG mask markup for the line cutouts: black hides the lines there – luminance, not a colour.',
  },
  {
    path: 'features/viewer/stage/lib/mark-chrome.ts',
    allow: [/^(?:bg|text)-white$/],
    reason:
      'Editing chrome on the slide image (handles, name tags): pure white so it reads on white paper and dark photos alike.',
  },
  {
    path: 'features/viewer/stage/GuideLayer.tsx',
    allow: [/^text-white$/],
    reason:
      'White label on the PowerPoint overflow red (GUIDE_COLORS), shown over the slide image.',
  },
  {
    path: 'features/viewer/timeline/Minimap.tsx',
    allow: [/^outline-white$/, RGB],
    reason:
      'On-slide contrast chrome: pure white focus outline around slide thumbnails, and the black 0.5 edge of the viewport bracket over arbitrary slide content.',
  },
  {
    path: 'features/viewer/media/lib/sketch.ts',
    allow: [/^#3A3A3A$/, RGB],
    reason:
      'Sketch paper colour, painted into the exported PNG too, and rgb() strings built at runtime for canvas strokes.',
  },
  {
    path: 'features/viewer/media/lib/screen-compositor.ts',
    allow: [RGB],
    reason:
      'Canvas export mirror: rgb() strings built from the palette alphas (FLOAT_SHADOW_ALPHA, HAIRLINE_STRONG_ALPHA) – canvas needs a colour string.',
  },
];

/**
 * Literal type, radius, z-index and easing values (rules 3, 5–7) that stay. `rounded-[inherit]`
 * is allowed everywhere (it follows the parent's token radius).
 */
export const LITERAL_EXCEPTIONS: readonly RawValueException[] = [
  {
    path: 'features/viewer/stage/Pin.tsx',
    allow: [/^z-1$/],
    reason:
      'Local order inside the slide box (pins above the frames’ click areas, below an emphasised pin) – not an app layer.',
  },
  {
    path: 'features/viewer/live/LiveThreadMarker.tsx',
    allow: [/^rounded-\[calc\(var\(--radius-panel\)\+3px\)\]$/],
    reason: 'Frame 3px outside a card: concentric with the card’s panel radius.',
  },
  {
    path: 'features/viewer/stage/TextBox.tsx',
    allow: [/^rounded-\[0\.4em\]$/],
    reason: 'Slide geometry: the hit area scales with the slide’s font size (em), not the UI.',
  },
  {
    path: 'features/viewer/stage/lib/text-box.ts',
    allow: [/^rounded-\[0\.25em\]$/],
    reason: 'Slide geometry: text-box corners scale with the slide’s font size (em).',
  },
  {
    path: 'features/viewer/media/RecorderPanel.tsx',
    allow: [/^rounded-\[10\.5%\/14%\]$/],
    reason: 'Camera bubble preview: the same corner as the recording compositor’s BUBBLE_CORNER.',
  },
  {
    path: 'features/viewer/timeline/CommentColumns.tsx',
    allow: [/^cubic-bezier\($/],
    reason:
      'SLOT_MOVE_EASE for Element.animate(), which cannot read a CSS custom property (no --ease-* token).',
  },
];
