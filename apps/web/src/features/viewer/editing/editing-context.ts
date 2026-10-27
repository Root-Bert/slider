import type {
  DeckEditState,
  EditableElement,
  LiveTextStyle,
  Rect,
  SlideOperation,
  TextAlign,
} from '@slider/shared';
import { createContext, use } from 'react';
import type { BackgroundPriority, ElementCutout } from '@/lib/api';
import type { TextStylePatch } from './live/model';

/** What is picked on the slide while editing. */
export interface EditSelection {
  slideId: string;
  elementId: string;
}

/** The text being typed on a slide: its formatting at the caret, and how to change it. */
export interface TextEditorHandle {
  /** The style at the caret (of the selection's start). */
  style: LiveTextStyle;
  align: TextAlign;
  /** Formats the selection (a caret: its word). */
  format: (patch: TextStylePatch) => void;
  alignText: (align: TextAlign) => void;
}

/** An element's cutout and its box on the slide when the cutout was drawn. */
export interface LiveCutout {
  cutout: ElementCutout;
  bbox: Rect;
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
  /** „Ebenen“ is open: the shown slide taken apart in 3D, its elements restacked there (L). */
  layers: boolean;
  setLayers: (open: boolean) => void;
  selection: EditSelection | null;
  select: (selection: EditSelection | null) => void;
  /** The slide's elements as they are now – the editor's own changes shown before the server answers. */
  elementsOf: (slideId: string) => readonly EditableElement[];
  selectedElement: EditableElement | null;
  /**
   * Applies operations; `false` when the server refused them (a toast says why). Element changes
   * show at once; the promise settles when the server has them and the slides are reloaded.
   */
  apply: (operations: SlideOperation[], options?: ApplyOptions) => Promise<boolean>;
  undo: () => void;
  redo: () => void;
  busy: boolean;
  /** The slides' size in centimetres. */
  pageSize: { width: number; height: number };
  /**
   * LibreOffice's picture of an element's slide with its text left out – what its text is typed
   * over; `null` until it is drawn (asked for when the element is picked).
   */
  backgroundOf: (elementId: string) => string | null;
  /**
   * The picked element's cutout (`ElementCutout`) and its box when it was drawn – it draws the
   * element live in new colours or places; `null` until it is drawn, or when its look is more
   * than masks painted can show.
   */
  cutoutOf: (elementId: string) => LiveCutout | null;
  /** An element deleted from the slide, drawn away (its cutout) until the new picture is there. */
  goneOn: (slideId: string) => string | null;
  /** Asks for that picture ahead (the pointer is over the text), so typing starts at once. */
  prefetch: (elementId: string, priority?: BackgroundPriority) => void;
  /**
   * The text the browser draws on a slide over that picture: the one typed in, or one changed
   * whose slide is not drawn anew yet. `null`: the slide is LibreOffice's picture alone.
   */
  liveOn: (slideId: string) => EditableElement | null;
  /**
   * What an element's change waits for: a slide picture other than `src` (the one it had);
   * `settled` once the server has the change (a picture that stays the same is done too).
   */
  awaitedPicture: (elementId: string) => { src: string | null; settled: boolean } | null;
  /** The slide's new picture is there (loaded): the element is the picture's again. */
  pictureCame: (elementId: string) => void;
  /** The live element whose text is typed on its slide. */
  textEditing: string | null;
  /** Where typing starts: the caret goes to that point (viewport pixels), else to the end. */
  textCaret: { x: number; y: number } | null;
  startText: (selection: EditSelection, at?: { x: number; y: number }) => void;
  stopText: () => void;
  textEditor: TextEditorHandle | null;
  setTextEditor: (handle: TextEditorHandle | null) => void;
  /** An element being dragged or resized, where it is now. */
  preview: { elementId: string; rect: Rect } | null;
  setPreview: (preview: { elementId: string; rect: Rect } | null) => void;
  /** Heights (of the slide) of live elements that grow with their text, as drawn. */
  heightOf: (elementId: string) => number | null;
  measure: (elementId: string, height: number | null) => void;
}

export const EditingContext = createContext<Editing | null>(null);

/** Outside an editable viewer (tests, previews): nothing to edit. */
const INACTIVE: Editing = {
  available: false,
  state: undefined,
  active: false,
  setActive: () => {},
  layers: false,
  setLayers: () => {},
  selection: null,
  select: () => {},
  elementsOf: () => [],
  selectedElement: null,
  apply: async () => false,
  undo: () => {},
  redo: () => {},
  busy: false,
  pageSize: { width: 28, height: 15.75 },
  backgroundOf: () => null,
  cutoutOf: () => null,
  goneOn: () => null,
  prefetch: () => {},
  liveOn: () => null,
  awaitedPicture: () => null,
  pictureCame: () => {},
  textEditing: null,
  textCaret: null,
  startText: () => {},
  stopText: () => {},
  textEditor: null,
  setTextEditor: () => {},
  preview: null,
  setPreview: () => {},
  heightOf: () => null,
  measure: () => {},
};

export const useEditing = (): Editing => use(EditingContext) ?? INACTIVE;
