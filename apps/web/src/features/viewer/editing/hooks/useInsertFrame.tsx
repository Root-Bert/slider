import {
  clamp01,
  rectFromPoints,
  type EditableElement,
  isNewLine,
  NEW_LINE_STROKE,
  type ElementFlip,
  type FrameShape as NewShape,
  type Point,
  type Rect,
  type AddElementOperation,
  type AddImageOperation,
} from '@slider/shared';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { isTextTarget } from '@/lib/dom';
import { typesCharacter } from '@/lib/keyboard';
import { useEditing } from '../editing-context';
import { FramePanelPreview } from '../FormatBar';
import { markSymbolFrame, openPanelOn } from '../panel-tab';
import { EditableFrame } from '../../stage/EditableFrame';
import { FRAME_ATTR } from '../../stage/hooks/useRectEdit';
import {
  drawnRect,
  LINE_SNAP_PX,
  snappedPoint,
  type RectSize,
  type SnapLines,
} from '../../stage/lib/rect-edit';
import { ShapeOutline } from '../../stage/ShapeOutline';
import {
  FrameOutline,
  FrameShape,
  KindChooser,
  type FrameKind,
  type InsertKind,
} from '../InsertFrameChooser';
import { focusShapes } from '../frame-shapes';
import { encloses, shownRect } from '../lib/group-layout';
import { bringsFiles, imageFilesOf, insertEach } from '../insert-image';
import { textStyleOn } from '../paste';
import { addedElement, addedImage, addedTurned, canMove, NEW_BOX } from '../live/model';
import { newEditId } from '../new-id';
import { typedAhead } from '../typed-ahead';
import { usePlaceAiBox } from '../../voice/hooks/usePlaceAiBox';

/** The preview's element (`FramePanelPreview`): never on the server. */
const DRAFT_ID = 'frame-draft';
/** Smaller than this (of the slide) is a click, not a frame. */
const MIN_FRAME = 0.02;
/** Typed into a new frame: taken by its element within this long, or dropped. */
const HAND_OVER_MS = 5000;
/** Several pictures dropped at once: each this far aside of the one before (of the slide). */
const DROP_STEP = 0.03;

const pointIn = (element: Element, event: { clientX: number; clientY: number }): Point => {
  const box = element.getBoundingClientRect();
  return {
    x: clamp01((event.clientX - box.left) / Math.max(1, box.width)),
    y: clamp01((event.clientY - box.top) / Math.max(1, box.height)),
  };
};

/**
 * Drawing a frame on a slide while editing, then saying what it is for – picking the elements it
 * encloses together („Auswählen“, first and picked when it encloses any), or what goes in it: a
 * text, a shape, a picture or a symbol (a placeholder until one is chosen). Dragging on the free
 * slide draws one; with ⇧ held, over elements too (a ⇧-click there still picks it together with
 * those picked, `onShiftClick`; ⇧ again for a square). Pictures dropped on the slide go on where
 * they fall. Drawn, its corners are caught at the lines a moved element is caught at (`snapLines`:
 * the slide's, the guides, the other elements' sides and middles; ⌘ free, ⇧ square); till it is
 * filled it moves, resizes and turns by the handles of a picked element. Rough on purpose: put the
 * idea on the slide, let the AI make it right (a comment).
 */
export function useInsertFrame(
  slideId: string,
  /** The slide's edit layer: `data-adding` while ⇧ is held (its pointer a crosshair). */
  layerRef: RefObject<HTMLElement | null>,
  snapLines: SnapLines,
  onShiftClick?: (element: EditableElement) => void,
) {
  const editing = useEditing();
  const placeAiBox = usePlaceAiBox();
  // Where it was pressed (`raw`), caught at the lines close by (`from`); how close they catch.
  // Begun with ⇧ on an element (`over`: its id, or null where it is found by the point): ⇧ held
  // from then on squares nothing – let go and pressed again, it does.
  const press = useRef<{
    raw: Point;
    from: Point;
    moved: boolean;
    tolerance: RectSize;
    over?: string | null;
    shiftHeld?: boolean;
  } | null>(null);
  const tool = editing.tool;
  // ⇧ held: a drag adds over elements too – the pointer says so (`data-adding` on the layer, no
  // render of it). Not while typing: ⇧ there writes capitals.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || tool !== 'select') return;
    const follow = (event: KeyboardEvent) =>
      layer.toggleAttribute('data-adding', event.shiftKey && !isTextTarget(event.target));
    const off = () => layer.removeAttribute('data-adding');
    window.addEventListener('keydown', follow);
    window.addEventListener('keyup', follow);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', follow);
      window.removeEventListener('keyup', follow);
      window.removeEventListener('blur', off);
      off();
    };
  }, [layerRef, tool]);
  // A drag just ended: the click after it does not let go of anything.
  const dragged = useRef(false);
  // Being drawn: caught at the lines a moved or resized element is caught at (`caught`: which).
  const [drawing, setDrawing] = useState<{ rect: Rect; caught: string | null } | null>(null);
  const [frame, setFrame] = useState<Rect | null>(null);
  // The way it was drawn: a line put in it runs from where it was begun to where it ended.
  const [drawnWay, setDrawnWay] = useState<ElementFlip>({ x: false, y: false });
  // The shape under the pointer or Tab in „Form“'s panel: the frame shows it meanwhile.
  const [shapeShown, setShapeShown] = useState<NewShape | null>(null);
  // The drawn frame's turn (its turning handle, as a picked element's).
  const [turn, setTurn] = useState(0);
  // The drawn frame as shown while it is moved, resized or turned (`EditableFrame`'s preview).
  const [moving, setMoving] = useState<{ rect: Rect; rotation: number } | null>(null);
  const aspect = editing.pageSize.width / editing.pageSize.height;
  // The kind picked for the frame (`KindChooser`): its panel shows meanwhile.
  const [kind, setKind] = useState<FrameKind>('text');
  // Filled, until the server has the new element: still shown where it goes.
  const [placing, setPlacing] = useState<{
    rect: Rect;
    kind: InsertKind;
    rotation: number;
  } | null>(null);
  // Typed on a kind (`KindChooser`), until the new element takes it (`typedAhead`): what goes on
  // being typed meanwhile is kept too, shown in the frame.
  const [typed, setTyped] = useState<string | null>(null);
  const typedRef = useRef<string | null>(null);
  // Handed to the new element: typed on into `typedAhead` until it is taken there.
  const handedTo = useRef<string | null>(null);
  const stock = editing.state?.stockPhotos ?? false;
  const generation = editing.state?.imageGeneration ?? false;
  // A picture goes on with typing when it has somewhere to go: a photo search, else a description;
  // a symbol searches the symbols (here in the browser, online to put one in).
  const typedKinds: InsertKind[] = editing.offline
    ? ['text']
    : stock || generation
      ? ['text', 'image', 'symbol']
      : ['text', 'symbol'];

  const keepTyped = (text: string | null) => {
    typedRef.current = text;
    setTyped(text);
  };
  const typing = typed !== null;
  useEffect(() => {
    if (!typing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey) return;
      const handed = handedTo.current;
      if (handed && !typedAhead.has(handed)) {
        // Taken: the keys are the editor's (or the field's) now.
        handedTo.current = null;
        keepTyped(null);
        return;
      }
      const now = handed ? typedAhead.peek(handed) : (typedRef.current ?? '');
      let next: string;
      if (typesCharacter(event)) next = now + event.key;
      else if (event.key === 'Backspace') next = now.slice(0, -1);
      else return;
      // Before the viewer's letter shortcuts.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (handed) typedAhead.put(handed, next);
      else keepTyped(next);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [typing]);

  /**
   * ⇧ and a press on an element's body (not its handles – ⇧ there resizes in proportion or tilts –
   * nor text being typed in): taken before the element, a frame drawn from there as on the free
   * slide.
   */
  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.shiftKey || tool !== 'select') return;
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const target = event.target;
    if (target === event.currentTarget || !(target instanceof Element)) return;
    if (isTextTarget(target)) return;
    const hit = target.closest('[data-edit-element]');
    // Elements picked together: their shared frame, the element under the point.
    if (!hit && !(target.hasAttribute(FRAME_ATTR) && !frame)) return;
    event.preventDefault();
    event.stopPropagation();
    begin(event, hit?.getAttribute('data-edit-element') ?? null);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    // On the free slide.
    if (event.target !== event.currentTarget) return;
    begin(event);
  };
  function begin(event: PointerEvent<HTMLDivElement>, over?: string | null) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = event.currentTarget.getBoundingClientRect();
    const tolerance = {
      w: LINE_SNAP_PX / Math.max(1, box.width),
      h: LINE_SNAP_PX / Math.max(1, box.height),
    };
    const raw = pointIn(event.currentTarget, event);
    // Begun at a line close by, as its other corner is caught – free with ⌘ (Ctrl).
    const free = event.metaKey || event.ctrlKey;
    const from = free ? raw : snappedPoint(raw, snapLines, tolerance).point;
    press.current = {
      raw,
      from,
      moved: false,
      tolerance,
      ...(over !== undefined && { over, shiftHeld: true }),
    };
    setFrame(null);
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (!start) return;
    const to = pointIn(event.currentTarget, event);
    const travel = rectFromPoints(start.raw, to);
    if (!start.moved && travel.w < MIN_FRAME / 2 && travel.h < MIN_FRAME / 2) return;
    start.moved = true;
    // Its moving corner caught at the lines close by, as a resized element's – free with ⌘
    // (Ctrl); square with ⇧ (begun with ⇧ on an element: pressed again).
    const free = event.metaKey || event.ctrlKey;
    if (!event.shiftKey) start.shiftHeld = false;
    setDrawing(
      drawnRect(
        free ? start.raw : start.from,
        to,
        free ? null : snapLines,
        start.tolerance,
        event.shiftKey && !start.shiftHeld,
        aspect,
      ),
    );
  };
  /**
   * The element under a point – the smallest, as the slide picks them (`EditLayer`); a locked one
   * the slide passes through.
   */
  const elementAt = (point: Point): EditableElement | null => {
    let found: EditableElement | null = null;
    for (const element of editing.elementsOf(slideId)) {
      if (element.locked) continue;
      const height = element.live?.autoGrow ? editing.heightOf(element.id) : null;
      const { x, y, w } = element.bbox;
      const h = height ?? element.bbox.h;
      if (w <= 0 || h <= 0) continue;
      if (point.x < x || point.x > x + w || point.y < y || point.y > y + h) continue;
      if (!found || w * h < found.bbox.w * found.bbox.h) found = element;
    }
    return found;
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = press.current;
    press.current = null;
    if (!start) return;
    const rect = drawing?.rect;
    setDrawing(null);
    if (start.moved) dragged.current = true;
    if (start.moved && rect && rect.w >= MIN_FRAME && rect.h >= MIN_FRAME) {
      // Speaking to the AI: the frame goes to it (its field beside it), nothing to choose.
      if (placeAiBox) {
        editing.select(null);
        placeAiBox(slideId, { type: 'rect', rect, shapeRef: null });
        return;
      }
      const to = pointIn(event.currentTarget, event);
      openFrame(rect, { x: to.x < start.from.x, y: to.y < start.from.y });
    } else if (!start.moved && start.over !== undefined) {
      // ⇧-click on an element: picked together with those picked, as always.
      dragged.current = true;
      const element = start.over
        ? editing.elementsOf(slideId).find((item) => item.id === start.over)
        : elementAt(start.raw);
      if (element) onShiftClick?.(element);
    }
  };
  /**
   * The elements wholly in a frame, as they show (turned, grown with their text), that move – not
   * locked ones.
   */
  const enclosedBy = (rect: Rect): EditableElement[] => {
    return editing.elementsOf(slideId).filter((element) => {
      const { w, h } = element.bbox;
      // A line may be flat one way.
      if (!canMove(element) || (element.line ? w <= 0 && h <= 0 : w <= 0 || h <= 0)) return false;
      const height = element.live?.autoGrow ? editing.heightOf(element.id) : null;
      const bbox = height === null ? element.bbox : { ...element.bbox, h: height };
      return encloses(
        rect,
        shownRect({ bbox, rotation: element.rotation, tilt: element.tilt }, aspect),
      );
    });
  };
  /**
   * A frame to fill: „Auswählen“ picked as the chooser opens when it encloses elements, else
   * „Text“ – whatever was picked let go.
   */
  function openFrame(rect: Rect, way: ElementFlip = { x: false, y: false }) {
    editing.select(null);
    setDrawnWay(way);
    setKind(enclosedBy(rect).length > 0 ? 'select' : 'text');
    setFrame(rect);
    setTurn(0);
    setMoving(null);
  }
  /** The frame as it is seen – turned, its box round it; moved or resized, as it goes. */
  const seenOf = (rect: Rect, rotation: number) =>
    rotation === 0 ? rect : shownRect({ bbox: rect, rotation }, aspect);
  const seen = frame && (moving ? seenOf(moving.rect, moving.rotation) : seenOf(frame, turn));
  // The chooser goes by what of it lies on the slide: turned, it may reach over the edge.
  const onSlide = seen && clippedToSlide(seen);
  const enclosed = frame ? enclosedBy(seenOf(frame, turn)) : [];
  /** The drawn frame moved or resized by its handles (as a picked element is). */
  const placeFrame = (rect: Rect, done: () => void) => {
    setFrame(rect);
    // Enclosing nothing any more: „Auswählen“ is gone, „Text“ picked in its stead.
    if (kind === 'select' && enclosedBy(seenOf(rect, turn)).length === 0) setKind('text');
    done();
  };
  /** The drawn frame turned by its handle. */
  const turnFrame = (rotation: number, done: () => void) => {
    setTurn(rotation);
    if (frame && kind === 'select' && enclosedBy(seenOf(frame, rotation)).length === 0)
      setKind('text');
    done();
  };
  /** „Auswählen“: the elements in the frame picked together (one alone, as a click picks it). */
  const pickEnclosed = () => {
    setFrame(null);
    editing.setTool('select');
    editing.selectGroup({ slideId, elementIds: enclosed.map((element) => element.id) });
  };
  // Pictures dragged from the desktop onto the slide: new picture elements where they fall, each a
  // step aside of the one before (as pasted copies).
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!bringsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!bringsFiles(event.dataTransfer)) return;
    // Never the browser's own (it would open the file instead of the deck).
    event.preventDefault();
    event.stopPropagation();
    const images = imageFilesOf(event.dataTransfer);
    const at = pointIn(event.currentTarget, event);
    void insertEach(images, at, DROP_STEP, editing.pageSize, (image, there) =>
      editing.insertImage(image, slideId, there),
    );
  };
  const onPointerCancel = () => {
    press.current = null;
    setDrawing(null);
  };
  /** The click after a drag: swallowed (it would let go of the frame's element). */
  const takesClick = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };

  const insert = async (kind: InsertKind, rect: Rect, shape?: NewShape, text?: string) => {
    const rotation = turn;
    setFrame(null);
    setMoving(null);
    editing.setTool('select');
    const slide = editing.state?.slides.find((item) => item.slideId === slideId);
    if (!slide) return;
    if (text !== undefined) keepTyped(text);
    const elementId = newEditId();
    const operation = operationFor(kind, rect, slide.pageId, elementId, shape, drawnWay);
    // Picked once the server has it: its pictures (to type over, to restyle) are drawn then.
    setPlacing({ rect, kind, rotation });
    // Its picture part opens on the symbols.
    if (kind === 'symbol') markSymbolFrame(elementId);
    // Turned: turned in the same step (one undo) – a new element comes unturned.
    const ok = await editing.apply(addedTurned(operation, rotation));
    const typedOn = typedRef.current;
    if (!ok || !typedOn) keepTyped(null);
    if (!ok) {
      setPlacing(null);
      return;
    }
    if (typedOn) {
      typedAhead.put(elementId, typedOn);
      handedTo.current = elementId;
      // Never taken (nothing went on with it): the keys are the editor's again.
      setTimeout(() => {
        if (handedTo.current !== elementId) return;
        handedTo.current = null;
        typedAhead.take(elementId);
        keepTyped(null);
      }, HAND_OVER_MS);
    }
    const selection = { slideId, elementId };
    // Its panel opens on the part its preview showed, in the preview's stead.
    openPanelOn(kind);
    if (kind === 'text') editing.startText(selection);
    else editing.select(selection);
    setPlacing(null);
  };

  /** The operation that adds an element of a kind in a frame. */
  const operationFor = (
    kind: InsertKind,
    rect: Rect,
    pageId: string,
    elementId: string,
    shape?: NewShape,
    way?: ElementFlip,
  ): AddElementOperation | AddImageOperation => {
    if (kind === 'image' || kind === 'symbol')
      return { type: 'addImage', pageId, elementId, box: rect, imageId: null };
    // A line or arrow: across the frame as it was drawn, no fill, no text.
    if (isNewLine(shape))
      return {
        type: 'addElement',
        pageId,
        elementId,
        kind: 'line',
        box: rect,
        flip: way ?? { x: false, y: false },
        heads: shape === 'arrow' ? 'end' : 'none',
        fill: null,
        stroke: NEW_LINE_STROKE,
        paragraphs: [],
      };
    const style = textStyleOn(editing.elementsOf(slideId));
    return {
      type: 'addElement',
      pageId,
      elementId,
      kind: kind === 'text' ? 'text' : 'rect',
      ...(shape && !isNewLine(shape) ? { shape } : {}),
      box: rect,
      fill: kind === 'text' ? null : NEW_BOX.fill,
      // No border until one is asked for (Rahmen).
      stroke: null,
      // Text typed into a shape later is centred in it.
      paragraphs: [{ align: kind === 'text' ? 'left' : 'center', runs: [{ ...style, text: '' }] }],
    };
  };

  // The element the frame would become, for its panel's preview – as the editor shows a new one.
  const shown =
    placing ?? (frame && kind !== 'select' ? { rect: frame, kind, rotation: turn } : null);
  const pageId = editing.state?.slides.find((item) => item.slideId === slideId)?.pageId;
  const pageSize = editing.pageSize;
  const draft = useMemo(() => {
    if (!shown || !pageId) return null;
    // A line shown in „Form“'s panel: its panel (no fill), the others' a box's.
    const line = shown.kind === 'shape' && isNewLine(shapeShown) ? shapeShown : undefined;
    const operation = operationFor(shown.kind, shown.rect, pageId, DRAFT_ID, line, drawnWay);
    const element =
      operation.type === 'addImage' ? addedImage(operation) : addedElement(operation, pageSize);
    return { ...element, rotation: shown.rotation };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.kind, shown?.rect, shown?.rotation, pageId, pageSize, shapeShown, drawnWay]);
  /** A click on the preview: its kind taken, as with the chooser's button. */
  const take = (picked: FrameKind) => {
    if (!frame) return;
    if (picked === 'select') pickEnclosed();
    else if (picked === 'shape') focusShapes();
    else void insert(picked, frame);
  };

  const overlay: ReactNode = (
    <>
      {drawing && <FrameOutline rect={drawing.rect} caught={drawing.caught} />}
      {placing && (
        <FrameOutline rect={placing.rect} rotation={placing.rotation} text={typed ?? undefined} />
      )}
      {draft && shown && (
        <FramePanelPreview
          element={draft}
          slideId={slideId}
          kind={shown.kind}
          rect={(!placing && seen) || shown.rect}
          typed={typed ?? ''}
          onTake={() => take(shown.kind)}
          // „Form“: its shapes beside the frame, one taken at once.
          onShape={
            frame && shown.kind === 'shape'
              ? (shape) => void insert('shape', frame, shape)
              : undefined
          }
          onShapeShown={setShapeShown}
        />
      )}
      {/* „Auswählen“ picked: the panel of what it would pick, as for the others' kinds. */}
      {frame && kind === 'select' && enclosed.length > 0 && (
        <FramePanelPreview
          element={enclosed.find((element) => element.movable) ?? enclosed[0]!}
          group={enclosed.length > 1 ? enclosed : undefined}
          slideId={slideId}
          kind="select"
          rect={seen ?? frame}
          typed=""
          onTake={pickEnclosed}
        />
      )}
      {frame && (
        <>
          {/* Moved, resized and turned as a picked element is: its frame, handles, catches. */}
          <EditableFrame
            rect={frame}
            color="var(--edit-color)"
            handles
            elementEdge
            emphasized
            rotation={turn}
            snapLines={snapLines}
            onCommit={placeFrame}
            onRotate={turnFrame}
            onPreview={(rect, rotation) => setMoving(rect && { rect, rotation: rotation ?? turn })}
          >
            {kind === 'shape' && shapeShown && shapeShown !== 'rectangle' ? (
              <FrameShape shape={shapeShown} flip={drawnWay} />
            ) : (
              <span aria-hidden className="absolute inset-0 bg-(--edit-tint)" />
            )}
          </EditableFrame>
          {/* „Auswählen“ picked: what it would pick, outlined as picked ones are. */}
          {kind === 'select' &&
            enclosed.map((element) => (
              <ShapeOutline
                key={element.id}
                shape={{
                  bbox:
                    element.live?.autoGrow && editing.heightOf(element.id) !== null
                      ? { ...element.bbox, h: editing.heightOf(element.id)! }
                      : element.bbox,
                  rotation: element.rotation,
                  tilt: element.tilt,
                }}
                variant="target"
                color="var(--edit-color)"
              />
            ))}
          <KindChooser
            rect={onSlide ?? frame}
            kind={kind}
            typed={typedKinds}
            selectable={enclosed.length}
            onKind={setKind}
            onPick={(kind, shape) =>
              kind === 'select' ? pickEnclosed() : void insert(kind, frame, shape)
            }
            onType={(kind, text) => void insert(kind, frame, undefined, text)}
            onCancel={() => setFrame(null)}
          />
        </>
      )}
    </>
  );

  return {
    handlers: {
      onPointerDownCapture,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onDragOver,
      onDrop,
    },
    takesClick,
    elementAt,
    overlay,
    /**
     * The frame as it is drawn, or moved and resized by its handles (unturned only): the lines it
     * lies on are drawn across the slide, as for a dragged element.
     */
    dragged: drawing?.rect ?? (moving && moving.rotation === 0 ? moving.rect : null),
  };
}

/** `rect` cut to the slide (as it is, when it lies wholly off it). */
function clippedToSlide(rect: Rect): Rect {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const w = Math.min(1, rect.x + rect.w) - x;
  const h = Math.min(1, rect.y + rect.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : rect;
}
