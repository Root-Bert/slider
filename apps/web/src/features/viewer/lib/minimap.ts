/**
 * Geometry of the minimap: a row of small thumbnails of the whole deck under the big track, with
 * a bracket showing which part of the track is in view (like a video timeline's overview). Pure
 * functions; the DOM is wired up in `timeline/Minimap.tsx`.
 *
 * Track and minimap are linked through "slide units" (`unitAt` / `xAt`): a point at 30 % of a
 * big slide maps to 30 % of its thumbnail, a point in a ⊕ gap to the gap between two thumbnails.
 */
import { unitAt, xAt, type TrackLayout } from './timeline-layout';

/** All thumbnails are this high, whatever the deck's length (64×36 for 16:9), 8px apart. */
export const THUMB_H = 36;
export const THUMB_GAP = 8;
/** Room around the thumbnails for the active frame and the bracket (each side). */
export const MINIMAP_PAD = 4;
/** The bracket never gets thinner than this, even for a tiny share of a long deck. */
export const BRACKET_MIN_W = 12;

export interface MinimapLayout {
  /** Thumbnail height (all thumbnails share it; widths follow their aspect ratio). */
  h: number;
  /** Thumbnail boxes, x from the row's content start. */
  slides: { x: number; w: number }[];
  /** Width of all thumbnails with the gaps between them. */
  contentW: number;
  /** True when the thumbnails don't fit the available width: the row scrolls. */
  scrolls: boolean;
}

/**
 * Thumbnails of a fixed height side by side: a short deck leaves the rest of the row free, a long
 * one scrolls when it is wider than `availableW`.
 */
export function layoutMinimap(aspectRatios: readonly number[], availableW: number): MinimapLayout {
  const h = THUMB_H;
  if (aspectRatios.length === 0) return { h, slides: [], contentW: 0, scrolls: false };
  const slides: MinimapLayout['slides'] = [];
  let x = 0;
  for (const ar of aspectRatios) {
    const w = Math.round(h * ar);
    slides.push({ x, w });
    x += w + THUMB_GAP;
  }
  const contentW = x - THUMB_GAP;
  return { h, slides, contentW, scrolls: contentW > availableW + 0.5 };
}

/**
 * The minimap in the shape of a track layout, so `unitAt` / `xAt` work on it. The gap after the
 * last thumbnail is virtual (it lies past `contentW`) and only keeps the unit maths finite.
 */
export function minimapAsTrack(mini: MinimapLayout): TrackLayout {
  return {
    h: mini.h,
    slides: mini.slides,
    gaps: mini.slides.map((slide) => ({ x: slide.x + slide.w, w: THUMB_GAP })),
    contentW: mini.contentW,
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export interface Bracket {
  /** From the row's content start. */
  left: number;
  width: number;
  /** The whole track is in view – the bracket would just frame everything. */
  all: boolean;
}

/** Where the track's visible part [scrollLeft, scrollLeft + viewportW] lies on the minimap. */
export function bracketFor(
  track: TrackLayout,
  mini: TrackLayout,
  scrollLeft: number,
  viewportW: number,
): Bracket {
  const all = track.contentW <= viewportW + 0.5;
  if (mini.slides.length === 0) return { left: 0, width: 0, all };
  const start = clamp(xAt(mini, unitAt(track, scrollLeft)), 0, mini.contentW);
  const end = clamp(xAt(mini, unitAt(track, scrollLeft + viewportW)), 0, mini.contentW);
  let width = Math.max(end - start, Math.min(BRACKET_MIN_W, mini.contentW));
  let left = start;
  // A minimum-width bracket at the end stays inside the row.
  if (left + width > mini.contentW) left = Math.max(0, mini.contentW - width);
  width = Math.min(width, mini.contentW - left);
  return { left, width, all };
}

/** Track scrollLeft that puts the bracket's centre at minimap x `centre` (dragging it). */
export function scrollLeftForBracket(
  track: TrackLayout,
  mini: TrackLayout,
  centre: number,
  viewportW: number,
): number {
  const x = xAt(track, unitAt(mini, clamp(centre, 0, mini.contentW)));
  return clamp(x - viewportW / 2, 0, track.contentW - viewportW);
}

/**
 * scrollLeft of the minimap row that keeps [left, left + width] in view with `margin` – unchanged
 * when it already is. A span wider than the row is aligned to its start.
 */
export function followScrollLeft(
  left: number,
  width: number,
  scrollLeft: number,
  clientW: number,
  maxScroll: number,
  margin = 24,
): number {
  let next = scrollLeft;
  if (width + 2 * margin >= clientW || left < scrollLeft + margin) next = left - margin;
  else if (left + width > scrollLeft + clientW - margin) next = left + width - clientW + margin;
  return clamp(next, 0, maxScroll);
}

/** Width of the zone at each end of the row where a dragged bracket scrolls the row along. */
export const EDGE_ZONE = 40;
/** Row scroll per frame with the pointer at (or past) the row's edge. */
export const EDGE_MAX_SPEED = 18;

/**
 * Per-frame scroll of the row while the bracket is dragged at `clientX`: negative near the left
 * edge, positive near the right one, faster the closer to (or further past) the edge; 0 between.
 */
export function edgeScrollSpeed(
  clientX: number,
  row: { left: number; right: number },
  zone = EDGE_ZONE,
  maxSpeed = EDGE_MAX_SPEED,
): number {
  const width = row.right - row.left;
  const z = Math.min(zone, width / 4);
  if (z <= 0) return 0;
  const depth =
    clientX < row.left + z
      ? -(row.left + z - clientX) / z
      : clientX > row.right - z
        ? (clientX - (row.right - z)) / z
        : 0;
  return Math.round(clamp(depth, -1, 1) * maxSpeed);
}
