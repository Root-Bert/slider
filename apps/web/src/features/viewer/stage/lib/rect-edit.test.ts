import { describe, expect, it } from 'vitest';
import { MIN_RECT_SIZE, moved, resized } from './rect-edit';

const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

describe('moved', () => {
  it('shifts the box and keeps it on the slide', () => {
    const shifted = moved(start, 0.1, -0.1);
    expect(shifted.x).toBeCloseTo(0.3);
    expect(shifted.y).toBeCloseTo(0.1);
    expect(shifted).toMatchObject({ w: 0.4, h: 0.4 });
    const pushed = moved(start, 1, 1);
    expect(pushed.x).toBeCloseTo(0.6);
    expect(pushed.y).toBeCloseTo(0.6);
    expect(moved(start, -1, -1)).toMatchObject({ x: 0, y: 0 });
  });
});

describe('resized', () => {
  it.each([
    ['se', 0.8, 0.9, { x: 0.2, y: 0.2, w: 0.6, h: 0.7 }],
    ['nw', 0.1, 0.1, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }],
    ['ne', 0.7, 0.1, { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }],
    ['sw', 0.1, 0.7, { x: 0.1, y: 0.2, w: 0.5, h: 0.5 }],
  ] as const)('drags the %s corner, the opposite one fixed', (corner, px, py, expected) => {
    const rect = resized(start, corner, px, py);
    expect(rect.x).toBeCloseTo(expected.x);
    expect(rect.y).toBeCloseTo(expected.y);
    expect(rect.w).toBeCloseTo(expected.w);
    expect(rect.h).toBeCloseTo(expected.h);
  });

  it('never goes below the minimum size past the opposite corner', () => {
    const rect = resized(start, 'se', 0, 0);
    expect(rect.w).toBeCloseTo(MIN_RECT_SIZE.w);
    expect(rect.h).toBeCloseTo(MIN_RECT_SIZE.h);
    expect(resized(start, 'nw', 1, 1, { w: 0.1, h: 0.1 }).w).toBeCloseTo(0.1);
  });

  it('clamps the pointer to the slide', () => {
    expect(resized(start, 'se', 2, 2)).toMatchObject({ w: 0.8, h: 0.8 });
    expect(resized(start, 'nw', -1, -1)).toMatchObject({ x: 0, y: 0 });
  });
});
