import { describe, expect, it } from 'vitest';
import { addPoint, hasInk, sketchPalette } from './sketch';

describe('sketch', () => {
  it('puts the own colour after the ink, without duplicates', () => {
    expect(sketchPalette('#0048ff').slice(0, 2)).toEqual(['#141414', '#0048ff']);
    expect(sketchPalette('#0048ff').filter((c) => c.toLowerCase() === '#0048ff')).toHaveLength(1);
  });

  it('drops points that barely moved', () => {
    expect(addPoint([[0.5, 0.5]], [0.5005, 0.5])).toHaveLength(1);
    expect(addPoint([[0.5, 0.5]], [0.6, 0.5])).toHaveLength(2);
  });

  it('needs a pen stroke to count as a drawing', () => {
    expect(hasInk([])).toBe(false);
    expect(hasInk([{ tool: 'eraser', color: '#fff', width: 0.04, points: [[0, 0]] }])).toBe(false);
    expect(hasInk([{ tool: 'pen', color: '#fff', width: 0.004, points: [[0, 0]] }])).toBe(true);
  });
});
