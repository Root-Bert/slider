import { describe, expect, it } from 'vitest';
import { gridLines, gridTracks } from './layout-grid';

describe('layout grid', () => {
  it('splits the slide into equal tracks between margins and gutters, and gives their edges', () => {
    const tracks = gridTracks({ count: 3, gutter: 1, margin: 2 }, 28);
    // (28 − 4 − 2) / 3 = 22/3 cm each.
    expect(tracks).toHaveLength(3);
    expect(tracks[0]!.start).toBeCloseTo(2 / 28);
    expect(tracks[0]!.size).toBeCloseTo(22 / 3 / 28);
    expect(tracks[2]!.start + tracks[2]!.size).toBeCloseTo(26 / 28);

    // None for no count or when they do not fit.
    expect(gridTracks({ count: 0, gutter: 1, margin: 1 }, 28)).toEqual([]);
    expect(gridTracks({ count: 4, gutter: 10, margin: 1 }, 28)).toEqual([]);

    const grid = {
      columns: { count: 2, gutter: 2, margin: 1 },
      rows: { count: 1, gutter: 0, margin: 1 },
    };
    const { x, y } = gridLines(grid, { width: 20, height: 10 });
    expect(x.map((edge) => edge * 20)).toEqual([1, 9, 11, 19].map((cm) => expect.closeTo(cm)));
    expect(y.map((edge) => edge * 10)).toEqual([1, 9].map((cm) => expect.closeTo(cm)));
    // Only the direction being set.
    expect(gridLines(grid, { width: 20, height: 10 }, 'columns').y).toEqual([]);
    expect(gridLines(grid, { width: 20, height: 10 }, 'rows').x).toEqual([]);
  });
});
