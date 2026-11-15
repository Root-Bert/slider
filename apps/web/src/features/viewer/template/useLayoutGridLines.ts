import { useMemo } from 'react';
import type { LayoutGrid } from '@slider/shared';
import { useEditing } from '../editing/editing-context';
import type { SnapLines } from '../stage/lib/rect-edit';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';
import { DEFAULT_GRID, gridLines } from './layout-grid';
import { usePickedGrids } from './picked-grids';

/** Where a slide's grid comes from: its own, its layout's, the deck's, the standard one. */
export type GridSource = 'own' | 'layout' | 'deck' | 'standard';

/**
 * The layout grid „Layout-Ansicht“ shows on a slide: in a template its layout's own (⇧H), else
 * the template's; in a presentation the slide's own (⇧H), else its layout's – the template it is
 * made from, as the slide came from it – else the one of that template (`Deck.grid`), else the
 * standard grid.
 */
export function useLayoutGrid(slideId: string): { grid: LayoutGrid; source: GridSource } {
  const { deck } = useViewerData();
  const { state } = useEditing();
  const picked = usePickedGrids();
  const slide = state?.slides.find((each) => each.slideId === slideId);
  const pageId = slide?.pageId ?? null;
  if (deck.template) {
    const own = pageId === null ? undefined : deck.template.layoutGrids?.[pageId];
    const grid = own ?? deck.template.grid;
    return { grid: grid ?? DEFAULT_GRID, source: own ? 'own' : grid ? 'layout' : 'standard' };
  }
  const shownOwn = pageId !== null && picked.has(pageId) ? picked.get(pageId) : slide?.grid;
  if (shownOwn) return { grid: shownOwn, source: 'own' };
  if (slide?.layoutGrid) return { grid: slide.layoutGrid, source: 'layout' };
  if (deck.grid) return { grid: deck.grid, source: 'deck' };
  return { grid: DEFAULT_GRID, source: 'standard' };
}

/**
 * „Layout-Ansicht“ on: the edges of the slide's grid's columns and rows, to catch boxes and
 * guides at – as shown (one direction alone while one is being set). `null` when off.
 */
export function useLayoutGridLines(slideId: string): SnapLines | null {
  const { showLayoutGrid, layoutGridAxis } = useViewerState();
  const { pageSize } = useEditing();
  const { grid } = useLayoutGrid(slideId);
  return useMemo(
    () => (showLayoutGrid ? gridLines(grid, pageSize, layoutGridAxis) : null),
    [showLayoutGrid, grid, pageSize, layoutGridAxis],
  );
}
