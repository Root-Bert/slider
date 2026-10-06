import { describe, expect, it } from 'vitest';
import { offsetInRect, pointInRect, rectContains, rectFromPoints } from '../src/geometry';
import { hitTestShapes, resolveShapeRef, shapeRefAt } from '../src/shapes';
import type { Shape } from '../src/model';

describe('rectFromPoints', () => {
  it('normalises a drag in any direction', () => {
    expect(rectFromPoints({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 })).toEqual({
      x: 0.2,
      y: 0.3,
      w: expect.closeTo(0.4),
      h: expect.closeTo(0.5),
    });
  });

  it('clamps points dragged outside the slide', () => {
    expect(rectFromPoints({ x: -0.2, y: 0.5 }, { x: 1.4, y: 0.7 })).toEqual({
      x: 0,
      y: 0.5,
      w: 1,
      h: expect.closeTo(0.2),
    });
  });
});

describe('offsetInRect / pointInRect', () => {
  const rect = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };

  it('round-trips a point through the relative offset', () => {
    const point = { x: 0.3, y: 0.35 };
    const offset = offsetInRect(rect, point);
    expect(offset.x).toBeCloseTo(0.25);
    expect(offset.y).toBeCloseTo(0.75);
    const back = pointInRect(rect, offset);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it('follows a moved shape (BER-111)', () => {
    const offset = offsetInRect(rect, { x: 0.4, y: 0.3 });
    const moved = { ...rect, x: 0.5, y: 0.6 };
    expect(pointInRect(moved, offset)).toEqual({ x: expect.closeTo(0.7), y: expect.closeTo(0.7) });
  });

  it('includes the edges in rectContains', () => {
    expect(rectContains(rect, { x: 0.2, y: 0.4 })).toBe(true);
    expect(rectContains(rect, { x: 0.61, y: 0.3 })).toBe(false);
  });
});

describe('shape hit-testing', () => {
  const shapes: Shape[] = [
    { id: '4', name: 'Bild', bbox: { x: 0, y: 0, w: 1, h: 0.7 }, text: '' },
    {
      id: '2',
      name: 'Titel',
      bbox: { x: 0.05, y: 0.5, w: 0.4, h: 0.1 },
      text: 'Presentation title',
    },
  ];

  it('prefers the smallest shape under the point', () => {
    expect(hitTestShapes(shapes, { x: 0.1, y: 0.55 })?.id).toBe('2');
    expect(hitTestShapes(shapes, { x: 0.8, y: 0.2 })?.id).toBe('4');
    expect(hitTestShapes(shapes, { x: 0.8, y: 0.9 })).toBeNull();
  });

  it('resolves a shape reference back to slide coordinates', () => {
    const ref = shapeRefAt(shapes, { x: 0.25, y: 0.55 });
    expect(ref?.shapeId).toBe('2');
    expect(resolveShapeRef(shapes, ref!)).toEqual({
      x: expect.closeTo(0.25),
      y: expect.closeTo(0.55),
    });
    expect(resolveShapeRef([], ref!)).toBeNull();
  });
});
