import type { DeckEditState, EditableElement, Rect, SlideOperation } from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isTypingTarget } from '@/lib/dom';
import { isModKey } from '@/lib/keyboard';
import {
  useApplyEdit,
  useDeckEdit,
  useMoveEdit,
  useElementCutout,
  useTextBackground,
  type BackgroundPriority,
  type ElementCutout,
} from '@/lib/api';
import { queryKeys } from '@/lib/api/keys';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';
import {
  EditingContext,
  type ApplyOptions,
  type EditSelection,
  type Editing,
  type LiveCutout,
  type TextEditorHandle,
} from './editing-context';
import { loadFonts, setWorkspaceFonts } from './live/fonts';
import { addedElement, applyToElement } from './live/model';

const NONE: readonly EditableElement[] = [];

/** Loads a picture into the browser's cache; a failed one is left to fail where it is shown. */
const preload = (url: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = image.onerror = () => resolve();
    image.src = url;
  });

/** Pictures asked for ahead at once (`prefetch`). */
const AHEAD_AT_ONCE = 2;
/** After a step, the slide's texts are asked for again once editing paused this long. */
const REDRAW_AHEAD_MS = 1200;

/** Pictures waiting to be asked for ahead, and how many are being asked for. */
interface AheadLine {
  waiting: { key: string; run: () => Promise<void> }[];
  running: number;
}

function pump(line: AheadLine): void {
  while (line.running < AHEAD_AT_ONCE && line.waiting.length > 0) {
    const next = line.waiting.shift()!;
    line.running += 1;
    void next.run().finally(() => {
      line.running -= 1;
      pump(line);
    });
  }
}

/** Typing in a field: the editor's keys are the field's. */
const inField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** An element as the editor changed it, until the server's answer has it: `null` = deleted. */
interface Changed {
  slideId: string;
  element: EditableElement | null;
  /** The edit that changed it last. */
  token: number;
}

/** A text changed on its slide: drawn live until the slide's new picture is there. */
interface Awaited {
  slideId: string;
  /** The slide's picture when it changed: any other is the new one. */
  src: string | null;
  /** The edit that changed it last. */
  token: number;
  /** The server has it: if the picture stays the same (nothing to draw), it is done anyway. */
  settled: boolean;
}

interface Queued {
  operations: SlideOperation[];
  coalesce?: string;
  tokens: number[];
  settle: ((ok: boolean) => void)[];
}

/**
 * Editing a deck in the viewer (BER-181): whether it can be edited, the edit mode, what is
 * picked, and applying operations – shared by the slides' element layers and the floating
 * format bar. The slides stay LibreOffice's pictures; a text being typed in or just changed is
 * drawn by the browser over its slide drawn without it (the live editor), until the slide's new
 * picture is there. Edits go out one after another, each on the step the one before made.
 */
export function EditingProvider({ children }: { children: ReactNode }) {
  const { deck, canManage, slides } = useViewerData();
  const toast = useViewerToast();
  const queryClient = useQueryClient();
  const { data: state } = useDeckEdit(deck.id, canManage);
  // The workspace's own fonts, for live text and the font list – before anything draws.
  useMemo(() => setWorkspaceFonts(state?.fonts ?? []), [state?.fonts]);
  const applyEdit = useApplyEdit(deck.id);
  const moveEdit = useMoveEdit(deck.id);
  const { mutateAsync: askBackground } = useTextBackground(deck.id);
  const [active, setActiveState] = useState(false);
  const [selection, setSelection] = useState<EditSelection | null>(null);
  const [textEditing, setTextEditing] = useState<string | null>(null);
  const [textCaret, setTextCaret] = useState<{ x: number; y: number } | null>(null);
  const [textEditor, setTextEditor] = useState<TextEditorHandle | null>(null);
  const [preview, setPreview] = useState<{ elementId: string; rect: Rect } | null>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [changed, setChangedState] = useState<ReadonlyMap<string, Changed>>(new Map());
  const [awaited, setAwaitedState] = useState<ReadonlyMap<string, Awaited>>(new Map());
  const awaitedRef = useRef(awaited);
  // Cutouts of picked elements (`ElementCutout`), with the step and the box they were drawn at.
  const [cutouts, setCutouts] = useState<
    ReadonlyMap<string, { cutout: ElementCutout; seq: number | undefined; bbox: Rect }>
  >(new Map());
  // The pictures texts are typed over, with the step of the file each was drawn from.
  const [backgrounds, setBackgrounds] = useState<
    ReadonlyMap<string, { url: string; seq: number | undefined }>
  >(new Map());
  // Read and written synchronously: two edits in one tick build on each other.
  const changedRef = useRef(changed);
  const tokenRef = useRef(0);
  const queueRef = useRef<Queued[]>([]);
  const sendingRef = useRef(false);
  const available = canManage && state?.editable === true;
  const measure = useCallback(
    (elementId: string, height: number | null) =>
      setHeights((current) => {
        const old = current.get(elementId) ?? null;
        if (
          old === height ||
          (old !== null && height !== null && Math.abs(old - height) < 0.0005)
        ) {
          return current;
        }
        const next = new Map(current);
        if (height === null) next.delete(elementId);
        else next.set(elementId, height);
        return next;
      }),
    [],
  );

  const setChanged = (next: ReadonlyMap<string, Changed>) => {
    changedRef.current = next;
    setChangedState(next);
  };
  const updateAwaited = useCallback((change: (next: Map<string, Awaited>) => void) => {
    const next = new Map(awaitedRef.current);
    change(next);
    awaitedRef.current = next;
    setAwaitedState(next);
  }, []);
  const pictureCame = useCallback(
    (elementId: string) => updateAwaited((awaiting) => void awaiting.delete(elementId)),
    [updateAwaited],
  );
  const srcOf = (slideId: string) => slides.find((slide) => slide.id === slideId)?.imageUrl ?? null;

  const bySlide = new Map((state?.slides ?? []).map((slide) => [slide.slideId, slide]));
  const slideOfElement = new Map(
    (state?.slides ?? []).flatMap((slide) =>
      slide.elements.map((element) => [element.id, slide.slideId] as const),
    ),
  );

  /** An element's cutout, while it shows the element as it is (or it is drawn live). */
  const cutoutOf = (elementId: string): LiveCutout | null => {
    const known = cutouts.get(elementId);
    if (!known?.cutout.plain) return null;
    const current = known.seq === state?.seq || elementId === textEditing || awaited.has(elementId);
    return current ? { cutout: known.cutout, bbox: known.bbox } : null;
  };

  const elementsWith = (slideId: string, overlay: ReadonlyMap<string, Changed>) => {
    const base = bySlide.get(slideId)?.elements ?? NONE;
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
  const elementsOf = (slideId: string) => elementsWith(slideId, changed);

  const picked = selection
    ? (elementsOf(selection.slideId).find((element) => element.id === selection.elementId) ?? null)
    : null;
  // An element that went away (deleted, undone) is no longer picked.
  const selectedElement = picked;
  const currentSelection = picked ? selection : null;

  const stopText = () => {
    setTextEditing(null);
    setTextEditor(null);
  };

  const select = (next: EditSelection | null) => {
    if (next?.elementId !== textEditing) stopText();
    setSelection(next);
  };

  // Editing and the layers view are one or the other: switching one on leaves the other.
  const setActive = (next: boolean) => {
    setActiveState(next);
    setSelection(null);
    stopText();
    if (next && layers) dispatch({ type: 'layersSet', open: false });
  };

  /** Drops what the server's answer (or refusal) settled; newer changes stay. */
  const settle = (tokens: readonly number[]) => {
    const next = new Map(changedRef.current);
    for (const [id, change] of next) if (tokens.includes(change.token)) next.delete(id);
    setChanged(next);
  };

  const send = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    while (queueRef.current.length > 0) {
      const item = queueRef.current.shift() as Queued;
      let ok = true;
      try {
        // The step the edit before made: the cache has the server's last answer.
        const seq = queryClient.getQueryData<DeckEditState>(queryKeys.edit(deck.id))?.seq;
        await applyEdit.mutateAsync({ operations: item.operations, baseSeq: seq });
      } catch (error) {
        ok = false;
        toast(error instanceof Error ? error.message : 'Die Änderung ging nicht durch.', 'danger');
      }
      settle(item.tokens);
      for (const done of item.settle) done(ok);
    }
    sendingRef.current = false;
  };

  const apply = (operations: SlideOperation[], options: ApplyOptions = {}) => {
    const token = ++tokenRef.current;
    const next = new Map(changedRef.current);
    const current = (id: string): EditableElement | null | undefined => {
      const change = next.get(id);
      if (change) return change.element;
      const slideId = slideOfElement.get(id);
      return slideId ? bySlide.get(slideId)?.elements.find((item) => item.id === id) : undefined;
    };
    for (const operation of operations) {
      if (operation.type === 'addElement') {
        const slideId = state?.slides.find(
          (slide) => slide.index === operation.slideIndex,
        )?.slideId;
        if (slideId) {
          next.set(operation.elementId, {
            slideId,
            element: addedElement(operation, state?.pageSize ?? { width: 28, height: 15.75 }),
            token,
          });
        }
        continue;
      }
      if (!('elementId' in operation)) continue;
      const element = current(operation.elementId);
      const slideId =
        next.get(operation.elementId)?.slideId ?? slideOfElement.get(operation.elementId);
      if (!element || !slideId) continue;
      next.set(operation.elementId, {
        slideId,
        element: applyToElement(element, operation),
        token,
      });
    }
    setChanged(next);
    // Drawn live until the slide's new picture is there: a text typed in, and a shape or text
    // frame whose look or place changed when its cutout is at hand (an outline of another width
    // is not in its mask).
    const texts = operations.flatMap((operation) => {
      if (operation.type === 'setRichText') return [operation.elementId];
      if (operation.type === 'deleteElement') {
        return cutoutOf(operation.elementId) ? [operation.elementId] : [];
      }
      if (operation.type !== 'setShapeStyle' && operation.type !== 'setBox') return [];
      const cut = cutoutOf(operation.elementId);
      if (!cut) return [];
      if (operation.type === 'setShapeStyle' && operation.stroke) {
        if (operation.stroke.width !== cut.cutout.strokeWidth) return [];
      }
      return [operation.elementId];
    });
    if (texts.length > 0) {
      updateAwaited((awaiting) => {
        for (const id of texts) {
          const slideId = next.get(id)?.slideId ?? slideOfElement.get(id);
          if (!slideId) continue;
          const src = awaiting.get(id)?.src ?? srcOf(slideId);
          awaiting.set(id, { slideId, src, token, settled: false });
        }
      });
    }
    // The server's answer: a refused change shows as it was; an accepted one waits for its picture.
    const settleAwaited = (ok: boolean) =>
      updateAwaited((awaiting) => {
        for (const id of texts) {
          const entry = awaiting.get(id);
          if (entry?.token !== token) continue;
          if (ok) awaiting.set(id, { ...entry, settled: true });
          else awaiting.delete(id);
        }
      });
    return new Promise<boolean>((done) => {
      const resolve = (ok: boolean) => {
        if (texts.length > 0) settleAwaited(ok);
        done(ok);
      };
      const waiting = options.coalesce
        ? queueRef.current.find((item) => item.coalesce === options.coalesce)
        : undefined;
      if (waiting) {
        waiting.operations = operations;
        waiting.tokens.push(token);
        waiting.settle.push(resolve);
      } else {
        queueRef.current.push({
          operations,
          coalesce: options.coalesce,
          tokens: [token],
          settle: [resolve],
        });
      }
      void send();
    });
  };

  const move = (direction: 'undo' | 'redo') =>
    moveEdit.mutate(direction, { onError: (error) => toast(error.message, 'danger') });
  const undo = () => move('undo');
  const redo = () => move('redo');

  // E switches editing on and off, like B box mode, L the layers view – not while typing, nor
  // while a drawing's comment is being started by typing after it (`useViewerShortcuts`).
  const {
    draft,
    lastDrawing,
    activeSlideId,
    layersOpen: layers,
    layersPanelOpen,
  } = useViewerState();
  const dispatch = useViewerDispatch();
  const setLayers = (open: boolean) => {
    if (open && active) setActive(false);
    dispatch({ type: 'layersSet', open });
  };
  useEffect(() => {
    if (!available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== 'e' && key !== 'l') return;
      if (event.defaultPrevented || isModKey(event) || event.altKey) return;
      if (isTypingTarget(event.target) || inField(event.target)) return;
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
      } else setActive(!active);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Keys while editing: Esc lets go (then leaves), ⌘↵ takes the element as it is and lets go –
  // also while typing in it –, Entf deletes, ⌘Z / ⇧⌘Z undo and redo.
  useEffect(() => {
    // The layers view takes the keys while it is open.
    if (!active || layers) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      // A panel's text field takes ⌘↵ itself; any other field gives up its value on blur.
      const textarea = event.target instanceof HTMLTextAreaElement;
      if (mod && event.key === 'Enter' && currentSelection && !textarea) {
        event.preventDefault();
        event.stopPropagation();
        if (inField(event.target) && event.target instanceof HTMLElement) event.target.blur();
        select(null);
        return;
      }
      if (inField(event.target)) return;
      let handled = true;
      if (event.key === 'Escape') {
        if (currentSelection) select(null);
        else setActive(false);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedElement) {
        void apply([{ type: 'deleteElement', elementId: selectedElement.id }]).then(
          (ok) => ok && setSelection(null),
        );
      } else if (event.key === 'Enter' && selectedElement?.live && currentSelection) {
        // Enter on a picked text box types in it, like PowerPoint.
        setTextEditing(selectedElement.id);
      } else if (mod && event.key.toLowerCase() === 'z') {
        if (event.shiftKey) {
          if (state?.canRedo) redo();
        } else if (state?.canUndo) undo();
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  });

  // The picture a text is typed over: asked for when the pointer comes over it and when it is
  // picked, again after each step (unchanged while only its text changes – the server answers
  // from its store then).
  // What was asked for, and how urgently: asked ahead, then picked, it is asked again to go first.
  const asked = useRef(new Map<string, BackgroundPriority>());
  const typingRef = useRef(textEditing);
  useEffect(() => {
    typingRef.current = textEditing;
  }, [textEditing]);
  const seq = state?.seq;
  // Asked for ahead: a few at a time, in a line of their own – the browser has only a few
  // connections to the server, and an edit or a picked text must never wait behind them.
  const ahead = useRef<AheadLine>({ waiting: [], running: 0 });
  /** Drops what is still waiting to be asked for ahead: asked for again when wanted. */
  const dropAhead = useCallback(() => {
    for (const { key } of ahead.current.waiting.splice(0)) {
      if (asked.current.get(key) === 'background') asked.current.delete(key);
    }
  }, []);
  const prefetch = useCallback(
    (elementId: string, priority: BackgroundPriority = 'interactive') => {
      const key = `${elementId}:${seq}`;
      const before = asked.current.get(key);
      if (before === 'interactive' || before === priority) return;
      asked.current.set(key, priority);
      // Each ask settles on its own (`mutate`'s callbacks would only follow the latest one).
      const ask = () =>
        askBackground({ elementId, priority }).then(
          ({ url }) =>
            setBackgrounds((current) => {
              const known = current.get(elementId);
              return known?.url === url && known.seq === seq
                ? current
                : new Map(current).set(elementId, { url, seq });
            }),
          (error: unknown) => {
            // Asked again with the next step; typing in it waits no longer.
            if (asked.current.get(key) === priority) asked.current.delete(key);
            if (priority === 'background' || typingRef.current !== elementId) return;
            setTextEditing(null);
            toast(
              error instanceof Error
                ? error.message
                : 'Der Text lässt sich gerade nicht bearbeiten.',
              'danger',
            );
          },
        );
      if (priority === 'interactive') void ask();
      else {
        ahead.current.waiting.push({ key, run: ask });
        pump(ahead.current);
      }
    },
    [seq, askBackground, toast],
  );
  // The picked element's cutout: changing its look or place then shows at once. Its pictures
  // are loaded before it is used, so nothing flashes when it is.
  const { mutateAsync: askCutout } = useElementCutout(deck.id);
  const askedCutouts = useRef(new Set<string>());
  const cutoutFor = useEffectEvent((elementId: string) => {
    const at = seq;
    const key = `${elementId}:${at}`;
    if (askedCutouts.current.has(key)) return;
    const slideId = slideOfElement.get(elementId);
    const bbox = slideId
      ? bySlide.get(slideId)?.elements.find((element) => element.id === elementId)?.bbox
      : undefined;
    if (!bbox) return;
    askedCutouts.current.add(key);
    askCutout({ elementId, priority: 'interactive' })
      .then(async (cutout) => {
        await Promise.all(
          [cutout.backdrop, cutout.fill, cutout.stroke, cutout.above].map(
            (url) => url && preload(url),
          ),
        );
        setCutouts((current) => new Map(current).set(elementId, { cutout, seq: at, bbox }));
      })
      // Without it, the change shows with the slide's new picture.
      .catch(() => askedCutouts.current.delete(key));
  });
  const wanted = active && selectedElement?.live ? selectedElement.id : null;
  useEffect(() => {
    if (!wanted) return;
    prefetch(wanted);
    cutoutFor(wanted);
  }, [wanted, prefetch]);
  // Every text of the slide shown, asked for ahead when editing starts and when another slide is
  // shown – so typing in one starts at once. Not again after each step: then the picked one
  // (above) and the one under the pointer are asked for, not the whole slide again.
  const prefetchSlide = useEffectEvent((slideId: string) => {
    // The slide shown before is not needed first any more.
    dropAhead();
    for (const element of elementsOf(slideId)) {
      if (!element.live) continue;
      prefetch(element.id, 'background');
      // Its fonts too: typing in it then lays it out in them at once.
      void loadFonts(element.live);
    }
  });
  const loaded = state !== undefined;
  useEffect(() => {
    if (active && loaded && activeSlideId) prefetchSlide(activeSlideId);
  }, [active, loaded, activeSlideId]);
  // After a step the slide's other texts are drawn anew – once editing pauses, not at every
  // step of typing (each changes what the other texts' pictures show).
  const lastSeq = useRef(seq);
  useEffect(() => {
    if (seq === lastSeq.current) return;
    lastSeq.current = seq;
    if (!active || !activeSlideId) return;
    const timer = window.setTimeout(() => prefetchSlide(activeSlideId), REDRAW_AHEAD_MS);
    return () => window.clearTimeout(timer);
  }, [active, activeSlideId, seq]);

  const liveOn = (slideId: string) =>
    elementsOf(slideId).find(
      (element) => element.live && (element.id === textEditing || awaited.has(element.id)),
    ) ?? null;

  const value: Editing = {
    available,
    state,
    active: active && available,
    setActive,
    layers: layers && available,
    setLayers,
    selection: currentSelection,
    select,
    elementsOf,
    selectedElement,
    apply,
    undo,
    redo,
    busy: applyEdit.isPending || moveEdit.isPending,
    pageSize: state?.pageSize ?? { width: 28, height: 15.75 },
    // Drawn from this step of the file; the text typed in (or waiting for its new picture)
    // keeps its last one until the next comes – its own text is not in it anyway.
    cutoutOf,
    goneOn: (slideId) => {
      for (const [elementId, entry] of awaited) {
        if (entry.slideId !== slideId) continue;
        if (!elementsOf(slideId).some((element) => element.id === elementId)) return elementId;
      }
      return null;
    },
    backgroundOf: (elementId) => {
      const known = backgrounds.get(elementId);
      if (!known) return null;
      const current = known.seq === seq || elementId === textEditing || awaited.has(elementId);
      return current ? known.url : null;
    },
    prefetch,
    liveOn,
    awaitedPicture: (elementId) => {
      const entry = awaited.get(elementId);
      return entry ? { src: entry.src, settled: entry.settled } : null;
    },
    pictureCame,
    textEditing,
    textCaret,
    startText: (next, at) => {
      setSelection(next);
      setTextCaret(at ?? null);
      setTextEditing(next.elementId);
    },
    stopText,
    textEditor,
    setTextEditor,
    preview,
    setPreview,
    heightOf: (elementId) => heights.get(elementId) ?? null,
    measure,
  };
  return <EditingContext value={value}>{children}</EditingContext>;
}
