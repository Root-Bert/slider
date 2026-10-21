import { describe, expect, it } from 'vitest';
import { roundedPath } from './rounded-path';

describe('roundedPath', () => {
  it('rounds corners with radius 8', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toBe('M0 0L92 0Q100 0 100 8L100 100');
  });

  it('lets a short first stub use its full length (Figma: 4px stub, r=4)', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 100 },
        { x: 50, y: 100 },
      ]),
    ).toBe('M0 0L0 0Q4 0 4 4L4 92Q4 100 12 100L50 100');
  });

  it('halves shared inner segments', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 10 },
        { x: 100, y: 10 },
      ]),
    ).toBe('M0 0L45 0Q50 0 50 5L50 5Q50 10 55 10L100 10');
  });
});
