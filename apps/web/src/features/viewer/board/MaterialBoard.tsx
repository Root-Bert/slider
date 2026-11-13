import {
  ACCENT_COLORS,
  BOARD_MIN_SIDE,
  type BoardFrame,
  type BoardItem,
  type Material,
} from '@slider/shared';
import {
  Background,
  BackgroundVariant,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore,
  type NodeChange,
  type NodeTypes,
  type ResizeParams,
} from '@xyflow/react';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ACCENT_COLOR_NAMES, accentColor, selectionStyle } from '@/lib/accent';
import { isTextTarget } from '@/lib/dom';
import { isModKey } from '@/lib/keyboard';
import { downloadNextcloudFile, useNextcloudConnections } from '@/lib/api';
import { NextcloudBrowser } from '@/features/nextcloud';
import {
  Button,
  cn,
  ConfirmDialog,
  ContextMenu,
  Dialog,
  GlassPanel,
  Icon,
  IconButton,
  NextcloudMark,
  Toolbar,
  ToolbarDivider,
} from '@/ui';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import {
  BoardNodeContext,
  boardNodes,
  holding,
  reflow,
  inFolders,
  isMaterial,
  isThing,
  isUploading,
  liesIn,
  noteColor,
  notesBeside,
  type BoardEntry,
  type BoardNode,
} from './board-nodes';
import { BoardNodeView } from './BoardNodeView';
import { RectFrame } from '../stage/RectFrame';
import { BoardPanel } from './BoardPanel';
import { askKeys, useNoteAnswers, type NoteAnswerValue } from './note-answers';
import { droppedItems } from './folder-files';
import { useBoard, useFolderUploads } from './useBoard';

/*
 * „Material“: the deck's board, a page of its own beside the presentation – a free surface like a moodboard where
 * files, links and notes lie (`useBoard`), shown with React Flow. A drag on the empty surface draws
 * a box as on a slide in Besprechen and the caret goes into it, as into a sticker on a slide: what
 * is typed is the note. Round one thing (a file mostly inside it, or begun on a picked file's
 * preview) the note hangs on it – the box goes, the thing is marked, the note's card stands
 * beside it; round several it hangs on all, its box drawn round them; on empty space it stays a
 * sticker. A click picks (⌘ adds) and opens its side panel, a drag on something moves it, ⌘ and a
 * drag on the surface pick with a box; ⇧ and a drag, the wheel and two fingers move the surface,
 * ⌘ and the wheel or a pinch zoom. Files, pictures, links and text come in by dropping, pasting
 * (⌘V, at the pointer) or „Material hinzufügen“. React Flow only shows it: what is picked and
 * where things lie live here and in `useBoard`. Never part of the deck's file.
 */

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
/** The dots' spacing (`dot-grid`); moved and resized cards snap to half of it. */
const GRID = 22;
const NODE_TYPES: NodeTypes = { item: BoardNodeView };
const NO_FRAMES: ReadonlyMap<string, BoardFrame> = new Map();
const NO_IDS: ReadonlySet<string> = new Set();
/** Room kept around everything shown whole, more under the controls on top. */
const FIT_PAD = { top: 72, right: 48, bottom: 48, left: 48 };
/** A note's card beside its box (`w-60` and its gap). */
const NOTE_CARD_ROOM = 252;
const px = (n: number) => `${n}px` as const;

/**
 * The size React Flow is laid out at: the screen's (larger only where the board is), never the
 * board's own. React Flow measures its box in a ResizeObserver and re-renders at once; the board's
 * box changes every frame while the deck's layout animates (the slide overview folding), when the
 * connector lines measure and write in the same observer round – „ResizeObserver loop completed
 * with undelivered notifications“. So it gets a box that stays, cut to the board by its overflow;
 * fitting and the zoom buttons count from the part seen.
 */
const stageFor = (w: number, h: number) => ({
  w: Math.ceil(Math.max(window.screen.width, window.innerWidth, w)),
  h: Math.ceil(Math.max(window.screen.height, window.innerHeight, h)),
});

/** Text pasted or dropped that is one web address. */
const asUrl = (text: string): string | null => {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
};

/** A press that moves this far (screen px) draws a box; less is a click. */
const DRAW_SLOP = 5;
/** A pasted text's note: its box at the pointer. */
const PASTED_BOX = { w: 160, h: 80 };
/** „Fragen“: a note to write the question in, at the middle of what is in view. */
const QUESTION_BOX = { w: 240, h: 96 };
/**
 * Below which width of the controls' row (its content, px) each part gives way – measured with
 * every button there (`canComment`), a few px to spare: labels first, then the zoom, then the
 * word „Material“. Nextcloud's button needs about 46 px more, its label about 70.
 */
const GIVE_WAY = {
  plain: {
    nextcloud: '',
    ask: '@max-[654px]:hidden',
    add: '@max-[604px]:hidden',
    leave: '@max-[474px]:hidden',
    zoom: '@max-[390px]:hidden',
    material: '@max-[256px]:hidden',
  },
  nextcloud: {
    nextcloud: '@max-[768px]:hidden',
    ask: '@max-[700px]:hidden',
    add: '@max-[650px]:hidden',
    leave: '@max-[520px]:hidden',
    zoom: '@max-[436px]:hidden',
    material: '@max-[302px]:hidden',
  },
} as const;
/** How much of a thing must lie in a box drawn (or of the box on it) for the note to hang on it. */
const MOSTLY = 0.6;

const overlap = (a: BoardFrame, b: BoardFrame) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * What a box drawn takes in: the things (files, links, folders) mostly inside it – the box holds
 * them; or, none of them, the one file the box lies mostly on – a note beside that file.
 */
function takenIn(
  rect: BoardFrame,
  things: readonly BoardEntry[],
): { held: string[]; beside: string | null } {
  const inside = things.filter(
    (thing) => !isUploading(thing) && overlap(rect, thing) >= MOSTLY * thing.w * thing.h,
  );
  if (inside.length > 0) return { held: inside.map((thing) => thing.id), beside: null };
  const under = things.find(
    (thing) => isMaterial(thing) && overlap(rect, thing) >= MOSTLY * rect.w * rect.h,
  );
  return { held: [], beside: under?.id ?? null };
}

/** A note or box: what may be asked (its text the question). */
const isNote = (item: BoardEntry): item is BoardItem =>
  !isMaterial(item) && (item.kind === 'note' || item.kind === 'box');

/** Where a new note lies free: from `start`, past whatever it would cover, to the right. */
function freeSpot(start: BoardFrame, things: readonly BoardFrame[]): { x: number; y: number } {
  const spot = { ...start };
  for (let step = 0; step < 50; step++) {
    const covered = things.filter((thing) => overlap(spot, thing) > 0);
    if (covered.length === 0) break;
    spot.x = Math.max(...covered.map((thing) => thing.x + thing.w)) + 24;
  }
  return { x: spot.x, y: spot.y };
}

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

const frameOf = ({ x, y, width, height }: ResizeParams): BoardFrame => ({
  x,
  y,
  w: width,
  h: height,
});

export const MaterialBoard = memo(function MaterialBoard(props: {
  w: number;
  h: number;
  /** „Präsentation →“: back to the presentation beside the material page. */
  onLeave: () => void;
}) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
});

function Board({ w, h, onLeave }: { w: number; h: number; onLeave: () => void }) {
  const { canComment, canManage, viewer, aiAuthor } = useViewerData();
  const {
    board,
    loading,
    addFiles,
    addFolder,
    addNote,
    addBox,
    addLink,
    updateText,
    setBound,
    setColor,
    move,
    remove,
    saved,
  } = useBoard();
  // The AI's answers under notes (⌘↵), seen by everyone who sees the board.
  const answers = useNoteAnswers(saved);
  const [deletingAnswer, setDeletingAnswer] = useState<NoteAnswerValue | null>(null);
  const flow = useReactFlow<BoardNode>();
  const zoom = useStore((state) => state.transform[2]);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // „Aus Nextcloud wählen“ once an account is connected: a picked file comes as if from disk.
  const nextcloudConnected = (useNextcloudConnections(canComment).data?.length ?? 0) > 0;
  const giveWay = GIVE_WAY[nextcloudConnected ? 'nextcloud' : 'plain'];
  const [browsingNextcloud, setBrowsingNextcloud] = useState(false);
  // Counts the dialog's closings: a download it was closed during is dropped, not added.
  const nextcloudClosings = useRef(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [live, setLive] = useState<ReadonlyMap<string, BoardFrame>>(NO_FRAMES);
  const [editing, setEditing] = useState<string | null>(null);
  /** A note whose box was just drawn, typed in: saved once it has a text, on what it took in. */
  const [draft, setDraft] = useState<BoardItem | null>(null);
  /** A box being drawn on the empty surface (screen points). */
  const [drawing, setDrawing] = useState<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    /** The board's top left on screen when it began. */
    origin: { x: number; y: number };
    /** Begun on a picked file's preview: the note goes on that file. */
    fileId: string | null;
  } | null>(null);
  /** What the box being drawn takes in now (shown picked). */
  const [covering, setCovering] = useState<string[]>([]);
  /** Frames something being dragged would join (lit). */
  const [targets, setTargets] = useState<ReadonlySet<string>>(new Set());
  /** Being dragged (a box's things with it): over everything till released. */
  const [lifted, setLifted] = useState<ReadonlySet<string>>(NO_IDS);
  /** A note or frame emptied of its text: deleted once confirmed. */
  const [emptied, setEmptied] = useState<BoardItem | null>(null);
  /** A note's or frame's right click. */
  const [menuAt, setMenuAt] = useState<{ item: BoardItem; x: number; y: number } | null>(null);
  /** Where the pointer last was over the board – pasted text goes there. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [stage, setStage] = useState(() => stageFor(w, h));
  // Grows only where the board outgrows it (a page zoomed far out): resized once, not per frame.
  if (w > stage.w || h > stage.h) setStage(stageFor(w * 1.5, h * 1.5));

  const items = useMemo<BoardEntry[]>(
    () => [...board.materials, ...board.items],
    [board.materials, board.items],
  );
  // What a box being drawn would take in, and what a frame holds: files, links, stickers.
  const hidden = useMemo(() => inFolders(board.items), [board.items]);
  const things = useMemo<BoardEntry[]>(
    () => items.filter((item) => isThing(item) && !hidden.has(item.id)),
    [items, hidden],
  );
  const folderUploads = useFolderUploads();
  const fileById = useMemo(
    () => new Map(board.materials.map((file) => [file.id, file])),
    [board.materials],
  );
  /** The folder opened: its files laid out under it. */
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  /** A folder's file being pulled out onto the board (screen points). */
  const [carrying, setCarrying] = useState<{
    file: Material;
    folder: BoardItem;
    start: { x: number; y: number };
    at: { x: number; y: number };
    origin: { x: number; y: number };
  } | null>(null);
  /** A folder to be deleted: asked whether its files go too. */
  const [deletingFolder, setDeletingFolder] = useState<BoardItem | null>(null);
  // Boxes: holding what lies in them.
  const frames = useMemo(() => board.items.filter((item) => item.kind === 'box'), [board.items]);
  const nodes = useMemo(
    () =>
      boardNodes(board, {
        selected: covering.length > 0 ? new Set([...selected, ...covering]) : selected,
        live,
        canMove: canComment,
        editing,
        draft,
        targets,
        openFolder,
        lifted,
      }),
    [board, selected, covering, live, canComment, editing, draft, targets, openFolder, lifted],
  );
  const beside = useMemo(() => notesBeside(board.items), [board.items]);
  const own = (item: BoardEntry) => item.author.id === viewer.author.id;
  const mayDelete = (item: BoardEntry) => canManage || (canComment && own(item));

  /** Board units under a point on screen. */
  const toBoard = (clientX: number, clientY: number) =>
    flow.screenToFlowPosition({ x: clientX, y: clientY }, { snapToGrid: false });
  /** Where new things go when no point is given: the middle of what is in view. */
  const middle = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    const at = rect
      ? toBoard(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : { x: 0, y: 0 };
    return { x: at.x - 110, y: at.y - 90 };
  };
  /** Shown whole in the part seen: at most at 100 %. */
  const fitOptions = () => ({
    maxZoom: 1,
    padding: {
      top: px(FIT_PAD.top),
      left: px(FIT_PAD.left),
      // Notes' cards stand beside their boxes and files, outside the nodes React Flow fits.
      right: px(FIT_PAD.right + NOTE_CARD_ROOM + stage.w - w),
      bottom: px(FIT_PAD.bottom + stage.h - h),
    },
  });
  const fit = () => void flow.fitView({ ...fitOptions(), duration: 200 });
  /** Zoomed by `factor` around the middle of the part seen. */
  const zoomBy = (factor: number) => {
    const view = flow.getViewport();
    const next = clampZoom(view.zoom * factor);
    void flow.setViewport(
      {
        zoom: next,
        x: w / 2 - ((w / 2 - view.x) / view.zoom) * next,
        y: h / 2 - ((h / 2 - view.y) / view.zoom) * next,
      },
      { duration: 150 },
    );
  };

  // The sticker editor (Lexical, its own chunk) fetched ahead: a box drawn takes the caret at once.
  useEffect(() => {
    if (canComment) void import('./RichSticker');
  }, [canComment]);

  // Shown whole once the board first arrives.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || loading) return;
    fitted.current = true;
    if (items.length > 0) requestAnimationFrame(() => void flow.fitView(fitOptions()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only once, when it first arrives
  }, [loading]);

  // Nothing the board takes goes on to the page. Safari's pinch comes as gesture events.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = (event: Event) => event.stopPropagation();
    let pinchFrom = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      pinchFrom = 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      const rect = root.getBoundingClientRect();
      const view = flow.getViewport();
      const next = clampZoom((view.zoom * gesture.scale) / pinchFrom);
      const px = gesture.clientX - rect.left;
      const py = gesture.clientY - rect.top;
      pinchFrom = gesture.scale;
      void flow.setViewport({
        zoom: next,
        x: px - ((px - view.x) / view.zoom) * next,
        y: py - ((py - view.y) / view.zoom) * next,
      });
    };
    root.addEventListener('wheel', stop);
    root.addEventListener('gesturestart', onGestureStart);
    root.addEventListener('gesturechange', onGestureChange);
    return () => {
      root.removeEventListener('wheel', stop);
      root.removeEventListener('gesturestart', onGestureStart);
      root.removeEventListener('gesturechange', onGestureChange);
    };
  }, [flow]);

  // ── React Flow's changes, kept here ─────────────────────────────────────────

  const onNodesChange = (changes: NodeChange<BoardNode>[]) => {
    let picked: Set<string> | null = null;
    let dragged: Map<string, BoardFrame> | null = null;
    for (const change of changes) {
      if (change.type === 'select') {
        picked ??= new Set(selected);
        if (change.selected) picked.add(change.id);
        else picked.delete(change.id);
      } else if (change.type === 'position' && change.dragging && change.position) {
        const item = items.find((each) => each.id === change.id);
        if (!item) continue;
        dragged ??= new Map(live);
        dragged.set(change.id, { ...change.position, w: item.w, h: item.h });
        // A frame takes everything in it along.
        if (!isMaterial(item) && item.kind === 'box') {
          const dx = change.position.x - item.x;
          const dy = change.position.y - item.y;
          for (const thing of things)
            if (item.boundIds.includes(thing.id))
              dragged.set(thing.id, { x: thing.x + dx, y: thing.y + dy, w: thing.w, h: thing.h });
        }
      }
    }
    if (picked) setSelected(picked);
    if (dragged) {
      const now = dragged;
      // Things dragged on their own: the frames they would join light up.
      const moving = frames.filter((frame) => now.has(frame.id));
      const carried = new Set(moving.flatMap((frame) => frame.boundIds));
      const lit = new Set<string>();
      for (const frame of frames) {
        if (now.has(frame.id)) continue;
        for (const [id, at] of now)
          if (!carried.has(id) && !frame.boundIds.includes(id) && things.some((t) => t.id === id))
            if (liesIn(at, frame)) lit.add(frame.id);
      }
      // Drawn before the pointer's event is over: left to React's own time, the thing showed
      // where the pointer was a frame before every other frame – a judder.
      flushSync(() => {
        setLive(now);
        if (now.size !== lifted.size) setLifted(new Set(now.keys()));
        if ([...lit].join() !== [...targets].join()) setTargets(lit);
      });
    }
  };

  const settle = (frames: (BoardFrame & { id: string })[]) => {
    const moved = frames.filter((frame) => {
      const item = items.find((each) => each.id === frame.id);
      return (
        item &&
        (item.x !== frame.x || item.y !== frame.y || item.w !== frame.w || item.h !== frame.h)
      );
    });
    if (moved.length > 0) move(moved);
    setLive(NO_FRAMES);
    setTargets(new Set());
    setLifted(NO_IDS);
  };

  /** Frames of a box resized to `frame` and of what it holds, reflowed to its width. */
  const resized = (id: string, frame: BoardFrame): Map<string, BoardFrame> => {
    const box = frames.find((each) => each.id === id);
    if (!box || box.boundIds.length === 0) return new Map([[id, frame]]);
    const held = things.filter((thing) => box.boundIds.includes(thing.id));
    const laid = reflow(frame, held);
    const out = new Map<string, BoardFrame>([
      [id, { ...frame, w: Math.max(frame.w, laid.minW), h: Math.max(frame.h, laid.minH) }],
    ]);
    for (const { id: each, ...at } of laid.frames) out.set(each, at);
    return out;
  };

  /**
   * What frames hold after things were moved (`moved`: their new places) or a frame was resized:
   * a thing whose centre or most lies in a frame is in it, else not.
   */
  const regroup = (
    moved: ReadonlyMap<string, BoardFrame>,
    resized?: BoardFrame & { id: string },
  ) => {
    for (const frame of frames) {
      const box = resized?.id === frame.id ? resized : (moved.get(frame.id) ?? frame);
      let held = frame.boundIds;
      if (resized?.id === frame.id) {
        held = things.filter((thing) => liesIn(moved.get(thing.id) ?? thing, box)).map((t) => t.id);
      } else {
        for (const [id, at] of moved) {
          if (id === frame.id || !things.some((thing) => thing.id === id)) continue;
          // Carried by a frame of its own: it stays where it was held.
          if (moved.has(frame.id)) continue;
          const inside = liesIn(at, box);
          if (inside && !held.includes(id)) held = [...held, id];
          else if (!inside && held.includes(id)) held = held.filter((each) => each !== id);
        }
      }
      if (held.join() !== frame.boundIds.join()) setBound(frame.id, held);
    }
  };

  const ownItem = (item: BoardItem) => canComment && item.author.id === viewer.author.id;
  /** Its text may be handed to the AI (⌘↵, „KI fragen“) – anyone's note, by whoever may comment. */
  const askable = (item: BoardItem) => canComment && isNote(item) && item.text.trim() !== '';
  /** A folder's files laid out where it lay, its folder deleted alone (they stay on the board). */
  const deleteFolder = (folder: BoardItem, withFiles: boolean) => {
    setDeletingFolder(null);
    setOpenFolder(null);
    if (withFiles) {
      remove([...folder.boundIds, folder.id]);
      return;
    }
    const files = folder.boundIds.flatMap((id) => {
      const file = fileById.get(id);
      return file ? [file] : [];
    });
    if (files.length > 0)
      move(
        files.map((file, index) => ({
          id: file.id,
          x: folder.x + (index % 4) * (file.w + 24),
          y: folder.y + folder.h + 24 + Math.floor(index / 4) * (file.h + 24),
          w: file.w,
          h: file.h,
        })),
      );
    remove([folder.id]);
  };

  /**
   * A note's or frame's text taken (↵, ⌘↵, or left with text): the note it is saved as – a new
   * one's own id – or `null` when none is kept.
   */
  const takeNote = (
    item: BoardItem,
    { text, plain, rich }: Parameters<BoardNodeContext['onNoteDone']>[1],
  ): string | null => {
    setEditing(null);
    if (item.id === draft?.id) {
      // Written: a note beside the one file the box lay on (its words), else the box with its
      // rich text, holding what it took in.
      setDraft(null);
      if (!plain) return null;
      const frame = { x: item.x, y: item.y, w: item.w, h: item.h };
      return item.kind === 'note'
        ? addNote(frame, plain, item.boundIds)
        : addBox(frame, text, item.boundIds, rich);
    }
    // Emptied: deleted once it is confirmed, as a comment is.
    if (!plain) {
      setEmptied(item);
      return null;
    }
    if (text !== item.text || (rich && JSON.stringify(rich) !== JSON.stringify(item.rich)))
      updateText(item.id, text, rich);
    return item.id;
  };

  const context: BoardNodeContext = {
    openFolder,
    fileById,
    folderUpload: (id) => folderUploads.get(id),
    cameFrom: (file) => {
      if (!file.folderId || hidden.has(file.id)) return null;
      const folder = board.items.find((item) => item.id === file.folderId);
      return folder ? folder.text : null;
    },
    takeOut: (file, folder, event) => {
      if (!canComment || event.button !== 0) return;
      event.stopPropagation();
      const root = rootRef.current;
      if (!root) return;
      root.setPointerCapture(event.pointerId);
      const box = root.getBoundingClientRect();
      const at = { x: event.clientX, y: event.clientY };
      setCarrying({ file, folder, start: at, at, origin: { x: box.left, y: box.top } });
    },
    color: accentColor(viewer.author.color),
    resizable: (id) => canComment && selected.size === 1 && selected.has(id),
    canDraw: canComment,
    mayMove: canComment,
    isPicked: (id) => selected.has(id),
    editing,
    boxColorOf: (id) => {
      const box = frames.find((each) => each.boundIds.includes(id));
      return box ? noteColor(box) : null;
    },
    boxMin: (id) => {
      const box = frames.find((each) => each.id === id);
      if (!box) return { minW: 8, minH: 8 };
      const { minW, minH } = reflow(
        box,
        things.filter((thing) => box.boundIds.includes(thing.id)),
      );
      return { minW, minH };
    },
    markOf: (id) => {
      const note = beside.get(id)?.[0];
      return note ? noteColor(note) : null;
    },
    pick: (id, add) =>
      setSelected((current) => {
        if (!add) return new Set([id]);
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    edit: (item) => {
      if (ownItem(item)) setEditing(item.id);
    },
    mayEdit: ownItem,
    setColor: (item, color) => setColor(item.id, color === item.author.color ? null : color),
    onContextMenu: (item, event) => {
      if (!ownItem(item) && !mayDelete(item) && !askable(item)) return;
      event.preventDefault();
      event.stopPropagation();
      setMenuAt({ item, x: event.clientX, y: event.clientY });
    },
    onNoteDone: (item, value) => void takeNote(item, value),
    onNoteAsk: (item, value) => {
      const id = takeNote(item, value);
      if (id) answers.ask(id, item.kind === 'note' ? value.plain : value.text);
    },
    answerOf: (noteId) => answers.byNote.get(noteId),
    answers: {
      ai: aiAuthor,
      byId: fileById,
      canComment,
      streaming: answers.streaming,
      stop: answers.stop,
      retry: (answer) => {
        const note = board.items.find((each) => each.id === answer.noteId);
        if (note?.text.trim()) answers.ask(note.id, note.text);
      },
      remove: setDeletingAnswer,
      openSource: (material, page) => {
        if (!material.url) return;
        const at = page && material.kind === 'pdf' ? `#page=${page}` : '';
        window.open(`${material.url}${at}`, '_blank', 'noopener');
      },
    },
    onNoteCancel: (item) => {
      setEditing(null);
      if (item.id === draft?.id) setDraft(null);
    },
    // Drawn in the move's own task: left pending, React Flow's observer (its store updated at once)
    // rendered it inside the observer round – the card resized again there, „ResizeObserver loop
    // completed with undelivered notifications“.
    onResize: (id, frame) => flushSync(() => setLive(resized(id, frameOf(frame)))),
    // A box resized: what it holds reflowed to its new width, saved with it.
    onResizeEnd: (id, frame) => {
      const laid = resized(id, frameOf(frame));
      settle([...laid].map(([each, at]) => ({ id: each, ...at })));
    },
  };

  // ── Adding ────────────────────────────────────────────────────────────────

  /** Text pasted or dropped at `at`: a link, or a note with its box there. */
  const putText = (text: string, at: { x: number; y: number }) => {
    const url = asUrl(text);
    if (url) addLink(at, url);
    else if (text.trim()) setSelected(new Set([addBox({ ...at, ...PASTED_BOX }, text.trim(), [])]));
  };

  // ── Drawing a note's box ────────────────────────────────────────────────────

  const startDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    // On the empty surface or a picked file's preview, without ⇧ (moves the surface) or ⌘ (picks
    // with a box).
    if (!canComment || event.button !== 0 || event.shiftKey || isModKey(event)) return;
    const target = event.target as Element;
    const preview = target.closest<HTMLElement>('[data-file-preview]');
    if (!preview && !target.classList.contains('react-flow__pane')) return;
    const at = { x: event.clientX, y: event.clientY };
    const box = event.currentTarget.getBoundingClientRect();
    setDrawing({
      start: at,
      end: at,
      origin: { x: box.left, y: box.top },
      fileId: preview?.dataset.filePreview ?? null,
    });
  };
  const followDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    setDrawing({ ...drawing, end: { x: event.clientX, y: event.clientY } });
    const rect = boardRect(drawing.start, { x: event.clientX, y: event.clientY });
    const taken = drawing.fileId
      ? [drawing.fileId]
      : rect
        ? (({ held, beside }) => (beside ? [beside] : held))(takenIn(rect, things))
        : [];
    if (taken.join() !== covering.join()) setCovering(taken);
    // Captured once it is a drag: a plain click still reaches the surface (it lets go of what is
    // picked).
    if (
      Math.hypot(event.clientX - drawing.start.x, event.clientY - drawing.start.y) >= DRAW_SLOP &&
      !event.currentTarget.hasPointerCapture(event.pointerId)
    )
      event.currentTarget.setPointerCapture(event.pointerId);
  };
  const endDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    setDrawing(null);
    setCovering([]);
    const rect =
      event.type === 'pointerup' &&
      boardRect(drawing.start, { x: event.clientX, y: event.clientY });
    if (!rect) return;
    // Begun on a picked file's preview, or lying mostly on one file: a note beside it; else a box
    // holding what it took in.
    const { held, beside } = drawing.fileId
      ? { held: [], beside: drawing.fileId }
      : takenIn(rect, things);
    const note: BoardItem = {
      id: crypto.randomUUID(),
      deckId: '',
      author: viewer.author,
      kind: beside ? 'note' : 'box',
      text: '',
      url: null,
      boundIds: beside ? [beside] : held,
      color: null,
      rich: null,
      ...rect,
      createdAt: new Date().toISOString(),
    };
    setSelected(new Set());
    setDraft(note);
    setEditing(note.id);
  };
  /** „Fragen“: a note in the middle of what is in view, typed in at once – ⌘↵ asks the AI. */
  const startQuestion = () => {
    const start = { ...middle(), ...QUESTION_BOX };
    const at = freeSpot(start, items);
    const note: BoardItem = {
      id: crypto.randomUUID(),
      deckId: '',
      author: viewer.author,
      kind: 'box',
      text: '',
      url: null,
      boundIds: [],
      color: null,
      rich: null,
      ...at,
      ...QUESTION_BOX,
      createdAt: new Date().toISOString(),
    };
    setSelected(new Set());
    setDraft(note);
    setEditing(note.id);
    // Moved aside to lie free: the board follows it.
    if (at.x !== start.x)
      void flow.setCenter(at.x + QUESTION_BOX.w / 2, at.y + QUESTION_BOX.h / 2, {
        zoom,
        duration: 300,
      });
  };
  /** A box drawn from `a` to `b` (screen points) in board units; `null` while it is a click. */
  const boardRect = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    if (Math.hypot(b.x - a.x, b.y - a.y) < DRAW_SLOP) return null;
    const from = toBoard(a.x, a.y);
    const to = toBoard(b.x, b.y);
    return {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      w: Math.max(BOARD_MIN_SIDE, Math.abs(from.x - to.x)),
      h: Math.max(BOARD_MIN_SIDE, Math.abs(from.y - to.y)),
    };
  };
  /** The box being drawn, in the board's own px. */
  const drawn = (() => {
    if (!drawing) return null;
    const { start, end, origin } = drawing;
    if (Math.hypot(end.x - start.x, end.y - start.y) < DRAW_SLOP) return null;
    return {
      left: Math.min(start.x, end.x) - origin.x,
      top: Math.min(start.y, end.y) - origin.y,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  })();

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canComment) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDropping(false);
    if (!canComment) return;
    event.preventDefault();
    event.stopPropagation();
    const at = toBoard(event.clientX, event.clientY);
    const text =
      event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    // Folders dropped: each one a folder with every file in it; loose files as cards.
    void droppedItems(event.dataTransfer).then(({ folders, files }) => {
      folders.forEach((folder, index) =>
        addFolder(folder.name, folder.files, { x: at.x + index * 264, y: at.y }),
      );
      if (files.length > 0) addFiles(files, folders.length > 0 ? { x: at.x, y: at.y + 240 } : at);
      else if (folders.length === 0) putText(text, at);
    });
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!canComment || isTextTarget(event.target)) return;
    const files = [...event.clipboardData.files];
    const text = event.clipboardData.getData('text/plain');
    if (files.length === 0 && !text.trim()) return;
    event.preventDefault();
    event.stopPropagation();
    if (files.length > 0) addFiles(files, middle());
    else putText(text, pointer.current ? toBoard(pointer.current.x, pointer.current.y) : middle());
  };

  // Keys only while the board has the focus: it stays mounted beside the slides.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTextTarget(event.target)) return;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const gone = items.filter((item) => selected.has(item.id) && mayDelete(item));
      if (gone.length === 0) return;
      const folder = gone.find((item) => !isMaterial(item) && item.kind === 'folder');
      if (folder && !isMaterial(folder) && folder.boundIds.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setDeletingFolder(folder);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      remove(gone.map((item) => item.id));
      setSelected(new Set());
    } else if (event.key === 'Escape' && (selected.size > 0 || openFolder)) {
      event.stopPropagation();
      setSelected(new Set());
      setOpenFolder(null);
    } else if (event.key === 'Enter' && isModKey(event) && canComment) {
      // ⌘↵ on one picked note: asked as while typing it.
      const notes = items.filter((item) => selected.has(item.id)).filter(isNote);
      if (notes.length !== 1 || !notes[0]!.text.trim()) return;
      event.preventDefault();
      event.stopPropagation();
      answers.ask(notes[0]!.id, notes[0]!.text);
    } else if (event.key === 'a' && isModKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      setSelected(new Set(items.map((item) => item.id)));
    }
  };

  const open = (item: BoardEntry) => {
    if (isMaterial(item)) {
      if (item.url) window.open(item.url, '_blank', 'noopener');
    } else if (item.kind === 'link' && item.url)
      window.open(item.url, '_blank', 'noopener,noreferrer');
    else if (ownItem(item)) setEditing(item.id);
  };

  // ── Its side panel ────────────────────────────────────────────────────────

  const viewerState = useViewerState();
  const dispatch = useViewerDispatch();
  const picked = selected.size === 1 ? items.find((item) => selected.has(item.id)) : undefined;
  // Only files, links and folders have a side panel; boxes keep their bar and right click.
  const panelItem =
    picked &&
    (isMaterial(picked) || picked.kind === 'link' || picked.kind === 'folder') &&
    !(editing && picked.id === editing)
      ? picked
      : undefined;
  // One of the deck's side panels, floating over the board as over the slides: open while one
  // thing is picked (gone with it).
  useEffect(() => {
    dispatch({ type: 'boardPanelSet', open: !!panelItem });
  }, [dispatch, panelItem]);
  useEffect(() => () => dispatch({ type: 'boardPanelSet', open: false }), [dispatch]);
  // Closed elsewhere (Esc, leaving the material page): what was picked is let go.
  const [panelShown, setPanelShown] = useState(false);
  if (viewerState.boardPanelOpen !== panelShown) {
    setPanelShown(viewerState.boardPanelOpen);
    if (panelShown && panelItem) setSelected(new Set());
  }
  const names = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.id,
          isMaterial(item)
            ? item.name
            : item.kind === 'link'
              ? item.text || item.url || 'Link'
              : item.text.slice(0, 40),
        ]),
      ),
    [items],
  );

  const fileCount = board.materials.length;

  return (
    <section
      data-material-board
      aria-label="Material"
      className="absolute"
      style={{ left: 0, top: 0, width: w, height: h }}
    >
      <div
        ref={rootRef}
        tabIndex={0}
        role="application"
        aria-roledescription="Materialfläche"
        className={cn(
          'material-board relative h-full w-full touch-none overflow-hidden rounded-panel bg-surface-1 ring-hairline outline-none select-none focus-visible:ring-hairline-strong',

          dropping && 'ring-hairline-strong',
        )}
        style={selectionStyle(viewer.author.color)}
        // React Flow's pane takes the press for itself: the board gets the focus for its keys.
        onPointerDownCapture={(event) => {
          if (!isTextTarget(event.target)) rootRef.current?.focus({ preventScroll: true });
        }}
        onPointerDown={startDrawing}
        onPointerMove={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY };
          if (carrying) setCarrying({ ...carrying, at: { x: event.clientX, y: event.clientY } });
          followDrawing(event);
        }}
        onPointerUp={(event) => {
          if (carrying) {
            // Pulled far enough: out of its folder, a card of its own where it was let go (still
            // marked as from it); else it was a click.
            setCarrying(null);
            const { file, folder, start } = carrying;
            if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAW_SLOP) return;
            const at = toBoard(event.clientX, event.clientY);
            move([{ id: file.id, x: at.x - file.w / 2, y: at.y - 24, w: file.w, h: file.h }]);
            setBound(
              folder.id,
              folder.boundIds.filter((id) => id !== file.id),
            );
            return;
          }
          endDrawing(event);
        }}
        onPointerCancel={(event) => {
          setCarrying(null);
          endDrawing(event);
        }}
        onPointerLeave={() => {
          pointer.current = null;
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      >
        <BoardNodeContext.Provider value={context}>
          <div className="absolute top-0 left-0" style={{ width: stage.w, height: stage.h }}>
            <ReactFlow<BoardNode>
              nodes={nodes}
              edges={[]}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onNodeDragStop={(_, __, dragged) => {
                // Where everything went – a frame's things with it – and what frames hold now.
                const moved = new Map(live);
                for (const node of dragged)
                  moved.set(node.id, {
                    x: node.position.x,
                    y: node.position.y,
                    w: node.data.item.w,
                    h: node.data.item.h,
                  });
                // A box something was dropped in grows to hold it – in the same step, so the
                // release changes its things, its size and where everything lies at once.
                const out = new Map(moved);
                for (const box of frames) {
                  if (moved.has(box.id)) continue;
                  let grown: BoardFrame = box;
                  for (const [id, at] of moved)
                    if (
                      !box.boundIds.includes(id) &&
                      things.some((t) => t.id === id) &&
                      liesIn(at, box)
                    )
                      grown = holding(grown, at);
                  if (grown !== box) out.set(box.id, grown);
                }
                regroup(moved);
                settle([...out].map(([id, frame]) => ({ id, ...frame })));
              }}
              // A click on the empty surface lets go of everything, a note's card too (no node).
              onPaneClick={() => {
                setSelected(new Set());
                setOpenFolder(null);
              }}
              // A folder clicked opens (or closes) – its files laid out under it.
              onNodeClick={(_, node) => {
                const item = node.data.item;
                if (node.data.role === 'item' && !isMaterial(item) && item.kind === 'folder') {
                  const opening = openFolder !== item.id;
                  setOpenFolder(opening ? item.id : null);
                  // Opened: it and its files under it come into the middle of the part seen,
                  // at most at 100 %.
                  const seen = rootRef.current?.getBoundingClientRect();
                  if (opening && seen) {
                    const zoomNow = Math.min(1, flow.getZoom());
                    const cx = item.x + item.w / 2;
                    const cy = item.y + item.h + 80;
                    void flow.setViewport(
                      {
                        zoom: zoomNow,
                        x: seen.width / 2 - cx * zoomNow,
                        y: seen.height / 2 - cy * zoomNow,
                      },
                      { duration: 300 },
                    );
                  }
                } else setOpenFolder(null);
              }}
              onNodeDoubleClick={(_, node) => open(node.data.item)}
              defaultViewport={{ x: 40, y: 64, zoom: 1 }}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              // A plain drag on the surface draws a note's box (`startDrawing`); ⇧ and a drag, or
              // the middle button, move the surface.
              panOnDrag={[1]}
              panActivationKeyCode="Shift"
              panOnScroll
              panOnScrollMode={PanOnScrollMode.Vertical}
              zoomOnScroll={false}
              zoomOnPinch
              zoomOnDoubleClick={false}
              zoomActivationKeyCode={['Meta', 'Control']}
              selectionKeyCode={['Meta', 'Control']}
              multiSelectionKeyCode={['Meta', 'Control']}
              selectionMode={SelectionMode.Partial}
              // Deleting is the board's own key (`onKeyDown`): React Flow's listens on the whole page.
              deleteKeyCode={null}
              disableKeyboardA11y
              nodesConnectable={false}
              nodesDraggable={canComment}
              nodeDragThreshold={3}
              // Picked things keep their place in the stack: notes always lie over files and links.
              elevateNodesOnSelect={false}
              // A drag moves, a click picks (as an element on a slide): a drag never picks – nor
              // opens a file's panel.
              selectNodesOnDrag={false}
              // Whole units only (as Figma's pixels): a coarser grid had a dragged thing lag the
              // pointer by up to a step and move in jerks.
              snapToGrid
              snapGrid={[1, 1]}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={GRID}
                size={2}
                color="var(--color-dot)"
              />
            </ReactFlow>
          </div>
        </BoardNodeContext.Provider>

        {carrying &&
          Math.hypot(carrying.at.x - carrying.start.x, carrying.at.y - carrying.start.y) >=
            DRAW_SLOP && (
            // The file being pulled out, under the pointer.
            <div
              aria-hidden
              className="pointer-events-none absolute z-(--z-raised) h-28 w-36 -translate-x-1/2 -translate-y-1/4 overflow-hidden rounded-chip bg-glass-solid shadow-float"
              style={{
                left: carrying.at.x - carrying.origin.x,
                top: carrying.at.y - carrying.origin.y,
              }}
            >
              {carrying.file.previewUrl ? (
                <img
                  src={carrying.file.previewUrl}
                  alt=""
                  className="size-full object-cover object-top"
                />
              ) : (
                <span className="flex size-full items-center justify-center text-caption text-fg-muted">
                  {carrying.file.name}
                </span>
              )}
            </div>
          )}
        {drawn && (
          // The box drawn on a slide in Besprechen: `RectFrame` dashed, over its whole area.
          <div aria-hidden className="pointer-events-none absolute z-(--z-raised)" style={drawn}>
            <RectFrame
              rect={{ x: 0, y: 0, w: 1, h: 1 }}
              color={accentColor(viewer.author.color)}
              dashed
            />
          </div>
        )}

        {/* What it is and how much lies there; the controls top right. On a narrow board the
            buttons keep their icons only, then the zoom goes, then the word „Material“ – nothing
            runs over the edge (`GIVE_WAY`, measured). */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 z-(--z-raised) @container flex items-center gap-2 p-3',
            // The side panel floats over the board's right: the controls stay left of it.
            panelItem && 'md:pr-[412px]',
          )}
        >
          <GlassPanel className="pointer-events-auto flex h-10 shrink-0 items-center gap-1.5 px-3.5 text-body font-medium text-fg">
            <Icon name="attachFile" size={18} />
            <span className={giveWay.material}>Material</span>
            {fileCount > 0 && <span className="text-fg-subtle">{fileCount}</span>}
          </GlassPanel>
          {/* One pill like the presentation's controls: every part 40 high. */}
          <Toolbar role={false} className="pointer-events-auto ml-auto shrink-0">
            <span className={cn('flex items-center gap-1', giveWay.zoom)}>
              <IconButton
                icon="remove"
                label="Verkleinern"
                size="sm"
                onClick={() => zoomBy(1 / 1.25)}
              />
              <button
                type="button"
                className="h-8 min-w-12 rounded-control px-1 text-xs text-fg-muted tabular-nums hover:bg-hover hover:text-fg"
                title="Alles zeigen"
                onClick={fit}
              >
                {Math.round(zoom * 100)} %
              </button>
              <IconButton icon="add" label="Vergrößern" size="sm" onClick={() => zoomBy(1.25)} />
              <ToolbarDivider />
            </span>
            {/* Asking spends the workspace's AI: not for Betrachter, as no other AI is. */}
            {canComment && (
              <Button
                size="sm"
                variant="ghost"
                icon="autoAwesome"
                className="rounded-control"
                aria-label="Frage an die KI"
                title={`Frage an die KI – in eine Notiz geschrieben, ${askKeys()} fragt`}
                onClick={startQuestion}
              >
                <span className={giveWay.ask}>Fragen</span>
              </Button>
            )}
            {canComment && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="upload"
                  className="rounded-control"
                  aria-label="Material hinzufügen"
                  title="Material hinzufügen"
                  onClick={() => fileRef.current?.click()}
                >
                  <span className={giveWay.add}>Material hinzufügen</span>
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    const files = [...(event.target.files ?? [])];
                    if (files.length > 0) addFiles(files, middle());
                    event.target.value = '';
                  }}
                />
                {nextcloudConnected && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-control"
                    aria-label="Aus Nextcloud wählen"
                    title="Aus Nextcloud wählen"
                    onClick={() => setBrowsingNextcloud(true)}
                  >
                    <NextcloudMark size={18} />
                    <span className={giveWay.nextcloud}>Nextcloud</span>
                  </Button>
                )}
              </>
            )}
            {/* The presentation lies to the right of the material page. */}
            <Button
              size="sm"
              variant="ghost"
              trailingIcon="arrowForward"
              className="rounded-control"
              aria-label="Zur Präsentation"
              title="Zur Präsentation (M)"
              onClick={onLeave}
            >
              <span className={giveWay.leave}>Präsentation</span>
            </Button>
          </Toolbar>
        </div>

        {!loading && items.length === 0 && (
          // Under the controls, never behind them: a low board drops the icon, then the second
          // line, then the hint itself.
          <div className="pointer-events-none absolute inset-x-0 top-14 bottom-0 z-(--z-raised) [container-type:size]">
            <div className="flex size-full flex-col items-center justify-center gap-2 overflow-hidden px-6 pb-3 text-center [@container(max-height:6rem)]:hidden [@container(max-width:16rem)]:hidden">
              <Icon
                name="attachFile"
                size={32}
                className="shrink-0 text-fg-faint [@container(max-height:12rem)]:hidden"
              />
              <p className="max-w-80 text-sm text-fg-muted">
                {canComment
                  ? 'Dateien, Bilder und Links für diese Präsentation hierher ziehen oder einfügen, mit einem Rahmen eine Notiz schreiben'
                  : 'Hier liegt noch kein Material'}
              </p>
              {canComment && (
                <p className="text-xs text-fg-subtle [@container(max-height:9rem)]:hidden">
                  Die KI liest es bei Bedarf mit
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      {panelItem && (
        <BoardPanel
          item={panelItem}
          notes={board.items}
          names={names}
          canComment={canComment}
          mayEdit={ownItem}
          onSetColor={(note, color) => context.setColor(note, color)}
          mayDelete={mayDelete}
          onClose={() => setSelected(new Set())}
          onOpen={open}
          onAddNote={(text, ask) => {
            const id = addNote(
              { x: panelItem.x, y: panelItem.y, w: panelItem.w, h: panelItem.h },
              text,
              [panelItem.id],
            );
            if (ask) answers.ask(id, text);
          }}
          onEditNote={(note, text) => (text ? updateText(note.id, text) : remove([note.id]))}
          onDelete={(item) => {
            if (!isMaterial(item) && item.kind === 'folder' && item.boundIds.length > 0) {
              setDeletingFolder(item);
              return;
            }
            remove([item.id]);
            if (item.id === panelItem.id) setSelected(new Set());
          }}
        />
      )}
      <ConfirmDialog
        open={deletingAnswer !== null}
        onClose={() => setDeletingAnswer(null)}
        title="Antwort löschen?"
        description={`Die Notiz bleibt – mit ${askKeys()} lässt sie sich wieder fragen.`}
        confirmLabel="Löschen"
        confirmIcon="delete"
        onConfirm={() => {
          if (deletingAnswer) answers.remove(deletingAnswer);
          setDeletingAnswer(null);
        }}
      />
      {browsingNextcloud && (
        <Dialog
          open
          onClose={() => {
            nextcloudClosings.current += 1;
            setBrowsingNextcloud(false);
          }}
          title="Aus Nextcloud wählen"
          className="w-[min(640px,calc(100vw-32px))]"
        >
          {/* The browser brings its own side padding; its list scrolls inside this height. */}
          <div className="-mx-5 -mt-4 flex h-[min(480px,calc(100dvh-180px))] flex-col">
            <NextcloudBrowser
              onPick={async (entry, connectionId) => {
                const closings = nextcloudClosings.current;
                const file = await downloadNextcloudFile(connectionId, entry.fileId, entry.name);
                if (closings !== nextcloudClosings.current) return;
                setBrowsingNextcloud(false);
                addFiles([file], middle());
              }}
            />
          </div>
        </Dialog>
      )}
      <ConfirmDialog
        open={deletingFolder !== null}
        onClose={() => setDeletingFolder(null)}
        title={`„${deletingFolder?.text ?? ''}“ löschen?`}
        description={`Die ${deletingFolder?.boundIds.length ?? 0} Dateien darin mitlöschen oder auf der Fläche behalten?`}
        confirmLabel="Löschen"
        confirmIcon="delete"
        onConfirm={() => deletingFolder && deleteFolder(deletingFolder, true)}
        extraActions={
          <Button
            variant="secondary"
            onClick={() => deletingFolder && deleteFolder(deletingFolder, false)}
          >
            Nur Ordner löschen
          </Button>
        }
      />
      <ConfirmDialog
        open={emptied !== null}
        onClose={() => setEmptied(null)}
        title="Notiz löschen?"
        description="Das lässt sich nicht rückgängig machen."
        confirmLabel="Löschen"
        confirmIcon="delete"
        onConfirm={() => {
          if (emptied) remove([emptied.id]);
          setEmptied(null);
        }}
      />
      {menuAt &&
        createPortal(
          <ContextMenu
            label={'Aktionen für diese Notiz'}
            at={menuAt}
            onClose={() => setMenuAt(null)}
            actions={[
              ...(askable(menuAt.item)
                ? [
                    {
                      label: answers.byNote.has(menuAt.item.id) ? 'KI nochmal fragen' : 'KI fragen',
                      icon: 'autoAwesome' as const,
                      onSelect: () => answers.ask(menuAt.item.id, menuAt.item.text),
                    },
                  ]
                : []),
              ...(ownItem(menuAt.item)
                ? [
                    {
                      label: 'Bearbeiten',
                      icon: 'edit' as const,
                      onSelect: () => setEditing(menuAt.item.id),
                    },
                    ...ACCENT_COLORS.map((color) => ({
                      label: ACCENT_COLOR_NAMES[color],
                      icon: (
                        <span
                          aria-hidden
                          className="size-3 rounded-full"
                          style={{ backgroundColor: accentColor(color) }}
                        />
                      ),
                      onSelect: () => context.setColor(menuAt.item, color),
                    })),
                  ]
                : []),
              ...(mayDelete(menuAt.item)
                ? [
                    {
                      label: 'Löschen',
                      icon: 'delete' as const,
                      tone: 'danger' as const,
                      onSelect: () => setEmptied(menuAt.item),
                    },
                  ]
                : []),
            ]}
          />,
          document.body,
        )}
    </section>
  );
}
