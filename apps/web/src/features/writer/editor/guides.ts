import { layoutGridSchema, type LayoutGrid } from '@slider/shared';
import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { loadWorkPreferences } from '@/lib/preferences/work-preferences';
import { readJson, writeJson } from '@/lib/storage';
import type { PageMetrics } from '../lib/paginate';

/**
 * What is drawn over the pages to lay them out, as over a presentation's slides: „Hilfslinien“
 * (G – the margins, the head and the foot; on when a document opens if set on /konto, as for a
 * deck) and „Layout-Ansicht“ (H – columns and rows in the text's room, as in Figma; its sizes
 * set at its button, ⇧H or a right click, and kept in this browser).
 */
export interface PageGuidesState {
  guides: boolean;
  grid: boolean;
  /** The grid's popover open (⇧H, a right click on its button). */
  gridPanel: boolean;
  layout: LayoutGrid;
  /** „Ebenen“ (L): the page's blocks listed beside it and outlined on it. */
  layers: boolean;
  /** The layer under the pointer in the list: outlined on the page. */
  hovered: string | null;
}

const GRID_KEY = 'slider.writerGrid.v1';

/** A document's text in 6 columns, 0.5 cm apart, as a page is usually set; no rows. */
export const DEFAULT_PAGE_GRID: LayoutGrid = {
  columns: { count: 6, gutter: 0.5, margin: 0 },
  rows: { count: 0, gutter: 0.5, margin: 0 },
};

let state: PageGuidesState = {
  guides: loadWorkPreferences().showGuides,
  grid: false,
  gridPanel: false,
  layers: false,
  hovered: null,
  layout: readJson(GRID_KEY, (value) => layoutGridSchema.parse(value), DEFAULT_PAGE_GRID),
};
const listeners = new Set<() => void>();

function set(next: Partial<PageGuidesState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const pageGuides = {
  state: () => state,
  /** A document opens with the guides as set on /konto. */
  reset: () =>
    set({
      guides: loadWorkPreferences().showGuides,
      gridPanel: false,
      layers: false,
      hovered: null,
    }),
  setLayers: (layers: boolean) => set({ layers, hovered: null }),
  setHovered: (hovered: string | null) => set({ hovered }),
  toggleGuides: () => set({ guides: !state.guides }),
  /** H: the grid on or off – off, its popover with it. */
  toggleGrid: () => set({ grid: !state.grid, gridPanel: false }),
  /** ⇧H: the grid's sizes – the grid on with them. */
  setGridPanel: (open: boolean) => set({ gridPanel: open, ...(open && { grid: true }) }),
  setLayout: (layout: LayoutGrid) => {
    writeJson(GRID_KEY, layout);
    set({ layout });
  },
};

export function usePageGuides(): PageGuidesState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Where a picture or a table sticks out over the margins, in the stack's own pixels. */
export interface Overflow {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * What sticks out over the text's room – a picture, a table wider than it –, measured after
 * every layout: outlined while the guides show, and their button lit (as a box over a slide's
 * guides).
 */
export function useMarginOverflows(
  host: RefObject<HTMLElement | null>,
  metrics: PageMetrics,
  zoom: number,
  layout: unknown,
): Overflow[] {
  const [found, setFound] = useState<Overflow[]>([]);
  useLayoutEffect(() => {
    // Measured once the text is laid out (a picture's size comes with it).
    const frame = requestAnimationFrame(() => measure());
    return () => cancelAnimationFrame(frame);
    function measure() {
      const root = host.current;
      if (!root) return;
      const origin = root.getBoundingClientRect();
      const inner = metrics.width - metrics.right;
      const next: Overflow[] = [];
      root.querySelectorAll<HTMLElement>('.writer-flow img, .writer-flow table').forEach((each) => {
        // The pictures inside a table go with the table.
        if (each.tagName === 'IMG' && each.closest('table')) return;
        const rect = each.getBoundingClientRect();
        const left = (rect.left - origin.left) / zoom;
        const right = (rect.right - origin.left) / zoom;
        if (left >= metrics.left - 0.5 && right <= inner + 0.5) return;
        next.push({
          key: `${next.length}`,
          left,
          top: (rect.top - origin.top) / zoom,
          width: right - left,
          height: rect.height / zoom,
        });
      });
      setFound((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    }
  }, [host, metrics, zoom, layout]);
  return found;
}
