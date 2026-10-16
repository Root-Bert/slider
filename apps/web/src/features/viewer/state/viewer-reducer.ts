import type { AccentColor } from '@slider/shared';
import { clampSplit } from '@/lib/preferences/split';
import type { StatusFilter } from '../comments/lib/comment-selectors';
import { draftReducer } from './draft-reducer';
import type { ViewerAction, ViewerState } from './viewer-types';

export function createInitialState(options: {
  activeSlideId: string | null;
  color: AccentColor;
  /** Restored split; `null` / missing is the default (Desktop-1 proportions). */
  split?: number | null;
  showChanges?: boolean;
  boxMode?: boolean;
  showGuides?: boolean;
  showHiddenSlides?: boolean;
  statusFilter?: StatusFilter;
}): ViewerState {
  return {
    activeSlideId: options.activeSlideId,
    tool: null,
    color: options.color,
    draft: null,
    lastDrawing: null,
    focusedThreadId: null,
    hoveredThreadId: null,
    hoveredSlideId: null,
    threadPanelOpen: false,
    editingCommentId: null,
    // BER-101: done comments are hidden by default.
    statusFilter: options.statusFilter ?? 'open',
    personFilter: null,
    split: options.split == null ? null : clampSplit(options.split),
    showChanges: options.showChanges ?? true,
    deletedPanelOpen: false,
    previousView: null,
    boxMode: options.boxMode ?? true,
    boxModeFlipped: false,
    showGuides: options.showGuides ?? false,
    showHiddenSlides: options.showHiddenSlides ?? false,
  };
}

export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  const draft = draftReducer(state.draft, action);
  const next = draft === state.draft ? state : { ...state, draft };

  switch (action.type) {
    case 'activeSlideChanged':
      return next.activeSlideId === action.slideId
        ? next
        : { ...next, activeSlideId: action.slideId };
    case 'toolSelected':
      return {
        ...next,
        tool: action.tool === next.tool ? null : action.tool,
        lastDrawing: null,
      };
    case 'drawingSaved': {
      const { type: _type, ...drawing } = action;
      return { ...next, lastDrawing: drawing };
    }
    case 'anchorPlaced':
    case 'strokeAdded':
    case 'gapDraftStarted':
    case 'textBoxPlaced':
    case 'drawingCommentStarted':
      // Composing a new comment takes over the focus.
      return { ...next, focusedThreadId: null, threadPanelOpen: false, lastDrawing: null };
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
    case 'threadFocused': {
      const threadPanelOpen = action.openPanel || next.threadPanelOpen;
      return {
        ...next,
        focusedThreadId: action.threadId,
        threadPanelOpen,
        // A pending "Bearbeiten" belongs to the thread it was asked for.
        editingCommentId: action.threadId === next.focusedThreadId ? next.editingCommentId : null,
        // Both are right side panels: the thread panel takes the deleted slides' place.
        deletedPanelOpen: threadPanelOpen ? false : next.deletedPanelOpen,
      };
    }
    case 'threadPanelClosed':
      return { ...next, threadPanelOpen: false, focusedThreadId: null, editingCommentId: null };
    case 'commentEditRequested':
      return {
        ...next,
        focusedThreadId: action.threadId,
        threadPanelOpen: true,
        deletedPanelOpen: false,
        editingCommentId: action.commentId,
      };
    case 'commentEditEnded':
      return next.editingCommentId === null ? next : { ...next, editingCommentId: null };
    case 'threadUnfocused':
      return next.focusedThreadId === action.threadId && !next.threadPanelOpen
        ? { ...next, focusedThreadId: null }
        : next;
    case 'statusFilterChanged':
      return { ...next, statusFilter: action.filter };
    case 'personFilterToggled':
      return {
        ...next,
        personFilter: next.personFilter === action.authorId ? null : action.authorId,
      };
    case 'splitChanged': {
      const split = action.split === null ? null : clampSplit(action.split);
      return split === next.split ? next : { ...next, split };
    }
    case 'showChangesSet':
      return next.showChanges === action.show ? next : { ...next, showChanges: action.show };
    case 'boxModeToggled':
      return { ...next, boxMode: !next.boxMode };
    case 'boxModeFlipped':
      return next.boxModeFlipped === action.flipped
        ? next
        : { ...next, boxModeFlipped: action.flipped };
    case 'showGuidesToggled':
      return { ...next, showGuides: !next.showGuides };
    case 'showHiddenSlidesToggled':
      return { ...next, showHiddenSlides: !next.showHiddenSlides };
    case 'previousViewSet':
      return next.previousView === action.view ? next : { ...next, previousView: action.view };
    case 'deletedPanelSet':
      return action.open
        ? { ...next, deletedPanelOpen: true, threadPanelOpen: false, focusedThreadId: null }
        : { ...next, deletedPanelOpen: false };
    case 'threadsReplaced': {
      const keepFocus = next.focusedThreadId === null || action.threadIds.has(next.focusedThreadId);
      const keepHover = next.hoveredThreadId === null || action.threadIds.has(next.hoveredThreadId);
      if (keepFocus && keepHover) return next;
      return {
        ...next,
        ...(keepFocus
          ? {}
          : { focusedThreadId: null, threadPanelOpen: false, editingCommentId: null }),
        hoveredThreadId: keepHover ? next.hoveredThreadId : null,
      };
    }
    case 'slidesReplaced': {
      const ids = new Set(action.slideIds);
      const keepActive = next.activeSlideId !== null && ids.has(next.activeSlideId);
      const keepHover = next.hoveredSlideId === null || ids.has(next.hoveredSlideId);
      const keepPrevious = next.previousView === null || ids.has(next.previousView.slideId);
      if (keepActive && keepHover && keepPrevious) return next;
      return {
        ...next,
        activeSlideId: keepActive ? next.activeSlideId : action.fallbackSlideId,
        hoveredSlideId: keepHover ? next.hoveredSlideId : null,
        previousView: keepPrevious ? next.previousView : null,
      };
    }
    default:
      return next;
  }
}
