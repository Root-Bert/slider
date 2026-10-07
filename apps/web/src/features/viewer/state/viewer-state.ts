import type { AccentColor, Anchor, Stroke, StrokeTool } from '@slider/shared';
import { createContext, useContext, type Dispatch } from 'react';
import type { StatusFilter } from '../lib/comment-selectors';
import { strokesBounds } from '../lib/stroke-path';
import { clampZoom, DEFAULT_ZOOM } from '../lib/zoom';

export { ZOOM_MAX, ZOOM_MIN } from '../lib/zoom';

/** `mark` places pins (click) and frames (drag); the stroke tools draw (BER-98, BER-99). */
export type Tool = 'mark' | StrokeTool;

/** An unsent comment: where it points and what has been drawn so far. */
export interface Draft {
  /** `null` for gap comments. */
  slideId: string | null;
  anchor: Anchor;
  /** The anchor was derived from the strokes' bounds and follows them on undo/redo. */
  anchorFromStrokes: boolean;
  strokes: Stroke[];
  /** Undone strokes, most recent last (for redo). */
  undone: Stroke[];
}

export interface ViewerState {
  activeSlideId: string | null;
  tool: Tool | null;
  /** Remembered so the `draw` button returns to the last pen variant. */
  lastStrokeTool: StrokeTool;
  color: AccentColor;
  draft: Draft | null;
  focusedThreadId: string | null;
  hoveredThreadId: string | null;
  /** Slide (or its comment column) under the pointer – its connector lines are drawn too. */
  hoveredSlideId: string | null;
  threadPanelOpen: boolean;
  statusFilter: StatusFilter;
  pptxOnly: boolean;
  /** Timeline zoom `t` ∈ [0, 1], see `lib/zoom`. */
  zoom: number;
}

export type ViewerAction =
  | { type: 'activeSlideChanged'; slideId: string }
  | { type: 'toolSelected'; tool: Tool | null }
  | { type: 'colorSelected'; color: AccentColor }
  | { type: 'anchorPlaced'; slideId: string; anchor: Anchor }
  | { type: 'strokeAdded'; slideId: string; stroke: Stroke }
  | { type: 'gapDraftStarted'; afterSlideId: string | null; beforeSlideId: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'draftCancelled' }
  | { type: 'draftSubmitted' }
  | { type: 'threadHovered'; threadId: string | null }
  | { type: 'slideHovered'; slideId: string | null }
  | { type: 'threadFocused'; threadId: string; openPanel: boolean }
  | { type: 'threadPanelClosed' }
  /** Inline thread collapsed: drops the focus unless the panel shows that thread. */
  | { type: 'threadUnfocused'; threadId: string }
  | { type: 'statusFilterChanged'; filter: StatusFilter }
  | { type: 'pptxOnlyToggled' }
  | { type: 'zoomChanged'; zoom: number };

export function createInitialState(options: {
  activeSlideId: string | null;
  color: AccentColor;
  /** Restored zoom; defaults to `DEFAULT_ZOOM` (Desktop-1). */
  zoom?: number;
}): ViewerState {
  return {
    activeSlideId: options.activeSlideId,
    tool: null,
    lastStrokeTool: 'pen',
    color: options.color,
    draft: null,
    focusedThreadId: null,
    hoveredThreadId: null,
    hoveredSlideId: null,
    threadPanelOpen: false,
    // BER-101: done comments are hidden by default.
    statusFilter: 'open',
    pptxOnly: false,
    zoom: clampZoom(options.zoom ?? DEFAULT_ZOOM),
  };
}

function strokeAnchor(strokes: readonly Stroke[]): Anchor | null {
  const bounds = strokesBounds(strokes);
  return bounds ? { type: 'rect', rect: bounds, shapeRef: null } : null;
}

/** Applies a new stroke list, keeping a stroke-derived anchor in sync. Empty → no draft. */
function withStrokes(draft: Draft, strokes: Stroke[], undone: Stroke[]): Draft | null {
  if (!draft.anchorFromStrokes) return { ...draft, strokes, undone };
  const anchor = strokeAnchor(strokes);
  return anchor ? { ...draft, anchor, strokes, undone } : null;
}

function draftReducer(draft: Draft | null, action: ViewerAction): Draft | null {
  switch (action.type) {
    case 'anchorPlaced':
      // Placing a mark on another slide starts over; on the same slide the drawing is kept.
      if (draft?.slideId === action.slideId)
        return { ...draft, anchor: action.anchor, anchorFromStrokes: false };
      return {
        slideId: action.slideId,
        anchor: action.anchor,
        anchorFromStrokes: false,
        strokes: [],
        undone: [],
      };
    case 'strokeAdded': {
      const base: Draft =
        draft?.slideId === action.slideId
          ? draft
          : {
              slideId: action.slideId,
              anchor: { type: 'slide' },
              anchorFromStrokes: true,
              strokes: [],
              undone: [],
            };
      return withStrokes(base, [...base.strokes, action.stroke], []);
    }
    case 'gapDraftStarted':
      return {
        slideId: null,
        anchor: {
          type: 'gap',
          afterSlideId: action.afterSlideId,
          beforeSlideId: action.beforeSlideId,
        },
        anchorFromStrokes: false,
        strokes: [],
        undone: [],
      };
    case 'undo': {
      const last = draft?.strokes.at(-1);
      if (!draft || !last) return draft;
      return withStrokes(draft, draft.strokes.slice(0, -1), [...draft.undone, last]);
    }
    case 'redo': {
      const next = draft?.undone.at(-1);
      if (!draft || !next) return draft;
      return withStrokes(draft, [...draft.strokes, next], draft.undone.slice(0, -1));
    }
    case 'draftCancelled':
    case 'draftSubmitted':
      return null;
    default:
      return draft;
  }
}

export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  const draft = draftReducer(state.draft, action);
  const next = draft === state.draft ? state : { ...state, draft };

  switch (action.type) {
    case 'activeSlideChanged':
      return next.activeSlideId === action.slideId
        ? next
        : { ...next, activeSlideId: action.slideId };
    case 'toolSelected': {
      const tool = action.tool === next.tool ? null : action.tool;
      const lastStrokeTool = tool && tool !== 'mark' ? tool : next.lastStrokeTool;
      return { ...next, tool, lastStrokeTool };
    }
    case 'colorSelected':
      return { ...next, color: action.color };
    case 'anchorPlaced':
    case 'strokeAdded':
    case 'gapDraftStarted':
      // Composing a new comment takes over the focus.
      return { ...next, focusedThreadId: null, threadPanelOpen: false };
    case 'draftSubmitted':
      return { ...next, tool: null };
    case 'threadHovered':
      return next.hoveredThreadId === action.threadId
        ? next
        : { ...next, hoveredThreadId: action.threadId };
    case 'slideHovered':
      return next.hoveredSlideId === action.slideId
        ? next
        : { ...next, hoveredSlideId: action.slideId };
    case 'threadFocused':
      return {
        ...next,
        focusedThreadId: action.threadId,
        threadPanelOpen: action.openPanel || next.threadPanelOpen,
      };
    case 'threadPanelClosed':
      return { ...next, threadPanelOpen: false, focusedThreadId: null };
    case 'threadUnfocused':
      return next.focusedThreadId === action.threadId && !next.threadPanelOpen
        ? { ...next, focusedThreadId: null }
        : next;
    case 'statusFilterChanged':
      return { ...next, statusFilter: action.filter };
    case 'pptxOnlyToggled':
      return { ...next, pptxOnly: !next.pptxOnly };
    case 'zoomChanged': {
      const zoom = clampZoom(action.zoom);
      return zoom === next.zoom ? next : { ...next, zoom };
    }
    default:
      return next;
  }
}

export const ViewerStateContext = createContext<ViewerState | null>(null);
export const ViewerDispatchContext = createContext<Dispatch<ViewerAction> | null>(null);

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
