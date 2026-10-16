import { slideHeightAt, splitForHeight, type TrackGeometry } from './timeline-layout';

/**
 * The split handle between the slide area and the comment area. The split is `t` ∈ [0, 1]
 * between the smallest and the largest slide height (see `timeline-layout`), or `null` for the
 * default (Desktop-1 proportions). Storing `t` rather than pixels keeps the setting meaningful
 * across window sizes and decks.
 */
export const SPLIT_MIN = 0;
export const SPLIT_MAX = 1;
export const SPLIT_STORAGE_KEY = 'slider.viewer.split.v1';
/** ↑ / ↓ on the focused handle move it this far; with Shift four times as far. */
export const SPLIT_KEY_STEP_PX = 24;
export const SPLIT_KEY_STEP_LARGE_PX = 96;

/** Wheel pixels per e-fold of slide height; a single wheel notch is capped so mice don't jump. */
const WHEEL_SENSITIVITY = 0.005;
const WHEEL_MAX_DELTA = 50;
const LINE_HEIGHT_PX = 16;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clampSplit = (split: number) => clamp(split, SPLIT_MIN, SPLIT_MAX);

/** Dragging the handle by `dy` pixels (down = positive) from where the slides were `startH` tall. */
export const dragSplit = (startH: number, dy: number, geo: TrackGeometry) =>
  splitForHeight(startH + dy, geo);

/** One keyboard step up (-1, smaller slides) or down (+1, bigger slides). */
export const stepSplit = (
  split: number | null,
  direction: 1 | -1,
  geo: TrackGeometry,
  stepPx = SPLIT_KEY_STEP_PX,
) => splitForHeight(slideHeightAt(split, geo) + direction * stepPx, geo);

/** Ctrl/⌘ + wheel and trackpad pinch: scrolling down (positive delta) makes the slides smaller. */
export function wheelSplit(
  split: number | null,
  deltaY: number,
  deltaMode: number,
  geo: TrackGeometry,
): number {
  const pixels = deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaY;
  const h = slideHeightAt(split, geo);
  return splitForHeight(
    h * Math.exp(-clamp(pixels, -WHEEL_MAX_DELTA, WHEEL_MAX_DELTA) * WHEEL_SENSITIVITY),
    geo,
  );
}

/** Safari pinch: `scale` is relative to the slide height when the gesture started. */
export const pinchSplit = (startSplit: number | null, scale: number, geo: TrackGeometry) =>
  splitForHeight(slideHeightAt(startSplit, geo) * scale, geo);

/** Persisted split of this browser; missing or unreadable means the default (`null`). */
export function loadStoredSplit(): number | null {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    const stored = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
    return Number.isFinite(stored) ? clampSplit(stored) : null;
  } catch {
    return null;
  }
}

export function storeSplit(split: number | null) {
  try {
    if (split === null) localStorage.removeItem(SPLIT_STORAGE_KEY);
    else localStorage.setItem(SPLIT_STORAGE_KEY, split.toFixed(4));
  } catch {
    // Not persisted – the split still applies for this session.
  }
}
