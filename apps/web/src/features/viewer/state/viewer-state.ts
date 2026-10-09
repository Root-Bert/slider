import type { AccentColor, Anchor, MediaKind, PathStrokeTool, Rect, Stroke } from '@slider/shared';
import { createContext, useContext, type Dispatch } from 'react';
import type { StatusFilter } from '../lib/comment-selectors';
import { strokesBounds } from '../lib/stroke-path';
import { clampSplit } from '../lib/split';

/**
 * Variants of the pen ("Zeichnen"): `mark` places pins (click) and frames (drag) – "Punkt/Bereich" –,
 * the stroke tools draw lines and shapes (BER-98, BER-99).
 */
export type PenTool = 'mark' | PathStrokeTool;
/** `text` writes directly on the slide ("Text auf Folie"). */
export type Tool = PenTool | 'text';

export const isPenTool = (tool: Tool | null): tool is PenTool => tool !== null && tool !== 'text';

/** The text box of an unsent "Text auf Folie" comment. Normalised to the slide box. */
export interface TextBoxDraft {
  x: number;
  y: number;
  /** Fixed width (dragged or resized), or `null` to grow with the longest line. */
  width: number | null;
  /** The box grows with its lines beyond this height. */
  minHeight: number;
  /** Relative to the slide height. */
  fontSize: number;
  text: string;
  /** The box as rendered, measured from the editor – what gets stored. */
  measured: Rect | null;
}

export type TextBoxPatch = Partial<Pick<TextBoxDraft, 'x' | 'y' | 'width' | 'minHeight' | 'text'>>;

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
  /** Text written on the slide; while present, its box is the anchor. */
  textBox: TextBoxDraft | null;
  /** Started from the tool bar's mic or camera: the composer opens recording (BER-116). */
  recordKind?: MediaKind;
}

export interface ViewerState {
  activeSlideId: string | null;
  tool: Tool | null;
  /** Remembered so the `draw` button returns to the last pen variant. */
  lastPenTool: PenTool;
  /** The viewer's own colour – drawings match their comment's connector line. */
  color: AccentColor;
  draft: Draft | null;
  focusedThreadId: string | null;
  hoveredThreadId: string | null;
  /** Slide (or its comment column) under the pointer – its connector lines are drawn too. */
  hoveredSlideId: string | null;
  threadPanelOpen: boolean;
  statusFilter: StatusFilter;
  pptxOnly: boolean;
  /** Split handle position `t` ∈ [0, 1] (slide size vs comment area), `null` = default; see `lib/split`. */
  split: number | null;
  /**
   * "Änderungen": badges of the latest revision on track and minimap (Figma D2). On by default –
   * the switch only shows when the latest revision changed slides, so there is always something
   * to mark.
   */
  showChanges: boolean;
  /** Side panel with the slides deleted in later revisions and their comments (BER-109). */
  deletedPanelOpen: boolean;
  /**
   * Box mode (B): a click comments on the PowerPoint box under the pointer, which is outlined
   * while hovered. Off: a click places a free comment and boxes never show.
   */
  boxMode: boolean;
  /** ⌥ held: box mode is flipped for as long as the key is down. */
  boxModeFlipped: boolean;
  /** "Hilfslinien zeigen": PowerPoint's drawing guides, and the boxes that cross them. */
  showGuides: boolean;
}

export type ViewerAction =
  | { type: 'activeSlideChanged'; slideId: string }
  | { type: 'toolSelected'; tool: Tool | null }
  | { type: 'anchorPlaced'; slideId: string; anchor: Anchor }
  | { type: 'strokeAdded'; slideId: string; stroke: Stroke }
  | { type: 'gapDraftStarted'; afterSlideId: string | null; beforeSlideId: string | null }
  /** Mic or camera in the tool bar: a voice/video comment on the slide (BER-116). */
  | { type: 'mediaDraftStarted'; slideId: string; kind: MediaKind }
  /** A text box was clicked or dragged open on a slide; on the same slide it keeps its text. */
  | {
      type: 'textBoxPlaced';
      slideId: string;
      box: Pick<TextBoxDraft, 'x' | 'y' | 'width' | 'minHeight' | 'fontSize'>;
    }
  | { type: 'textBoxChanged'; patch: TextBoxPatch }
  | { type: 'textBoxMeasured'; rect: Rect }
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
  /** `null` resets the split to the default. */
  | { type: 'splitChanged'; split: number | null }
  | { type: 'showChangesSet'; show: boolean }
  | { type: 'deletedPanelSet'; open: boolean }
  | { type: 'boxModeToggled' }
  | { type: 'boxModeFlipped'; flipped: boolean }
  | { type: 'showGuidesToggled' }
  /** A new revision arrived: drop what points at slides that are gone (BER-107). */
  | { type: 'slidesReplaced'; slideIds: readonly string[]; fallbackSlideId: string | null };

export function createInitialState(options: {
  activeSlideId: string | null;
  color: AccentColor;
  /** Restored split; `null` / missing is the default (Desktop-1 proportions). */
  split?: number | null;
  showChanges?: boolean;
  boxMode?: boolean;
}): ViewerState {
  return {
    activeSlideId: options.activeSlideId,
    tool: null,
    lastPenTool: 'pen',
    color: options.color,
    draft: null,
    focusedThreadId: null,
    hoveredThreadId: null,
    hoveredSlideId: null,
    threadPanelOpen: false,
    // BER-101: done comments are hidden by default.
    statusFilter: 'open',
    pptxOnly: false,
    split: options.split == null ? null : clampSplit(options.split),
    showChanges: options.showChanges ?? true,
    deletedPanelOpen: false,
    boxMode: options.boxMode ?? true,
    boxModeFlipped: false,
    showGuides: false,
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

const rectAnchor = (rect: Rect): Anchor => ({ type: 'rect', rect, shapeRef: null });

/** Anchor of a text box before it has been measured. */
const placedTextRect = (box: TextBoxDraft): Rect => ({
  x: box.x,
  y: box.y,
  w: Math.max(box.width ?? 0, 0.01),
  h: Math.max(box.minHeight, 0.01),
});

function draftReducer(draft: Draft | null, action: ViewerAction): Draft | null {
  switch (action.type) {
    case 'anchorPlaced':
      // Placing a mark on another slide starts over; on the same slide the drawing is kept
      // (a text box makes way – the mark is the anchor now).
      if (draft?.slideId === action.slideId)
        return { ...draft, anchor: action.anchor, anchorFromStrokes: false, textBox: null };
      return {
        slideId: action.slideId,
        anchor: action.anchor,
        anchorFromStrokes: false,
        strokes: [],
        undone: [],
        textBox: null,
      };
    case 'textBoxPlaced': {
      const same = draft?.slideId === action.slideId ? draft : null;
      const textBox: TextBoxDraft = {
        ...action.box,
        text: same?.textBox?.text ?? '',
        measured: null,
      };
      return {
        slideId: action.slideId,
        anchor: rectAnchor(placedTextRect(textBox)),
        anchorFromStrokes: false,
        strokes: same?.strokes ?? [],
        undone: same?.undone ?? [],
        textBox,
      };
    }
    case 'textBoxChanged': {
      if (!draft?.textBox) return draft;
      const textBox = { ...draft.textBox, ...action.patch };
      // Moving keeps the measured size until the editor reports the new box.
      const measured = textBox.measured && { ...textBox.measured, x: textBox.x, y: textBox.y };
      const rect = measured ?? placedTextRect(textBox);
      return { ...draft, anchor: rectAnchor(rect), textBox: { ...textBox, measured } };
    }
    case 'textBoxMeasured': {
      if (!draft?.textBox) return draft;
      const { measured } = draft.textBox;
      const { rect } = action;
      if (
        measured &&
        measured.x === rect.x &&
        measured.y === rect.y &&
        measured.w === rect.w &&
        measured.h === rect.h
      )
        return draft;
      return { ...draft, anchor: rectAnchor(rect), textBox: { ...draft.textBox, measured: rect } };
    }
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
              textBox: null,
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
        textBox: null,
      };
    case 'mediaDraftStarted': {
      // A mark or drawing already on that slide stays; otherwise the comment is about the slide.
      const base: Draft =
        draft?.slideId === action.slideId
          ? draft
          : {
              slideId: action.slideId,
              anchor: { type: 'slide' },
              anchorFromStrokes: false,
              strokes: [],
              undone: [],
              textBox: null,
            };
      return { ...base, recordKind: action.kind };
    }
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
    case 'slidesReplaced': {
      if (!draft) return draft;
      const ids = new Set(action.slideIds);
      if (draft.slideId !== null) return ids.has(draft.slideId) ? draft : null;
      if (draft.anchor.type !== 'gap') return draft;
      const { afterSlideId, beforeSlideId } = draft.anchor;
      return (afterSlideId && !ids.has(afterSlideId)) || (beforeSlideId && !ids.has(beforeSlideId))
        ? null
        : draft;
    }
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
      const lastPenTool = isPenTool(tool) ? tool : next.lastPenTool;
      return { ...next, tool, lastPenTool };
    }
    case 'anchorPlaced':
    case 'strokeAdded':
    case 'gapDraftStarted':
    case 'textBoxPlaced':
    case 'mediaDraftStarted':
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
    case 'threadFocused': {
      const threadPanelOpen = action.openPanel || next.threadPanelOpen;
      return {
        ...next,
        focusedThreadId: action.threadId,
        threadPanelOpen,
        // Both are right side panels: the thread panel takes the deleted slides' place.
        deletedPanelOpen: threadPanelOpen ? false : next.deletedPanelOpen,
      };
    }
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
    case 'deletedPanelSet':
      return action.open
        ? { ...next, deletedPanelOpen: true, threadPanelOpen: false, focusedThreadId: null }
        : { ...next, deletedPanelOpen: false };
    case 'slidesReplaced': {
      const ids = new Set(action.slideIds);
      const keepActive = next.activeSlideId !== null && ids.has(next.activeSlideId);
      const keepHover = next.hoveredSlideId === null || ids.has(next.hoveredSlideId);
      if (keepActive && keepHover) return next;
      return {
        ...next,
        activeSlideId: keepActive ? next.activeSlideId : action.fallbackSlideId,
        hoveredSlideId: keepHover ? next.hoveredSlideId : null,
      };
    }
    default:
      return next;
  }
}

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
