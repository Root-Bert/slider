import { describe, expect, it } from 'vitest';
import { linePaths, spread } from './line';

describe('dashboard lines (BER-167)', () => {
  it('spreads the values from edge to edge: the latest at the right one', () => {
    expect(spread([0, 10, 0], 300, (v) => 100 - v * 10)).toEqual([
      { x: 0, y: 100 },
      { x: 150, y: 0 },
      { x: 300, y: 100 },
    ]);
    expect(spread([4], 300, (v) => v)).toEqual([{ x: 150, y: 4 }]);
  });

  it('rounds the corners and closes the area on the baseline', () => {
    const { line, area } = linePaths(
      spread([0, 10, 0], 300, (v) => 100 - v * 10),
      100,
    );
    expect(line.startsWith('M0 100')).toBe(true);
    expect(line.endsWith('L300 100')).toBe(true);
    expect(line).toContain('Q150 0');
    expect(area.endsWith('L300 100L0 100Z')).toBe(true);
  });

  it('draws nothing without values', () => {
    expect(linePaths([], 100)).toEqual({ line: '', area: '' });
  });
});
