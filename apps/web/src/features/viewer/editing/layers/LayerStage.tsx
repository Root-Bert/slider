import {
  distance,
  MIN_DRAG_DISTANCE,
  rectFromPoints,
  type Anchor,
  type EditableElement,
  type Point,
  type Rect,
  type Shape,
} from '@slider/shared';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button, cn, Spinner } from '@/ui';
import type { Thread } from '../../comments/lib/comment-selectors';
import { followConnectors } from '../../connectors/hooks/useConnectorLayout';
import {
  projectUnitSquare,
  unprojectUnitSquare,
  type Quad,
} from '../../connectors/lib/plane-projection';
import { useEditing } from '../editing-context';
import { elementLabel } from '../lib/element-label';
import { RectFrame } from '../../stage/RectFrame';
import { isFront, useLayers } from './layers-context';
import { anchorElement, marksByElement } from './mark-planes';
import { useLayerPictures, type LayerPicture } from './useLayerPictures';

/** Turning stops short of edge-on: the layers would vanish into lines. */
const MAX_PITCH = 75;
const MAX_YAW = 80;
/** Degrees per pixel dragged. */
const TURN_PER_PX = 0.3;
/** The slide's share of its frame: turned, it still fits; from the front, it floats in it. */
const FIT = 0.78;
/** The whole stack at spread 1 is this deep, as a share of the slide's width … */
const DEPTH = 0.9;
/** … one layer at most this far from the next. */
const MAX_GAP = 0.16;
/** Marks float this far (px) over their plane: never half hidden in its picture. */
const MARK_LIFT = 1;
/** A plane's corners in the order `projectUnitSquare` takes them. */
const PLANE_CORNERS = [
  ['0%', '0%'],
  ['100%', '0%'],
  ['100%', '100%'],
  ['0%', '100%'],
] as const;
/** How long a turn or spread eases (`easing`): the connector lines follow it. */
const EASE_MS = 300;
/** Pins and the like on the slide keep their own clicks. */
const OWN_CLICKS = 'button, a, input, textarea, [contenteditable], [data-mark]';

const boxStyle = ({ x, y, w, h }: Rect): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  width: `${w * 100}%`,
  height: `${h * 100}%`,
});

/**
 * Every slide is seen from the middle of the window – one vanishing point for the whole track:
 * scrolled sideways, a slide's near layers move further than its far ones (parallax), most
 * plainly seen from the front. Follows scrolling and resizing frame by frame, without
 * re-rendering.
 */
function useSharedVanishingPoint(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      element.style.perspectiveOrigin = `${window.innerWidth / 2 - rect.left}px 50%`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const options = { capture: true, passive: true } as const;
    document.addEventListener('scroll', schedule, options);
    window.addEventListener('resize', schedule);
    // Its slide moves in the track without a scroll too (panels, the split, zoom).
    const resizes = new ResizeObserver(schedule);
    resizes.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, options);
      window.removeEventListener('resize', schedule);
      resizes.disconnect();
    };
  }, [ref]);
}

/** Its corners, to see where it lies (`whereOnPlane`, the connector lines). */
function PlaneCorners() {
  return PLANE_CORNERS.map(([left, top], corner) => (
    <i key={corner} data-plane-corner={corner} className="absolute size-0" style={{ left, top }} />
  ));
}

/** A plane's corners as seen on screen (`PlaneCorners`). */
function seenCorners(plane: Element): Quad | null {
  const corners = [...plane.querySelectorAll(':scope > [data-plane-corner]')].map((corner) => {
    const rect = corner.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  });
  return corners.length === 4 ? (corners as unknown as Quad) : null;
}

/** Where on its plane – on the slide, 0–1 – a point seen on screen lies. */
function whereOnPlane(plane: Element, x: number, y: number): Point | null {
  const corners = seenCorners(plane);
  return corners ? unprojectUnitSquare(corners)({ x, y }) : null;
}

/** Whether a frame on screen and a box as seen (a convex quad) overlap: no axis parts them. */
function touches(frame: Rect, quad: readonly Point[]): boolean {
  const corners = [
    { x: frame.x, y: frame.y },
    { x: frame.x + frame.w, y: frame.y },
    { x: frame.x + frame.w, y: frame.y + frame.h },
    { x: frame.x, y: frame.y + frame.h },
  ];
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    ...quad.map((point, i) => {
      const next = quad[(i + 1) % quad.length]!;
      return { x: point.y - next.y, y: next.x - point.x };
    }),
  ];
  return axes.every((axis) => {
    const along = (points: readonly Point[]) => points.map((p) => p.x * axis.x + p.y * axis.y);
    const a = along(corners);
    const b = along(quad);
    return Math.max(...a) >= Math.min(...b) && Math.max(...b) >= Math.min(...a);
  });
}

/** The elements whose box, as seen on its plane, a frame dragged on screen touches. */
function elementsIn(stage: Element, frame: Rect, boxes: Map<string, Rect>): string[] {
  const hits: string[] = [];
  for (const [id, box] of boxes) {
    const plane = stage.querySelector(`[data-layer="${CSS.escape(id)}"]`)?.closest('[data-plane]');
    const corners = plane && seenCorners(plane);
    if (!corners) continue;
    const project = projectUnitSquare(corners);
    const seen = [
      project({ x: box.x, y: box.y }),
      project({ x: box.x + box.w, y: box.y }),
      project({ x: box.x + box.w, y: box.y + box.h }),
      project({ x: box.x, y: box.y + box.h }),
    ];
    if (touches(frame, seen)) hits.push(id);
  }
  return hits;
}

const onSlide = ({ x, y }: Point) => x >= 0 && x <= 1 && y >= 0 && y <= 1;
const clampToSlide = ({ x, y }: Point): Point => ({
  x: Math.min(1, Math.max(0, x)),
  y: Math.min(1, Math.max(0, y)),
});

/** The comments on a slide, drawn on their planes. */
export interface LayerMarks {
  threads: readonly Thread[];
  /** The slide's boxes: what a comment's box reference names. */
  shapes: readonly Shape[];
  /** Where a comment being started on the slide hangs: its mark goes on that element's plane. */
  draft: Anchor | null;
  /** The marks of these comments (`withDraft`: and the draft's), laid over a plane (`AnnotationLayer`, held still). */
  render: (threads: Thread[], withDraft: boolean) => ReactNode;
}

/**
 * A slide on the track while „Ebenen“ is on (L): taken apart in 3D – what lies under every
 * element (page and master), then each element alone on a plane of its own, bottom first. The
 * comments go along: one on a box on that element's plane, the others on top of the stack – their
 * connector lines start from where the marks are seen. All slides turn together: dragging with ⇧
 * held turns them, Space twice shows them from the front (`LayersProvider`).
 *
 * Two ways to work, a double click goes from one to the other:
 * - reviewing (the list closed) – as on the flat slide: a click comments, a drag marks an area;
 *   in box mode, on the box of the layer it starts on (outlined under the pointer), else on top.
 * - editing (the list open): a click picks a layer (⇧ one more), a frame dragged – flat on the
 *   screen – picks every element it touches as seen.
 *
 * Until its layers are drawn – the active slide first, the others after – it lies flat as its own
 * picture.
 */
export function LayerStage({
  slideId,
  active,
  src,
  w,
  h,
  color,
  boxes,
  onComment,
  onCommentArea,
  onEdit,
  marks,
}: {
  slideId: string;
  /** The active slide: drawn first, says while it is drawn. */
  active: boolean;
  src: string;
  w: number;
  h: number;
  /** The viewer's colour: the picked and hovered layer's outline. */
  color: string;
  /** Box mode: reviewing, the layer under the pointer is outlined – comments go on its box. */
  boxes: boolean;
  /** A click: a comment there (slide 0–1) – on the box `box`, else free (`SlideFrame`). */
  onComment: (point: Point, box: string | null) => void;
  /** An area dragged: a comment on it – bound to the box `box`, else free (`SlideFrame`). */
  onCommentArea: (rect: Rect, box: string | null) => void;
  /** A double click starts editing: the comment its two clicks started goes (`SlideFrame`). */
  onEdit: () => void;
  /** Its comments, on their planes. */
  marks?: LayerMarks;
}) {
  const layers = useLayers();
  const editing = useEditing();
  const drawn = useLayerPictures(slideId, active ? 'interactive' : 'background');
  const stageRef = useRef<HTMLDivElement>(null);
  useSharedVanishingPoint(stageRef);
  const [turning, setTurning] = useState(false);
  const press = useRef<{
    x: number;
    y: number;
    view: typeof layers.view;
    moved: boolean;
    turns: boolean;
    /** Not touch: a drag marks an area or draws a frame. */
    drags: boolean;
    /** The plane pressed on; `null`: something with clicks of its own (`OWN_CLICKS`). */
    plane: Element | null;
    /** The layer pressed on. */
    layer: string | null;
  } | null>(null);
  // The list open: editing – clicks pick layers, dragging draws a frame to pick in.
  const editMode = layers.panelOpen;
  // On screen; `origin`: where the stage lies, the frame is drawn in it.
  const [frame, setFrame] = useState<(Rect & { origin: Point }) | null>(null);
  // Reviewing, an area dragged to comment on: on the plane it is drawn on (`z`), slide 0–1.
  const [area, setArea] = useState<{ z: number; rect: Rect } | null>(null);
  /**
   * The box a comment started on `layer` hangs on: in box mode, that element's – a box of the
   * slide by the same id. Else, or beside every one, it is a general comment.
   */
  const boxOf = (layer: string | null) =>
    boxes && layer && marks?.shapes.some((shape) => shape.id === layer) ? layer : null;
  /** The plane it lies on – where it shows once made: its element's, else the top. */
  const commentPlane = (pressed: Element, layer: string | null) =>
    boxOf(layer) ? pressed : (topRef.current ?? pressed);
  const elementList = editing.elementsOf(slideId);
  const elements = new Map(elementList.map((element) => [element.id, element]));
  const baseRef = useRef<HTMLDivElement>(null);
  // Where general comments lie, on top of the stack: one clicked or dragged outside box mode
  // goes there – seen right where it was made.
  const topRef = useRef<HTMLDivElement>(null);
  const order = layers.orderOf(slideId);
  const aspect = editing.pageSize.width / editing.pageSize.height;
  const front = isFront(layers.view);
  const width = Math.max(0, Math.min(w * FIT, h * FIT * aspect));
  const count = order.length;
  // Flat until its layers are there: then it opens up.
  const gap = drawn.background
    ? layers.spread * Math.min((width * DEPTH) / Math.max(1, count), width * MAX_GAP)
    : 0;
  const { view } = layers;
  const easing = turning ? undefined : `transform ${EASE_MS}ms ease-out`;
  const picked = layers.picked?.slideId === slideId ? layers.picked.ids : [];
  // From the front the slide looks as it is: no plane's frame.
  const framed = !front;
  const marked = marks ? marksByElement(marks.threads, elementList, marks.shapes) : null;
  // The draft's plane: its element's – else (or not on a plane) the top's.
  const draftOn =
    marks?.draft != null ? anchorElement(marks.draft, elementList, marks.shapes) : undefined;
  const draftPlane = draftOn != null && order.includes(draftOn) ? draftOn : null;
  if (marked && draftOn !== undefined && !marked.has(draftPlane)) marked.set(draftPlane, []);

  // The marks' lines ease along with a turn or a spread.
  useEffect(() => {
    if (stageRef.current) followConnectors(stageRef.current, EASE_MS);
  }, [view.pitch, view.yaw, gap]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const target = event.target as Element;
    const own = target.closest(OWN_CLICKS);
    // Touch scrolls the track, as on the flat slide: a tap still comments or picks.
    const touch = event.pointerType === 'touch';
    // Turning or dragging, the stage keeps the pointer – the plane pressed on is known now.
    if (!touch && (event.shiftKey || !own)) event.currentTarget.setPointerCapture(event.pointerId);
    press.current = {
      x: event.clientX,
      y: event.clientY,
      view,
      moved: false,
      turns: event.shiftKey && !touch,
      drags: !touch,
      plane: own ? null : (target.closest('[data-plane]') ?? baseRef.current),
      layer: target.closest<HTMLElement>('[data-layer]')?.dataset.layer ?? null,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const start = press.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 4) return;
    start.moved = true;
    if (!start.turns) {
      if (!start.drags || !start.plane) return;
      if (editMode) {
        const stage = event.currentTarget.getBoundingClientRect();
        setFrame({
          origin: { x: stage.left, y: stage.top },
          x: Math.min(start.x, event.clientX),
          y: Math.min(start.y, event.clientY),
          w: Math.abs(dx),
          h: Math.abs(dy),
        });
      } else {
        const plane = commentPlane(start.plane, start.layer);
        const from = whereOnPlane(plane, start.x, start.y);
        const to = whereOnPlane(plane, event.clientX, event.clientY);
        if (from && to && onSlide(from))
          setArea({
            z: Number((plane as HTMLElement).dataset.z ?? 0),
            rect: rectFromPoints(from, clampToSlide(to)),
          });
      }
      return;
    }
    setTurning(true);
    layers.setView({
      yaw: Math.max(-MAX_YAW, Math.min(MAX_YAW, start.view.yaw + dx * TURN_PER_PX)),
      pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, start.view.pitch - dy * TURN_PER_PX)),
    });
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const start = press.current;
    press.current = null;
    setTurning(false);
    setFrame(null);
    setArea(null);
    if (!start || !start.plane) return;
    if (editMode) {
      // A frame drawn: what it touches; a click: the layer (⇧ one more) – beside every one, none.
      if (frame && stageRef.current) {
        const boxes = new Map(
          order.flatMap((id) => {
            const element = elements.get(id);
            return element ? [[id, drawn.pictures.get(id)?.box ?? element.bbox] as const] : [];
          }),
        );
        layers.pickAll(slideId, elementsIn(stageRef.current, frame, boxes));
      } else if (!start.moved) layers.pick(slideId, start.layer, start.turns);
      return;
    }
    if (start.turns) return;
    // Dragged: a comment on the area – too small an one, none.
    if (start.moved) {
      if (
        area &&
        distance(area.rect, { x: area.rect.x + area.rect.w, y: area.rect.y + area.rect.h }) >=
          MIN_DRAG_DISTANCE
      )
        onCommentArea(area.rect, boxOf(start.layer));
      return;
    }
    // Pressed without dragging: a comment where it lands – beside the slide, none.
    const point = whereOnPlane(
      commentPlane(start.plane, start.layer),
      event.clientX,
      event.clientY,
    );
    if (point && onSlide(point)) onComment(point, boxOf(start.layer));
  };
  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const target = event.target as Element;
    if (target.closest(OWN_CLICKS)) return;
    // Editing: back to reviewing.
    if (editMode) {
      layers.setPanelOpen(false);
      return;
    }
    onEdit();
    layers.pick(
      slideId,
      target.closest<HTMLElement>('[data-layer]')?.dataset.layer ?? null,
      event.shiftKey,
    );
  };

  return (
    <div
      ref={stageRef}
      data-layer-stage={slideId}
      className={cn(
        'absolute inset-0 touch-pan-x select-none',
        turning
          ? 'cursor-grabbing'
          : layers.turnKey
            ? 'cursor-grab'
            : editMode
              ? 'cursor-default'
              : 'cursor-crosshair',
      )}
      style={{
        perspective: `${Math.max(1200, width * 2.4)}px`,
        ['--layer-color' as string]: color,
        ['--layer-tint' as string]: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onPointerCancel={() => {
        press.current = null;
        setTurning(false);
        setFrame(null);
        setArea(null);
      }}
      // The slide's own click would comment on the flat slide: the stage's comments on its planes.
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {width > 0 && (
        <div
          className="absolute top-1/2 left-1/2"
          style={{
            width,
            height: width / aspect,
            transformStyle: 'preserve-3d',
            // Turned about the stack's middle – from the front too: scrolled sideways, the whole slide
            // floats against the track, its near layers ahead, its far ones behind.
            transform: `translate(-50%, -50%) rotateX(${view.pitch}deg) rotateY(${view.yaw}deg) translateZ(${(-gap * count) / 2}px)`,
            transition: easing,
          }}
        >
          {/* What lies under every element: page and master – the slide itself until drawn. */}
          <div
            ref={baseRef}
            data-plane
            data-z={0}
            className={cn(
              'pointer-events-none absolute inset-0 overflow-hidden rounded-thumb bg-surface-2',
              framed && 'ring-1 ring-hairline-strong',
            )}
            style={{ transform: 'translateZ(0px)', transition: easing }}
          >
            <PlaneCorners />
            <img
              src={drawn.background ?? src}
              alt=""
              draggable={false}
              className="size-full object-fill"
            />
          </div>
          {drawn.background &&
            order.map((id, at) => (
              <LayerPlane
                key={id}
                element={elements.get(id)}
                picture={drawn.pictures.get(id)}
                z={(at + 1) * gap}
                easing={easing}
                framed={framed}
                hovered={(boxes || editMode) && id === layers.hovered}
                // Picked shows while editing: reviewing, the comments' marks have the slide.
                picked={editMode && picked.includes(id)}
                onHover={(over) => layers.setHovered(over ? id : null)}
              />
            ))}
          {/* The top of the stack, where general comments lie: its corners place them. */}
          <div
            ref={topRef}
            data-z={count * gap + MARK_LIFT}
            className="pointer-events-none absolute inset-0"
            style={{ transform: `translateZ(${count * gap + MARK_LIFT}px)`, transition: easing }}
          >
            <PlaneCorners />
          </div>
          {area && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{ transform: `translateZ(${area.z + MARK_LIFT}px)` }}
            >
              <RectFrame rect={area.rect} color={color} dashed />
            </div>
          )}
          {marked &&
            [...marked].map(([id, threads]) => {
              // A general comment, or one whose element is not on a plane: on top of the stack.
              const at = id === null ? -1 : order.indexOf(id);
              const z = (at < 0 ? count : at + 1) * gap + MARK_LIFT;
              return (
                <div
                  key={id ?? ''}
                  data-layer-marks={id ?? ''}
                  className="pointer-events-none absolute inset-0"
                  style={{ transform: `translateZ(${z}px)`, transition: easing }}
                >
                  {/* Its corners as seen: the connector lines map the marks through them. */}
                  <PlaneCorners />
                  {marks?.render(threads, draftOn !== undefined && id === draftPlane)}
                </div>
              );
            })}
        </div>
      )}
      {frame && (
        // Flat on the screen, facing the viewer – not on a plane. Placed in the stage: with its
        // perspective it is what `fixed` would be measured against, too.
        <div
          data-layer-frame
          className="pointer-events-none absolute rounded-mark border border-(--layer-color) bg-(--layer-tint)"
          style={{
            left: frame.x - frame.origin.x,
            top: frame.y - frame.origin.y,
            width: frame.w,
            height: frame.h,
          }}
        />
      )}
      {active && !drawn.background && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          {drawn.failed ? (
            <span className="pointer-events-auto flex items-center gap-2 rounded-full bg-canvas/80 px-3 py-1.5 text-sm text-fg-muted">
              Die Ebenen ließen sich nicht zeichnen.
              <Button variant="soft" size="xs" onClick={drawn.retry}>
                Nochmal
              </Button>
            </span>
          ) : (
            <span className="flex items-center gap-2 rounded-full bg-canvas/80 px-3 py-1.5 text-sm text-fg-muted">
              <Spinner size="sm" label="" />
              Ebenen werden gezeichnet …
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One element on its plane: its picture alone where it lies, the slide's frame faint around it
 * (not from the front). Outlined as in box mode (`EditLayer`): tight, tinted while hovered, a
 * heavier line once picked.
 */
function LayerPlane({
  element,
  picture,
  z,
  easing,
  framed,
  hovered,
  picked,
  onHover,
}: {
  element: EditableElement | undefined;
  picture: LayerPicture | undefined;
  z: number;
  easing: string | undefined;
  framed: boolean;
  hovered: boolean;
  picked: boolean;
  onHover: (over: boolean) => void;
}) {
  if (!element) return null;
  const label = elementLabel(element);
  const hover = {
    'data-layer': element.id,
    onPointerEnter: () => onHover(true),
    onPointerLeave: () => onHover(false),
  };
  return (
    <div
      data-plane
      data-z={z}
      className={cn(
        'pointer-events-none absolute inset-0 rounded-thumb border transition-colors',
        !framed
          ? 'border-transparent'
          : picked || hovered
            ? 'border-(--layer-color)'
            : 'border-hairline-strong',
      )}
      style={{ transform: `translateZ(${z}px)`, transition: easing }}
    >
      <PlaneCorners />
      {picture?.url && picture.box ? (
        <img
          {...hover}
          src={picture.url}
          alt={label}
          draggable={false}
          // It takes the pointer: a click lands on its plane.
          className="pointer-events-auto absolute max-w-none"
          style={boxStyle(picture.box)}
        />
      ) : (
        // Not drawn (yet), or it draws nothing: its box, to find it by.
        <span
          {...hover}
          className="pointer-events-auto absolute rounded-thumb border border-dashed border-fg-subtle"
          style={boxStyle(element.bbox)}
        />
      )}
      {(picked || hovered) && (
        <span
          className={cn(
            'pointer-events-none absolute rounded-mark',
            picked
              ? 'border-2 border-(--layer-color)'
              : 'border-[1.5px] border-(--layer-color) bg-(--layer-tint)',
          )}
          style={boxStyle(element.bbox)}
        />
      )}
    </div>
  );
}
