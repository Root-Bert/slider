import type { LayoutGrid, LayoutGridAxis } from '@slider/shared';

/** A template without a grid of its own yet: 5 columns and 5 rows, 1 cm apart, 0.5 cm in. */
export const DEFAULT_GRID: LayoutGrid = {
  columns: { count: 5, gutter: 1, margin: 0.5 },
  rows: { count: 5, gutter: 1, margin: 0.5 },
};

/** One column (or row) of a layout grid: where it starts and how wide (high) it is, of the slide. */
export interface GridTrack {
  start: number;
  size: number;
}

/**
 * The columns (or rows) of one direction of a layout grid on a slide `length` cm wide (high):
 * equal ones, `gutter` apart, `margin` in from either edge. None if they would not fit.
 */
export function gridTracks({ count, gutter, margin }: LayoutGridAxis, length: number): GridTrack[] {
  if (count <= 0 || length <= 0) return [];
  const size = (length - 2 * margin - (count - 1) * gutter) / count;
  if (size <= 0) return [];
  return Array.from({ length: count }, (_, index) => ({
    start: (margin + index * (size + gutter)) / length,
    size: size / length,
  }));
}

/**
 * The edges of a layout grid's columns (`x`) and rows (`y`), of the slide – what boxes and guides
 * are caught at in „Layout-Ansicht“. `axis` alone: only that direction (it is being set).
 */
export function gridLines(
  grid: LayoutGrid,
  pageSize: { width: number; height: number },
  axis: 'columns' | 'rows' | null = null,
): { x: number[]; y: number[] } {
  const edges = (tracks: GridTrack[]) => tracks.flatMap(({ start, size }) => [start, start + size]);
  return {
    x: axis === 'rows' ? [] : edges(gridTracks(grid.columns, pageSize.width)),
    y: axis === 'columns' ? [] : edges(gridTracks(grid.rows, pageSize.height)),
  };
}
