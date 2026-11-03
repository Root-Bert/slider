import { describe, expect, it } from 'vitest';
import { isTilted, mirroredOnScreen, overTheEdge, projected } from './tilt-math';

describe('projected', () => {
  it('shows the side tilted away smaller, the near one larger, and counts what tilts', () => {
    expect(projected(30, -20, { x: 0, y: 0 }, 1000)).toEqual({ x: 30, y: -20, w: 1 });
    // y: its right side away.
    const right = projected(100, 50, { x: 0, y: 30 }, 1000);
    const left = projected(-100, 50, { x: 0, y: 30 }, 1000);
    expect(right.w).toBeGreaterThan(1);
    expect(Math.abs(right.y)).toBeLessThan(Math.abs(left.y));
    // x: its top away.
    const top = projected(80, -100, { x: 30, y: 0 }, 1000);
    const bottom = projected(80, 100, { x: 30, y: 0 }, 1000);
    expect(Math.abs(top.x)).toBeLessThan(Math.abs(bottom.x));
    expect(isTilted(null)).toBe(false);
    expect(isTilted({ x: 0, y: 0 })).toBe(false);
    expect(isTilted({ x: 0, y: 12 })).toBe(true);
  });
});

describe('over the edge', () => {
  const flat = { x: false, y: false };

  it('stores a tilt over the edge mirrored, and turns a mirrored element the other way', () => {
    expect(overTheEdge({ x: 20, y: -40 })).toEqual({ tilt: { x: 20, y: -40 }, mirror: null });
    // Over sideways: mirrored left to right.
    expect(overTheEdge({ x: 0, y: 110 })).toEqual({
      tilt: { x: 0, y: -70 },
      mirror: { x: true, y: false },
    });
    // Over its top: mirrored top to bottom; half a turn is flat, mirrored.
    expect(overTheEdge({ x: -180, y: 10 })).toEqual({
      tilt: { x: 0, y: 10 },
      mirror: { x: false, y: true },
    });

    expect(mirroredOnScreen(30, flat, { x: true, y: false })).toEqual({
      rotation: 330,
      flip: { x: true, y: false },
    });
    expect(mirroredOnScreen(0, { x: true, y: false }, { x: true, y: false })).toEqual({
      rotation: 0,
      flip: flat,
    });
    // Mirrored both ways (half a turn) it keeps its turn.
    expect(mirroredOnScreen(30, flat, { x: true, y: true })).toEqual({
      rotation: 30,
      flip: { x: true, y: true },
    });
  });
});
