/**
 * All on-slide geometry is stored normalised to the slide box (0–1 on both axes).
 * That keeps anchors pixel-exact at every zoom level and screen size (BER-96, BER-98).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const clampPoint = (point: Point): Point => ({ x: clamp01(point.x), y: clamp01(point.y) });

/** The part of a rect on the slide – elements may hang off it, anchors only live on it. */
export function clampRect(rect: Rect): Rect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(rect.w - (x - rect.x), 1 - x)),
    h: Math.max(0, Math.min(rect.h - (y - rect.y), 1 - y)),
  };
}

/** The rect's corners, clockwise from its top left. */
export const rectCorners = ({ x, y, w, h }: Rect): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Builds a normalised rect from two arbitrary corner points (e.g. drag start and end). */
export function rectFromPoints(a: Point, b: Point): Rect {
  const start = clampPoint(a);
  const end = clampPoint(b);
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

export const rectCenter = (rect: Rect): Point => ({
  x: rect.x + rect.w / 2,
  y: rect.y + rect.h / 2,
});

export const rectArea = (rect: Rect): number => rect.w * rect.h;

export const rectContains = (rect: Rect, point: Point): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.w &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.h;

/** Position of `point` relative to `rect`, where (0,0) is the rect's top-left and (1,1) its bottom-right. */
export const offsetInRect = (rect: Rect, point: Point): Point => ({
  x: rect.w === 0 ? 0 : (point.x - rect.x) / rect.w,
  y: rect.h === 0 ? 0 : (point.y - rect.y) / rect.h,
});

/** Inverse of {@link offsetInRect}. */
export const pointInRect = (rect: Rect, offset: Point): Point => ({
  x: rect.x + offset.x * rect.w,
  y: rect.y + offset.y * rect.h,
});

/** A drag shorter than this (in normalised units) counts as a click. */
export const MIN_DRAG_DISTANCE = 0.01;

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
