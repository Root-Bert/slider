import type { Anchor, PathStrokeTool, Rect, Stroke } from '@slider/shared';
import type { StatusFilter } from '../comments/lib/comment-selectors';

/**
 * Drawing tools of the tool bar: freehand, arrow, marker (BER-98). Boxes are the pointer's
 * (drag); stored `rect`/`ellipse` strokes from earlier still render.
 */
export type PenTool = Exclude<PathStrokeTool, 'rect' | 'ellipse'>;
/**
 * A picked pen or the eraser (removes one's own freehand and marker strokes); `null` is the
 * pointer – click = pin, drag = box, or a PowerPoint box in box mode.
 */
export type Tool = PenTool | 'eraser';

export const isPenTool = (tool: Tool | null): tool is PenTool => tool !== null && tool !== 'eraser';

/** The tool bar's order, pointer first – Tab / ⇧Tab steps through it. */
export const TOOL_CYCLE: readonly (Tool | null)[] = [null, 'pen', 'arrow', 'highlighter', 'eraser'];

/** The tool `step` places after `tool` in the tool bar, wrapping around. */
export function cycleTool(tool: Tool | null, step: 1 | -1): Tool | null {
  const index = TOOL_CYCLE.indexOf(tool);
  return TOOL_CYCLE[(index + step + TOOL_CYCLE.length) % TOOL_CYCLE.length] ?? null;
}

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
  /**
   * The bare drawing (freehand, arrow, marker) this comment is written for: sending replaces it
   * with a comment carrying its strokes. Its strokes are fixed – no undo/redo.
   */
  commentId: string | null;
  /** The comment's first characters – typed right after drawing, before the composer opened. */
  initialBody?: string;
}

/** One's own drawing just saved: typing right away comments on it (`drawingCommentStarted`). */
export interface SavedDrawing {
  slideId: string;
  commentId: string;
  anchor: Anchor;
  strokes: Stroke[];
}

/** A slide shown as it was when a comment was written (`previousView`). */
export interface PreviousView {
  slideId: string;
  /** The thread whose "Alt/Neu" switch set it. */
  threadId: string;
}

export interface ViewerState {
  activeSlideId: string | null;
  tool: Tool | null;
  draft: Draft | null;
  /** The latest freehand, arrow or marker drawing while its tool is still picked. */
  lastDrawing: SavedDrawing | null;
  focusedThreadId: string | null;
  hoveredThreadId: string | null;
  /** Slide (or its comment column) under the pointer – its connector lines are drawn too. */
  hoveredSlideId: string | null;
  threadPanelOpen: boolean;
  /** "Bearbeiten" from a card's context menu: the thread panel opens with this comment's editor. */
  editingCommentId: string | null;
  statusFilter: StatusFilter;
  /**
   * Threads someone is replying to right now (typed reply, open voice/video/sketch dialog), with
   * how many fields hold them. They stay listed even when they stop matching the status filter –
   * e.g. someone else resolves one – so the card and the draft or recording in it don't vanish.
   */
  composingThreads: ReadonlyMap<string, number>;
  /**
   * Avatar filter (bottom right): the viewer's own id = threads that @mention them (BER-105),
   * someone else's = threads they wrote in. `null` = everyone.
   */
  personFilter: string | null;
  /** Split handle position `t` ∈ [0, 1] (slide size vs comment area), `null` = default; see `timeline/lib/split`. */
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
   * "Alt" on a comment whose slide changed since (BER-109): that slide shows the version the
   * comment was written on. One at a time; `null` = every slide as it is now.
   */
  previousView: PreviousView | null;
  /**
   * Box mode (B): a click comments on the PowerPoint box under the pointer, which is outlined
   * while hovered. Off: a click places a free comment and boxes never show.
   */
  boxMode: boolean;
  /** ⌥ held: box mode is flipped for as long as the key is down. */
  boxModeFlipped: boolean;
  /** "Hilfslinien zeigen": PowerPoint's drawing guides, and the boxes that cross them. */
  showGuides: boolean;
  /** Slides hidden in PowerPoint: out of sight by default, H or the toolbar shows them. */
  showHiddenSlides: boolean;
}

export type ViewerAction =
  | { type: 'activeSlideChanged'; slideId: string }
  | { type: 'toolSelected'; tool: Tool | null }
  | { type: 'anchorPlaced'; slideId: string; anchor: Anchor }
  | { type: 'strokeAdded'; slideId: string; stroke: Stroke }
  | { type: 'gapDraftStarted'; afterSlideId: string | null; beforeSlideId: string | null }
  /** A click on a bare drawing's badge: the composer opens to comment on it. */
  | {
      type: 'drawingCommentStarted';
      slideId: string;
      commentId: string;
      anchor: Anchor;
      strokes: Stroke[];
      /** Typed right after drawing: the comment starts with it. */
      text?: string;
    }
  /** A freehand, arrow or marker stroke was stored as a bare drawing. */
  | ({ type: 'drawingSaved' } & SavedDrawing)
  /**
   * A text box was clicked or dragged open on a slide; on the same slide it keeps its text –
   * unless `text` starts it (typing right after drawing a box).
   */
  | {
      type: 'textBoxPlaced';
      slideId: string;
      box: Pick<TextBoxDraft, 'x' | 'y' | 'width' | 'minHeight' | 'fontSize'>;
      text?: string;
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
  | { type: 'commentEditRequested'; threadId: string; commentId: string }
  | { type: 'commentEditEnded' }
  /** Inline thread collapsed: drops the focus unless the panel shows that thread. */
  | { type: 'threadUnfocused'; threadId: string }
  | { type: 'statusFilterChanged'; filter: StatusFilter }
  /** A reply field of the thread started (`true`) or stopped (`false`) holding a draft. */
  | { type: 'composingChanged'; threadId: string; composing: boolean }
  /** Click on an avatar: filters by that person, a second click clears it. */
  | { type: 'personFilterToggled'; authorId: string }
  /** `null` resets the split to the default. */
  | { type: 'splitChanged'; split: number | null }
  | { type: 'showChangesSet'; show: boolean }
  | { type: 'deletedPanelSet'; open: boolean }
  /** "Alt/Neu" on a comment: `null` shows every slide as it is now again. */
  | { type: 'previousViewSet'; view: PreviousView | null }
  | { type: 'boxModeToggled' }
  | { type: 'boxModeFlipped'; flipped: boolean }
  | { type: 'showGuidesToggled' }
  | { type: 'showHiddenSlidesToggled' }
  /** Comments refetched: a thread deleted meanwhile (by someone else) loses focus and panel. */
  | { type: 'threadsReplaced'; threadIds: ReadonlySet<string> }
  /** A new revision arrived: drop what points at slides that are gone (BER-107). */
  | { type: 'slidesReplaced'; slideIds: readonly string[]; fallbackSlideId: string | null };
