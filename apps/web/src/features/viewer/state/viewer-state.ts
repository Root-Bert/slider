import { createContext, useContext, type Dispatch } from 'react';
import type { ViewerAction, ViewerState } from './viewer-types';

/*
 * The viewer's UI state: types in `viewer-types`, the reducers in `viewer-reducer` and
 * `draft-reducer`; this module is the entry point and holds the React context.
 */
export * from './viewer-types';
export { createInitialState, viewerReducer } from './viewer-reducer';

export const ViewerStateContext = createContext<ViewerState | null>(null);
export const ViewerDispatchContext = createContext<Dispatch<ViewerAction> | null>(null);

/** Box mode as it applies right now – the stored mode, flipped while ⌥ is held. */
export const isBoxModeActive = (state: Pick<ViewerState, 'boxMode' | 'boxModeFlipped'>) =>
  state.boxMode !== state.boxModeFlipped;

export function useViewerState(): ViewerState {
  const state = useContext(ViewerStateContext);
  if (!state) throw new Error('useViewerState must be used inside <ViewerStoreProvider>');
  return state;
}

/** Stable across renders – components that only dispatch don't re-render on state changes. */
export function useViewerDispatch(): Dispatch<ViewerAction> {
  const dispatch = useContext(ViewerDispatchContext);
  if (!dispatch) throw new Error('useViewerDispatch must be used inside <ViewerStoreProvider>');
  return dispatch;
}
