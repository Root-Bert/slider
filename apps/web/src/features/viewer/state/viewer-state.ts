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

/*
 * The hovered thread: its own context, not part of `ViewerState`. It changes with every move of
 * the mouse from one thread to another; in the state it re-rendered the whole viewer each time,
 * and cards, lines and marks dimmed only after that. Now only what shows the emphasis renders.
 */
export const ViewerHoverContext = createContext<string | null>(null);
export const ViewerSetHoverContext = createContext<((threadId: string | null) => void) | null>(
  null,
);

/** Box mode as it applies right now – the stored mode, flipped while ⌥ is held. */
export const isBoxModeActive = (state: Pick<ViewerState, 'boxMode' | 'boxModeFlipped'>) =>
  state.boxMode !== state.boxModeFlipped;

export function useViewerState(): ViewerState {
  const state = useContext(ViewerStateContext);
  if (!state) throw new Error('useViewerState must be used inside <ViewerStoreProvider>');
  return state;
}

/** The thread under the mouse (card, pin, frame, drawing, gap marker), see `useThreadHover`. */
export function useHoveredThreadId(): string | null {
  return useContext(ViewerHoverContext);
}

/** Stable across renders. */
export function useSetHoveredThread(): (threadId: string | null) => void {
  const set = useContext(ViewerSetHoverContext);
  if (!set) throw new Error('useSetHoveredThread must be used inside <ViewerStoreProvider>');
  return set;
}

/** Stable across renders – components that only dispatch don't re-render on state changes. */
export function useViewerDispatch(): Dispatch<ViewerAction> {
  const dispatch = useContext(ViewerDispatchContext);
  if (!dispatch) throw new Error('useViewerDispatch must be used inside <ViewerStoreProvider>');
  return dispatch;
}
