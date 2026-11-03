import {
  isTurned,
  type EditableElement,
  type ElementFlip,
  type ElementTilt,
  type Rect,
  turnedBoxContains,
} from '@slider/shared';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { cn } from '@/ui';
import { EditableFrame } from '../stage/EditableFrame';
import {
  boxLines,
  caughtLines,
  fittedToText,
  joinLines,
  snappedToText,
  type RectCorner,
  type SnapLines,
  type TextSize,
} from '../stage/lib/rect-edit';
import { markTint } from '../stage/lib/mark-chrome';
import { ShapeOutline } from '../stage/ShapeOutline';
import { shapeOutlineStyle } from '../stage/lib/shape-outline-style';
import { useViewerDispatch } from '../state/viewer-state';
import { useComposed } from './compose/composed';
import { useEditing } from './editing-context';
import { usePreviewAmong } from './preview-store';
import { GroupSelection } from './GroupSelection';
import { LineFrame } from './LineFrame';
import { useInsertFrame } from './hooks/useInsertFrame';
import { InlineTextEditor } from './live/InlineTextEditor';
import { liveLayerStyle, PT_PER_CM } from './live/css';
import { LiveElementView, PromptText } from './live/render';
import { measureTextSize } from './live/text-size';
import { TextSizeMeasure } from './live/TextSizeMeasure';
import { elementLabel } from './lib/element-label';
import { elementTransform } from './tilt/tilt-math';
import { useAlonePictures, useTiltElement } from './tilt/useTilt';
import { useViewerToast } from '../state/viewer-toast';
import { useSnapLines } from '../template/useSnapLines';
import { canMove } from './live/model';
import { pictureFit } from './picture-fit';
import { fillToCrop, useCropFill } from './fills/useCropFill';
import { PictureFitLayer } from './PictureFitLayer';

const area = (element: EditableElement) => element.bbox.w * element.bbox.h;
/** How close (screen pixels) a resized text box is caught at its text's own size. */
const SNAP_PX = 8;

/**
 * The elements of one slide while editing (BER-181): each one outlined on hover in box mode. A click into a
 * text puts the cursor there, to type on the slide (the live editor) – once the slide's picture
 * without that text is there, asked for when the pointer comes over it; its border moves it,
 * its corners resize it. Anything else a click picks. Any element that moves is dragged at once,
 * picked or not; its corners and turning handle show once picked, or in box mode under the
 * pointer. A click on the free slide lets go; dragging there draws a frame for a new text, shape
 * or picture (`useInsertFrame`). A locked element (`EditableElement.locked`) is not there for the
 * pointer: clicks and drags on it go to what lies under it, or to the free slide – a frame drawn
 * on it. Picked by a double click or in the list of layers („Ebenen“), it is outlined, without
 * handles – its panel unlocks it.
 */
export function EditLayer(props: EditLayerProps) {
  const editing = useEditing();
  // Worked on once composed (`SlideCompositor`): before, the slide is LibreOffice's picture alone.
  const composed = useComposed(props.slideId);
  if (!editing.active || !composed) return null;
  return <EditLayerView {...props} />;
}

interface EditLayerProps {
  slideId: string;
  color: string;
  /** Box mode: the element under the pointer outlined. Off, only the picked one is. */
  boxes: boolean;
  /** The element under the pointer (or none): its faint box mode outline steps aside (`BoxHints`). */
  onHover?: (elementId: string | null) => void;
}

function EditLayerView({ slideId, color, boxes, onHover }: EditLayerProps) {
  const previewSurface = useRef({}).current;
  const layerRef = useRef<HTMLDivElement>(null);
  const editing = useEditing();
  const dispatch = useViewerDispatch();
  const insertFrame = useInsertFrame(slideId);
  const cropFill = useCropFill(slideId);
  // Lines are grabbed along their length and dragged by their ends (`LineFrame`).
  const lines = editing
    .elementsOf(slideId)
    .filter((element) => element.line && element.movable && !element.locked);
  const elements = [...editing.elementsOf(slideId)]
    .filter((element) => !element.line && element.bbox.w > 0 && element.bbox.h > 0)
    // Small ones on top, so they can be picked inside large ones.
    .sort((a, b) => area(b) - area(a));
  // Only a drag of one of this slide's elements renders it again.
  const preview = usePreviewAmong(elements.map((element) => element.id));
  const picked = editing.selection?.slideId === slideId ? editing.selectedElement : null;
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    onHover?.(hovered);
    return () => onHover?.(null);
  }, [onHover, hovered]);
  // Its handles shown – picked, or under the pointer in box mode: ⇧ on its turning handle tilts it
  // from its picture alone.
  const handled = (element: EditableElement) =>
    element.resizable &&
    !element.locked &&
    (picked?.id === element.id || (boxes && hovered === element.id));
  // The element whose turning handle the pointer came onto: a tilt (⇧) may follow.
  const [aimed, setAimed] = useState<string | null>(null);
  // The slide taken apart (by LibreOffice, on the server) only once a tilt is plausible: an element
  // picked, or the turning handle of one under the pointer aimed at – not for every element the
  // pointer merely passes over in box mode.
  const tiltable = elements.some(
    (element) =>
      element.movable &&
      element.resizable &&
      (picked?.id === element.id || (aimed === element.id && handled(element))),
  );
  const aloneOf = useAlonePictures(slideId, tiltable || hovered !== null);
  const tiltElement = useTiltElement();
  const [focused, setFocused] = useState<string | null>(null);
  const toast = useViewerToast();
  // Moved and resized, the elements are caught at the slide's edges and middles, the guides shown
  // and the layout grid's lines.
  const snapLines = useSnapLines(slideId);
  // The picked text's own size (at its own size, also one that shrinks to fit), read while its
  // box is resized – caught there within a few pixels – or fitted to it, the corner's double click
  // and „Höhe an Text anpassen“ alike. Not for an empty placeholder.
  const sizeRef = useRef<HTMLDivElement>(null);
  const sized = picked?.live && !picked.live.placeholder ? picked : null;
  // Measured once per resize (`start`, the box as the drag began, is the drag's own): every
  // pointer move would otherwise lay the page out two or three times over.
  const measured = useRef<{
    start: Rect;
    text: TextSize | null;
    tolerance: { w: number; h: number };
  } | null>(null);
  const snapToText = (rect: Rect, start: Rect, corner: RectCorner) => {
    if (measured.current?.start !== start) {
      const layer = sizeRef.current?.parentElement;
      measured.current = {
        start,
        text: sized && measureTextSize(sizeRef.current, sized),
        tolerance: layer
          ? { w: SNAP_PX / layer.offsetWidth, h: SNAP_PX / layer.offsetHeight }
          : { w: 0, h: 0 },
      };
    }
    const { text, tolerance } = measured.current;
    return text ? snappedToText(rect, start, corner, text, tolerance) : rect;
  };
  /** A double click on a corner of the picked text: its box fitted to the text, that corner moving. */
  const fitToText = (element: EditableElement, rect: Rect, corner: RectCorner) => {
    const text = measureTextSize(sizeRef.current, element);
    const layer = sizeRef.current?.parentElement;
    if (!text || !layer || layer.offsetHeight <= 0) return;
    const aspect = layer.offsetWidth / layer.offsetHeight;
    commit(element, fittedToText(rect, corner, text, element.rotation, aspect), () => {});
  };
  /**
   * Where an element is shown: a box growing with its text as high as it is drawn live – where it
   * is, also partly or wholly off the slide (zoomed out, the room around it shows).
   */
  const boxOf = (element: EditableElement): Rect => {
    const height = element.live?.autoGrow ? editing.heightOf(element.id) : null;
    return height === null ? element.bbox : { ...element.bbox, h: height };
  };

  // Moved and resized, an element is caught at the other elements' sides and middles too (locked
  // ones as well) – not at its own, nor at those picked together with it.
  const pageAspect = editing.pageSize.width / editing.pageSize.height;
  const ownLines = new Map(
    [...elements, ...lines].map((element) => [
      element.id,
      boxLines(
        [{ bbox: boxOf(element), rotation: element.rotation, tilt: element.tilt }],
        pageAspect,
      ),
    ]),
  );
  const linesWithout = (ids: readonly string[]): SnapLines => {
    let lines = snapLines;
    for (const [id, own] of ownLines) if (!ids.includes(id)) lines = joinLines(lines, own);
    return lines;
  };
  const groupIds = editing.group?.slideId === slideId ? editing.group.elementIds : [];
  // The lines the one dragged lies on now, drawn across the slide (moved or resized unturned only:
  // a turned one is not caught).
  const dragged = preview && elements.find((element) => element.id === preview.elementId);
  const dragLines =
    preview?.rect &&
    dragged &&
    !isTurned({
      bbox: preview.rect,
      rotation: preview.rotation ?? dragged.rotation,
      tilt: preview.tilt !== undefined ? preview.tilt : dragged.tilt,
    })
      ? caughtLines(preview.rect, linesWithout([dragged.id, ...groupIds]))
      : null;

  // Moved or turned before it was picked, it stays unpicked: a drag is no click.
  const commit = (element: EditableElement, rect: Rect, done: () => void, flip?: ElementFlip) => {
    // Groups only move: their size stays.
    const box = element.resizable ? rect : { ...rect, w: element.bbox.w, h: element.bbox.h };
    void editing
      .apply([{ type: 'setBox', elementId: element.id, box, ...(flip && { flip }) }])
      .finally(done);
  };
  const tilt = (
    element: EditableElement,
    next: ElementTilt,
    done: () => void,
    mirror?: ElementFlip,
  ) => {
    const alone = aloneOf(element.id);
    if (!alone) {
      toast('Das Element wird noch vorbereitet. Gleich nochmal versuchen.', 'neutral');
      done();
      return;
    }
    void tiltElement(element, next, alone, mirror)
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : 'Das Kippen ging nicht.', 'danger'),
      )
      .finally(done);
  };
  /**
   * ⇧-click: the element joins those picked (the one picked alone too) or leaves them – only
   * elements that move go together.
   */
  const toggleInGroup = (element: EditableElement) => {
    const group = editing.group?.slideId === slideId ? editing.group.elementIds : null;
    const base = group ?? (picked ? [picked.id] : []);
    const elementIds = base.includes(element.id)
      ? base.filter((id) => id !== element.id)
      : [...base, element.id];
    editing.selectGroup({ slideId, elementIds });
  };
  const turn = (element: EditableElement, rect: Rect, rotation: number, done: () => void) => {
    void editing
      .apply([{ type: 'setBox', elementId: element.id, box: rect, rotation }])
      .finally(done);
  };

  return (
    <div
      ref={layerRef}
      data-edit-layer={slideId}
      data-live-host=""
      className={cn(
        'absolute inset-0 z-(--z-raised)',
        insertFrame.passThrough ? 'cursor-crosshair' : 'cursor-default',
      )}
      style={{
        ...liveLayerStyle(editing.pageSize.width * PT_PER_CM, editing.pageSize.height * PT_PER_CM),
        ['--edit-color' as string]: color,
        ['--edit-tint' as string]: markTint(color),
      }}
      {...insertFrame.handlers}
      onClick={(event) => {
        event.stopPropagation();
        if (insertFrame.takesClick()) return;
        editing.select(null);
      }}
      // A double click on the slide itself (no element there): its background, as from its menu –
      // on a locked element, that one picked.
      onDoubleClick={(event) => {
        if (event.target !== event.currentTarget || insertFrame.passThrough) return;
        event.stopPropagation();
        // On a locked element: it is picked – its panel unlocks it.
        const box = event.currentTarget.getBoundingClientRect();
        const point = {
          x: (event.clientX - box.left) / Math.max(1, box.width),
          y: (event.clientY - box.top) / Math.max(1, box.height),
        };
        const aspect = editing.pageSize.width / editing.pageSize.height;
        const locked = elements.findLast(
          (element) =>
            element.locked &&
            turnedBoxContains(
              { bbox: boxOf(element), rotation: element.rotation, tilt: element.tilt },
              point,
              aspect,
            ),
        );
        if (locked) {
          // Adding, it is held still here only: Bearbeiten, with it picked.
          if (editing.adding) editing.setActive(true);
          editing.select({ slideId, elementId: locked.id });
          return;
        }
        const pageId = editing.state?.slides.find((item) => item.slideId === slideId)?.pageId;
        if (pageId) dispatch({ type: 'backgroundPanelSet', pageId });
      }}
    >
      {/* In a group (entered, Figma): its box dashed, under the frames of its parts. */}
      {editing.entered?.slideId === slideId && editing.enteredGroup && (
        <div
          aria-hidden
          data-entered-group={editing.enteredGroup.id}
          className="pointer-events-none absolute border border-dashed"
          style={{
            ...shapeOutlineStyle({ bbox: boxOf(editing.enteredGroup), rotation: 0, tilt: null }),
            borderColor: color,
          }}
        />
      )}
      {/* Drawing a frame: the elements let the pointer through to the slide. */}
      <div className={cn('contents', insertFrame.passThrough && '*:pointer-events-none!')}>
        {elements.map((element) => {
          // Drawing a frame: the pointer passes through to the slide.
          const passThrough = insertFrame.passThrough ? 'pointer-events-none!' : undefined;
          const rect = boxOf(element);
          const select = () => editing.select({ slideId, elementId: element.id });
          const typeOnSlide = element.live !== null;
          const typeAt = (event: { clientX: number; clientY: number }) =>
            editing.startText(
              { slideId, elementId: element.id },
              { x: event.clientX, y: event.clientY },
            );
          // A picture: its part shown chosen on the slide („Ausschnitt“).
          const cropHere = () => {
            select();
            pictureFit.crop(element.id);
          };
          // A shape filled with a picture, without text: its part too (as Figma crops an image
          // fill) – one with text is typed in…
          const cropFillHere = () => {
            select();
            cropFill(element);
          };
          // A group: entered (Figma), the element of it under the pointer picked.
          const enterHere = (event: { clientX: number; clientY: number }) => {
            const box = layerRef.current?.getBoundingClientRect();
            const point = box && {
              x: (event.clientX - box.left) / Math.max(1, box.width),
              y: (event.clientY - box.top) / Math.max(1, box.height),
            };
            const under =
              point &&
              element.children?.findLast(
                (child) =>
                  !child.locked &&
                  turnedBoxContains(
                    { bbox: boxOf(child), rotation: child.rotation, tilt: child.tilt },
                    point,
                    pageAspect,
                  ),
              );
            editing.enterGroup(slideId, element.id, under ? under.id : null);
          };
          // …so a click on it picked does not type in it (the double click's first half would).
          const cropsFill = fillToCrop(element) >= 0;
          const typesOnClick = typeOnSlide && !cropsFill;
          const onDoubleClick = element.children
            ? enterHere
            : element.picture?.src && !element.tilt
              ? cropHere
              : cropsFill
                ? cropFillHere
                : typeOnSlide
                  ? typeAt
                  : select;
          const typing = typeOnSlide && editing.textEditing === element.id;
          // Typing in another text: a click into this one types on here at once, where clicked.
          const typingElsewhere = editing.textEditing !== null && !typing;
          const frameProps = {
            rect,
            className: passThrough,
            color,
            handles: element.resizable,
            elementEdge: true,
            offSlide: true,
            emphasized: true,
            rotation: element.rotation,
            outline: element.outline,
            onCommit: (next: Rect, done: () => void, flip?: ElementFlip) =>
              commit(element, next, done, flip),
            // Groups do not turn.
            onRotate: element.resizable
              ? (rotation: number, done: () => void) => turn(element, rect, rotation, done)
              : undefined,
            snapResize: sized?.id === element.id ? snapToText : undefined,
            onFit:
              sized?.id === element.id
                ? (corner: RectCorner) => fitToText(element, rect, corner)
                : undefined,
            snapLines: linesWithout(
              groupIds.includes(element.id) ? [element.id, ...groupIds] : [element.id],
            ),
            onPreview: (next: Rect | null, rotation?: number, flip?: ElementFlip) =>
              editing.setPreview(
                next && { elementId: element.id, rect: next, rotation, flip },
                element.id,
                previewSurface,
              ),
            // ⇧ on its turning handle tilts it in depth (groups do not tilt).
            tilt: element.tilt,
            // Offline not: its tilted picture goes up to the server.
            onTilt:
              element.resizable && !editing.offline
                ? (next: ElementTilt, done: () => void, mirror?: ElementFlip) =>
                    tilt(element, next, done, mirror)
                : undefined,
            // Pictures and drawn shapes mirror, pulled over a side or tilted over the edge.
            flip: element.resizable ? element.flip : null,
            onTiltPreview: (next: ElementTilt | null) => {
              // Typed in, typing goes on: its text is drawn tilted as it goes.
              editing.setPreview(
                next && { elementId: element.id, rect, tilt: next },
                element.id,
                previewSurface,
              );
            },
          };
          if (typing && element.live) {
            // Typable at once: until the picture without this text is drawn (asked for ahead on
            // hover), the browser's text lies over LibreOffice's own – the same, by live parity.
            return (
              <div
                key={element.id}
                style={{ display: 'contents' }}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <LiveElementView
                  // Dragged by its border or corners: laid out in the box as it goes.
                  element={
                    preview?.elementId === element.id
                      ? {
                          ...element,
                          bbox: preview.rect,
                          rotation: preview.rotation ?? element.rotation,
                          tilt: preview.tilt !== undefined ? preview.tilt : element.tilt,
                        }
                      : element
                  }
                  live={element.live}
                  textOnly
                  style={{
                    // Over every other element's frame, also one raised under the pointer: a
                    // click on the text – wherever it reaches, turned or tilted – lands in it.
                    zIndex: 'var(--z-typing)',
                    pointerEvents: 'auto',
                    // A layer of its own: drawn with the slide, Chrome lets a drag over the
                    // text move the caret instead of selecting (turned or tilted, it has one).
                    willChange: 'transform',
                    ...(canMove(element)
                      ? {}
                      : { outline: `2px solid ${color}`, outlineOffset: 2 }),
                  }}
                >
                  <InlineTextEditor
                    elementId={element.id}
                    live={element.live}
                    prompt={
                      element.live.placeholder && (
                        <PromptText element={element} live={element.live} />
                      )
                    }
                  />
                </LiveElementView>
                {/* Moved by its border and resized by its corners while typing in it. */}
                {canMove(element) && (
                  <EditableFrame
                    key="frame"
                    {...frameProps}
                    edgesOnly
                    className={cn(passThrough, 'z-(--z-typing-frame)')}
                  />
                )}
              </div>
            );
          }
          // Locked: the pointer passes through it (typed in, as above, once picked otherwise).
          if (element.locked) return null;
          const isPicked = picked?.id === element.id;
          const hover = {
            onPointerEnter: () => setHovered(element.id),
            // Its turning handle is no longer aimed at either: coming back over the element alone
            // takes the slide apart no more than passing over any other one does.
            onPointerLeave: () => {
              setHovered((id) => (id === element.id ? null : id));
              setAimed((id) => (id === element.id ? null : id));
            },
          };
          const keyboard = {
            'data-edit-element': element.id,
            'aria-label': elementLabel(element),
            'aria-pressed': isPicked,
            onFocus: (event: FocusEvent<HTMLButtonElement>) => {
              if (event.currentTarget.matches(':focus-visible')) setFocused(element.id);
            },
            onBlur: () => setFocused((id) => (id === element.id ? null : id)),
          };
          if (element.movable) {
            // Dragged at once, picked or not; its handles show once picked, or in box mode under
            // the pointer. Kept as it is when typing in it starts or stops (as a tilt does): a
            // drag going on goes on.
            return (
              <div key={element.id} style={{ display: 'contents' }}>
                <EditableFrame
                  key="frame"
                  {...frameProps}
                  handles={handled(element)}
                  emphasized={isPicked}
                  outlined={isPicked}
                  // Tilted from its picture alone, asked for once its turning handle is aimed at.
                  onTilt={handled(element) ? frameProps.onTilt : undefined}
                  onTurnHandleEnter={() => setAimed(element.id)}
                  {...hover}
                  // A click picks it – Tab then steps its panel's kinds; a click into the picked
                  // text types in it, where it was clicked (as typing at it or Enter does) – at
                  // once while typing in another text. ⇧-click: picked together with those picked.
                  onActivate={(event) =>
                    event.shiftKey
                      ? toggleInGroup(element)
                      : typesOnClick && (isPicked || typingElsewhere)
                        ? typeAt(event)
                        : select()
                  }
                  onDoubleClick={onDoubleClick}
                >
                  {/* Reached by the keyboard; its click goes up to the frame. */}
                  <button
                    type="button"
                    {...keyboard}
                    className="absolute inset-0 cursor-[inherit] rounded-mark outline-none"
                  />
                </EditableFrame>
              </div>
            );
          }
          return (
            <button
              key={element.id}
              type="button"
              {...keyboard}
              {...hover}
              // Picked by a click; the picked text is typed in where it is clicked again – at
              // once while typing in another text.
              onClick={(event) => {
                event.stopPropagation();
                if (typesOnClick && (isPicked || typingElsewhere)) typeAt(event);
                else select();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onDoubleClick?.(event);
              }}
              // Only where it can be clicked: its outline is the box mode's (`ShapeOutline`).
              className="absolute rounded-mark outline-none"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
                transform: elementTransform(element.rotation, element.tilt),
              }}
            />
          );
        })}
      </div>
      {lines.map((element) => (
        <LineFrame
          key={element.id}
          element={element}
          color={color}
          picked={picked?.id === element.id}
          hovered={hovered === element.id}
          snapLines={linesWithout(
            groupIds.includes(element.id) ? [element.id, ...groupIds] : [element.id],
          )}
          onActivate={(event) =>
            event.shiftKey
              ? toggleInGroup(element)
              : editing.select({ slideId, elementId: element.id })
          }
          onHover={(over) =>
            setHovered((id) => (over ? element.id : id === element.id ? null : id))
          }
        />
      ))}
      {/* Outlined as in box mode: picked, on keyboard focus, and in box mode under the pointer. */}
      {elements.map((element) => {
        const isPicked = picked?.id === element.id;
        // The picked one that moves has its frame (a locked one none); one typed in, its editor.
        if (isPicked && canMove(element)) return null;
        if (editing.textEditing === element.id) return null;
        // Dragged before it was picked: its frame shows where it goes.
        if (preview?.elementId === element.id) return null;
        const under = boxes && hovered === element.id;
        // Under the pointer with its handles, its frame draws the line, out around them.
        if (under && element.movable && element.resizable) return null;
        const shown = isPicked || focused === element.id || under;
        if (!shown) return null;
        return (
          <ShapeOutline
            key={element.id}
            shape={{ bbox: boxOf(element), rotation: element.rotation, tilt: element.tilt }}
            variant="target"
            color={color}
          />
        );
      })}
      {/* The picked text, measured unseen: its box can be fitted to it. */}
      {sized?.live && (
        <div aria-hidden className="pointer-events-none invisible absolute inset-0">
          <TextSizeMeasure
            element={sized}
            live={sized.live}
            nodeRef={sizeRef}
            onMeasure={editing.measureText}
          />
        </div>
      )}
      <GroupSelection
        slideId={slideId}
        color={color}
        boxOf={boxOf}
        elementAt={insertFrame.elementAt}
        // Clicked alone out of those picked together: picked, as any first click picks.
        onAlone={(element) => editing.select({ slideId, elementId: element.id })}
        onToggle={toggleInGroup}
        snapLines={linesWithout(groupIds)}
      />
      <PictureFitLayer slideId={slideId} color={color} />
      {dragLines && <CaughtLines lines={dragLines} color={color} />}
      {insertFrame.overlay}
    </div>
  );
}

/** The lines a dragged element lies on – the slide's, a guide, another element's side – across it. */
function CaughtLines({ lines, color }: { lines: SnapLines; color: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-(--z-raised)">
      {lines.x.map((x) => (
        <span
          key={`x${x}`}
          data-caught-line="x"
          className="absolute inset-y-0 w-px -translate-x-1/2"
          style={{ left: `${x * 100}%`, background: color }}
        />
      ))}
      {lines.y.map((y) => (
        <span
          key={`y${y}`}
          data-caught-line="y"
          className="absolute inset-x-0 h-px -translate-y-1/2"
          style={{ top: `${y * 100}%`, background: color }}
        />
      ))}
    </div>
  );
}
