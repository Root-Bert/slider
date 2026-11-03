import { describe, expect, it } from 'vitest';
import {
  hitTestShapes,
  rectShapeRefAt,
  rectShapeRefOver,
  resolveRectAnchor,
  shapeRefAt,
  type Shape,
} from '../src';

const picture: Shape = {
  id: '1',
  name: 'Bild',
  bbox: { x: 0.3, y: 0.1, w: 0.4, h: 0.8 },
  text: '',
};
const title: Shape = {
  id: '2',
  name: 'Titel',
  bbox: { x: 0.05, y: 0.5, w: 0.7, h: 0.12 },
  text: 'T',
};

describe('box targeting', () => {
  it('prefers the later box on equal overlap and uses the same portrait geometry for placing and reanchoring', () => {
    const top = { ...picture, id: 'top' };
    expect(hitTestShapes([picture, top], { x: 0.5, y: 0.5 })?.id).toBe('top');
    const shape = { ...title, bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.1 }, rotation: 90 };
    const aspect = 0.5;
    const point = { x: 0.5, y: 0.3 };
    const rect = { x: 0.495, y: 0.295, w: 0.01, h: 0.01 };
    // In portrait the rotated box is shorter than the default 16:9 version.
    expect(hitTestShapes([shape], point)).toBe(shape);
    expect(hitTestShapes([shape], point, aspect)).toBeNull();
    expect(shapeRefAt([shape], point, aspect)).toBeNull();
    expect(rectShapeRefAt([shape], rect, aspect)).toBeNull();
    expect(rectShapeRefOver([shape], rect, aspect)).toBeNull();
    const inside = { x: 0.495, y: 0.395, w: 0.01, h: 0.01 };
    expect(rectShapeRefAt([shape], inside, aspect)?.shapeId).toBe(shape.id);
  });
});

describe('rectShapeRefOver', () => {
  it('binds a box to the shape it covers best, not the one under its centre', () => {
    const rect = { x: 0.06, y: 0.49, w: 0.68, h: 0.14 };
    const ref = rectShapeRefOver([picture, title], rect);
    expect(ref?.shapeId).toBe('2');
    // The shape moved up: the box goes along.
    const moved = { ...title, bbox: { ...title.bbox, y: 0.1 } };
    const now = resolveRectAnchor([picture, moved], rect, ref!);
    expect(now.y).toBeCloseTo(0.09);
    expect(now.x).toBeCloseTo(rect.x);
    // Covering nothing well, it falls back to the shape under its centre, or none.
    const small = { x: 0.45, y: 0.2, w: 0.05, h: 0.05 };
    expect(rectShapeRefOver([picture, title], small)?.shapeId).toBe('1');
    expect(rectShapeRefOver([title], small)).toBeNull();
  });
});
