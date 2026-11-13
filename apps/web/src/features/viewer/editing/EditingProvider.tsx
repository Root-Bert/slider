import {
  findElement,
  parentOf,
  withChildren,
  type ApplyEditResult,
  type Deck,
  type EditableElement,
  type LiveStep,
  type SlideOperation,
} from '@slider/shared';
import { onLiveStep, setPresence } from '../live/lib/live-store';
import { showRemoteSlideStep } from './remote-slides';
import { rebased, restacked, settledAt, withRemoteStep, type RemoteChange } from './remote-steps';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { isTextTarget, isTypingTarget, tabStep } from '@/lib/dom';
import { isModKey, typesCharacter } from '@/lib/keyboard';
import {
  queryKeys,
  useDeckEdit,
  useDeckLayouts,
  useMe,
  useUploadEditImage,
  useWorkspaceMasters,
} from '@/lib/api';
import { useOnline } from '@/lib/offline';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';
import { useUpdateTemplate } from '../template/useTemplate';
import { editOutbox } from './edit-outbox-app';
import type { OutboxListener } from './edit-outbox';
import {
  EditingContext,
  type ApplyOptions,
  type EditGroup,
  type EditSelection,
  type Editing,
  type EditTool,
  type TextEditorHandle,
  type TextFit,
} from './editing-context';
import { useOwnUndo } from './hooks/useOwnUndo';
import { inverseOf, snapshotOf, touchedElements, type UndoContext } from './undo-ops';
import { useSlidePicturesReady } from './hooks/useSlidePicturesReady';
import { setWorkspaceFonts } from './live/fonts';
import { imageBox, imageFilesOf, insertEach, readClipboard, shownImage } from './insert-image';
import {
  loadPastedFont,
  pastedOf,
  pastedParagraphs,
  pastedTextBox,
  textStyleOn,
  type Pasted,
} from './paste';
import { lockOperations } from './lib/element-label';
import {
  addedElement,
  addedImage,
  applyToElement,
  canMove,
  copiedElement,
  enteredIn,
  groupedElement,
  newPartIds,
  withCopyIn,
  withGroupIn,
} from './live/model';
import { photoSearchTakesTab } from './photos/photo-search-tab';
import { typedIntoField } from './hooks/useTypeIntoField';
import { newEditId } from './new-id';
import { typedAhead } from './typed-ahead';
import { createPreviewStore, PreviewStoreContext } from './preview-store';

/** What `Editing` does rather than shows: one identity for the provider's lifetime. */
type Actions = Pick<
  Editing,
  | 'setActive'
  | 'setTool'
  | 'enterGroup'
  | 'setLayers'
  | 'select'
  | 'selectGroup'
  | 'apply'
  | 'tryOut'
  | 'insertImage'
  | 'undo'
  | 'redo'
  | 'startText'
  | 'stopText'
  | 'groupPicked'
  | 'ungroupPicked'
  | 'pasteCopied'
>;

const NONE: readonly EditableElement[] = [];
/** The page size (cm) until the deck's edit state is there. */
const PAGE_SIZE = { width: 28, height: 15.75 };

/** A map of heights with one changed – the same map when it changed by a hair only. */
const withHeight =
  (elementId: string, height: number | null) => (current: ReadonlyMap<string, number>) => {
    const old = current.get(elementId) ?? null;
    if (old === height || (old !== null && height !== null && Math.abs(old - height) < 0.0005)) {
      return current;
    }
    const next = new Map(current);
    if (height === null) next.delete(elementId);
    else next.set(elementId, height);
    return next;
  };

/** A map of text sizes with one changed – the same map when it changed by a hair only. */
const withFit =
  (elementId: string, fit: TextFit | null) => (current: ReadonlyMap<string, TextFit>) => {
    const old = current.get(elementId) ?? null;
    const same = (a: number, b: number) => Math.abs(a - b) < 0.0005;
    if (
      old === fit ||
      (old &&
        fit &&
        same(old.width, fit.width) &&
        same(old.height, fit.height) &&
        same(old.fittedHeight, fit.fittedHeight))
    ) {
      return current;
    }
    const next = new Map(current);
    if (fit === null) next.delete(elementId);
    else next.set(elementId, fit);
    return next;
  };

/** An element as the editor changed it, until the server's answer has it: `null` = deleted. */
type MoveOperation = Extract<SlideOperation, { type: 'moveElement' }>;

interface Changed {
  slideId: string;
  element: EditableElement | null;
  /** The edit that changed it last. */
  token: number;
  /** Its stacking moves on their way, oldest first (`restacked`). */
  moves?: readonly MoveOperation[];
}

/**
 * An element copied with ⌘C or cut with ⌘X (`copyElement` – the server takes a cut one from the
 * file before it went).
 */
interface CopiedElement {
  deckId: string;
  elementId: string;
  slideId: string;
  /** Where the last copy on its own slide went – the next one goes a step further. */
  box: EditableElement['bbox'];
  /** Cut and not put in yet: on its own slide it goes back where it was, as PowerPoint's. */
  cut?: boolean;
}

/** How far a copy on its element's own slide lies aside of it (a share of the slide's width). */
const PASTE_STEP = 0.02;

/** An element copied, on the system's clipboard – beside its text, for other apps. */
const ELEMENT_MIME = 'application/x-slider-element';

/** The element on the clipboard, if it holds one (`ELEMENT_MIME`). */
function copiedOf(data: DataTransfer): CopiedElement | null {
  const raw = data.getData(ELEMENT_MIME);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CopiedElement>;
    const { deckId, elementId, slideId, box } = value;
    if (typeof deckId !== 'string' || typeof elementId !== 'string') return null;
    if (typeof slideId !== 'string' || !box || typeof box.x !== 'number') return null;
    return { deckId, elementId, slideId, box };
  } catch {
    return null;
  }
}

/**
 * Puts `copied` on the system's clipboard (its text as plain text, for anywhere else): what is
 * copied after it – here or in another app – replaces it there, so ⌘V puts in what was copied
 * last. `false` where the browser does not let it (the editor's own copy then still holds).
 */
function writeClipboard(copied: CopiedElement, text: string): boolean {
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    // Not the page's own listeners: this is not „something else copied“.
    event.stopImmediatePropagation();
    event.clipboardData.setData(ELEMENT_MIME, JSON.stringify(copied));
    if (text) event.clipboardData.setData('text/plain', text);
  };
  window.addEventListener('copy', onCopy, { capture: true });
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    window.removeEventListener('copy', onCopy, { capture: true });
  }
}

/** An edit shown here until the server settles it: what it changed, by its outbox id. */
interface Shown {
  /** Its latest operations (merged ones replace those before, `coalesce`). */
  operations: readonly SlideOperation[];
  /** The changes it drew (`Changed.token`) – dropped once it is settled. */
  tokens: number[];
}

/** „3 Änderungen“ – how many of the operations sent the server left out. */
const droppedMessage = (count: number) =>
  count === 1
    ? 'Eine Änderung passte nicht mehr – ihr Element oder ihre Folie wurde inzwischen gelöscht.'
    : `${count} Änderungen passten nicht mehr – ihre Elemente oder Folien wurden inzwischen gelöscht.`;

/**
 * Editing a deck in the viewer (BER-181): whether it can be edited, the edit mode, what is
 * picked, and applying operations – shared by the slides' element layers and the floating
 * format bar. Bearbeiten composes each slide per element (`SlideCompositor`): what the browser
 * draws whole changes in the same frame, from the elements as shown here. The edits go out through the outbox (`edit-outbox.ts`) – one after another,
 * each on the step the one before made, and on even once the deck is left; the editor attaches to
 * it to show its edits before the server has them.
 */
export function EditingProvider({ children }: { children: ReactNode }) {
  const { deck, canManage, slides } = useViewerData();
  const toast = useViewerToast();
  const updateTemplate = useUpdateTemplate();
  const queryClient = useQueryClient();
  const slidePicturesReady = useSlidePicturesReady(deck.id, slides);
  const { data: state } = useDeckEdit(deck.id, canManage);
  // The workspace's own fonts, for live text and the font list – before anything draws.
  useMemo(() => setWorkspaceFonts(state?.fonts ?? []), [state?.fonts]);
  // The account the edits are made under: only it ever sends them (`edit-outbox.ts`).
  const userId = useMe().data?.user?.id;
  const [active, setActiveState] = useState(false);
  const [tool, setToolState] = useState<EditTool>('select');
  const [selection, setSelection] = useState<EditSelection | null>(null);
  const [group, setGroup] = useState<EditGroup | null>(null);
  // The group entered by a double click (Figma): its elements picked and edited as any – while
  // what is picked lies in it; picking anything else (or nothing) leaves it.
  const [entered, setEntered] = useState<{ slideId: string; groupId: string } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [textEditing, setTextEditing] = useState<string | null>(null);
  const [textCaret, setTextCaret] = useState<{ x: number; y: number } | null>(null);
  // Typing let go before its editor was there: what was typed at the picked box goes with it.
  useEffect(() => {
    if (!textEditing) return;
    return () => void typedAhead.take(textEditing);
  }, [textEditing]);
  const [textEditor, setTextEditor] = useState<TextEditorHandle | null>(null);
  // Where the element dragged is now: read by those that follow it alone (`preview-store.ts`).
  const [previews] = useState(createPreviewStore);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [changed, setChangedState] = useState<ReadonlyMap<string, Changed>>(new Map());
  const [retilting, setRetilting] = useState<ReadonlyMap<string, string>>(new Map());
  const retilted = useCallback(
    (elementId: string) =>
      setRetilting((current) => {
        if (!current.has(elementId)) return current;
        const next = new Map(current);
        next.delete(elementId);
        return next;
      }),
    [],
  );
  // Read and written synchronously: two edits in one tick build on each other.
  const changedRef = useRef(changed);
  // Someone else's steps shown at once, under the own edits (`remote-steps.ts`).
  const [remote, setRemoteState] = useState<ReadonlyMap<string, RemoteChange>>(new Map());
  const remoteRef = useRef(remote);
  const setRemote = (next: ReadonlyMap<string, RemoteChange>) => {
    remoteRef.current = next;
    setRemoteState(next);
  };
  // Someone else's stacking moves, until the edit state is at their step.
  const [remoteMoves, setRemoteMovesState] = useState<
    readonly { seq: number; operation: MoveOperation }[]
  >([]);
  const remoteMovesRef = useRef(remoteMoves);
  const setRemoteMoves = (next: typeof remoteMoves) => {
    remoteMovesRef.current = next;
    setRemoteMovesState(next);
  };
  // The edits sent from here (their `clientEditId`): their steps come back over the live stream.
  const ownEditsRef = useRef(new Set<string>());
  const tokenRef = useRef(0);
  // The deck's edits shown here until the server settles them, by their outbox id.
  const shownRef = useRef(new Map<string, Shown>());
  // A taken edit's step (`seq` of its answer), until it is settled.
  const answeredSeqRef = useRef(new Map<string, number>());
  // Taken edits whose changes go once the edit state is at their step.
  const lateDropsRef = useRef<{ seq: number; tokens: readonly number[] }[]>([]);
  const outbox = useSyncExternalStore(editOutbox.subscribe, () => editOutbox.status(deck.id));
  // No connection, or the server out of reach while sending: what needs it at once waits.
  const online = useOnline();
  const offline = outbox.unreachable || !online;
  // Someone else's steps seen here, and when each element was last changed by one (undo's check).
  const othersRef = useRef({ count: 0, touched: new Map<string, number>() });
  const ownUndo = useOwnUndo(deck.id, offline, {
    element: (id) => shownElement(id),
    send: (operations, sources) => send(operations, {}, sources)?.id ?? null,
    othersMark: () => othersRef.current.count,
    touchedByOthers: (id, mark) => (othersRef.current.touched.get(id) ?? -1) > mark,
  });
  const available = canManage && state?.editable === true && userId !== undefined;
  // „Folie einfügen“'s layouts asked for ahead: the first time, the server draws them – not
  // while someone waits with the panel open.
  useDeckLayouts(deck.id, available);
  // …and the workspace's templates („Vorlagen“), so the panel never waits on them either.
  useWorkspaceMasters(deck.workspaceId, available);
  // The picked text's own size – to fit its box to (`textFitOf`).
  const [textFits, setTextFits] = useState<ReadonlyMap<string, TextFit>>(new Map());
  const measure = useCallback(
    (elementId: string, height: number | null) => setHeights(withHeight(elementId, height)),
    [],
  );
  const measureText = useCallback(
    (elementId: string, fit: TextFit | null) => setTextFits(withFit(elementId, fit)),
    [],
  );

  const setChanged = (next: ReadonlyMap<string, Changed>) => {
    changedRef.current = next;
    setChangedState(next);
  };
  const bySlide = new Map((state?.slides ?? []).map((slide) => [slide.slideId, slide]));
  const slideOfElement = new Map(
    (state?.slides ?? []).flatMap((slide) =>
      withChildren(slide.elements).map((element) => [element.id, slide.slideId] as const),
    ),
  );
  for (const [id, change] of remote) {
    slideOfElement.set(id, change.slideId);
    for (const inner of withChildren(change.element?.children ?? [])) {
      slideOfElement.set(inner.id, change.slideId);
    }
  }
  /** An element as the server's last answer has it – someone else's newer steps applied. */
  const drawnElement = (elementId: string) => {
    const change = remote.get(elementId);
    if (change) return change.element ?? undefined;
    const slideId = slideOfElement.get(elementId);
    // One in a group too.
    return slideId ? findElement(drawnOn(slideId), elementId) : undefined;
  };

  /** An element as shown now – the edits on their way applied (`null`: deleted). */
  const shownElement = (elementId: string): EditableElement | null | undefined => {
    const change = changedRef.current.get(elementId);
    const slideId = change?.slideId ?? slideOfElement.get(elementId);
    // In a group (one made a moment ago too): as its group shows it.
    const shown = slideId
      ? findElement(elementsWith(slideId, changedRef.current), elementId)
      : undefined;
    if (shown) return shown;
    if (change) return change.element;
    // Drawn but not shown on its slide: deleted here (one in a group too).
    return slideId && drawnElement(elementId) ? null : undefined;
  };

  /** A slide's elements as the server's last answer has them, someone else's newer steps applied. */
  const drawnOn = (slideId: string): readonly EditableElement[] => {
    const elements = bySlide.get(slideId)?.elements ?? NONE;
    const overlay = remote;
    if (overlay.size === 0) return elements;
    const out: EditableElement[] = [];
    for (const element of elements) {
      const change = overlay.get(element.id);
      if (!change) out.push(element);
      else if (change.element) out.push(change.element);
    }
    for (const [id, change] of overlay) {
      if (change.slideId === slideId && change.element && !elements.some((item) => item.id === id))
        out.push(change.element);
    }
    return out;
  };
  const elementsWith = (slideId: string, overlay: ReadonlyMap<string, Changed>) => {
    const base = drawnOn(slideId);
    if (overlay.size === 0) return base;
    const out: EditableElement[] = [];
    for (const element of base) {
      const change = overlay.get(element.id);
      if (!change) out.push(element);
      else if (change.element) out.push(change.element);
    }
    for (const [id, change] of overlay) {
      if (change.slideId === slideId && change.element && !base.some((item) => item.id === id)) {
        out.push(change.element);
      }
    }
    return out;
  };
  /** Stacking moves on their way – someone else's not yet in the edit state, then the own. */
  const pendingMoves = (overlay: ReadonlyMap<string, Changed>) => [
    ...remoteMoves.map((move) => move.operation),
    ...[...overlay.values()]
      .filter((change) => change.moves)
      .sort((a, b) => a.token - b.token)
      .flatMap((change) => change.moves ?? []),
  ];
  const {
    draft,
    lastDrawing,
    activeSlideId,
    layersOpen: layers,
    layersPanelOpen,
    tool: reviewTool,
    materialOpen,
  } = useViewerState();
  // The editor's keys are off on the material page: ⌘Z, ⌘V, Entf there are the board's.
  const keysActive = active && !materialOpen;
  const stacked = (slideId: string) => {
    const elements = elementsWith(slideId, changed);
    const moves = pendingMoves(changed);
    return moves.length === 0 ? elements : restacked(elements, moves);
  };
  // In a group while what is picked lies in it (and it is there): its elements in its place, each
  // its own – in the layers view picked in its list, the slide's elements staying as they are
  // (their pictures are the slide's elements').
  const pickedIds = selection ? [selection.elementId] : (group?.elementIds ?? []);
  const enteredGroup = entered ? findElement(stacked(entered.slideId), entered.groupId) : undefined;
  const inGroup =
    entered &&
    enteredGroup?.children &&
    pickedIds.length > 0 &&
    pickedIds.every((id) => findElement(enteredGroup.children!, id))
      ? entered
      : null;
  // Left (something else picked, the group gone): out of it for good, as rendered.
  if (entered && !inGroup) setEntered(null);
  const elementsOf = (slideId: string) =>
    inGroup?.slideId === slideId && !layers
      ? enteredIn(stacked(slideId), inGroup.groupId)
      : stacked(slideId);

  const picked = selection
    ? (elementsOf(selection.slideId).find((element) => element.id === selection.elementId) ??
      // A part of the group entered in the layers view's list.
      (inGroup && layers ? findElement(stacked(selection.slideId), selection.elementId) : null) ??
      null)
    : null;
  // An element that went away (deleted, undone) is no longer picked.
  const selectedElement = picked;
  const currentSelection = picked ? selection : null;
  // Those that went away (deleted, undone) leave the group; one left is no group any more.
  const groupIds = group
    ? group.elementIds.filter((id) =>
        elementsOf(group.slideId).some((element) => element.id === id),
      )
    : [];
  const groupKey = group && groupIds.length > 1 ? `${group.slideId}\n${groupIds.join('\n')}` : '';
  const currentGroup = useMemo<EditGroup | null>(() => {
    if (!groupKey) return null;
    const [slideId, ...elementIds] = groupKey.split('\n');
    return { slideId: slideId!, elementIds };
  }, [groupKey]);

  const dispatch = useViewerDispatch();
  useLayoutEffect(() => {
    previews.set(null);
  }, [active, layers, previews]);
  const stopText = () => {
    setTextEditing(null);
    setTextEditor(null);
  };

  const select = (next: EditSelection | null) => {
    // Whatever was tried on goes with the element it was tried on.
    if (triedRef.current) tryOut(null);
    if (next?.elementId !== textEditing) stopText();
    if (next?.elementId !== opened) setOpened(null);
    setSelection(next);
    setGroup(null);
  };
  /**
   * A double click on a group (Figma): in it, its element `elementId` picked – none under the
   * pointer, the group picked.
   */
  const enterGroup = (slideId: string, groupId: string, elementId: string | null) => {
    select({ slideId, elementId: elementId ?? groupId });
    setEntered(elementId ? { slideId, groupId } : null);
  };
  const selectGroup = (next: EditGroup | null) => {
    const ids = [...new Set(next?.elementIds ?? [])];
    if (!next || ids.length < 2) {
      select(next && ids.length === 1 ? { slideId: next.slideId, elementId: ids[0]! } : null);
      return;
    }
    select(null);
    setGroup({ slideId: next.slideId, elementIds: ids });
  };

  // Reviewing or editing – either one also in the layers view. Editing drops the drawing tool.
  const setActive = (next: boolean) => {
    setActiveState(next);
    setToolState('select');
    setSelection(null);
    setGroup(null);
    stopText();
    if (next) dispatch({ type: 'toolSelected', tool: null });
  };
  const setTool = (next: EditTool) => {
    setToolState(next);
    if (next !== 'select') select(null);
  };

  /** Drops the changes the server's answer (or refusal) settled; newer changes stay. */
  const dropChanges = (tokens: readonly number[]) => {
    const next = new Map(changedRef.current);
    for (const [id, change] of next) if (tokens.includes(change.token)) next.delete(id);
    setChanged(next);
  };

  /**
   * Shows `operations` at once – before the server has them – and returns what settles them: the
   * changes drawn (their `Changed.token`) and what waits for the server's answer.
   */
  const show = (
    operations: readonly SlideOperation[],
    sources?: ReadonlyMap<string, EditableElement>,
  ) => {
    const token = ++tokenRef.current;
    const previous = changedRef.current;
    const next = new Map(previous);
    const current = (id: string): EditableElement | null | undefined => {
      const change = next.get(id);
      return change ? change.element : drawnElement(id);
    };
    const aspect = (state?.pageSize ?? PAGE_SIZE).width / (state?.pageSize ?? PAGE_SIZE).height;
    const slideOf = (id: string) =>
      next.get(id)?.slideId ??
      slideOfElement.get(id) ??
      // Made in a group in this edit or one before the server's answer (pasted, grouped in it).
      [...next.values()].find(
        (change) => change.element?.children && findElement(change.element.children, id),
      )?.slideId;
    /** As shown with what came before in this edit – one in a group as its group has it. */
    const currentAny = (id: string): EditableElement | null | undefined => {
      const slideId = slideOf(id);
      const top = slideId ? topOf(slideId, id, next) : undefined;
      if (!top || top === id) return current(id);
      const holder = current(top);
      return holder?.children ? findElement(holder.children, id) : undefined;
    };
    for (const operation of operations) {
      if (operation.type === 'addElement' || operation.type === 'addImage') {
        const slideId = state?.slides.find((slide) => slide.pageId === operation.pageId)?.slideId;
        if (slideId) {
          next.set(operation.elementId, {
            slideId,
            element:
              operation.type === 'addImage'
                ? addedImage(operation)
                : addedElement(operation, state?.pageSize ?? PAGE_SIZE),
            token,
          });
        }
        continue;
      }
      if (operation.type === 'copyElement') {
        // Deleted since (an undo brings it back): as it was when it went.
        const source = currentAny(operation.elementId) ?? sources?.get(operation.elementId);
        const slideId = state?.slides.find((slide) => slide.pageId === operation.pageId)?.slideId;
        if (!source || !slideId) continue;
        const copy = copiedElement(
          source,
          operation.newElementId,
          operation.box,
          operation.partIds,
        );
        // Into a group (pasted in it, a part of it brought back): drawn in it at once.
        const top = operation.groupId ? topOf(slideId, operation.groupId, next) : undefined;
        const holder = top && current(top);
        if (operation.groupId && top && holder) {
          next.set(top, {
            ...next.get(top),
            slideId,
            element: withCopyIn(holder, operation.groupId, copy, aspect),
            token,
          });
        } else if (!operation.groupId) {
          next.set(operation.newElementId, { slideId, element: copy, token });
        }
        continue;
      }
      if (operation.type === 'groupElements') {
        // Grouped: its elements give way to the group, where the topmost of them was – drawn as
        // they were until LibreOffice's picture of it comes (`SlideCompositor`).
        const first = operation.elementIds[0];
        const slideId = first && slideOf(first);
        if (!slideId) continue;
        // Parts of a group (entered, ⌘G in it): a group in it, drawn so in the same frame.
        const holderId = topOf(slideId, first, next);
        if (holderId && holderId !== first) {
          const holder = current(holderId);
          if (holder) {
            next.set(holderId, {
              ...next.get(holderId),
              slideId,
              element: withGroupIn(holder, operation, aspect),
              token,
            });
          }
          continue;
        }
        const ids = new Set(operation.elementIds);
        const shown = restacked(elementsWith(slideId, next), pendingMoves(next));
        const members = shown.filter((element) => ids.has(element.id));
        if (members.length < 2) continue;
        const top = shown.indexOf(members.at(-1)!);
        const below = shown.slice(0, top).filter((element) => !ids.has(element.id)).length;
        const pageSize = state?.pageSize ?? PAGE_SIZE;
        for (const member of members) next.set(member.id, { slideId, element: null, token });
        next.set(operation.newElementId, {
          slideId,
          element: groupedElement(operation, members, pageSize.width / pageSize.height),
          token,
          moves: [{ type: 'moveElement', elementId: operation.newElementId, to: below }],
        });
        continue;
      }
      if (!('elementId' in operation)) continue;
      const slideId = slideOf(operation.elementId);
      // One in a group (entered): a change of its group, drawn so in the same frame.
      const top = slideId && topOf(slideId, operation.elementId, next);
      if (slideId && top && top !== operation.elementId) {
        const holder = current(top);
        if (!holder) continue;
        next.set(top, {
          ...next.get(top),
          slideId,
          element: applyToElement(holder, operation, aspect),
          token,
        });
        continue;
      }
      const element = current(operation.elementId);
      if (!element || !slideId) continue;
      // A tilted one changed: its tilted picture is drawn anew; the new tilt is that picture.
      const tiltedId = operation.elementId;
      if (operation.type === 'setTilt' || operation.type === 'deleteElement') retilted(tiltedId);
      // Locked or unlocked, it looks as it did.
      else if (element.tilt && operation.type !== 'setLocked')
        setRetilting((current) =>
          current.get(tiltedId) === slideId ? current : new Map(current).set(tiltedId, slideId),
        );
      const moves = next.get(operation.elementId)?.moves;
      next.set(operation.elementId, {
        slideId,
        element: applyToElement(element, operation, aspect),
        token,
        moves: operation.type === 'moveElement' ? [...(moves ?? []), operation] : moves,
      });
    }
    setChanged(next);
    return { token };
  };

  /** Remembers what an edit showed, under its outbox id – an edit merged into it adds to that. */
  const track = (
    id: string,
    operations: readonly SlideOperation[],
    shown: ReturnType<typeof show>,
  ) => {
    const known = shownRef.current.get(id);
    if (!known) {
      shownRef.current.set(id, { operations, tokens: [shown.token] });
      return;
    }
    known.operations = operations;
    known.tokens.push(shown.token);
  };

  /** The top element of a slide (as `overlay` shows it) that is `id` or holds it, at any depth. */
  const topOf = (slideId: string, id: string, overlay: ReadonlyMap<string, Changed>) => {
    const shown = elementsWith(slideId, overlay);
    if (shown.some((element) => element.id === id)) return id;
    return shown.find((element) => element.children && findElement(element.children, id))?.id;
  };

  /** What undo reads of the slides as shown when an edit is made (`inverseOf`). */
  const undoContext = (): UndoContext => {
    const slides = [...(state?.slides ?? [])].sort((a, b) => a.index - b.index);
    const byPage = new Map(slides.map((slide) => [slide.pageId, slide]));
    return {
      element: shownElement,
      groupOf: (elementId) => {
        const slideId = changedRef.current.get(elementId)?.slideId ?? slideOfElement.get(elementId);
        return slideId ? parentOf(elementsWith(slideId, changedRef.current), elementId) : undefined;
      },
      pageOf: (elementId) => {
        const slideId = changedRef.current.get(elementId)?.slideId ?? slideOfElement.get(elementId);
        return slideId ? bySlide.get(slideId)?.pageId : undefined;
      },
      elementsOn: (pageId) => {
        const slideId = byPage.get(pageId)?.slideId;
        return slideId
          ? restacked(elementsWith(slideId, changedRef.current), pendingMoves(changedRef.current))
          : NONE;
      },
      slides,
      slidePending: (pageId) =>
        [...shownRef.current.values()].some((shown) =>
          shown.operations.some(
            (operation) => 'pageId' in operation && operation.pageId === pageId,
          ),
        ),
    };
  };

  /** Shows `operations` at once and hands them to the outbox to send; its outbox id. */
  const send = (
    operations: SlideOperation[],
    options: ApplyOptions = {},
    sources?: ReadonlyMap<string, EditableElement>,
  ) => {
    if (!available || !userId) return null;
    const shown = show(operations, sources);
    const { id, done } = editOutbox.enqueue(deck.id, userId, operations, options);
    ownEditsRef.current.add(id);
    track(id, operations, shown);
    return { id, done };
  };

  /** An own edit: shown at once, sent, and the next for ⌘Z – its way back worked out here first. */
  const apply = (operations: SlideOperation[], options: ApplyOptions = {}) => {
    if (!available || !userId) return Promise.resolve(false);
    const back = inverseOf(operations, undoContext());
    const touched = touchedElements(operations);
    const before = snapshotOf(touched, shownElement);
    const sent = send(operations, options);
    if (!sent) return Promise.resolve(false);
    ownUndo.edited(sent.id, operations, back, before, snapshotOf(touched, shownElement));
    return sent.done;
  };

  /** What is tried on (`tryOut`): shown like an edit, settled as refused once let go of. */
  const triedRef = useRef<ReturnType<typeof show> | null>(null);
  const tryOut = (operations: SlideOperation[] | null) => {
    const before = triedRef.current;
    triedRef.current = null;
    if (before) dropChanges([before.token]);
    if (operations && available) triedRef.current = show(operations);
  };

  // What the outbox makes of the deck's edits: shown (one left from before, or made before this
  // editor attached), taken, refused, settled – each read with this render's state.
  const onAdded = useEffectEvent((id: string, operations: readonly SlideOperation[]) => {
    ownEditsRef.current.add(id);
    if (!shownRef.current.has(id)) track(id, operations, show(operations));
  });
  // Someone else's step: shown at once, under the own edits on their way – those replayed over it.
  const onStep = useEffectEvent((step: LiveStep) => {
    if (step.clientEditId !== null && ownEditsRef.current.has(step.clientEditId)) return;
    if (!state || state.seq >= step.seq) return;
    showRemoteSlideStep(deck.id, step);
    const { next, touched } = withRemoteStep(remoteRef.current, step, {
      element: (id) => drawnElement(id),
      slideOfElement: (id) => slideOfElement.get(id),
      slideOfPage: (pageId) => state.slides.find((slide) => slide.pageId === pageId)?.slideId,
      pageSize: state.pageSize ?? PAGE_SIZE,
      topOf: (id) => {
        const slideId = slideOfElement.get(id);
        return slideId ? topOf(slideId, id, changedRef.current) : undefined;
      },
    });
    const moves = step.operations.filter(
      (operation): operation is MoveOperation => operation.type === 'moveElement',
    );
    if (moves.length > 0) {
      setRemoteMoves([
        ...remoteMovesRef.current,
        ...moves.map((operation) => ({ seq: step.seq, operation })),
      ]);
    }
    if (touched.length === 0) return;
    const others = othersRef.current;
    others.count += 1;
    for (const id of touched) others.touched.set(id, others.count);
    setRemote(next);
    const own = changedRef.current;
    const tried = triedRef.current?.token;
    const pending = [...shownRef.current.values()].flatMap((shown) => shown.operations);
    let rebasedOwn: Map<string, Changed> | null = null;
    for (const id of touched) {
      const change = own.get(id);
      if (!change || change.token === tried) continue;
      const base = next.get(id)?.element ?? null;
      const element = rebased(base, id, pending);
      if (element === undefined) continue;
      rebasedOwn ??= new Map(own);
      rebasedOwn.set(id, { ...change, element });
    }
    if (rebasedOwn) setChanged(rebasedOwn);
  });
  useEffect(() => onLiveStep((step) => onStep(step)), []);
  // The element as shown now, read from a subscription.
  const shownNow = useEffectEvent((elementId: string) => shownElement(elementId));
  // The others see what is dragged here as it moves (presence, no step yet)…
  useEffect(
    () =>
      previews.subscribe(() => {
        const preview = previews.get();
        const element = preview && !preview.group ? shownNow(preview.elementId) : null;
        setPresence({
          drag:
            preview && element
              ? {
                  elementId: preview.elementId,
                  ...preview.rect,
                  rotation: preview.rotation ?? element.rotation,
                }
              : null,
        });
      }),
    [previews],
  );
  // …and which element is picked here.
  const pickedId = active ? (selection?.elementId ?? null) : null;
  useEffect(() => {
    setPresence({ picked: pickedId });
  }, [pickedId]);
  const onTaken = useEffectEvent((id: string, answer: ApplyEditResult) => {
    answeredSeqRef.current.set(id, answer.seq);
    if (answer.step !== null) ownUndo.taken(id, answer.step);
    if (answer.dropped > 0) toast(droppedMessage(answer.dropped), 'danger');
  });
  const onRefused = useEffectEvent((id: string, error: unknown) => {
    ownUndo.refused(id);
    toast(error instanceof Error ? error.message : 'Die Änderung ging nicht durch.', 'danger');
  });
  const onSettled = useEffectEvent((id: string, ok: boolean) => {
    const shown = shownRef.current.get(id);
    const seq = answeredSeqRef.current.get(id);
    answeredSeqRef.current.delete(id);
    if (!shown) return;
    shownRef.current.delete(id);
    // Taken, its answer stored – yet read here only a little later (the query cache tells its
    // readers in a task of its own): shown as changed until then, not back where it was for a frame.
    if (ok && seq !== undefined && (state?.seq ?? 0) < seq) {
      lateDropsRef.current.push({ seq, tokens: shown.tokens });
    } else dropChanges(shown.tokens);
  });
  // The edit state caught up with a taken edit's answer: what it showed goes now.
  /** The edit state has someone else's steps up to `seq` now: their overlay goes. */
  const settleRemote = (seq: number) => {
    const moves = remoteMovesRef.current;
    if (moves.some((move) => move.seq <= seq))
      setRemoteMoves(moves.filter((move) => move.seq > seq));
    const left = settledAt(remoteRef.current, seq);
    if (left !== remoteRef.current) setRemote(left);
  };
  const dropLate = useEffectEvent((seq: number) => {
    settleRemote(seq);
    const due = lateDropsRef.current.filter((late) => late.seq <= seq);
    if (due.length === 0) return;
    lateDropsRef.current = lateDropsRef.current.filter((late) => late.seq > seq);
    dropChanges(due.flatMap((late) => late.tokens));
  });
  const stateSeq = state?.seq;
  useEffect(() => {
    if (stateSeq === undefined) return;
    dropLate(stateSeq);
  }, [stateSeq]);
  useEffect(() => {
    if (!available) return;
    const listener: OutboxListener = {
      added: (id, operations) => onAdded(id, operations),
      taken: (id, answer) => onTaken(id, answer),
      refused: (id, error) => onRefused(id, error),
      settled: (id, ok) => onSettled(id, ok),
    };
    const detach = editOutbox.attach(deck.id, listener);
    // Settled while detached (it attaches anew): what they showed goes.
    const queued = new Set(editOutbox.queued(deck.id));
    for (const id of [...shownRef.current.keys()]) if (!queued.has(id)) onSettled(id, true);
    return detach;
  }, [available, deck.id]);

  const undo = ownUndo.undo;
  const redo = ownUndo.redo;

  // E edits, R reviews (each only goes there), L switches the layers view – not while typing, nor
  // while a drawing's comment is being started by typing after it (`useViewerShortcuts`).
  const setLayers = (open: boolean) => {
    dispatch({ type: 'layersSet', open });
  };
  // A drawing tool picked (Tab steps through them): back to reviewing.
  if (reviewTool && active) setActive(false);
  useEffect(() => {
    if (!available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== 'e' && key !== 'r' && key !== 'l') return;
      if (materialOpen || event.defaultPrevented || isModKey(event) || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('dialog')) return;
      if (draft || lastDrawing) return;
      event.preventDefault();
      // L switches the mode, ⇧L its list (the mode on with it).
      if (key === 'l') {
        if (!event.shiftKey) setLayers(!layers);
        else if (!layers) {
          setLayers(true);
          dispatch({ type: 'layersPanelSet', open: true });
        } else dispatch({ type: 'layersPanelSet', open: !layersPanelOpen });
      } else if ((key === 'e') !== active) setActive(key === 'e');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // The element copied (⌘C), to put in with ⌘V – in this deck. The system's clipboard has it too
  // (`writeClipboard`) and goes first: anything copied since, here or elsewhere, replaces it. This
  // one is for where a browser tells nothing on ⌘V (Safari, nothing to type in focused) – any
  // other copy on the page (a comment's text) replaces it as well.
  const copiedRef = useRef<CopiedElement | null>(null);
  // The element last copied as it was then: shown in the format panel's handle (`Editing.clipboard`).
  const [copiedShown, setClipboard] = useState<{ deckId: string; element: EditableElement } | null>(
    null,
  );
  const clipboard = copiedShown?.deckId === deck.id ? copiedShown.element : null;
  // ⌘V pressed where it puts in an element: the paste it brings answers, else `copiedRef` does.
  const pastePendingRef = useRef(false);
  useEffect(() => {
    const forget = () => {
      copiedRef.current = null;
      setClipboard(null);
    };
    document.addEventListener('copy', forget);
    document.addEventListener('cut', forget);
    return () => {
      document.removeEventListener('copy', forget);
      document.removeEventListener('cut', forget);
    };
  }, []);
  useEffect(() => {
    copiedRef.current = null;
  }, [deck.id]);

  /**
   * Puts a copy of the element copied on the slide shown, picked; on its own slide a step aside
   * (one cut: where it was, the first time).
   */
  const paste = async (copied: CopiedElement, slideId = activeSlideId ?? copied.slideId) => {
    const slide = bySlide.get(slideId);
    if (!slide) return;
    let box = copied.box;
    const back = copied.cut && slideId === copied.slideId;
    copied.cut = false;
    if (slideId === copied.slideId && !back) {
      const size = state?.pageSize ?? PAGE_SIZE;
      box = {
        ...box,
        x: Math.min(1 - box.w, box.x + PASTE_STEP),
        y: Math.min(1 - box.h, box.y + (PASTE_STEP * size.width) / size.height),
      };
    }
    const elementId = newEditId();
    // In a group: into it, as Figma pastes.
    const into = inGroup?.slideId === slideId ? inGroup.groupId : undefined;
    // A group: its parts' ids given here, as the file then has them – nothing re-keyed after.
    const source =
      shownElement(copied.elementId) ||
      (clipboard?.id === copied.elementId ? clipboard : undefined);
    const partIds = newPartIds(source, newEditId);
    const done = apply([
      {
        type: 'copyElement',
        elementId: copied.elementId,
        pageId: slide.pageId,
        newElementId: elementId,
        box,
        ...(into && { groupId: into }),
        ...(partIds && { partIds }),
      },
    ]);
    // Picked as it shows, at once – not when the server answers, over what was picked since.
    select({ slideId, elementId });
    // The next one a step further, as PowerPoint's.
    if (slideId === copied.slideId) copied.box = box;
    if (!(await done)) return;
    // A template's picture placeholder copied: the copy is one too (a text box is one anyway).
    const template = queryClient.getQueryData<Deck>(queryKeys.deck(deck.id))?.template;
    const kind = template?.placeholders[copied.elementId];
    if (template && kind === 'picture') {
      updateTemplate({ placeholders: { ...template.placeholders, [elementId]: kind } });
    }
  };

  /** What ⌘G groups: those picked together that move and are flat – at least two. */
  const groupable = currentGroup
    ? elementsOf(currentGroup.slideId).filter(
        (element) =>
          currentGroup.elementIds.includes(element.id) && canMove(element) && !element.tilt,
      )
    : [];
  /** ⌘G: those picked together in one group (`groupElements`), the group picked. */
  const groupPicked = () => {
    if (!currentGroup || groupable.length < 2) return false;
    const elementId = newEditId();
    void apply([
      {
        type: 'groupElements',
        elementIds: groupable.map((element) => element.id),
        newElementId: elementId,
      },
    ]);
    select({ slideId: currentGroup.slideId, elementId });
    return true;
  };
  /** ⇧⌘G: the picked group taken apart, its elements picked together once they are there. */
  const ungroupPicked = () => {
    const picked = selectedElement;
    if (!picked || picked.kind !== 'group' || !currentSelection) return false;
    const slideId = currentSelection.slideId;
    void apply([{ type: 'ungroupElements', elementId: picked.id }]).then(
      (ok) => ok && picked.members && selectGroup({ slideId, elementIds: picked.members }),
    );
    return true;
  };

  /** The element last copied here put in again, as ⌘V does (the clipboard in the format panel). */
  const pasteCopied = () => {
    const copied = copiedRef.current;
    if (copied?.deckId === deck.id) void paste(copied);
  };

  const upload = useUploadEditImage(deck.id);
  /** A picture pasted or dropped: uploaded, then a new picture element of its proportions. */
  const insertImage: Editing['insertImage'] = async (
    file,
    slideId = activeSlideId ?? undefined,
    at,
    longest,
  ) => {
    const slide = slideId ? bySlide.get(slideId) : undefined;
    if (!slide) return false;
    if (offline) {
      toast('Bilder lassen sich nur mit Verbindung einfügen.', 'neutral');
      return false;
    }
    // HEIC, TIFF, SVG …: drawn into a PNG first – as the slide shows it.
    const shown = await shownImage(file);
    if (!shown) {
      toast('Dieses Bildformat lässt sich nicht einfügen.', 'neutral');
      return false;
    }
    try {
      const image = await upload.mutateAsync(shown);
      const elementId = newEditId();
      const box = imageBox(image, state?.pageSize ?? PAGE_SIZE, at, longest);
      const ok = await apply([
        { type: 'addImage', pageId: slide.pageId, elementId, box, imageId: image.imageId },
      ]);
      if (ok) select({ slideId: slide.slideId, elementId });
      return ok;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Das Bild ging nicht hoch.', 'danger');
      return false;
    }
  };

  /**
   * Text pasted from outside (another app, a web page): a new text box in the slide's body style,
   * as wide as its lines, in the slide's middle, picked – as Figma does. Works offline (no upload).
   */
  const insertText = async (text: string, slideId = activeSlideId ?? undefined) => {
    const slide = slideId ? bySlide.get(slideId) : undefined;
    if (!slide) return false;
    const style = textStyleOn(elementsOf(slide.slideId));
    const { paragraphs, cut } = pastedParagraphs(text, style);
    if (paragraphs.length === 0) return false;
    if (cut) toast('Der Text war zu lang – eingefügt ist sein Anfang.', 'neutral');
    const elementId = newEditId();
    await loadPastedFont(style);
    const box = pastedTextBox(paragraphs, style, state?.pageSize ?? PAGE_SIZE);
    const ok = await apply([
      {
        type: 'addElement',
        pageId: slide.pageId,
        elementId,
        kind: 'text',
        box,
        fill: null,
        stroke: null,
        paragraphs,
      },
    ]);
    if (ok) select({ slideId: slide.slideId, elementId });
    return ok;
  };

  /** What came from outside Slider: pictures as picture elements (a step apart), text as a box. */
  const insertPasted = async (pasted: Pasted) => {
    if (pasted?.kind === 'text') return insertText(pasted.text);
    if (pasted?.kind !== 'images') return false;
    return insertEach(
      pasted.images,
      { x: 0.5, y: 0.5 },
      PASTE_STEP,
      state?.pageSize ?? PAGE_SIZE,
      (image, at) => insertImage(image, undefined, at),
    );
  };

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const pending = pastePendingRef.current;
    pastePendingRef.current = false;
    // A dialog over the editor takes what is pasted there itself (as it does E, R and L).
    if (event.target instanceof Element && event.target.closest('dialog')) return;
    const data = event.clipboardData;
    if (!data) return;
    const copied = copiedOf(data);
    if (!copied) {
      // Something else copied since (in another app, too): not the element any more.
      if (data.types.length > 0) copiedRef.current = null;
      const pasted = pastedOf({
        images: imageFilesOf(data),
        text: data.getData('text/plain'),
        html: data.getData('text/html'),
      });
      // A picture (a screenshot, one copied in another app or a file): new picture elements –
      // unless pasted into a field (a comment takes it there). Text: a new text box – unless
      // pasted where text is typed (a text box, a comment, a panel's field takes it).
      const takes =
        pasted?.kind === 'images'
          ? pending || !isTextTarget(event.target)
          : !!pasted && !isTextTarget(event.target);
      if (takes) {
        event.preventDefault();
        event.stopPropagation();
        void insertPasted(pasted);
      }
      return;
    }
    // In a field with text: the element's text goes in, as plain text.
    if (!pending) return;
    event.preventDefault();
    event.stopPropagation();
    if (copied.deckId !== deck.id) {
      toast('Ein kopiertes Element lässt sich nur dort einfügen, wo es herkommt.', 'neutral');
      return;
    }
    // Put in here before: the next one a step further (`paste`).
    const same =
      copiedRef.current?.deckId === copied.deckId &&
      copiedRef.current.elementId === copied.elementId
        ? copiedRef.current
        : copied;
    copiedRef.current = same;
    void paste(same);
  });
  useEffect(() => {
    if (!keysActive) return;
    const listener = (event: ClipboardEvent) => onPaste(event);
    window.addEventListener('paste', listener, { capture: true });
    return () => window.removeEventListener('paste', listener, { capture: true });
  }, [keysActive]);

  // Keys while editing: Esc lets go (the tool, then the pick – never the mode), ⌘↵ takes the element as it is and lets go –
  // also while typing in it –, Entf / ⌘⌫ deletes (elements picked together too), ⌘A picks every
  // element of the slide together, ⌘C / ⌘X / ⌘V copy, cut and put in, ⌘D duplicates,
  // ⇧⌘L locks and unlocks, ⌘G / ⇧⌘G group and ungroup, ⌘Z / ⇧⌘Z undo and redo.
  useEffect(() => {
    // Also in the layers view; its list's keys go first (⌘Z there is the same).
    if (!keysActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A key typed into a search open anywhere (symbols, photos): the search's, not a picked
      // text box's.
      if (event.defaultPrevented || typedIntoField(event)) return;
      const mod = event.metaKey || event.ctrlKey;
      // A panel's text field takes ⌘↵ itself; any other field gives up its value on blur.
      const textarea = event.target instanceof HTMLTextAreaElement;
      if (mod && event.key === 'Enter' && (currentSelection || currentGroup) && !textarea) {
        event.preventDefault();
        event.stopPropagation();
        if (isTypingTarget(event.target)) (event.target as HTMLElement).blur();
        select(null);
        return;
      }
      const key = event.key.toLowerCase();
      // ⇧⌘L locks or unlocks what is picked (all of it: locked unless every one is) – as Figma.
      // No meaning in text, so also while typing.
      if (
        mod &&
        event.shiftKey &&
        !event.altKey &&
        key === 'l' &&
        (selectedElement || currentGroup)
      ) {
        const picked = currentGroup
          ? elementsOf(currentGroup.slideId).filter((element) =>
              currentGroup.elementIds.includes(element.id),
            )
          : [selectedElement as EditableElement];
        event.preventDefault();
        event.stopPropagation();
        void apply(lockOperations(picked));
        return;
      }
      // Typing in a field: the editor's keys are the field's – but an empty text box typed in
      // has nothing to copy, put in or delete but itself, and with nothing marked in a text box
      // ⌘C, ⌘X and ⌘D take the whole box. A choice picked in a panel (a select) holds no text:
      // ⌘C, ⌘X, ⌘V, ⌘D, ⌘Z and Entf stay the editor's.
      if (isTypingTarget(event.target)) {
        // The text box itself (contenteditable) \u2013 not a panel's field while it is typed in.
        const box =
          !!selectedElement &&
          textEditing === selectedElement.id &&
          (event.target as HTMLElement).isContentEditable;
        const empty = box && !(event.target as HTMLElement).textContent?.replace(/[\s\u200b]/g, '');
        const own = mod
          ? !event.altKey && ['c', 'x', 'v', 'd', 'z', 'g'].includes(key)
          : event.key === 'Delete' || event.key === 'Backspace';
        const textless = !isTextTarget(event.target) && own;
        const emptyBox =
          empty && mod && !event.altKey && (key === 'c' || key === 'v' || key === 'backspace');
        const whole =
          box &&
          mod &&
          !event.altKey &&
          !event.shiftKey &&
          (key === 'c' || key === 'x' || key === 'd') &&
          !!window.getSelection()?.isCollapsed;
        if (!textless && !emptyBox && !whole) return;
        if (box && (key === 'c' || key === 'x' || key === 'd')) {
          // What was typed is written first (on blur), so the copy has it; typing ends.
          (event.target as HTMLElement).blur();
          setTextEditing(null);
        }
      }
      // A picked text box typed at: typing in it starts, the key typed at its end – and what is
      // typed until its editor is there (its picture without the text) is typed on there.
      const typedBox = selectedElement?.live && currentSelection ? selectedElement.id : null;
      const typedOn = typedBox !== null && textEditing === typedBox && typedAhead.has(typedBox);
      let handled = true;
      if (
        typedBox &&
        !event.isComposing &&
        typesCharacter(event) &&
        (typedOn || (textEditing !== typedBox && event.key !== ' '))
      ) {
        typedAhead.put(typedBox, typedAhead.peek(typedBox) + event.key);
        if (!typedOn) {
          setTextCaret(null);
          setTextEditing(typedBox);
          setOpened(typedBox);
        }
      } else if (typedOn && event.key === 'Backspace') {
        typedAhead.put(typedBox, typedAhead.peek(typedBox).slice(0, -1));
      } else if (event.key === 'Escape') {
        // Never out of editing: that is the mode switch's (R).
        if (tool !== 'select') setTool('select');
        // In a group: out of it, the group picked (Figma).
        else if (inGroup && (currentSelection || currentGroup))
          select({ slideId: inGroup.slideId, elementId: inGroup.groupId });
        else if (currentSelection || currentGroup) select(null);
        else handled = false;
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && currentGroup) {
        const ids = currentGroup.elementIds;
        void apply(ids.map((elementId) => ({ type: 'deleteElement', elementId }))).then(
          (ok) => ok && select(null),
        );
      } else if (mod && !event.altKey && key === 'g' && (currentGroup || selectedElement)) {
        // ⌘G groups those picked together, ⇧⌘G takes a picked group apart – as Figma.
        handled = event.shiftKey ? ungroupPicked() : groupPicked();
      } else if (mod && !event.altKey && key === 'a' && activeSlideId && !layers) {
        // Every element of the slide shown that moves – not one locked –, picked together.
        // In a group: its elements.
        const among =
          inGroup?.slideId === activeSlideId && enteredGroup?.children
            ? new Set(enteredGroup.children.map((element) => element.id))
            : null;
        const elementIds = elementsOf(activeSlideId)
          .filter((element) => canMove(element) && element.bbox.w > 0 && element.bbox.h > 0)
          .filter((element) => !among || among.has(element.id))
          .map((element) => element.id);
        if (elementIds.length > 0) selectGroup({ slideId: activeSlideId, elementIds });
        else handled = false;
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedElement) {
        void apply([{ type: 'deleteElement', elementId: selectedElement.id }]).then(
          (ok) => ok && select(null),
        );
      } else if (
        mod &&
        !event.altKey &&
        (key === 'c' || key === 'x') &&
        selectedElement &&
        currentSelection &&
        // Text marked on the page (a comment's) is copied as text.
        !window.getSelection()?.toString()
      ) {
        // The element as it is now; its copy is made from the file's, changes before it included
        // – one cut from the file before it went.
        const copied: CopiedElement = {
          deckId: deck.id,
          elementId: selectedElement.id,
          slideId: currentSelection.slideId,
          box: selectedElement.bbox,
          cut: key === 'x',
        };
        copiedRef.current = copied;
        setClipboard({ deckId: deck.id, element: selectedElement });
        writeClipboard({ ...copied }, selectedElement.paragraphs?.join('\n') ?? '');
        if (key === 'x') {
          void apply([{ type: 'deleteElement', elementId: selectedElement.id }]).then(
            (ok) => ok && select(null),
          );
        }
      } else if (
        mod &&
        !event.altKey &&
        !event.shiftKey &&
        key === 'd' &&
        selectedElement &&
        currentSelection
      ) {
        // A copy a step aside, picked – the clipboard stays as it is; again: a step further.
        void paste(
          {
            deckId: deck.id,
            elementId: selectedElement.id,
            slideId: currentSelection.slideId,
            box: selectedElement.bbox,
          },
          currentSelection.slideId,
        );
      } else if (mod && !event.altKey && key === 'v') {
        // The browser's paste comes with the clipboard (`onPaste`); none – Safari with nothing
        // to type in focused – the element copied here goes in.
        pastePendingRef.current = true;
        setTimeout(() => {
          if (!pastePendingRef.current) return;
          pastePendingRef.current = false;
          if (copiedRef.current?.deckId === deck.id) void paste(copiedRef.current);
          // Nothing copied here: a picture or text on the clipboard, read where the browser allows it.
          else void readClipboard().then((content) => insertPasted(pastedOf(content)));
        });
        // Not kept from the browser: its paste brings the clipboard.
        event.stopPropagation();
        return;
      } else if (event.key === 'Enter' && selectedElement?.live && currentSelection) {
        // Enter on a picked text box types in it, like PowerPoint.
        setTextCaret(null);
        setTextEditing(selectedElement.id);
        setOpened(selectedElement.id);
      } else if (mod && event.key.toLowerCase() === 'z') {
        if (event.shiftKey) redo();
        else undo();
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  });

  // Tab / ⇧Tab steps through the editing tools, as through the drawing tools while reviewing
  // (`useViewerShortcuts`): while nothing has the focus, once the pointer was used – designing a
  // template, through its guides, too. In the layers view there is only picking – Tab stays with
  // it, it does not step into the drawing tools.
  useEffect(() => {
    if (!keysActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const step = tabStep(event);
      if (!step || photoSearchTakesTab(event)) return;
      // A panel open with parts to pick: Tab steps through them (`FormatBar`).
      if (document.querySelector('[data-panel-tabs]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (layers) return;
      // As in the tool bar: picking, and designing a template its guides (a frame is drawn by
      // dragging on the free slide – no tool of its own any more).
      const tools: EditTool[] = deck.template ? ['select', 'guides'] : ['select'];
      const at = Math.max(0, tools.indexOf(tool));
      setTool(tools[(at + step + tools.length) % tools.length]!);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  });

  const startText: Editing['startText'] = (next, at) => {
    setSelection(next);
    setTextCaret(at ?? null);
    setTextEditing(next.elementId);
  };

  // The actions act on the latest render through stable wrappers, and the value changes only with
  // what it shows – so a change in the viewer's state (a draft, the slide shown, hovering) does not
  // render every `useEditing` consumer again.
  const actions: Actions = {
    setActive,
    setTool,
    setLayers,
    select,
    selectGroup,
    enterGroup,
    apply,
    tryOut,
    insertImage,
    undo,
    redo,
    startText,
    stopText,
    groupPicked,
    ungroupPicked,
    pasteCopied,
  };
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const stable = useMemo<Actions>(
    () => ({
      setActive: (next) => latest.current.setActive(next),
      setTool: (next) => latest.current.setTool(next),
      setLayers: (open) => latest.current.setLayers(open),
      select: (next) => latest.current.select(next),
      selectGroup: (next) => latest.current.selectGroup(next),
      enterGroup: (slideId, groupId, elementId) =>
        latest.current.enterGroup(slideId, groupId, elementId),
      apply: (operations, options) => latest.current.apply(operations, options),
      tryOut: (operations) => latest.current.tryOut(operations),
      insertImage: (file, slideId, at, longest) =>
        latest.current.insertImage(file, slideId, at, longest),
      undo: () => latest.current.undo(),
      redo: () => latest.current.redo(),
      startText: (next, at) => latest.current.startText(next, at),
      stopText: () => latest.current.stopText(),
      groupPicked: () => latest.current.groupPicked(),
      ungroupPicked: () => latest.current.ungroupPicked(),
      pasteCopied: () => latest.current.pasteCopied(),
    }),
    [],
  );

  // A take-back on its way; edits going out are read where they are waited for (`useOutboxSending`).
  const busy = ownUndo.busy;
  const { canUndo, canRedo } = ownUndo;
  const signedOut = outbox.paused;
  // Shown only while edits wait (`EditActions`): offline, or signed out. Otherwise each edit going
  // out does not render every `useEditing` consumer again for it.
  const pendingShown = offline || signedOut ? outbox.pending : 0;
  const value = useMemo<Editing>(
    () => ({
      ...stable,
      available,
      state,
      active: active && available,
      tool,
      layers: layers && available,
      selection: currentSelection,
      group: currentGroup,
      entered: inGroup,
      enteredGroup: (inGroup && enteredGroup) || null,
      clipboard,
      opened,
      open: setOpened,
      elementsOf,
      selectedElement,
      busy,
      canUndo,
      canRedo,
      pending: pendingShown,
      offline,
      signedOut,
      pageSize: state?.pageSize ?? PAGE_SIZE,
      slidePicturesReady,
      textEditing,
      textCaret,
      textEditor,
      setTextEditor,
      setPreview: previews.set,
      heightOf: (elementId) => heights.get(elementId) ?? null,
      measure,
      textFitOf: (elementId) => textFits.get(elementId) ?? null,
      measureText,
      retilting,
      retilted,
    }),
    // The readers (`elementsOf`, …) are made anew each render but read only these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      stable,
      deck.id,
      available,
      state,
      active,
      tool,
      layers,
      currentSelection,
      currentGroup,
      inGroup,
      clipboard,
      opened,
      changed,
      selectedElement,
      busy,
      canUndo,
      canRedo,
      pendingShown,
      offline,
      signedOut,
      slidePicturesReady,
      textEditing,
      textCaret,
      textEditor,
      heights,
      textFits,
      retilting,
      measure,
      measureText,
      retilted,
    ],
  );
  return (
    <EditingContext value={value}>
      <PreviewStoreContext value={previews}>{children}</PreviewStoreContext>
    </EditingContext>
  );
}
