import type {
  AccentColor,
  AuthorColor,
  Board,
  BoardFrame,
  BoardItem,
  Material,
} from '@slider/shared';
import type { Node, ResizeParams } from '@xyflow/react';
import { createContext, type MouseEvent, type PointerEvent } from 'react';
import type { RichValue } from './RichSticker';
import type { NoteAnswerActions } from './NoteAnswer';
import type { NoteAnswerValue } from './note-answers';
import type { FolderUpload } from './useBoard';

/*
 * The board as React Flow shows it, laid out from the board as `useBoard` has it – the server's
 * with what is queued laid over it – and, while a drag or a resize goes on, the frames it has got
 * to (`live`):
 * - files and links, as cards;
 * - a note on its own: a sticker, its box with its text in it;
 * - notes on one thing: no box – the thing is marked and the notes' cards stand beside it (one
 *   column node per thing, `notes`), where they cover no other card;
 * - a box (as a sticker on a slide: its rich text at its top left) – holding the things that lie
 *   in it (`boundIds`), under them then, or none, over files and links then.
 * Notes lie over files and links. React Flow is only the view: its own node state is never kept,
 * every change goes through `useBoard`.
 */

/**
 * A sticker's text on the board: the slide sticker's (`TEXT_CLASS`) at a fixed size – left-aligned,
 * from the top, as it is typed into a box drawn first.
 */
export const STICKER_TEXT =
  'whitespace-pre-wrap break-words px-[0.35em] py-[0.15em] text-base leading-[1.25] font-semibold';

export type BoardEntry = Material | BoardItem;

/** A note's or box's colour: its own, else its author's. */
export const noteColor = (item: BoardItem): AuthorColor => item.color ?? item.author.color;

export type BoardNodeData =
  /** `target`: a box something being dragged would join. */
  | { role: 'item'; item: BoardEntry; target?: boolean }
  /** The cards of the notes on one thing, beside it. */
  | { role: 'notes'; item: BoardEntry; notes: BoardItem[] };

export type BoardNode = Node<BoardNodeData, 'item'>;

export const isMaterial = (item: BoardEntry): item is Material => 'sizeBytes' in item;

/** A file still on its way up: not on the server yet, so it stays where it was put. */
export const isUploading = (item: BoardEntry) => 'progress' in item;

/** Room between a thing and its notes' cards. */
export const NOTE_GAP = 12;
/** A note's card (`w-60`) and about how tall one is, to keep them off other cards. */
export const NOTE_CARD_W = 240;
const NOTE_CARD_H = 84;
/**
 * Boxes holding things under them; free boxes and notes over files and links. What is being
 * dragged lies over everything (`lift`: a box, `+1` what it carries or a thing, `+2` notes beside
 * it) – never under a box's glass on its way, its place in the stack again on release.
 */
const Z = { holder: -1, thing: 0, note: 10, open: 15, draft: 20, lift: 30 } as const;

/** The things a box holds or a note stands beside: files, links, folders. */
export const isThing = (item: BoardEntry) =>
  isMaterial(item) || item.kind === 'link' || item.kind === 'folder';

/** A box (as a sticker), holding things or not. */
export const isBox = (item: BoardEntry): item is BoardItem =>
  !isMaterial(item) && item.kind === 'box';

/** Room in a box round what it holds, and above them for its text. */
export const BOX_PAD = 16;
export const BOX_TOP = 44;
const BOX_GAP = 16;

/**
 * What a box holds laid out anew for its width (resized): in their order (rows, then left to
 * right), wrapping as a grid does – and how small the box may be (the widest thing with its room;
 * as tall as the rows need at that width).
 */
export function reflow(
  box: BoardFrame,
  held: readonly (BoardFrame & { id: string })[],
): { frames: (BoardFrame & { id: string })[]; minW: number; minH: number } {
  if (held.length === 0) return { frames: [], minW: 8, minH: 8 };
  const order = [...held].sort((a, b) => a.y - b.y || a.x - b.x);
  const minW = Math.max(...order.map((each) => each.w)) + 2 * BOX_PAD;
  const width = Math.max(box.w, minW);
  const right = box.x + width - BOX_PAD;
  let x = box.x + BOX_PAD;
  let y = box.y + BOX_TOP;
  let rowH = 0;
  const frames = order.map((each) => {
    if (x > box.x + BOX_PAD && x + each.w > right) {
      x = box.x + BOX_PAD;
      y += rowH + BOX_GAP;
      rowH = 0;
    }
    const placed = { ...each, x, y };
    x += each.w + BOX_GAP;
    rowH = Math.max(rowH, each.h);
    return placed;
  });
  return { frames, minW, minH: y + rowH + BOX_PAD - box.y };
}

/**
 * A box taking in what was dropped on it: grown, once, so far that it lies wholly in it with the
 * box's room round it (under its text at the top) – never smaller.
 */
export function holding(box: BoardFrame, thing: BoardFrame): BoardFrame {
  const x = Math.min(box.x, thing.x - BOX_PAD);
  const y = Math.min(box.y, thing.y - BOX_TOP);
  return {
    x,
    y,
    w: Math.max(box.x + box.w, thing.x + thing.w + BOX_PAD) - x,
    h: Math.max(box.y + box.h, thing.y + thing.h + BOX_PAD) - y,
  };
}

/** The files lying in a folder (shown only when it is opened), by id. */
export const inFolders = (items: readonly BoardItem[]): ReadonlySet<string> =>
  new Set(items.filter((item) => item.kind === 'folder').flatMap((item) => item.boundIds));

/** The notes hanging on each thing (beside it), oldest first. */
export function notesBeside(items: readonly BoardItem[]): ReadonlyMap<string, BoardItem[]> {
  const notes = new Map<string, BoardItem[]>();
  for (const item of items)
    if (item.kind === 'note' && item.boundIds.length === 1)
      notes.set(item.boundIds[0]!, [...(notes.get(item.boundIds[0]!) ?? []), item]);
  return notes;
}

/** Every note and box on a thing. */
export const notesOn = (items: readonly BoardItem[], id: string) =>
  items.filter((item) => item.boundIds.includes(id));

const overlaps = (a: BoardFrame, b: BoardFrame) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Whether a thing lies in a box: its centre in it, or most of it. */
export function liesIn(thing: BoardFrame, frame: BoardFrame): boolean {
  const cx = thing.x + thing.w / 2;
  const cy = thing.y + thing.h / 2;
  if (cx >= frame.x && cx <= frame.x + frame.w && cy >= frame.y && cy <= frame.y + frame.h)
    return true;
  const w = Math.min(thing.x + thing.w, frame.x + frame.w) - Math.max(thing.x, frame.x);
  const h = Math.min(thing.y + thing.h, frame.y + frame.h) - Math.max(thing.y, frame.y);
  return w > 0 && h > 0 && w * h >= 0.5 * thing.w * thing.h;
}

/**
 * Where a thing's notes' cards go: right of it, else left, else under it, else above – the first
 * place that covers no other card; right of it when none is free.
 */
export function besidePlace(
  owner: BoardFrame,
  count: number,
  others: readonly BoardFrame[],
): { x: number; y: number } {
  const h = count * NOTE_CARD_H + (count - 1) * 8;
  const places = [
    { x: owner.x + owner.w + NOTE_GAP, y: owner.y },
    { x: owner.x - NOTE_GAP - NOTE_CARD_W, y: owner.y },
    { x: owner.x, y: owner.y + owner.h + NOTE_GAP },
    { x: owner.x, y: owner.y - NOTE_GAP - h },
  ];
  return (
    places.find(
      (place) => !others.some((frame) => overlaps({ ...place, w: NOTE_CARD_W, h }, frame)),
    ) ?? places[0]!
  );
}

const sized = (frame: BoardFrame) => ({
  position: { x: frame.x, y: frame.y },
  width: frame.w,
  height: frame.h,
  // Handed back as measured (it is what is laid out): a node rebuilt here without it, React Flow
  // takes as new – hidden and observed again till measured, inside the observer's round.
  measured: { width: frame.w, height: frame.h },
});

export function boardNodes(
  board: Board,
  {
    selected,
    live,
    canMove,
    editing,
    draft = null,
    targets = new Set(),
    openFolder = null,
    lifted = new Set(),
  }: {
    /** Picked – or, while a box is drawn, what it takes in. */
    selected: ReadonlySet<string>;
    /** Frames of a drag or resize under way, by id. */
    live: ReadonlyMap<string, BoardFrame>;
    canMove: boolean;
    /** The note being typed in: it stays put meanwhile. */
    editing: string | null;
    /** A note whose box was just drawn, typed in: not saved before it has a text. */
    draft?: BoardItem | null;
    /** Boxes something being dragged would join. */
    targets?: ReadonlySet<string>;
    /** The folder opened: its files laid out by it, over everything. */
    openFolder?: string | null;
    /** Being dragged, a box's things with it: over everything meanwhile. */
    lifted?: ReadonlySet<string>;
  },
): BoardNode[] {
  const frameOf = (item: BoardEntry): BoardFrame => live.get(item.id) ?? item;
  const hidden = inFolders(board.items);
  const things = [...board.materials, ...board.items].filter(
    (item) => isThing(item) && !hidden.has(item.id),
  );
  const byId = new Map<string, BoardEntry>(things.map((each) => [each.id, each]));
  const nodes: BoardNode[] = [];
  for (const item of board.items) {
    if (item.kind !== 'box') continue;
    nodes.push({
      id: item.id,
      type: 'item',
      ...sized(frameOf(item)),
      zIndex: lifted.has(item.id) ? Z.lift : item.boundIds.length > 0 ? Z.holder : Z.note,
      data: { role: 'item', item, target: targets.has(item.id) },
      selected: selected.has(item.id),
      draggable: canMove && editing !== item.id,
    });
  }
  for (const item of things) {
    nodes.push({
      id: item.id,
      type: 'item',
      ...sized(frameOf(item)),
      zIndex: lifted.has(item.id) ? Z.lift + 1 : item.id === openFolder ? Z.open : Z.thing,
      data: { role: 'item', item },
      selected: selected.has(item.id),
      draggable: canMove && !isUploading(item) && editing !== item.id,
    });
  }
  const cards = things.map(frameOf);
  for (const [id, notes] of notesBeside(board.items)) {
    const owner = byId.get(id);
    if (!owner) continue;
    const frame = frameOf(owner);
    const place = besidePlace(
      frame,
      notes.length,
      cards.filter((each) => each !== frame),
    );
    nodes.push({
      id: `notes:${id}`,
      type: 'item',
      // A column as wide as a card; its height is its cards' (laid out by them, over the board).
      ...sized({ ...place, w: NOTE_CARD_W, h: 8 }),
      zIndex: lifted.has(id) ? Z.lift + 2 : Z.note,
      data: { role: 'notes', item: owner, notes },
      selectable: false,
      draggable: false,
    });
  }
  if (draft)
    nodes.push({
      id: draft.id,
      type: 'item',
      ...sized(draft),
      // Round things already: under them, as the box it becomes – they stay as they are.
      zIndex: draft.kind === 'box' && draft.boundIds.length > 0 ? Z.holder : Z.draft,
      data: { role: 'item', item: draft },
      selectable: false,
      draggable: false,
    });
  return nodes;
}

/** What a node (`BoardNodeView`) needs from the board around it. */
export interface BoardNodeContext {
  /** The viewer's colour: the selection's, as in the editor. */
  color: string;
  /** Resizable (one picked, may change the board). */
  resizable: (id: string) => boolean;
  /** Notes may be drawn: on a picked file's preview too (its name bar then moves it). */
  canDraw: boolean;
  /** Things may be moved and resized (comment rights). */
  mayMove: boolean;
  /** Picked (also a note's card beside its thing, which is no node of its own). */
  isPicked: (id: string) => boolean;
  /** The note or frame whose text is being typed (a new one's or one's own). */
  editing: string | null;
  /** The folder opened (its files laid out by it). */
  openFolder: string | null;
  /** The files of the board, by id (a folder's peek and its opened files). */
  fileById: ReadonlyMap<string, Material>;
  /** A folder's files on their way (or some that did not go). */
  folderUpload: (id: string) => FolderUpload | undefined;
  /** The name of the folder a file came from, while it lies outside it. */
  cameFrom: (file: Material) => string | null;
  /** A file of a folder pressed: dragged, it is taken out onto the board. */
  takeOut: (file: Material, folder: BoardItem, event: PointerEvent<HTMLElement>) => void;
  /** The colour of the box a thing lies in (its file icon takes it), if one. */
  boxColorOf: (id: string) => AuthorColor | null;
  /** How small a box may be made: what it holds, reflowed. */
  boxMin: (id: string) => { minW: number; minH: number };
  /** The colour a thing is marked in, when notes hang on it (its first one's author's). */
  markOf: (id: string) => AuthorColor | null;
  /** A note's card picked (⇧/⌘ adds). */
  pick: (id: string, add: boolean) => void;
  /** Its text typed again, where it shows – one's own only. */
  edit: (item: BoardItem) => void;
  /** One's own: its text and colour may be changed. */
  mayEdit: (item: BoardItem) => boolean;
  /** Its colour of the comment colours. */
  setColor: (item: BoardItem, color: AccentColor) => void;
  /** Its right click: Bearbeiten, Löschen. */
  onContextMenu: (item: BoardItem, event: MouseEvent) => void;
  /**
   * A note's or frame's text taken (↵, or left with text): emptied, it goes (after asking). A
   * sticker's comes with its rich text (`rich`, its Markdown as `text`).
   */
  onNoteDone: (
    item: BoardItem,
    value: RichValue | { text: string; plain: string; rich: null },
  ) => void;
  /** ⌘↵ while its text is typed: taken as ↵ takes it, then handed to the AI (`NoteAnswer`). */
  onNoteAsk: (
    item: BoardItem,
    value: RichValue | { text: string; plain: string; rich: null },
  ) => void;
  /** Typing dropped (Esc): a new one goes, one's own stays as it was. */
  onNoteCancel: (item: BoardItem) => void;
  /** The AI's answer under a note, once asked. */
  answerOf: (noteId: string) => NoteAnswerValue | undefined;
  /** What the answer card under a note offers. */
  answers: NoteAnswerActions;
  onResize: (id: string, frame: ResizeParams) => void;
  onResizeEnd: (id: string, frame: ResizeParams) => void;
}

export const BoardNodeContext = createContext<BoardNodeContext | null>(null);
