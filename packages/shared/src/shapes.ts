import {
  offsetInRect,
  pointInRect,
  rectArea,
  rectCenter,
  rectContains,
  type Point,
  type Rect,
} from './geometry';
import type { Guide, Shape, ShapeRef } from './model';

/**
 * Finds the shape under a point, preferring the smallest (most specific) one.
 * Used when placing an anchor so it can follow the object across revisions (BER-98, BER-111).
 */
export function hitTestShapes(shapes: readonly Shape[], point: Point): Shape | null {
  let best: Shape | null = null;
  for (const shape of shapes) {
    if (!rectContains(shape.bbox, point)) continue;
    if (!best || rectArea(shape.bbox) < rectArea(best.bbox)) best = shape;
  }
  return best;
}

export function shapeRefAt(shapes: readonly Shape[], point: Point): ShapeRef | null {
  const shape = hitTestShapes(shapes, point);
  return shape ? { shapeId: shape.id, offset: offsetInRect(shape.bbox, point) } : null;
}

/** Resolves a shape reference back to slide coordinates, or `null` when the shape is gone. */
export function resolveShapeRef(shapes: readonly Shape[], ref: ShapeRef): Point | null {
  const shape = shapes.find((candidate) => candidate.id === ref.shapeId);
  return shape ? pointInRect(shape.bbox, ref.offset) : null;
}

/** Binds a box to `shape`: its centre and size relative to the shape's bounds. */
export function shapeRefForRect(shape: Shape, rect: Rect): ShapeRef {
  const { bbox } = shape;
  return {
    shapeId: shape.id,
    offset: offsetInRect(bbox, rectCenter(rect)),
    size: { w: bbox.w > 0 ? rect.w / bbox.w : 1, h: bbox.h > 0 ? rect.h / bbox.h : 1 },
  };
}

/** Binds a box to the shape under its centre, or `null` when there is none. */
export function rectShapeRefAt(shapes: readonly Shape[], rect: Rect): ShapeRef | null {
  const shape = hitTestShapes(shapes, rectCenter(rect));
  return shape ? shapeRefForRect(shape, rect) : null;
}

/**
 * Where a bound box sits now: around its shape's current place, scaled with it (with `size`) or
 * just moved along (older boxes). The stored `rect` while the shape is gone.
 */
export function resolveRectAnchor(shapes: readonly Shape[], rect: Rect, ref: ShapeRef): Rect {
  const shape = shapes.find((candidate) => candidate.id === ref.shapeId);
  if (!shape) return rect;
  const { bbox } = shape;
  const center = pointInRect(bbox, ref.offset);
  const w = Math.min(1, ref.size ? ref.size.w * bbox.w : rect.w);
  const h = Math.min(1, ref.size ? ref.size.h * bbox.h : rect.h);
  return {
    x: Math.min(Math.max(0, center.x - w / 2), 1 - w),
    y: Math.min(Math.max(0, center.y - h / 2), 1 - h),
    w,
    h,
  };
}

/** Shapes may sit this close past a guide (normalised, ≈ 3 px on a 1280 px slide). */
const GUIDE_TOLERANCE = 0.0025;
/** Within this of the slide's edge a shape bleeds off it – crossing the margin on purpose. */
const BLEED = 0.005;

export interface GuideOverflow {
  shape: Shape;
  /** The parts of the shape beyond the outer guides, in slide coordinates. */
  overflow: Rect[];
}

/**
 * Shapes that cross the outer guides: per direction with at least two guides, the outermost pair
 * marks the margins, and a shape straddling one of them sticks out. Inner guides (centre lines,
 * columns) are crossed on purpose by wider boxes and do not count; neither do shapes entirely
 * outside the margins (footers, page numbers) or bleeding off the slide on that side
 * (backgrounds, edge-to-edge pictures).
 */
export function guideOverflows(
  shapes: readonly Shape[],
  guides: readonly Guide[],
): GuideOverflow[] {
  const margins = (orientation: Guide['orientation']): [number, number] | null => {
    const positions = guides
      .filter((guide) => guide.orientation === orientation)
      .map((guide) => guide.position);
    return positions.length >= 2 ? [Math.min(...positions), Math.max(...positions)] : null;
  };
  const vertical = margins('vertical');
  const horizontal = margins('horizontal');
  if (!vertical && !horizontal) return [];

  const crosses = (start: number, end: number, line: number) =>
    start < line - GUIDE_TOLERANCE && end > line + GUIDE_TOLERANCE;
  const bleedsBefore = (start: number) => start <= BLEED;
  const bleedsAfter = (end: number) => end >= 1 - BLEED;

  const result: GuideOverflow[] = [];
  for (const shape of shapes) {
    const { x, y, w, h } = shape.bbox;
    const overflow: Rect[] = [];
    if (vertical) {
      const [left, right] = vertical;
      if (crosses(x, x + w, left) && !bleedsBefore(x)) overflow.push({ x, y, w: left - x, h });
      if (crosses(x, x + w, right) && !bleedsAfter(x + w))
        overflow.push({ x: right, y, w: x + w - right, h });
    }
    if (horizontal) {
      const [top, bottom] = horizontal;
      if (crosses(y, y + h, top) && !bleedsBefore(y)) overflow.push({ x, y, w, h: top - y });
      if (crosses(y, y + h, bottom) && !bleedsAfter(y + h))
        overflow.push({ x, y: bottom, w, h: y + h - bottom });
    }
    if (overflow.length > 0) result.push({ shape, overflow });
  }
  return result;
}
