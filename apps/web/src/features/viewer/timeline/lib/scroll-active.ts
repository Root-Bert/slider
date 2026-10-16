/**
 * Which slide scrolling the timeline makes active: the slide whose centre is closest to a focus
 * point at the left third of the viewport. Near the ends of the track the focus point slides
 * towards the edge – at the very start it sits on the first slide, at the very end on the last –
 * so the pick never jumps when the track reaches an end. A hysteresis margin keeps the current
 * slide until another one is clearly closer, so the active slide doesn't flicker at a boundary.
 * Pure; wired to the scroller in `useScrollActiveSlide`.
 */

/** Within this many px of either end the first / last slide is active. */
export const SCROLL_EDGE_PX = 2;
/** Another slide must be this much closer to the focus point to take over. */
export const ACTIVE_HYSTERESIS_PX = 24;
/** The focus point's position in the viewport (share of its width). */
export const FOCUS_SHARE = 1 / 3;

export interface SlideSpan {
  x: number;
  w: number;
}

/**
 * Content x of the focus point: the left third of the viewport, except near the ends – within
 * the first third of a viewport of scrolling it moves in from the left edge, within the last two
 * thirds it moves out to the right edge.
 */
export function focusX(scrollLeft: number, viewportW: number, maxScroll: number): number {
  const remaining = Math.max(0, maxScroll - scrollLeft);
  let viewportX = Math.min(viewportW * FOCUS_SHARE, Math.max(0, scrollLeft));
  viewportX = Math.max(viewportX, viewportW - remaining);
  return scrollLeft + viewportX;
}

export function pickActiveSlide({
  slides,
  scrollLeft,
  viewportW,
  maxScroll,
  current,
  hysteresis = ACTIVE_HYSTERESIS_PX,
}: {
  slides: readonly SlideSpan[];
  scrollLeft: number;
  viewportW: number;
  /** scrollWidth − clientWidth. */
  maxScroll: number;
  /** Index of the active slide, `null` if none (or not on the track). */
  current: number | null;
  hysteresis?: number;
}): number | null {
  const n = slides.length;
  if (n === 0) return null;
  const valid = current !== null && current >= 0 && current < n ? current : null;
  // Nothing to scroll: every slide is in view, scrolling picks nothing.
  if (maxScroll <= SCROLL_EDGE_PX) return valid ?? 0;
  if (scrollLeft <= SCROLL_EDGE_PX) return 0;
  if (scrollLeft >= maxScroll - SCROLL_EDGE_PX) return n - 1;

  const focus = focusX(scrollLeft, viewportW, maxScroll);
  const distance = (index: number) => {
    const slide = slides[index]!;
    return Math.abs(slide.x + slide.w / 2 - focus);
  };
  let best = 0;
  let bestDistance = distance(0);
  for (let i = 1; i < n; i++) {
    const d = distance(i);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  if (valid !== null && valid !== best && distance(valid) - bestDistance <= hysteresis)
    return valid;
  return best;
}
