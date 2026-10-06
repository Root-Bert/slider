import { describe, expect, it } from 'vitest';
import { appendPoint, arrowPath, smoothPath, strokesBounds } from './stroke-path';

describe('smoothPath', () => {
  it('handles degenerate input', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 0.1, y: 0.2 }])).toBe('M0.1 0.2');
    expect(
      smoothPath([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe('M0 0L1 1');
  });

  it('uses inner points as quadratic control points through the midpoints', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(d).toBe('M0 0Q0.5 0 0.75 0.5L1 1');
  });
});

describe('arrowPath', () => {
  it('draws the shaft and two symmetric head wings ending at the tip', () => {
    const d = arrowPath(
      [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
      1,
    );
    expect(d.startsWith('M0 0.5L1 0.5M')).toBe(true);
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [, , , , leftX, leftY, tipX, tipY, rightX, rightY] = numbers;
    expect([tipX, tipY]).toEqual([1, 0.5]);
    expect(leftX).toBeCloseTo(rightX!);
    expect(leftY! - 0.5).toBeCloseTo(0.5 - rightY!);
  });
});

describe('appendPoint', () => {
  it('skips points closer than the minimum distance', () => {
    const points = [{ x: 0, y: 0 }];
    expect(appendPoint(points, { x: 0.0001, y: 0 })).toBe(points);
    expect(appendPoint(points, { x: 0.1, y: 0 })).toHaveLength(2);
  });
});

it('computes the bounds of all strokes', () => {
  expect(strokesBounds([])).toBeNull();
  expect(
    strokesBounds([
      {
        points: [
          { x: 0.2, y: 0.4 },
          { x: 0.5, y: 0.1 },
        ],
      },
      { points: [{ x: 0.1, y: 0.3 }] },
    ]),
  ).toMatchObject({ x: 0.1, y: 0.1, w: 0.4 });
});
