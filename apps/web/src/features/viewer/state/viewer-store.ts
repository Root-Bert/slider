import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { viewerReducer } from './viewer-reducer';
import type { ViewerAction, ViewerState } from './viewer-types';

export type ViewerControls = Omit<ViewerState, 'slideZooms'>;

/** Keep the reducer/behaviour shared, but subscribe the chrome separately from live views. */
export function createViewerStore(initial: ViewerState) {
  let state = initial;
  const controlsOf = ({ slideZooms: _zooms, ...controls }: ViewerState) => controls;
  let controls = controlsOf(initial);
  const controlKeys = Object.keys(controls) as (keyof ViewerControls)[];
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    getControls: () => controls,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch: (action: ViewerAction) => {
      const next = viewerReducer(state, action);
      if (next === state) return;
      state = next;
      // No new context value for a zoom-only change, including pruned views on a new revision.
      if (!controlKeys.every((key) => Object.is(controls[key], next[key])))
        controls = controlsOf(next);
      listeners.forEach((listener) => listener());
    },
  };
}

export const ViewerStoreContext = createContext<ReturnType<typeof createViewerStore> | null>(null);

/** Stable imperative access for wheel/hand/auto-zoom without a React subscription. */
export function useViewerStore() {
  const store = useContext(ViewerStoreContext);
  if (!store) throw new Error('useViewerStore must be used inside <ViewerStoreProvider>');
  return store;
}

/** A moving slide alone renders; the remaining slides keep their snapshots. */
export function useSlideZoom(slideId: string) {
  const store = useViewerStore();
  const snapshot = useCallback(
    () => store.getState().slideZooms.get(slideId) ?? null,
    [store, slideId],
  );
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}
