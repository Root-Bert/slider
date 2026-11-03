import { rectContains, type Point, type Rect } from './geometry';

/*
 * A slide element's box as it shows: turned in its plane (`rotation`, degrees clockwise around
 * its centre), then tilted in depth (`tilt`, degrees around the slide's horizontal and vertical
 * axis) and seen in perspective – the same wherever it is drawn or hit: in box mode, while
 * editing, in the picture written into the file.
 */

/** A tilt in depth: its top away (`x`), its right side away (`y`), degrees. */
export interface BoxTilt {
  x: number;
  y: number;
}

/** A box on the slide, maybe turned and tilted. */
export interface TurnedBox {
  bbox: Rect;
  rotation?: number;
  tilt?: BoxTilt | null;
}

/** How far the eye is from the slide, in slide widths. */
export const TILT_DEPTH = 2;

/** A slide's width over its height when nothing else is known. */
export const DEFAULT_ASPECT = 16 / 9;

/** Whether a tilt tilts at all. */
export const isTilted = (tilt: BoxTilt | null | undefined): tilt is BoxTilt =>
  !!tilt && (Math.abs(tilt.x) > 0.05 || Math.abs(tilt.y) > 0.05);

/** Whether the box shows other than as its plain rect. */
export const isTurned = (box: TurnedBox): boolean => !!box.rotation || isTilted(box.tilt);

/**
 * A point (`x`, `y` from the centre, in any unit with `depth` in it too) tilted and seen in
 * perspective: where it shows, and how far it lies (the perspective's divisor, 1 in the slide).
 * CSS's `perspective(depth) rotateX(x) rotateY(y)`.
 */
export function projected(
  x: number,
  y: number,
  tilt: BoxTilt,
  depth: number,
): { x: number; y: number; w: number } {
  const ax = (tilt.x * Math.PI) / 180;
  const ay = (tilt.y * Math.PI) / 180;
  // Turned around y first, then around x (y down, z to the eye).
  const x1 = x * Math.cos(ay);
  const z1 = -x * Math.sin(ay);
  const y2 = y * Math.cos(ax) - z1 * Math.sin(ax);
  const z2 = y * Math.sin(ax) + z1 * Math.cos(ax);
  const w = (depth - z2) / depth;
  return { x: x1 / w, y: y2 / w, w };
}

/**
 * The box's corners as they show on the slide (normalised), clockwise from its top left.
 * `aspect`: the slide's width over its height – turning happens in true proportions.
 */
export function turnedCorners(box: TurnedBox, aspect = DEFAULT_ASPECT): Point[] {
  const { bbox, rotation = 0, tilt } = box;
  const cx = (bbox.x + bbox.w / 2) * aspect;
  const cy = bbox.y + bbox.h / 2;
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = (bbox.w * aspect) / 2;
  const hh = bbox.h / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([lx, ly]) => {
    // Turned clockwise as seen (y down), then tilted.
    let x = lx! * cos - ly! * sin;
    let y = lx! * sin + ly! * cos;
    if (isTilted(tilt)) ({ x, y } = projected(x, y, tilt, TILT_DEPTH * aspect));
    return { x: (cx + x) / aspect, y: cy + y };
  });
}

/** Whether `point` lies inside the (convex) polygon `corners`. */
function insideConvex(point: Point, corners: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) < 1e-12) continue;
    const side = Math.sign(cross);
    if (sign === 0) sign = side;
    else if (side !== sign) return false;
  }
  return true;
}

/** Whether `point` lies on the box as it shows. */
export function turnedBoxContains(box: TurnedBox, point: Point, aspect = DEFAULT_ASPECT): boolean {
  return isTurned(box)
    ? insideConvex(point, turnedCorners(box, aspect))
    : rectContains(box.bbox, point);
}
