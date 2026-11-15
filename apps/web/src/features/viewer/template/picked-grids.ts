import { useSyncExternalStore } from 'react';
import type { LayoutGrid } from '@slider/shared';

/**
 * Slide grids just set, by page id, until the server has them – `null` set back to the layout's:
 * the slides and the panel show them at once, no waiting on the edit's round trip.
 */
let picked: ReadonlyMap<string, LayoutGrid | null> = new Map();
const listeners = new Set<() => void>();

const publish = (next: ReadonlyMap<string, LayoutGrid | null>) => {
  picked = next;
  for (const listener of listeners) listener();
};

/** Shows `grid` on the slide while `done` is on its way; it settles back to the server's. */
export function showPickedGrid(
  pageId: string,
  grid: LayoutGrid | null,
  done: Promise<unknown>,
): void {
  publish(new Map(picked).set(pageId, grid));
  const settle = () => {
    // A newer one for the slide stays.
    if (picked.get(pageId) !== grid) return;
    const next = new Map(picked);
    next.delete(pageId);
    publish(next);
  };
  void done.then(settle, settle);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The grids just set, by page id (`undefined` for a slide: none on its way). */
export const usePickedGrids = () => useSyncExternalStore(subscribe, () => picked);
