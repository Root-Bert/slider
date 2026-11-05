import type { Anchor, PathStrokeTool, Rect, Stroke } from '@slider/shared';
import type { StatusFilter } from '../comments/lib/comment-selectors';
import type { SlideZoom } from '../stage/lib/slide-zoom';

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
  /**
   * Its slide (gap: both neighbours) left the shown slides – deleted by a new revision or
   * hidden. The composer stays with what is written in it but can't send.
   */
  slideGone?: boolean;
  /**
   * The composer holds what the draft itself doesn't – text, a recording (running or finished),
   * a sketch – or is sending it (`draftHeld`). Then a click elsewhere doesn't replace the draft.
   */
  held?: boolean;
  /** Counts the clicks that would have replaced this draft but were ignored (`keepsDraft`). */
  nudge?: number;
  /**
   * A box drawn while speaking to the AI: what is said (or typed) meanwhile belongs to it, ↵
   * sends it to the AI (`AiBoxComposer`) – the box's own number, new for each box drawn.
   */
  aiBox?: number;
  /**
   * The box for the AI adds to this thread, whose request the AI still works on: sent, it is a
   * reply there, the AI stopped and asked again with it (`useSendAiBox`).
   */
  aiThreadId?: string;
}

/** One's own drawing just saved: typing right away comments on it (`drawingCommentStarted`). */
export interface SavedDrawing {
  slideId: string;
  commentId: string;
  anchor: Anchor;
  strokes: Stroke[];
}

/** A reply dialog for a thread: record (voice, video) or draw (image). */
export interface MediaReply {
  threadId: string;
  kind: 'audio' | 'video' | 'image';
}

export interface ViewerState {
  activeSlideId: string | null;
  tool: Tool | null;
  draft: Draft | null;
  /** The latest freehand, arrow or marker drawing while its tool is still picked. */
  lastDrawing: SavedDrawing | null;
  focusedThreadId: string | null;
  threadPanelOpen: boolean;
  /** "Bearbeiten" from a card's context menu: the thread panel opens with this comment's editor. */
  editingCommentId: string | null;
  statusFilter: StatusFilter;
  /** The filter before the comments were hidden: K brings it back (`commentsToggled`). */
  shownStatusFilter: Exclude<StatusFilter, 'hidden'>;
  /**
   * Threads someone is replying to right now (typed reply, open voice/video/sketch dialog), with
   * how many fields hold them. They stay listed even when they stop matching the status filter –
   * e.g. someone else resolves one – so the card and the draft or recording in it don't vanish.
   */
  composingThreads: ReadonlyMap<string, number>;
  /**
   * The voice, video or sketch reply dialog that is open. Held here, not in the card that opened
   * it, so it outlives that card – windowed out by scrolling, or turned compact by a narrower
   * column – with the recording or drawing in it.
   */
  mediaReply: MediaReply | null;
  /**
   * Avatar filter (bottom right): the viewer's own id = threads that @mention them (BER-105),
   * someone else's = threads they wrote in. `null` = everyone.
   */
  personFilter: string | null;
  /** Split handle position `t` ∈ [0, 1] (slide size vs comment area), `null` = default; see `timeline/lib/split`. */
  split: number | null;
  /**
   * Zoom inside slides, past the largest slide size (`stage/lib/slide-zoom`), by slide id: every
   * slide keeps its own zoom and the part it shows. Missing = whole (or, cropped, from its top).
   */
  slideZooms: ReadonlyMap<string, SlideZoom>;
  /**
   * "Änderungen": badges of the latest revision on track and minimap (Figma D2). On by default –
   * the switch only shows when the latest revision changed slides, so there is always something
   * to mark.
   */
  showChanges: boolean;
  /** Side panel with the slides deleted in later revisions and their comments (BER-109). */
  deletedPanelOpen: boolean;
  /** „Ebenen“ (L): the slides on the track shown taken apart in 3D. */
  layersOpen: boolean;
  /**
   * The active slide's layers in the side panel, where the thread or the deleted slides would
   * be – opens with „Ebenen“, closes on its own (the mode stays on).
   */
  layersPanelOpen: boolean;
  /**
   * „Hintergrund“ from a slide's right-click menu: that slide's background in the side panel,
   * where the thread, the deleted slides or the layers would be – by its page id, `null` = closed.
   */
  backgroundPanelPageId: string | null;
  /** „Layout umbenennen“ from a template slide's right-click menu: its page id, `null` = closed. */
  layoutRenamePageId: string | null;
  /**
   * Box mode (B): a click comments on the PowerPoint box under the pointer, which is outlined
   * while hovered. Off: a click places a free comment and boxes never show.
   */
  boxMode: boolean;
  /** ⌥ held: box mode is flipped for as long as the key is down. */
  boxModeFlipped: boolean;
  /** "Hilfslinien zeigen": PowerPoint's drawing guides, and the boxes that cross them. */
  showGuides: boolean;
  /** „Layout-Ansicht“ (H): the layout grid over the slides – a template's, or a presentation's template's. */
  showLayoutGrid: boolean;
  /**
   * Its columns and rows set in the side panel (⇧H, the view on with it) – where the thread, the
   * deleted slides, the layers or a background would be.
   */
  layoutGridPanelOpen: boolean;
  /**
   * „Exportieren“ (S): the deck's file (a template's as `.otp`) and a PDF in the side panel – where
   * the thread, the deleted slides, the layers, a background or the layout grid would be.
   */
  sharePanelOpen: boolean;
  /**
   * Something picked on the board (Folie 0): its file, link or note in the side panel – where the
   * thread or the others would be (`MaterialBoard` keeps what is picked).
   */
  boardPanelOpen: boolean;
  /** The direction of the grid being set (its fields in use): only it shows meanwhile. */
  layoutGridAxis: 'columns' | 'rows' | null;
  /** Slides hidden in PowerPoint: out of sight by default, H or the toolbar shows them. */
  showHiddenSlides: boolean;
  /** The minimap under the track: opens as set on /konto, the button left of the slide counter toggles it. */
  showMinimap: boolean;
  /**
   * The split handle pushed the comment area out of sight (desktop): the participants give way,
   * only the AI's avatar stays – in the controls row.
   */
  commentsClosed: boolean;
  /**
   * Portrait pages in 16:9 frames, the page filling its frame – the wheel moves the part it
   * shows. Only counts when the deck has portrait pages (`frame-format`).
   */
  wideFrames: boolean;
}

export type ViewerAction =
  | { type: 'activeSlideChanged'; slideId: string }
  | { type: 'toolSelected'; tool: Tool | null }
  /** `aiBox`: a box drawn while speaking to the AI – it goes to the AI (`Draft.aiBox`). */
  | { type: 'anchorPlaced'; slideId: string; anchor: Anchor; aiBox?: number; aiThreadId?: string }
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
  /** The composer started (`true`) or stopped holding unsent content (see `Draft.held`). */
  | { type: 'draftHeld'; held: boolean }
  | { type: 'draftCancelled' }
  | { type: 'draftSubmitted' }
  | { type: 'threadFocused'; threadId: string; openPanel: boolean }
  | { type: 'threadPanelClosed' }
  | { type: 'commentEditRequested'; threadId: string; commentId: string }
  | { type: 'commentEditEnded' }
  /** Inline thread collapsed: drops the focus unless the panel shows that thread. */
  | { type: 'threadUnfocused'; threadId: string }
  | { type: 'statusFilterChanged'; filter: StatusFilter }
  /** K: hides the comments, or brings back the filter they were hidden from. */
  | { type: 'commentsToggled' }
  /** A reply field of the thread started (`true`) or stopped (`false`) holding a draft. */
  | { type: 'composingChanged'; threadId: string; composing: boolean }
  | { type: 'mediaReplyOpened'; reply: MediaReply }
  | { type: 'mediaReplyClosed' }
  /** Click on an avatar: filters by that person, a second click clears it. */
  | { type: 'personFilterToggled'; authorId: string }
  /** `null` resets the split to the default. */
  | { type: 'splitChanged'; split: number | null }
  /** `null` ends that slide's zoom: it shows whole again. */
  | { type: 'slideZoomChanged'; slideId: string; zoom: SlideZoom | null }
  | { type: 'showChangesSet'; show: boolean }
  | { type: 'deletedPanelSet'; open: boolean }
  | { type: 'layersSet'; open: boolean }
  | { type: 'layersPanelSet'; open: boolean }
  /** `null` closes it. */
  | { type: 'backgroundPanelSet'; pageId: string | null }
  /** `null` closes it. */
  | { type: 'layoutRenameSet'; pageId: string | null }
  | { type: 'boxModeToggled' }
  | { type: 'boxModeFlipped'; flipped: boolean }
  | { type: 'showGuidesToggled' }
  | { type: 'layoutGridToggled' }
  | { type: 'layoutGridPanelSet'; open: boolean }
  | { type: 'sharePanelSet'; open: boolean }
  | { type: 'boardPanelSet'; open: boolean }
  | { type: 'layoutGridAxisSet'; axis: 'columns' | 'rows' | null }
  | { type: 'showHiddenSlidesToggled' }
  | { type: 'showMinimapToggled' }
  | { type: 'commentsClosedSet'; closed: boolean }
  | { type: 'wideFramesToggled' }
  /** Comments refetched: a thread deleted meanwhile (by someone else) loses focus and panel. */
  | { type: 'threadsReplaced'; threadIds: ReadonlySet<string> }
  /** A new revision arrived: drop what points at slides that are gone (BER-107). */
  | { type: 'slidesReplaced'; slideIds: readonly string[]; fallbackSlideId: string | null };
