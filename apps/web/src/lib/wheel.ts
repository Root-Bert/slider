/** A line of a line-based wheel (some mice) in pixels. */
const LINE_PX = 16;

/** A wheel delta in pixels, whether the device counts pixels or lines (`deltaMode` 1). */
export const wheelPixels = (delta: number, deltaMode: number) =>
  deltaMode === 1 ? delta * LINE_PX : delta;

/** Wheel pixels per e-fold of size; a single wheel notch is capped so mice don't jump. */
const WHEEL_SENSITIVITY = 0.005;
const WHEEL_MAX_DELTA = 50;

/**
 * Ctrl/⌘ + wheel and trackpad pinch as a size factor: scrolling down (positive delta) shrinks –
 * a presentation's slides and a document's page alike.
 */
export const wheelFactor = (deltaY: number, deltaMode: number) =>
  Math.exp(
    -Math.min(WHEEL_MAX_DELTA, Math.max(-WHEEL_MAX_DELTA, wheelPixels(deltaY, deltaMode))) *
      WHEEL_SENSITIVITY,
  );
