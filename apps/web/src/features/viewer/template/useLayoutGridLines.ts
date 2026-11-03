import { useMemo } from 'react';
import type { LayoutGrid } from '@slider/shared';
import { useEditing } from '../editing/editing-context';
import type { SnapLines } from '../stage/lib/rect-edit';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';
import { DEFAULT_GRID, gridLines } from './layout-grid';

/**
 * The layout grid „Layout-Ansicht“ shows: a template's own, set in it (⇧H); a presentation's,
 * the one of the template it is made from (`Deck.grid`) – else the standard grid.
 */
export function useLayoutGrid(): LayoutGrid {
  const { deck } = useViewerData();
  return (deck.template ? deck.template.grid : deck.grid) ?? DEFAULT_GRID;
}

/**
 * „Layout-Ansicht“ on: the edges of the grid's columns and rows, to catch boxes and guides at –
 * as shown (one direction alone while a template's is being set). `null` when off.
 */
export function useLayoutGridLines(): SnapLines | null {
  const { showLayoutGrid, layoutGridAxis } = useViewerState();
  const { pageSize } = useEditing();
  const grid = useLayoutGrid();
  return useMemo(
    () => (showLayoutGrid ? gridLines(grid, pageSize, layoutGridAxis) : null),
    [showLayoutGrid, grid, pageSize, layoutGridAxis],
  );
}
