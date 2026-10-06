import { offsetInRect, pointInRect, rectArea, rectContains, type Point } from './geometry';
import type { Shape, ShapeRef } from './model';

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
