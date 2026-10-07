/**
 * Timeline zoom of the slide row (BER-96). `zoom` is the slide height relative to the
 * Desktop-1 size: 1 = 552px slides with the next one peeking in (Desktop-1, 87:317),
 * ZOOM_MIN = 252px slides with several side by side (Desktop-7, 87:238). The slider works on
 * a logarithmic scale, so equal thumb travel feels like equal zoom.
 */
export const ZOOM_MAX = 1;
export const ZOOM_MIN = 252 / 552;
/** One click on ›‹ / ‹›, in slider units: four clicks go from max to min. */
export const ZOOM_STEP = 0.25;
export const ZOOM_STORAGE_KEY = 'slider.viewer.zoom.v1';

/** Wheel pixels per e-fold of zoom; a single wheel notch is capped so mice don't jump. */
const WHEEL_SENSITIVITY = 0.005;
const WHEEL_MAX_DELTA = 50;
const LINE_HEIGHT_PX = 16;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clampZoom = (zoom: number) => clamp(zoom, ZOOM_MIN, ZOOM_MAX);

/** Zoom → slider position in 0..1 (log scale). */
export const zoomToSlider = (zoom: number) =>
  Math.log(clampZoom(zoom) / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);

/** Slider position in 0..1 → zoom. The ends map exactly, so the buttons disable there. */
export function sliderToZoom(position: number): number {
  if (position <= 0) return ZOOM_MIN;
  if (position >= 1) return ZOOM_MAX;
  return ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** position;
}

/** One button step out (-1) or in (+1); rounding keeps float drift from missing the ends. */
export const stepZoom = (zoom: number, direction: 1 | -1) =>
  sliderToZoom(Math.round((zoomToSlider(zoom) + direction * ZOOM_STEP) * 1e6) / 1e6);

/** Ctrl/⌘ + wheel and trackpad pinch: scrolling down (positive delta) zooms out. */
export function wheelZoom(zoom: number, deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaY;
  return clampZoom(
    zoom * Math.exp(-clamp(pixels, -WHEEL_MAX_DELTA, WHEEL_MAX_DELTA) * WHEEL_SENSITIVITY),
  );
}

/** Persisted zoom of this browser; anything unreadable falls back to the Desktop-1 look. */
export function loadStoredZoom(): number {
  try {
    const stored = Number.parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY) ?? '');
    return Number.isFinite(stored) ? clampZoom(stored) : ZOOM_MAX;
  } catch {
    return ZOOM_MAX;
  }
}

export function storeZoom(zoom: number) {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, zoom.toFixed(4));
  } catch {
    // Not persisted – the zoom still applies for this session.
  }
}
