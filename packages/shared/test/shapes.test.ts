import { describe, expect, it } from 'vitest';
import {
  clamp01,
  clampPoint,
  distance,
  MIN_DRAG_DISTANCE,
  offsetInRect,
  rectArea,
  rectCenter,
} from '../src/geometry';
import {
  hitTestShapes,
  rectShapeRefAt,
  resolveRectAnchor,
  resolveShapeRef,
  shapeRefAt,
  shapeRefForRect,
} from '../src/shapes';
import type { Shape } from '../src/model';

const shape = (id: string, x: number, y: number, w: number, h: number): Shape => ({
  id,
  name: id,
  bbox: { x, y, w, h },
  text: '',
});

describe('geometry primitives', () => {
  it('clamps values and points to the slide', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(3)).toBe(1);
    expect(clampPoint({ x: -1, y: 2 })).toEqual({ x: 0, y: 1 });
  });

  it('computes centre, area and distance', () => {
    const rect = { x: 0.2, y: 0.4, w: 0.4, h: 0.2 };
    expect(rectCenter(rect).x).toBeCloseTo(0.4);
    expect(rectCenter(rect).y).toBeCloseTo(0.5);
    expect(rectArea(rect)).toBeCloseTo(0.08);
    expect(distance({ x: 0, y: 0 }, { x: 0.3, y: 0.4 })).toBeCloseTo(0.5);
    expect(MIN_DRAG_DISTANCE).toBe(0.01);
  });

  it('gives an offset of 0 inside a rect without width or height', () => {
    expect(offsetInRect({ x: 0.5, y: 0.5, w: 0, h: 0 }, { x: 0.7, y: 0.2 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe('hit-testing edge cases', () => {
  const shapes = [shape('a', 0, 0, 0.5, 0.5), shape('b', 0.25, 0.25, 0.25, 0.25)];

  it('finds nothing off every shape', () => {
    expect(hitTestShapes(shapes, { x: 0.9, y: 0.9 })).toBeNull();
    expect(shapeRefAt(shapes, { x: 0.9, y: 0.9 })).toBeNull();
    expect(rectShapeRefAt(shapes, { x: 0.8, y: 0.8, w: 0.1, h: 0.1 })).toBeNull();
    expect(hitTestShapes([], { x: 0.5, y: 0.5 })).toBeNull();
  });

  it('keeps the first of two shapes of equal size', () => {
    const twins = [shape('first', 0, 0, 0.5, 0.5), shape('second', 0, 0, 0.5, 0.5)];
    expect(hitTestShapes(twins, { x: 0.1, y: 0.1 })?.id).toBe('first');
  });

  it('references the point relative to the smallest shape', () => {
    const ref = shapeRefAt(shapes, { x: 0.375, y: 0.3 });
    expect(ref?.shapeId).toBe('b');
    expect(ref?.offset.x).toBeCloseTo(0.5);
    expect(ref?.offset.y).toBeCloseTo(0.2);
    expect(ref?.size).toBeUndefined();
  });

  it('resolves nothing when the shape is gone', () => {
    expect(resolveShapeRef(shapes, { shapeId: 'gone', offset: { x: 0.5, y: 0.5 } })).toBeNull();
  });
});

describe('shapeRefForRect', () => {
  it('falls back to a size of 1 for a shape without width or height', () => {
    const line = shape('line', 0.2, 0.5, 0.6, 0);
    const ref = shapeRefForRect(line, { x: 0.3, y: 0.45, w: 0.2, h: 0.1 });
    expect(ref.size?.w).toBeCloseTo(1 / 3);
    expect(ref.size?.h).toBe(1);
    expect(ref.offset.y).toBe(0);
  });
});

describe('resolveRectAnchor edge cases', () => {
  it('returns the stored rect itself while the shape is gone', () => {
    const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(resolveRectAnchor([], rect, { shapeId: 'x', offset: { x: 0.5, y: 0.5 } })).toBe(rect);
  });

  it('pushes a box that would stick out back onto the slide', () => {
    const corner = shape('corner', 0.8, 0.8, 0.2, 0.2);
    const resolved = resolveRectAnchor(
      [corner],
      { x: 0, y: 0, w: 0.2, h: 0.2 },
      { shapeId: 'corner', offset: { x: 1, y: 1 } },
    );
    expect(resolved.x).toBeCloseTo(0.8);
    expect(resolved.y).toBeCloseTo(0.8);
    expect(resolved.w).toBe(0.2);
    expect(resolved.h).toBe(0.2);
  });

  it('never grows a box past the slide', () => {
    const big = shape('big', 0.25, 0.25, 0.5, 0.5);
    const resolved = resolveRectAnchor(
      [big],
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { shapeId: 'big', offset: { x: 0.5, y: 0.5 }, size: { w: 3, h: 3 } },
    );
    expect(resolved).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
