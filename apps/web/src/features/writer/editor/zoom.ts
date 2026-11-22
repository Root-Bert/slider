/** How large the page is shown: fitted to the window, or a size of its own. */
export type ZoomChoice = 'fit' | number;
/** „Größe“'s steps; the handle, pinch and keys stay between the first and the last. */
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const ZOOM_MIN = ZOOMS[0];
export const ZOOM_MAX = ZOOMS[ZOOMS.length - 1]!;

export const clampZoom = (zoom: number) =>
  Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 100) / 100;
