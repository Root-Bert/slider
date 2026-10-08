import {
  offsetInRect,
  pointInRect,
  rectArea,
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
