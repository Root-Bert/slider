/** A line of a line-based wheel (some mice) in pixels. */
const LINE_PX = 16;

/** A wheel delta in pixels, whether the device counts pixels or lines (`deltaMode` 1). */
export const wheelPixels = (delta: number, deltaMode: number) =>
  deltaMode === 1 ? delta * LINE_PX : delta;
