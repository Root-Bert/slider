/** A line of a line-based wheel (some mice) in pixels. */
const LINE_PX = 16;

/** A wheel delta in pixels, whether the device counts pixels or lines (`deltaMode` 1). */
export const wheelPixels = (delta: number, deltaMode: number) =>
  deltaMode === 1 ? delta * LINE_PX : delta;

/** Whether `element` is already scrolled as far as `delta` (pixels, positive: right) would go. */
export function atScrollEdge(element: HTMLElement, delta: number): boolean {
  const max = element.scrollWidth - element.clientWidth;
  return (delta > 0 && element.scrollLeft >= max - 1) || (delta < 0 && element.scrollLeft <= 1);
}
