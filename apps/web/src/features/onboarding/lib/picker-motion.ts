/**
 * How long a source button takes to open up into its picker (and back) – the panel's size, tint
 * and shadow (`ease-sheet`), and the other source button folding away beside it.
 */
export const PICKER_EXPAND_MS = 380;

/** The open panel: wider than the column, tall enough for the list, never off screen. */
export const PICKER_PANEL_WIDTH = 'min(1080px, calc(100vw - 32px))';
export const PICKER_PANEL_HEIGHT = 'min(760px, max(420px, calc(100dvh - 300px)))';

/** Everything that changes between button and panel, timed alike so they read as one surface. */
export const PICKER_SURFACE_TRANSITION = [
  'width',
  'height',
  'border-radius',
  'background-color',
  'box-shadow',
  'backdrop-filter',
  '-webkit-backdrop-filter',
]
  .map((property) => `${property} ${PICKER_EXPAND_MS}ms var(--ease-sheet)`)
  .join(', ');
