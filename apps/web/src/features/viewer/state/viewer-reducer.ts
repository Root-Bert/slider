import { clampSplit } from '@/lib/preferences/split';
import type { StatusFilter } from '../comments/lib/comment-selectors';
import { draftReducer, keepsDraft } from './draft-reducer';
import type { ViewerAction, ViewerState } from './viewer-types';

export function createInitialState(options: {
  activeSlideId: string | null;
  /** Restored split; `null` / missing is the default (Desktop-1 proportions). */
  split?: number | null;
  showChanges?: boolean;
  boxMode?: boolean;
  showGuides?: boolean;
  showHiddenSlides?: boolean;
  showMinimap?: boolean;
  wideFrames?: boolean;
  statusFilter?: StatusFilter;
}): ViewerState {
  return {
    activeSlideId: options.activeSlideId,
    tool: null,
    draft: null,
    lastDrawing: null,
    focusedThreadId: null,
    threadPanelOpen: false,
    editingCommentId: null,
    // BER-101: done comments are hidden by default.
    statusFilter: options.statusFilter ?? 'open',
    composingThreads: new Map(),
    mediaReply: null,
    personFilter: null,
    split: options.split == null ? null : clampSplit(options.split),
    slideZooms: new Map(),
    showChanges: options.showChanges ?? false,
    deletedPanelOpen: false,
    layersOpen: false,
    layersPanelOpen: false,
    boxMode: options.boxMode ?? true,
    boxModeFlipped: false,
    showGuides: options.showGuides ?? false,
    showHiddenSlides: options.showHiddenSlides ?? false,
    showMinimap: options.showMinimap ?? true,
    wideFrames: options.wideFrames ?? false,
  };
}

/** "Ausgeblendet" gives way to `fallback`; any other filter stays. */
const shown = (filter: StatusFilter, fallback: StatusFilter): StatusFilter =>
  filter === 'hidden' ? fallback : filter;

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
      // Ignored for an open draft with content: focus and panels stay as they are.
      if (keepsDraft(state.draft, action)) return next;
      // Composing a new comment takes over the focus.
      return { ...next, focusedThreadId: null, threadPanelOpen: false, lastDrawing: null };
    case 'draftSubmitted':
      // A comment written while all are hidden ends that: it is shown, among the open ones.
      return { ...next, tool: null, statusFilter: shown(next.statusFilter, 'open') };
    case 'threadFocused': {
      const threadPanelOpen = action.openPanel || next.threadPanelOpen;
      return {
        ...next,
        // A thread opened while all are hidden (a link, a notification) brings them back.
        statusFilter: shown(next.statusFilter, 'all'),
        focusedThreadId: action.threadId,
        threadPanelOpen,
        // A pending "Bearbeiten" belongs to the thread it was asked for.
        editingCommentId: action.threadId === next.focusedThreadId ? next.editingCommentId : null,
        // All are right side panels: the thread panel takes the deleted slides' or layers' place.
        deletedPanelOpen: threadPanelOpen ? false : next.deletedPanelOpen,
        layersPanelOpen: threadPanelOpen ? false : next.layersPanelOpen,
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
        layersPanelOpen: false,
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
    case 'composingChanged': {
      const count = (next.composingThreads.get(action.threadId) ?? 0) + (action.composing ? 1 : -1);
      const composingThreads = new Map(next.composingThreads);
      if (count > 0) composingThreads.set(action.threadId, count);
      else composingThreads.delete(action.threadId);
      return { ...next, composingThreads };
    }
    case 'mediaReplyOpened':
      return { ...next, mediaReply: action.reply };
    case 'mediaReplyClosed':
      return next.mediaReply === null ? next : { ...next, mediaReply: null };
    case 'personFilterToggled':
      return {
        ...next,
        personFilter: next.personFilter === action.authorId ? null : action.authorId,
      };
    case 'splitChanged': {
      const split = action.split === null ? null : clampSplit(action.split);
      return split === next.split ? next : { ...next, split };
    }
    case 'slideZoomChanged': {
      if (action.zoom === null && !next.slideZooms.has(action.slideId)) return next;
      const slideZooms = new Map(next.slideZooms);
      if (action.zoom === null) slideZooms.delete(action.slideId);
      else slideZooms.set(action.slideId, action.zoom);
      return { ...next, slideZooms };
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
    case 'showMinimapToggled':
      return { ...next, showMinimap: !next.showMinimap };
    case 'wideFramesToggled':
      // The frames change shape: a zoom or a moved part of the old shape means nothing in the new one.
      return { ...next, wideFrames: !next.wideFrames, slideZooms: new Map() };
    case 'deletedPanelSet':
      return action.open
        ? {
            ...next,
            deletedPanelOpen: true,
            threadPanelOpen: false,
            focusedThreadId: null,
            layersPanelOpen: false,
          }
        : next.deletedPanelOpen
          ? { ...next, deletedPanelOpen: false }
          : next;
    case 'layersSet':
    case 'layersPanelSet': {
      // The mode on leaves the side as it is (its panel opens on asking); off, both go. The panel
      // opens only with the mode on.
      const layersOpen = action.type === 'layersSet' ? action.open : next.layersOpen;
      const layersPanelOpen =
        layersOpen && (action.type === 'layersSet' ? next.layersPanelOpen : action.open);
      if (layersOpen === next.layersOpen && layersPanelOpen === next.layersPanelOpen) return next;
      return layersPanelOpen
        ? {
            ...next,
            layersOpen,
            layersPanelOpen,
            threadPanelOpen: false,
            focusedThreadId: null,
            editingCommentId: null,
            deletedPanelOpen: false,
          }
        : { ...next, layersOpen, layersPanelOpen };
    }
    case 'threadsReplaced': {
      const keepFocus = next.focusedThreadId === null || action.threadIds.has(next.focusedThreadId);
      const keepReply = next.mediaReply === null || action.threadIds.has(next.mediaReply.threadId);
      if (keepFocus && keepReply) return next;
      return {
        ...next,
        ...(keepFocus
          ? {}
          : { focusedThreadId: null, threadPanelOpen: false, editingCommentId: null }),
        mediaReply: keepReply ? next.mediaReply : null,
      };
    }
    case 'slidesReplaced': {
      const ids = new Set(action.slideIds);
      const gone = [...next.slideZooms.keys()].some((id) => !ids.has(id));
      const slideZooms = gone
        ? new Map([...next.slideZooms].filter(([id]) => ids.has(id)))
        : next.slideZooms;
      if (next.activeSlideId !== null && ids.has(next.activeSlideId)) {
        return gone ? { ...next, slideZooms } : next;
      }
      return { ...next, activeSlideId: action.fallbackSlideId, slideZooms };
    }
    default:
      return next;
  }
}
