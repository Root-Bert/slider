import { clamp } from '@slider/shared';
/**
 * Geometry of the deck timeline: every slide side by side in one horizontal track, each slide's
 * comments in a column of exactly its width below it. The split handle between the slide area
 * and the comment area sets the slide height (`split` ∈ [0, 1], linear between the smallest and
 * the largest slide); the track is always exactly as tall as the slides, so dragging the handle
 * down makes the slides bigger and the comment area smaller, and up the other way round.
 * Pure functions; the DOM is measured in `useTimelineMetrics`.
 */

/** Content padding left and right of the timeline. */
export const TRACK_PAD_X = 16;
/** Room above the slides; the track itself is exactly as tall as its slides. */
export const TRACK_PAD_TOP = 16;
/**
 * The tracks stacked over and under the slides' – the band shows one of them at a time, swiped
 * up and down (`useTrackSwipe`): `above` variant tracks (the first variant of each slide right
 * over the slides, the second over that, …, and on an editable deck one more to make a variant
 * in), `below` the speaker notes. A track is named by its place: 0 the slides, -1 the first
 * variants, 1 the notes.
 */
export interface TrackStack {
  above: number;
  below: number;
}

export function trackStack(mostVariants: number, canEdit: boolean): TrackStack {
  return { above: mostVariants + (canEdit ? 1 : 0), below: canEdit ? 1 : 0 };
}

/** What track `track` holds, as its dot names it. */
export const trackName = (track: number): string =>
  track === 0 ? 'Folien' : track > 0 ? 'Notizen' : `Variante ${-track}`;

/** Desktop-1 slide height (982px wide at 16:9): the default split never makes slides taller. */
export const DEFAULT_SLIDE_H_MAX = 552;
/** Smallest slide height the split handle allows. */
export const MIN_SLIDE_H = 90;
/** At the default split the comment area keeps this share (Figma D1). */
export const COMMENT_DEFAULT_SHARE = 0.4;
/**
 * Column widths for full cards and compact cards; narrower columns show one bubble. Compact cards
 * start a bit above the slide-width floor so small slides show one bubble per slide.
 */
export const CARD_FULL_MIN = 260;
export const CARD_COMPACT_MIN = 140;
/** Visible peek of the next slide at the largest split. */
const PEEK_PX = 48;
const GAP_MIN = 20;
const GAP_MAX = 48;
const GAP_RATIO = 0.09;
/** Floor for degenerate viewports (smaller than the split limits allow). */
const ABSOLUTE_MIN_H = 40;

/** Width of the ⊕ divider after a slide of height `h`. */
export const gapWidth = (h: number) =>
  Math.min(GAP_MAX, Math.max(GAP_MIN, Math.round(GAP_RATIO * h)));

export interface TrackGeometry {
  /** Slide height with the handle at the top (`split` 0) … */
  hMin: number;
  /** … and at the bottom (`split` 1). */
  hMax: number;
  /** Slide height until the handle is first moved (and after a double click on it). */
  hDefault: number;
}

export function computeTrackGeometry({
  aspectRatios,
  viewportW,
  viewportH,
  controlsH,
  freedH = 0,
  narrow,
}: {
  aspectRatios: readonly number[];
  /** Usable timeline width (root width without scrollbar, not shrunk by the thread panel). */
  viewportW: number;
  viewportH: number;
  /** Height of the band between track and comments: minimap, controls row and split handle. */
  controlsH: number;
  /**
   * Height a folded minimap frees (`controlsH` still counts it): the slides take all of it, so
   * the comment area stays where it is – at the default only as far as the width allows.
   */
  freedH?: number;
  narrow: boolean;
}): TrackGeometry {
  const ars = aspectRatios.length > 0 ? aspectRatios : [16 / 9];
  const arMax = Math.max(...ars);
  const inner = viewportW - 2 * TRACK_PAD_X;
  const chrome = TRACK_PAD_TOP + controlsH;

  // Phones: one slide fills the width, no handle.
  if (narrow) {
    const h = Math.max(ABSOLUTE_MIN_H, Math.min(DEFAULT_SLIDE_H_MAX, inner / arMax));
    return { hMin: h, hMax: h, hDefault: h };
  }

  // The handle at the bottom: the slides take the whole height and the comment area is gone –
  // wider than the window if need be, the track scrolls sideways anyway. Only the default keeps
  // the widest slide within the width, with room for its divider and a peek of the next slide.
  const widthLimit = Math.floor((inner - GAP_MAX - PEEK_PX) / arMax);
  const largest = Math.max(ABSOLUTE_MIN_H, viewportH - chrome);
  const hMin = Math.min(MIN_SLIDE_H, largest);
  const hMax = Math.max(hMin, largest);
  const defaultLimit = Math.floor((1 - COMMENT_DEFAULT_SHARE) * viewportH) - chrome;
  const hDefault = clamp(Math.min(DEFAULT_SLIDE_H_MAX, defaultLimit, widthLimit), hMin, hMax);
  return {
    hMin: hMin + freedH,
    hMax: hMax + freedH,
    hDefault: hDefault + Math.max(0, Math.min(freedH, widthLimit - hDefault)),
  };
}

/** Slide height at `split` (0 = handle at the top, 1 = at the bottom, `null` = default). */
export function slideHeightAt(split: number | null, geo: TrackGeometry): number {
  if (split === null) return geo.hDefault;
  return geo.hMin + clamp(split, 0, 1) * (geo.hMax - geo.hMin);
}

/** Split that gives slide height `h`, clamped to 0..1. */
export function splitForHeight(h: number, geo: TrackGeometry): number {
  if (geo.hMax <= geo.hMin) return 1;
  return clamp((h - geo.hMin) / (geo.hMax - geo.hMin), 0, 1);
}

/** The split as a number – the default resolved for this geometry. */
export const resolvedSplit = (split: number | null, geo: TrackGeometry) =>
  split ?? splitForHeight(geo.hDefault, geo);

export interface TrackLayout {
  h: number;
  slides: { x: number; w: number }[];
  /** The divider after slide i (one per slide, the last one is "after the last slide"). */
  gaps: { x: number; w: number }[];
  contentW: number;
  /** Extra slot after the last divider – the "Gelöschte Folien" entry (BER-109). */
  trailing?: { x: number; w: number };
  /** Folie 0, „Material“: the deck's board before the first slide, a divider's width apart. */
  leading?: { x: number; w: number };
}

/** Width of the "Gelöschte Folien" slot at the end of a track of slide height `h`. */
export const trailingWidth = (h: number) => Math.round(Math.min(260, Math.max(112, h * 0.6)));

/** Width of the board (Folie 0) on a track of slide height `h`: a 16:9 slide's. */
export const leadingWidth = (h: number) => Math.round((h * 16) / 9);

export function layoutTrack(
  aspectRatios: readonly number[],
  h: number,
  /** Width of a slot after the last slide's divider; 0 = none. */
  trailingW = 0,
  /** Width of the board before the first slide (Folie 0); 0 = none. */
  leadingW = 0,
): TrackLayout {
  const g = gapWidth(h);
  const slides: TrackLayout['slides'] = [];
  const gaps: TrackLayout['gaps'] = [];
  const leading = leadingW > 0 ? { x: TRACK_PAD_X, w: leadingW } : undefined;
  let x = TRACK_PAD_X + (leading ? leadingW + g : 0);
  for (const ar of aspectRatios) {
    const w = h * ar;
    slides.push({ x, w });
    gaps.push({ x: x + w, w: g });
    x += w + g;
  }
  const lead = leading ? { leading } : {};
  if (trailingW <= 0) return { h, slides, gaps, contentW: x + TRACK_PAD_X, ...lead };
  return {
    h,
    slides,
    gaps,
    trailing: { x, w: trailingW },
    contentW: x + trailingW + TRACK_PAD_X,
    ...lead,
  };
}

/** Share of a slot (slide + gap) in unit space that belongs to the slide. */
const SLIDE_SHARE = 0.85;

/**
 * Position in "slide units": slot i spans [i, i + 1) – the slide maps linearly onto the first
 * 85 %, its gap onto the rest – so a point keeps its fraction across the slide at every slide size.
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

export type RevealAlign = 'nearest' | 'center' | 'start' | 'end';
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
  else if (align === 'end') left = slide.x + slide.w + TRACK_PAD_X - viewportW;
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

/** Room kept free between two comment columns grown towards each other: lines to lower bands run down there. */
export const COLUMN_SPACING = 48;

/**
 * Where each slide's comment column sits. As wide as its slide – unless its cards want more
 * (`wanted`, 0 = no comments): then it grows into the free room beside the slide, at most up to
 * halfway to the next column with comments, centred under the slide where it can. Slides and
 * gaps with comments (`gapTaken`) keep their room.
 */
export function columnSpans(
  layout: TrackLayout,
  wanted: (index: number) => number,
  gapTaken: (index: number) => boolean,
): { x: number; w: number }[] {
  // Occupied stretches of the track in order: slides with comments, gaps with comments.
  const taken: { left: number; right: number; slide: number | null }[] = [];
  layout.slides.forEach((box, index) => {
    if (wanted(index) > 0) taken.push({ left: box.x, right: box.x + box.w, slide: index });
    const gap = layout.gaps[index];
    if (gap && gapTaken(index)) taken.push({ left: gap.x, right: gap.x + gap.w, slide: null });
  });
  const spans = layout.slides.map((box) => ({ x: box.x, w: box.w }));
  taken.forEach((stretch, at) => {
    if (stretch.slide === null) return;
    const box = layout.slides[stretch.slide]!;
    const prev = taken[at - 1];
    const next = taken[at + 1];
    const left = Math.min(box.x, prev ? (prev.right + box.x + COLUMN_SPACING) / 2 : TRACK_PAD_X);
    const right = Math.max(
      box.x + box.w,
      next ? (box.x + box.w + next.left - COLUMN_SPACING) / 2 : layout.contentW - TRACK_PAD_X,
    );
    const w = clamp(wanted(stretch.slide), box.w, right - left);
    spans[stretch.slide] = { x: clamp(box.x + box.w / 2 - w / 2, left, right - w), w };
  });
  return spans;
}

/** Smallest split at which a column is at least `width` wide (for a slide of aspect `ar`). */
export const splitForWidth = (width: number, ar: number, geo: TrackGeometry) =>
  splitForHeight(width / ar, geo);

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

/**
 * Room above the cards for the connector bus rows: 10px top (8px below the header, 2px slack),
 * 10px per line, 14px above the cards – the top card sits close under the controls row.
 */
export const busRoom = (lines: number) => Math.max(24, 10 + 10 * Math.max(0, lines - 1) + 14);
