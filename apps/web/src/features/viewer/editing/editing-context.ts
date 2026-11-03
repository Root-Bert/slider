import type {
  DeckEditState,
  EditableElement,
  ElementFlip,
  ElementTilt,
  LiveTextStyle,
  Point,
  Rect,
  SlideOperation,
  TextAlign,
} from '@slider/shared';
import { createContext, use } from 'react';
import type { ParagraphPatch, TextStylePatch } from './live/model';

/**
 * While editing: picking elements, drawing a frame for a new text, shape or picture, or – in a
 * template being designed – setting its guides.
 */
export type EditTool = 'select' | 'frame' | 'guides';

/** What is picked on the slide while editing. */
export interface EditSelection {
  slideId: string;
  elementId: string;
}

/**
 * Several elements of one slide picked together – a frame drawn round them („Auswählen“), ⇧-click,
 * ⌘A: they move, line up and go together (`GroupBar`).
 */
export interface EditGroup {
  slideId: string;
  elementIds: readonly string[];
}

/** The text being typed on a slide: its formatting at the caret, and how to change it. */
export interface TextEditorHandle {
  /** The style at the caret (of the selection's start). */
  style: LiveTextStyle;
  /** Of the paragraphs the selection touches, `null` where they differ. */
  align: TextAlign | null;
  list: 'bullet' | 'number' | 'none' | null;
  lineSpacing: number | null;
  /** Formats the selection (a caret: its word). */
  format: (patch: TextStylePatch) => void;
  /**
   * Shows the selection in a format on trial (a list stepped through); `null` puts it back as it
   * was. The trials and the `format` that ends them are one step for ⌘Z.
   */
  tryFormat: (patch: TextStylePatch | null) => void;
  /** The focus back in the text, its selection as it was (a field of the panel had it). */
  focus: () => void;
  /** Aligns, spaces or lists the paragraphs the selection touches. */
  paragraphs: (patch: ParagraphPatch) => void;
}

export interface ApplyOptions {
  /**
   * Edits with the same key that have not gone out yet are replaced by the newer one (a colour
   * dragged through the picker sends its last value only).
   */
  coalesce?: string;
}

export interface Editing {
  /** The deck can be edited by this viewer (an ODP, and they manage it). */
  available: boolean;
  state: DeckEditState | undefined;
  /** „Bearbeiten“ is on: the slides show their elements, clicks pick instead of commenting. */
  active: boolean;
  setActive: (active: boolean) => void;
  /**
   * „Hinzufügen“ is on: editing, every element there when it began held still as locked (in the
   * editor only, not in the file) – what is added meanwhile stays free.
   */
  adding: boolean;
  /** „Hinzufügen“ (A): editing, what is there now held still. */
  setAdding: () => void;
  /**
   * Whether an element is held still by „Hinzufügen“ only – shown locked, but not locked in the
   * file (`elementsOf` gives it `locked`).
   */
  isHeld: (slideId: string, elementId: string) => boolean;
  tool: EditTool;
  setTool: (tool: EditTool) => void;
  /** „Ebenen“ is open: the shown slide taken apart in 3D, its elements restacked there (L). */
  layers: boolean;
  setLayers: (open: boolean) => void;
  selection: EditSelection | null;
  select: (selection: EditSelection | null) => void;
  /** Elements picked together (two or more; never alongside `selection`). */
  group: EditGroup | null;
  /** Picks them together – one alone is picked as `selection`, none lets go. */
  selectGroup: (group: EditGroup | null) => void;
  /**
   * The group entered by a double click (Figma): its elements are the slide's in `elementsOf`,
   * each picked and edited as any – while what is picked lies in it. `null`: none.
   */
  entered: { slideId: string; groupId: string } | null;
  /** That group as it shows now (its box round its parts) – `null` when none is entered. */
  enteredGroup: EditableElement | null;
  /** A double click on group `groupId`: in it, its element `elementId` picked (none: the group). */
  enterGroup: (slideId: string, groupId: string, elementId: string | null) => void;
  /** ⌘G: those picked together (that move, flat) in one group, picked – `false`: nothing to group. */
  groupPicked: () => boolean;
  /** ⇧⌘G: the picked group taken apart, its elements picked – `false`: no group picked. */
  ungroupPicked: () => boolean;
  /** The element last copied here (⌘C / ⌘X), as it was then – `null`: none, or copied over since. */
  clipboard: EditableElement | null;
  /** Puts the element last copied in again, as ⌘V does. */
  pasteCopied: () => void;
  /**
   * The picked element opened to be changed (its format bar): in the layers view a click picks a
   * layer (its list), a double click opens it. On the flat slide picking opens it.
   */
  opened: string | null;
  open: (elementId: string) => void;
  /** The slide's elements as they are now – the editor's own changes shown before the server answers. */
  elementsOf: (slideId: string) => readonly EditableElement[];
  selectedElement: EditableElement | null;
  /**
   * Applies operations; `false` when the server refused them (a toast says why). Element changes
   * show at once; the promise settles when the server has them and the slides are reloaded – or,
   * the server out of reach, once they are kept to be sent later (`true`).
   */
  apply: (operations: SlideOperation[], options?: ApplyOptions) => Promise<boolean>;
  /**
   * Shows operations tried on (a font or size hovered in its list) as `apply` would – never sent,
   * no ⌘Z step; the next replace them, `null` shows the elements as they are again.
   */
  tryOut: (operations: SlideOperation[] | null) => void;
  /**
   * A picture from outside (pasted, dropped) as a new picture element on a slide – the one shown
   * unless given –, centred on `at` (of the slide), picked; `false` when it did not go on.
   */
  insertImage: (file: File, slideId?: string, at?: Point) => Promise<boolean>;
  undo: () => void;
  redo: () => void;
  /**
   * A take-back (undo, redo) is on its way. Edits going out are not in here – each would render
   * every reader again; those that wait for them read `useOutboxSending`.
   */
  busy: boolean;
  /** Own edits made here to take back (undo), and undone ones to bring back (redo). */
  canUndo: boolean;
  canRedo: boolean;
  /** Edits made here the server does not have yet (kept in the browser until it does). */
  pending: number;
  /**
   * No connection, or the server cannot be reached: edits are kept and sent once it can; what
   * needs it at once (the AI, photos, uploads) is off meanwhile.
   */
  offline: boolean;
  /**
   * The session ended (or another account signed in meanwhile): edits are kept in the browser
   * and sent once the same account is signed in again.
   */
  signedOut: boolean;
  /** The slides' size in centimetres. */
  pageSize: { width: number; height: number };
  /**
   * The slides' pictures are the ones fetched after the last answer (no refetch pending or failed):
   * what is drawn over a slide for a settled change (a stock photo, a picture's part) may go once
   * its picture is on screen.
   */
  slidePicturesReady: boolean;
  /** The live element whose text is typed on its slide. */
  textEditing: string | null;
  /** Where typing starts: the caret goes to that point (viewport pixels), else to the end. */
  textCaret: { x: number; y: number } | null;
  startText: (selection: EditSelection, at?: { x: number; y: number }) => void;
  stopText: () => void;
  textEditor: TextEditorHandle | null;
  setTextEditor: (handle: TextEditorHandle | null) => void;
  /**
   * An element being dragged, resized or turned, where it is now – read with `usePreviewOf` /
   * `usePreviewAmong` (`preview-store.ts`: a drag renders only what follows it, not every reader).
   */
  setPreview: (preview: ElementPreview | null, ownerId?: string, surface?: object) => void;
  /** Heights (of the slide) of live elements that grow with their text, as drawn. */
  heightOf: (elementId: string) => number | null;
  measure: (elementId: string, height: number | null) => void;
  /**
   * How high the picked text's box is around its text at its width, padding in (of the slide) –
   * what its height is fitted to („Höhe an Text anpassen“, `TextSizeMeasure`).
   */
  textHeightOf: (elementId: string) => number | null;
  measureText: (elementId: string, height: number | null) => void;
  /**
   * Tilted elements changed since their tilted picture was drawn (their text, look, size), by
   * their slide: drawn tilted anew (`TiltRefreshes`), picked or not.
   */
  retilting: ReadonlyMap<string, string>;
  /** Its tilted picture is drawn anew (or there is none to draw): no longer waited for. */
  retilted: (elementId: string) => void;
}

/** An element as dragged: its box, and its turn when it is being turned or moved turned. */
export interface ElementPreview {
  elementId: string;
  rect: Rect;
  rotation?: number;
  /** Being tilted in depth: as it is tilted now (`null`: flat). */
  tilt?: ElementTilt | null;
  /** Mirrored by the drag (a corner pulled over the opposite side, tilted over the edge). */
  flip?: ElementFlip | null;
  /**
   * Elements picked together (`Editing.group`) dragged with it, this one among them: each moved
   * as far (of the slide).
   */
  group?: {
    elementIds: readonly string[];
    dx: number;
    dy: number;
    /**
     * Resized or turned together: each one's box and turn by its id (then `dx`/`dy` are 0) – one
     * not in it moves by `dx`/`dy`.
     */
    frames?: ReadonlyMap<string, { rect: Rect; rotation: number }>;
  };
}

/**
 * Where an element picked together with the one dragged shows now – `null`: it is not among them.
 */
export function groupFrameOf(
  preview: ElementPreview | null,
  element: EditableElement,
): { bbox: Rect; rotation: number } | null {
  const group = preview?.group;
  if (!group?.elementIds.includes(element.id)) return null;
  const frame = group.frames?.get(element.id);
  if (frame) return { bbox: frame.rect, rotation: frame.rotation };
  return {
    bbox: { ...element.bbox, x: element.bbox.x + group.dx, y: element.bbox.y + group.dy },
    rotation: element.rotation,
  };
}

export const EditingContext = createContext<Editing | null>(null);

/** Outside an editable viewer (tests, previews): nothing to edit. */
const INACTIVE: Editing = {
  available: false,
  state: undefined,
  active: false,
  setActive: () => {},
  adding: false,
  setAdding: () => {},
  isHeld: () => false,
  tool: 'select',
  setTool: () => {},
  layers: false,
  setLayers: () => {},
  selection: null,
  select: () => {},
  group: null,
  selectGroup: () => {},
  entered: null,
  enteredGroup: null,
  enterGroup: () => {},
  groupPicked: () => false,
  ungroupPicked: () => false,
  clipboard: null,
  pasteCopied: () => {},
  opened: null,
  open: () => {},
  elementsOf: () => [],
  selectedElement: null,
  apply: async () => false,
  tryOut: () => {},
  insertImage: async () => false,
  undo: () => {},
  redo: () => {},
  busy: false,
  canUndo: false,
  canRedo: false,
  pending: 0,
  offline: false,
  signedOut: false,
  pageSize: { width: 28, height: 15.75 },
  slidePicturesReady: true,
  textEditing: null,
  textCaret: null,
  startText: () => {},
  stopText: () => {},
  textEditor: null,
  setTextEditor: () => {},
  setPreview: () => {},
  heightOf: () => null,
  measure: () => {},
  textHeightOf: () => null,
  measureText: () => {},
  retilting: new Map(),
  retilted: () => {},
};

export const useEditing = (): Editing => use(EditingContext) ?? INACTIVE;
