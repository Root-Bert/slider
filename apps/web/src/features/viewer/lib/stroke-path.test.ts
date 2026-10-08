import { describe, expect, it } from 'vitest';
import {
  appendPoint,
  arrowPath,
  ellipsePath,
  rectPath,
  smoothPath,
  strokeOutline,
  strokesBounds,
} from './stroke-path';

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
        tool: 'pen',
        color: 'red',
        points: [
          { x: 0.2, y: 0.4 },
          { x: 0.5, y: 0.1 },
        ],
      },
      { tool: 'pen', color: 'red', points: [{ x: 0.1, y: 0.3 }] },
    ]),
  ).toMatchObject({ x: 0.1, y: 0.1, w: 0.4 });
});

it('draws rectangles and ellipses from two opposite corners', () => {
  const corners = [
    { x: 0.6, y: 0.5 },
    { x: 0.2, y: 0.1 },
  ];
  expect(rectPath(corners)).toBe('M0.2 0.1H0.6V0.5H0.2Z');
  expect(ellipsePath(corners)).toBe('M0.2 0.3A0.2 0.2 0 1 0 0.6 0.3A0.2 0.2 0 1 0 0.2 0.3Z');
});

it('outlines shapes and text boxes by their edge midpoints', () => {
  const ellipse = {
    tool: 'ellipse' as const,
    color: 'red' as const,
    points: [
      { x: 0.2, y: 0.1 },
      { x: 0.6, y: 0.5 },
    ],
  };
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  expect(strokeOutline(ellipse).map(({ x, y }) => ({ x: round(x), y: round(y) }))).toEqual([
    { x: 0.2, y: 0.3 },
    { x: 0.6, y: 0.3 },
    { x: 0.4, y: 0.1 },
    { x: 0.4, y: 0.5 },
  ]);
  const text = {
    tool: 'text' as const,
    color: 'red' as const,
    x: 0.7,
    y: 0.6,
    w: 0.2,
    h: 0.1,
    text: 'Hi',
    fontSize: 0.04,
  };
  const bounds = strokesBounds([ellipse, text])!;
  expect(bounds.x).toBeCloseTo(0.2);
  expect(bounds.y).toBeCloseTo(0.1);
  expect(bounds.w).toBeCloseTo(0.7);
  expect(bounds.h).toBeCloseTo(0.6);
});
