import { slideHeightAt, zoomForHeight, type TrackGeometry } from './timeline-layout';

/**
 * Timeline zoom (BER-96). The zoom is the slider position `t` ∈ [0, 1] on a log scale between
 * "the whole deck fits" (0) and Desktop-1 (1), see `timeline-layout`. Storing `t` rather than
 * pixels keeps the setting meaningful across window sizes and decks.
 */
export const ZOOM_MIN = 0;
export const ZOOM_MAX = 1;
/**
 * First visit: Desktop-1 – the slides fill the track like Figma D1, the minimap below gives the
 * overview of the whole deck.
 */
export const DEFAULT_ZOOM = 1;
/** One click on ›‹ / ‹›: four clicks go from one end to the other. */
export const ZOOM_STEP = 0.25;
export const ZOOM_STORAGE_KEY = 'slider.viewer.timelineZoom.v2';

/** Wheel pixels per e-fold of slide height; a single wheel notch is capped so mice don't jump. */
const WHEEL_SENSITIVITY = 0.005;
const WHEEL_MAX_DELTA = 50;
const LINE_HEIGHT_PX = 16;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clampZoom = (zoom: number) => clamp(zoom, ZOOM_MIN, ZOOM_MAX);

/** One button step out (-1) or in (+1); rounding keeps float drift from missing the ends. */
export const stepZoom = (zoom: number, direction: 1 | -1) =>
  clampZoom(Math.round((zoom + direction * ZOOM_STEP) * 1e6) / 1e6);

/** Ctrl/⌘ + wheel and trackpad pinch: scrolling down (positive delta) zooms out. */
export function wheelZoom(
  zoom: number,
  deltaY: number,
  deltaMode: number,
  geo: TrackGeometry,
): number {
  const pixels = deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaY;
  const h = slideHeightAt(zoom, geo);
  return zoomForHeight(
    h * Math.exp(-clamp(pixels, -WHEEL_MAX_DELTA, WHEEL_MAX_DELTA) * WHEEL_SENSITIVITY),
    geo,
  );
}

/** Safari pinch: `scale` is relative to the height when the gesture started. */
export const pinchZoom = (startZoom: number, scale: number, geo: TrackGeometry) =>
  zoomForHeight(slideHeightAt(startZoom, geo) * scale, geo);

/** Persisted zoom of this browser; anything unreadable falls back to the default. */
export function loadStoredZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
    const stored = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
    return Number.isFinite(stored) ? clampZoom(stored) : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

export function storeZoom(zoom: number) {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, zoom.toFixed(4));
  } catch {
    // Not persisted – the zoom still applies for this session.
  }
}
