/**
 * Geometry of the deck timeline: every slide side by side in one horizontal track, each slide's
 * comments in a column of exactly its width below it. Zoom (`t` ∈ [0, 1], log scale) only
 * changes the slide height inside a track of fixed height, so the comment area never moves.
 * Pure functions; the DOM is measured in `useTimelineMetrics`.
 */

/** Content padding left and right of the timeline. */
export const TRACK_PAD_X = 16;
/** Room above and below the slides at max zoom. */
export const TRACK_PAD_Y = 16;
/** Desktop-1 slide height (982px wide at 16:9). */
export const MAX_SLIDE_H = 552;
/**
 * Narrowest slide. Min zoom fits the whole deck into the viewport when that keeps slides at least
 * this wide; a longer deck scrolls instead of shrinking further.
 */
export const MIN_SLIDE_W = 120;
/** The comment area keeps at least this share of the viewport height. */
export const COMMENT_MIN_SHARE = 0.4;
/**
 * Column widths for full cards and compact cards; narrower columns show one bubble. Compact cards
 * start a bit above the slide-width floor so the overview at min zoom shows one bubble per slide.
 */
export const CARD_FULL_MIN = 260;
export const CARD_COMPACT_MIN = 140;
/** Visible peek of the next slide at max zoom. */
const PEEK_PX = 48;
const GAP_MIN = 24;
const GAP_MAX = 88;
const GAP_RATIO = 0.16;

/** Width of the ⊕ divider after a slide of height `h`. */
export const gapWidth = (h: number) =>
  Math.min(GAP_MAX, Math.max(GAP_MIN, Math.round(GAP_RATIO * h)));

export interface TrackGeometry {
  /** Fixed height of the track – independent of zoom. */
  trackH: number;
  hMin: number;
  hMax: number;
}

export function computeTrackGeometry({
  aspectRatios,
  viewportW,
  viewportH,
  controlsH,
  narrow,
}: {
  aspectRatios: readonly number[];
  /** Usable timeline width (root width without scrollbar, not shrunk by the thread panel). */
  viewportW: number;
  viewportH: number;
  controlsH: number;
  narrow: boolean;
}): TrackGeometry {
  const ars = aspectRatios.length > 0 ? aspectRatios : [16 / 9];
  const arMax = Math.max(...ars);
  const arMin = Math.min(...ars);
  const n = ars.length;
  const sumAr = ars.reduce((sum, ar) => sum + ar, 0);
  const inner = viewportW - 2 * TRACK_PAD_X;

  const heightLimit = Math.floor((1 - COMMENT_MIN_SHARE) * viewportH) - controlsH - 2 * TRACK_PAD_Y;
  const widthLimit = narrow
    ? inner / arMax
    : Math.floor((inner - gapWidth(MAX_SLIDE_H) - PEEK_PX) / arMax);
  const hMax = Math.max(
    40,
    narrow ? Math.min(MAX_SLIDE_H, widthLimit) : Math.min(MAX_SLIDE_H, heightLimit, widthLimit),
  );
  const trackH = Math.round(hMax + 2 * TRACK_PAD_Y);
  if (narrow) return { trackH, hMin: hMax, hMax };

  // Largest h whose whole deck fits the viewport (content width is monotonic in h).
  let lo = 0;
  let hi = MAX_SLIDE_H;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (contentWidth(sumAr, n, mid) <= viewportW) lo = mid;
    else hi = mid;
  }
  const hFit = lo;
  const hMin = Math.min(hMax, Math.max(hFit, MIN_SLIDE_W / arMin));
  return { trackH, hMin, hMax };
}

/** Exact continuous content width; layoutTrack rounds the gaps the same way. */
const contentWidth = (sumAr: number, n: number, h: number) =>
  2 * TRACK_PAD_X + sumAr * h + n * gapWidth(h);

/** Slide height at zoom `t` (0 = whole deck, 1 = Desktop-1). */
export function slideHeightAt(t: number, geo: TrackGeometry): number {
  if (geo.hMax <= geo.hMin) return geo.hMax;
  const clamped = Math.min(1, Math.max(0, t));
  return geo.hMin * (geo.hMax / geo.hMin) ** clamped;
}

/** Zoom that gives slide height `h`, clamped to 0..1. */
export function zoomForHeight(h: number, geo: TrackGeometry): number {
  if (geo.hMax <= geo.hMin) return 1;
  const t = Math.log(h / geo.hMin) / Math.log(geo.hMax / geo.hMin);
  return Math.min(1, Math.max(0, t));
}

export interface TrackLayout {
  h: number;
  slides: { x: number; w: number }[];
  /** The divider after slide i (one per slide, the last one is "after the last slide"). */
  gaps: { x: number; w: number }[];
  contentW: number;
}

export function layoutTrack(aspectRatios: readonly number[], h: number): TrackLayout {
  const g = gapWidth(h);
  const slides: TrackLayout['slides'] = [];
  const gaps: TrackLayout['gaps'] = [];
  let x = TRACK_PAD_X;
  for (const ar of aspectRatios) {
    const w = h * ar;
    slides.push({ x, w });
    gaps.push({ x: x + w, w: g });
    x += w + g;
  }
  return { h, slides, gaps, contentW: x + TRACK_PAD_X };
}

/** Share of a slot (slide + gap) in unit space that belongs to the slide. */
const SLIDE_SHARE = 0.85;

/**
 * Position in "slide units": slot i spans [i, i + 1) – the slide maps linearly onto the first
 * 85 %, its gap onto the rest – so a point keeps its fraction across the slide at every zoom.
 * Before the first slide the value is negative, past the last gap it exceeds n.
 */
export function unitAt(layout: TrackLayout, x: number): number {
  const n = layout.slides.length;
  if (n === 0) return 0;
  const first = layout.slides[0]!;
  if (x < first.x) return ((x - first.x) / first.w) * SLIDE_SHARE;
  for (let i = 0; i < n; i++) {
    const slide = layout.slides[i]!;
    const gap = layout.gaps[i]!;
    if (x < slide.x + slide.w) return i + ((x - slide.x) / slide.w) * SLIDE_SHARE;
    if (x < gap.x + gap.w || i === n - 1)
      return i + SLIDE_SHARE + ((x - gap.x) / gap.w) * (1 - SLIDE_SHARE);
  }
  return n;
}

/** Inverse of `unitAt`. */
export function xAt(layout: TrackLayout, u: number): number {
  const n = layout.slides.length;
  if (n === 0) return 0;
  const first = layout.slides[0]!;
  if (u < 0) return first.x + (u / SLIDE_SHARE) * first.w;
  const i = Math.min(n - 1, Math.floor(u));
  const slide = layout.slides[i]!;
  const gap = layout.gaps[i]!;
  const fraction = u - i;
  if (fraction < SLIDE_SHARE) return slide.x + (fraction / SLIDE_SHARE) * slide.w;
  return gap.x + ((fraction - SLIDE_SHARE) / (1 - SLIDE_SHARE)) * gap.w;
}

const clampScroll = (left: number, layout: TrackLayout, viewportW: number) =>
  Math.max(0, Math.min(Math.max(0, layout.contentW - viewportW), left));

/** scrollLeft that keeps the content point under `viewportX` over the same slide fraction. */
export function anchoredScrollLeft(
  prev: TrackLayout,
  next: TrackLayout,
  contentX: number,
  viewportX: number,
  viewportW: number,
): number {
  return clampScroll(xAt(next, unitAt(prev, contentX)) - viewportX, next, viewportW);
}

export type RevealAlign = 'nearest' | 'center' | 'start';
/** Margin kept around a slide revealed with `nearest`. */
export const REVEAL_MARGIN = 48;

export function revealScrollLeft(
  layout: TrackLayout,
  index: number,
  scrollLeft: number,
  viewportW: number,
  align: RevealAlign,
): number {
  const slide = layout.slides[index];
  if (!slide) return scrollLeft;
  let left = scrollLeft;
  if (align === 'center') left = slide.x + slide.w / 2 - viewportW / 2;
  else if (align === 'start') left = slide.x - TRACK_PAD_X;
  else {
    const margin = Math.min(REVEAL_MARGIN, Math.max(0, (viewportW - slide.w) / 2));
    if (slide.x < scrollLeft + margin) left = slide.x - margin;
    else if (slide.x + slide.w > scrollLeft + viewportW - margin)
      left = slide.x + slide.w - viewportW + margin;
  }
  return clampScroll(left, layout, viewportW);
}

export type CardMode = 'full' | 'compact' | 'bubble';

export const cardMode = (columnWidth: number): CardMode =>
  columnWidth >= CARD_FULL_MIN ? 'full' : columnWidth >= CARD_COMPACT_MIN ? 'compact' : 'bubble';

/** Smallest zoom at which a column is at least `width` wide (for a slide of aspect `ar`). */
export const zoomForWidth = (width: number, ar: number, geo: TrackGeometry) =>
  zoomForHeight(Math.min(geo.hMax, width / ar), geo);

/**
 * Index range of slides (with their gap) intersecting [scrollLeft - overscan, scrollLeft +
 * viewportW + overscan]; overscan defaults to one viewport on each side.
 */
export function visibleRange(
  layout: TrackLayout,
  scrollLeft: number,
  viewportW: number,
  overscan = viewportW,
): { first: number; last: number } {
  const n = layout.slides.length;
  if (n === 0) return { first: 0, last: -1 };
  const from = scrollLeft - overscan;
  const to = scrollLeft + viewportW + overscan;
  let first = 0;
  while (first < n - 1 && layout.gaps[first]!.x + layout.gaps[first]!.w < from) first++;
  let last = first;
  while (last < n - 1 && layout.slides[last + 1]!.x <= to) last++;
  return { first, last };
}

/** Room above the cards for the connector bus rows: 18px top, 10px per line, 20px above cards. */
export const busRoom = (lines: number) => Math.max(48, 18 + 10 * Math.max(0, lines - 1) + 20);
