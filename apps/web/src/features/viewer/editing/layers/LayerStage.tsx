import {
  rectCorners,
  turnedBoxContains,
  turnedCorners,
  clampPoint,
  distance,
  findElement,
  MIN_DRAG_DISTANCE,
  rectFromPoints,
  TILT_DEPTH,
  type Anchor,
  type EditableElement,
  type ElementFlip,
  type ElementTilt,
  type Point,
  type Rect,
  type Shape,
} from '@slider/shared';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { wheelPixels } from '@/lib/wheel';
import { Button, cn } from '@/ui';
import type { Thread } from '../../comments/lib/comment-selectors';
import { followConnectors } from '../../connectors/hooks/useConnectorLayout';
import { projectUnitSquare, unprojectUnitSquare } from '../../connectors/lib/plane-projection';
import { useEditing } from '../editing-context';
import { usePreviewAmong } from '../preview-store';
import { elementLabel } from '../lib/element-label';
import { InlineTextEditor } from '../live/InlineTextEditor';
import { ElementView } from '../compose/ElementView';
import {
  frameTransform,
  liveLayerStyle,
  PT_PER_CM,
  stretched,
  turnedCss,
  type Frame,
} from '../live/css';
import { LiveElementView } from '../live/render';
import { isTilted } from '../tilt/tilt-math';
import { useTiltElement } from '../tilt/useTilt';
import { useViewerToast } from '../../state/viewer-toast';
import { useStageRegistry } from '../../state/stage-registry';
import { ShapeOutline } from '../../stage/ShapeOutline';
import { EditableFrame } from '../../stage/EditableFrame';
import { FRAME_ATTR } from '../../stage/hooks/useRectEdit';
import { markTint } from '../../stage/lib/mark-chrome';
import { RectFrame } from '../../stage/RectFrame';
import type { SlideZoom } from '../../stage/lib/slide-zoom';
import { FRONT, isFront, MAX_SPREAD, useLayers, type LayerView } from './layers-context';
import { anchorElement, marksByElement } from './mark-planes';
import { planeBox, seenCorners } from './seen-on-plane';
import { useLayerPictures, type LayerPicture } from './useLayerPictures';
import { LAYER_EASE_MS, LAYER_SWAP_MS, type StagePhase } from './useStagePhase';
import { canMove, canSize } from '../live/model';

/** Turning stops short of edge-on: the layers would vanish into lines. */
const MAX_PITCH = 75;
const MAX_YAW = 80;
/** Degrees per pixel dragged. */
const TURN_PER_PX = 0.3;
/** The slide's share of its frame: turned, it still fits; from the front, it floats in it. */
const FIT = 0.78;
/** The whole stack at spread 1 is this deep, as a share of the slide's width … */
const DEPTH = 0.9;
/** … less with more layers than this: a deep stack of many drifts off its slide (parallax). */
const MANY_LAYERS = 15;
/** … one layer at most this far from the next. */
const MAX_GAP = 0.16;
/** Turned less than this (degrees, yaw and pitch added up), the stack still flattens to the slide. */
const FLAT_WITHIN = 30;
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
const EASE_MS = LAYER_EASE_MS;
/** The planes beside the outlined one: framed in white, this strong next to it … */
const NEIGHBOUR_FRAME = 0.55;
/** … each frame farther off this much fainter. */
const NEIGHBOUR_FALLOFF = 0.7;
/** Framed this share of the stack before and behind it, but at least `NEIGHBOUR_MIN_REACH` … */
const NEIGHBOUR_REACH = 0.25;
const NEIGHBOUR_MIN_REACH = 3;
/** … with at most this many frames on each side: in a deep stack only every 2nd, 5th, 10th … */
const NEIGHBOUR_FRAMES = 5;

/** Every how many planes one is framed, to reach `reach` planes with few enough frames. */
function neighbourStep(reach: number): number {
  for (let step = 1; ; step *= 10) {
    for (const nice of [1, 2, 5]) {
      if (reach / (step * nice) <= NEIGHBOUR_FRAMES) return step * nice;
    }
  }
}

/**
 * How strong a plane `steps` away from the outlined one is framed, in a stack of `count`;
 * `null`: not at all.
 */
function neighbourFrame(steps: number, count: number): number | null {
  const reach = Math.max(NEIGHBOUR_MIN_REACH, Math.round(count * NEIGHBOUR_REACH));
  const step = neighbourStep(reach);
  if (steps <= 0 || steps > reach || steps % step !== 0) return null;
  return NEIGHBOUR_FRAME * NEIGHBOUR_FALLOFF ** (steps / step - 1);
}

/** ⌥ + wheel spreads the layers: this much per pixel scrolled (up: farther apart). */
const SPREAD_PER_PX = 0.012;
/** Spread by the wheel: it follows at once, eased again this long after the last scroll. */
const SPREAD_SETTLE_MS = 150;
/** The nearest plane at most this share of the way to the eye (its perspective). */
const NEAREST = 0.8;

/** Pins and the like on the slide keep their own clicks. */
const OWN_CLICKS = 'button, a, input, textarea, [contenteditable], [data-mark]';
/** Longer than the system's double click lasts (macOS at its slowest: ~0.8 s). */
const DOUBLE_CLICK_MS = 1000;

const boxStyle = ({ x, y, w, h }: Rect): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  width: `${w * 100}%`,
  height: `${h * 100}%`,
});

/** Its corners, to see where it lies (`whereOnPlane`, the connector lines). */
function PlaneCorners() {
  return PLANE_CORNERS.map(([left, top], corner) => (
    <i key={corner} data-plane-corner={corner} className="absolute size-0" style={{ left, top }} />
  ));
}

/** Where on its plane – on the slide, 0–1 – a point seen on screen lies. */
function whereOnPlane(plane: Element, x: number, y: number): Point | null {
  const corners = seenCorners(plane);
  if (!corners) return null;
  const at = unprojectUnitSquare(corners)({ x, y });
  const box = planeBox(plane);
  return box ? { x: box.x + at.x * box.w, y: box.y + at.y * box.h } : at;
}

/** Whether a frame on screen and a box as seen (a convex quad) overlap: no axis parts them. */
function touches(frame: Rect, quad: readonly Point[]): boolean {
  const corners = rectCorners(frame);
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
function elementsIn(
  stage: Element,
  frame: Rect,
  elements: readonly EditableElement[],
  aspect: number,
): string[] {
  const hits: string[] = [];
  for (const element of elements) {
    const { id } = element;
    const plane = stage.querySelector(`[data-layer="${CSS.escape(id)}"]`)?.closest('[data-plane]');
    const corners = plane && seenCorners(plane);
    if (!corners) continue;
    const unit = projectUnitSquare(corners);
    const span = planeBox(plane) ?? { x: 0, y: 0, w: 1, h: 1 };
    // A point of the slide as seen: through its plane's part of the slide.
    const project = ({ x, y }: Point) =>
      unit({ x: (x - span.x) / span.w, y: (y - span.y) / span.h });
    const seen = turnedCorners(element, aspect).map(project);
    if (touches(frame, seen)) hits.push(id);
  }
  return hits;
}

const onSlide = ({ x, y }: Point) => x >= 0 && x <= 1 && y >= 0 && y <= 1;

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
 * connector lines start from where the marks are seen. Each slide turns on its own: dragging with
 * ⇧ held turns it, Space twice turns the active one to the front, or tilts it from there
 * (`LayersProvider`).
 *
 * Two ways to work, a double click goes from reviewing to editing:
 * - reviewing (the list closed) – as on the flat slide: a click comments – in box mode on the box
 *   of the layer it lands on (outlined under the pointer), else on top; a drag marks an area,
 *   free, on top.
 * - editing (the list open): as on the flat slide, a click changes the element right there (a text
 *   typed in, the format bar beside it); a double click picks its layer, ⇧ and a click one more,
 *   a frame dragged – flat on the screen – every element it touches as seen.
 *
 * Until its layers are drawn – the active slide first, the others after – it lies flat as its own
 * picture.
 */
export function LayerStage({
  slideId,
  active,
  phase = 'open',
  onReady,
  src,
  w,
  h,
  color,
  boxes,
  onComment,
  onCommentArea,
  onEdit,
  marks,
  zoom,
}: {
  slideId: string;
  /** The active slide: drawn first, says while it is drawn. */
  active: boolean;
  /**
   * On its way into or out of its layers (`useStagePhase`): not open, it is flat, facing and as
   * large as the slide shows on its own; `prep` unseen.
   */
  phase?: Exclude<StagePhase, null>;
  /** `prep`: its pictures are decoded, it can be shown. */
  onReady?: () => void;
  src: string;
  w: number;
  h: number;
  /** The viewer's colour: the picked and hovered layer's outline. */
  color: string;
  /** Box mode: the layer under the pointer is outlined – reviewing, comments go on its box. */
  boxes: boolean;
  /**
   * A click: a comment there (slide 0–1) – on the box `box`, else free (`SlideFrame`). `add`: ⇧
   * and a click, as one more layer is picked while editing – the comment takes this box too.
   */
  onComment: (point: Point, box: string | null, add?: boolean) => void;
  /** An area dragged: a comment on it – bound to the box `box`, else free (`SlideFrame`). */
  onCommentArea: (rect: Rect, box: string | null) => void;
  /** A double click starts editing: the comment its two clicks started goes (`SlideFrame`). */
  onEdit: () => void;
  /** Its comments, on their planes. */
  marks?: LayerMarks;
  /** Zoomed into (`SlideZoom`): that part of the stack fills the frame. */
  zoom?: Pick<SlideZoom, 'scale' | 'x' | 'y'> | null;
}) {
  const layers = useLayers();
  const hovered = layers.hovered?.slideId === slideId ? layers.hovered.elementId : null;
  const { setHovered } = layers;
  useEffect(() => () => setHovered(slideId, null), [setHovered, slideId]);
  const registry = useStageRegistry();
  const [pointerLayer, setPointerLayer] = useState<string | null>(null);
  const editing = useEditing();
  const tiltElement = useTiltElement();
  const toast = useViewerToast();
  const drawn = useLayerPictures(slideId, active ? 'interactive' : 'background');
  const stageRef = useRef<HTMLDivElement>(null);
  const [turning, setTurning] = useState(false);
  // Spread by the wheel: no easing meanwhile, each scroll would start it anew and lag behind.
  const [spreading, setSpreading] = useState(false);
  // Being turned: only this slide draws anew meanwhile, the others stay as they are.
  const [turned, setTurned] = useState<LayerView | null>(null);
  const press = useRef<{
    x: number;
    y: number;
    view: LayerView;
    moved: boolean;
    turns: boolean;
    /** Not touch: a drag marks an area or draws a frame. */
    drags: boolean;
    /** The plane pressed on; `null`: something with clicks of its own (`OWN_CLICKS`). */
    plane: Element | null;
    /** The layer pressed on. */
    layer: string | null;
  } | null>(null);
  // The layer last pressed on: the stage keeps the pointer, so a double click lands on it.
  const pressedLayer = useRef<string | null>(null);
  // When a click last changed an element right here (`change`): a double click's second click
  // lands in the text that click began typing – still a double click on the element.
  const changedAt = useRef(-Infinity);
  // Editing: clicks pick layers, dragging draws a frame to pick in. Reviewing: they comment.
  const editMode = editing.active;
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
  // Only a drag of one of this slide's elements renders the stage again.
  const preview = usePreviewAmong(elementList.map((element) => element.id));
  const baseRef = useRef<HTMLDivElement>(null);
  // Where general comments lie, on top of the stack: one clicked or dragged outside box mode
  // goes there – seen right where it was made.
  const topRef = useRef<HTMLDivElement>(null);
  const order = layers.orderOf(slideId);
  const drawnFrame = (id: string) => drawn.frames?.get(id);
  // Drawn by the browser on its plane: the text typed in, a text dragged (alone on its plane, no
  // slide backdrop to leave out), and every element the browser draws whole (`paint`) – changed,
  // it shows so at once, as on the flat slide.
  const liveDrag = preview && elements.get(preview.elementId);
  const liveId =
    liveDrag?.live && !liveDrag.tilt && preview?.tilt === undefined
      ? liveDrag.id
      : editing.textEditing;
  const drawnLive = (id: string) => {
    const element = elements.get(id);
    return !!element?.live && (id === liveId || (!!element.paint && !element.tilt));
  };
  const aspect = editing.pageSize.width / editing.pageSize.height;
  const open = phase === 'opening' || phase === 'open';
  const view = open ? (turned ?? layers.viewOf(slideId)) : FRONT;
  const front = isFront(view);
  // ⌥ + wheel spreads the layers (⌘/Ctrl + wheel zooms, ⇧ + wheel scrolls sideways): taken
  // here, before the timeline would scroll with it.
  const spreadNow = useRef(layers.spread);
  const { setSpread } = layers;
  useLayoutEffect(() => {
    spreadNow.current = layers.spread;
  }, [layers.spread]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let frame = 0;
    let settle = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      // A trackpad scrolls either way: the larger one counts.
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      event.preventDefault();
      event.stopPropagation();
      spreadNow.current = Math.min(
        MAX_SPREAD,
        Math.max(0, spreadNow.current - wheelPixels(delta, event.deltaMode) * SPREAD_PER_PX),
      );
      setSpreading(true);
      // A trackpad sends many scrolls a frame: drawn once per frame.
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setSpread(spreadNow.current);
        });
      }
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setSpreading(false), SPREAD_SETTLE_MS);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      stage.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [setSpread]);
  const width = Math.max(0, Math.min(w * FIT, h * FIT * aspect));
  const count = order.length;
  // Flat until its layers are there: then it opens up.
  const perspective = Math.max(1200, width * 2.4);
  // Spread far, the nearest plane still stays in front of the eye.
  const gap =
    open && drawn.background
      ? Math.min(
          layers.spread *
            Math.min(
              (width * DEPTH * Math.sqrt(Math.min(1, MANY_LAYERS / Math.max(1, count)))) /
                Math.max(1, count),
              width * MAX_GAP,
            ),
          (perspective * NEAREST) / (Math.max(1, count) / 2),
        )
      : 0;
  const easing =
    turning || spreading
      ? undefined
      : phase === 'opening' || phase === 'out'
        ? `transform ${LAYER_SWAP_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`
        : `transform ${EASE_MS}ms ease-out`;
  // From the front the slide looks as it is: each plane shrunk by what its nearness adds (seen
  // from the slide's middle), so the stack shows no rim – the depth comes back as it turns.
  const frontness = Math.max(0, 1 - (Math.abs(view.yaw) + Math.abs(view.pitch)) / FLAT_WITHIN);
  const flatAt = (z: number) => 1 - (frontness * (z - (gap * count) / 2)) / perspective;
  const depthAt = (z: number) => `translateZ(${z}px) scale(${flatAt(z)})`;
  // From the front as large as the slide on its own – scrolled past, it does not change size; turned,
  // it floats in its frame (`FIT`), the more the farther it is turned.
  const fill = open ? 1 + (1 / FIT - 1) * frontness : 1 / FIT;
  // The slide's corners: from the front rounded as the slide on its own, turned as a plane's.
  const slideRadius = `calc((var(--radius-thumb) + (var(--radius-panel) - var(--radius-thumb)) * ${frontness}) / ${fill})`;
  const shown = width * fill;
  // From the front (and on its way in or out) cut to the slide, its corners rounded as the slide's
  // on its own; turned, the cut opens wide – eased, as the stack turns.
  const clip = zoom
    ? undefined
    : !open || front
      ? `inset(${(h - shown / aspect) / 2}px ${(w - shown) / 2}px round var(--radius-panel))`
      : `inset(${-2 * h}px ${-2 * w}px round 0px)`;
  const pickedIds = layers.picked?.slideId === slideId ? layers.picked.ids : [];
  // A part of a group picked in the list (the group entered): its group's plane shows picked –
  // the plane is the group's picture.
  const picked = pickedIds.map(
    (id) =>
      (!elements.has(id) &&
        elementList.find((element) => element.children && findElement(element.children, id))?.id) ||
      id,
  );
  // From the front the slide looks as it is: no plane's frame.
  const framed = !front;
  // The layer outlined in the stack: the picked one, else the one under the pointer – the
  // planes before and behind it are framed too, fainter the farther off.
  const outlined =
    (editMode ? order.find((id) => picked.includes(id)) : undefined) ?? (boxes ? hovered : null);
  const outlinedAt = outlined ? order.indexOf(outlined) : -1;
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

  // Unseen until its pictures are decoded: shown at once, whole, no plane coming in late.
  useEffect(() => {
    if (phase !== 'prep' || !onReady) return;
    // Still being drawn: shown once drawn (or after a while, `useStagePhase`).
    if (!drawn.background && drawn.drawing) return;
    const stage = stageRef.current;
    if (!stage) return;
    let gone = false;
    let frame = 0;
    const pictures = [...stage.querySelectorAll('img')];
    void Promise.all(pictures.map((img) => img.decode().catch(() => undefined))).then(() => {
      if (gone) return;
      // A frame drawn flat first: the easing starts from there.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(onReady);
      });
    });
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
    };
  }, [phase, onReady, drawn.background, drawn.drawing]);

  /**
   * The element under a point on screen, as on the flat slide (box mode, `EditLayer`): the smallest
   * whose box, on its own plane as seen, holds it – not whatever picture lies on top (its
   * see-through parts would take the pointer from what shows through them). Not a locked one: the
   * pointer passes through it, as on the slide – picked in the list.
   */
  const layerAt = (x: number, y: number): { id: string; plane: HTMLElement } | null => {
    let found: { id: string; plane: HTMLElement; area: number } | null = null;
    for (const plane of stageRef.current?.querySelectorAll<HTMLElement>(
      '[data-plane][data-layer]',
    ) ?? []) {
      const id = plane.dataset.layer!;
      const element = asShown(id);
      if (element?.locked) continue;
      const point = element && whereOnPlane(plane, x, y);
      if (!element || !point || !turnedBoxContains({ ...element, tilt: tiltOf(id) }, point, aspect))
        continue;
      const area = element.bbox.w * element.bbox.h;
      // Of the same size, the one higher up.
      if (!found || area <= found.area) found = { id, plane, area };
    }
    return found && { id: found.id, plane: found.plane };
  };
  // The layer under the pointer, outlined while it moves (box mode, editing).
  const hoverAt = useRef<{ x: number; y: number } | null>(null);
  const hoverFrame = useRef(0);
  const followHover = (x: number, y: number) => {
    hoverAt.current = { x, y };
    if (hoverFrame.current) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const at = hoverAt.current;
      const id = at ? (layerAt(at.x, at.y)?.id ?? null) : null;
      setPointerLayer(id);
      if (id !== hovered) layers.setHovered(slideId, id);
    });
  };
  useEffect(() => () => cancelAnimationFrame(hoverFrame.current), []);
  const pointerShape =
    open && boxes && !editMode && pointerLayer
      ? (marks?.shapes.find((shape) => shape.id === pointerLayer) ?? null)
      : null;
  useEffect(() => {
    registry.setHoveredBox(slideId, pointerShape);
    return () => registry.setHoveredBox(slideId, null);
  }, [registry, slideId, pointerShape]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const target = event.target as Element;
    const hit = layerAt(event.clientX, event.clientY);
    pressedLayer.current = hit?.id ?? null;
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
      plane: own ? null : (hit?.plane ?? baseRef.current),
      layer: hit?.id ?? null,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const start = press.current;
    if (!start) {
      if (event.pointerType === 'touch') return;
      // On a frame's handle or border (beyond its element's box, reached for): it stays hovered.
      if ((event.target as Element).closest(`[${FRAME_ATTR}]`)) return;
      if (boxes || editMode) followHover(event.clientX, event.clientY);
      return;
    }
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
        // Marked freely, whatever it starts on: on top.
        const plane = topRef.current ?? start.plane;
        const from = whereOnPlane(plane, start.x, start.y);
        const to = whereOnPlane(plane, event.clientX, event.clientY);
        if (from && to && onSlide(from))
          setArea({
            z: Number((plane as HTMLElement).dataset.z ?? 0),
            rect: rectFromPoints(from, clampPoint(to)),
          });
      }
      return;
    }
    setTurning(true);
    setTurned({
      yaw: Math.max(-MAX_YAW, Math.min(MAX_YAW, start.view.yaw + dx * TURN_PER_PX)),
      pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, start.view.pitch - dy * TURN_PER_PX)),
    });
  };
  /** The press let go: no more turning, frame or area. */
  const release = () => {
    press.current = null;
    setTurning(false);
    setFrame(null);
    setArea(null);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const start = press.current;
    release();
    if (turned) {
      layers.setViewOf(slideId, turned);
      setTurned(null);
    }
    if (!start || !start.plane) return;
    if (editMode) {
      // A frame drawn: what it touches; ⇧ and a click: one more layer; a click: the element is
      // changed right here – beside every one, none picked.
      if (frame && stageRef.current) {
        layers.pickAll(
          slideId,
          elementsIn(
            stageRef.current,
            frame,
            elementList.map((element) => ({
              ...asShown(element.id)!,
              tilt: tiltOf(element.id) ?? null,
            })),
            aspect,
          ),
        );
      } else if (!start.moved) {
        if (start.turns || !start.layer) layers.pick(slideId, start.layer, start.turns);
        else {
          changedAt.current = event.timeStamp;
          change(start.layer, { x: event.clientX, y: event.clientY });
        }
      }
      return;
    }
    // ⇧ and a drag turns the slide; ⇧ and a click: the comment takes this box too.
    if (start.turns && start.moved) return;
    // Dragged: a comment on the area – too small an one, none.
    if (start.moved) {
      if (
        area &&
        distance(area.rect, { x: area.rect.x + area.rect.w, y: area.rect.y + area.rect.h }) >=
          MIN_DRAG_DISTANCE
      )
        onCommentArea(area.rect, null);
      return;
    }
    // Pressed without dragging: a comment where it lands – beside the slide, none.
    const point = whereOnPlane(
      commentPlane(start.plane, start.layer),
      event.clientX,
      event.clientY,
    );
    if (point && onSlide(point)) onComment(point, boxOf(start.layer), start.turns);
  };
  /** An element as shown: dragged by its frame, where it is dragged to (its text follows). */
  const asShown = (id: string): EditableElement | undefined => {
    const element = elements.get(id);
    if (!element || preview?.elementId !== id) return element;
    return {
      ...element,
      bbox: preview.rect,
      rotation: preview.rotation ?? element.rotation,
      flip: preview.flip ?? element.flip,
    };
  };
  /** An element's tilt as shown: dragged with ⇧, the tilt it is dragged to. */
  const tiltOf = (id: string) =>
    preview?.elementId === id && preview.tilt !== undefined ? preview.tilt : elements.get(id)?.tilt;
  /** Moved, resized or turned by its frame on its plane – groups keep their size. */
  const place = (
    shownAs: EditableElement,
    rect: Rect,
    rotation: number,
    done: () => void,
    flip?: ElementFlip,
  ) => {
    // As stored, not as dragged (`asShown`).
    const element = elements.get(shownAs.id) ?? shownAs;
    const box = element.resizable ? rect : { ...rect, w: element.bbox.w, h: element.bbox.h };
    void editing
      .apply([
        {
          type: 'setBox',
          elementId: element.id,
          box,
          ...(rotation !== element.rotation && { rotation }),
          ...(flip && { flip }),
        },
      ])
      .finally(done);
  };
  /** Tilted in depth by its frame's turning handle with ⇧: drawn so from its picture alone. */
  const tilt = (
    shownAs: EditableElement,
    next: ElementTilt,
    done: () => void,
    mirror?: ElementFlip,
  ) => {
    const element = elements.get(shownAs.id) ?? shownAs;
    const picture = drawn.pictures.get(element.id);
    if (!picture?.url || !picture.box) {
      toast('Das Element wird noch vorbereitet. Gleich nochmal versuchen.', 'neutral');
      done();
      return;
    }
    void tiltElement(element, next, { url: picture.url, box: picture.box }, mirror)
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : 'Das Kippen ging nicht.', 'danger'),
      )
      .finally(done);
  };
  // Stable event props preserve LayerPlane's memo while only one element is dragged.
  const placeRef = useRef(place);
  const tiltRef = useRef(tilt);
  useLayoutEffect(() => {
    placeRef.current = place;
    tiltRef.current = tilt;
  });
  const placeStable = useCallback(
    (...args: Parameters<typeof place>) => placeRef.current(...args),
    [],
  );
  const tiltStable = useCallback(
    (...args: Parameters<typeof tilt>) => tiltRef.current(...args),
    [],
  );
  /**
   * The element changed right here: picked, its format bar beside it – a text picked already is
   * typed in on its plane, the caret where it was clicked (`at`, on screen), as on the slide.
   */
  const change = (layer: string, at: Point) => {
    const element = elements.get(layer);
    if (!element) return;
    const selection = { slideId, elementId: element.id };
    if (
      element.live &&
      (editing.selection?.elementId === element.id ||
        // Typing in another text: typed on here at once.
        (editing.textEditing !== null && editing.textEditing !== element.id))
    ) {
      editing.startText(selection, at);
    } else editing.select(selection);
    editing.open(element.id);
  };
  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const target = event.target as Element;
    const own = target.closest(OWN_CLICKS);
    // In the text its first click began typing: on the element. Typed in before, a double click
    // marks a word.
    const begun =
      editMode &&
      own?.matches('[contenteditable]') &&
      event.timeStamp - changedAt.current < DOUBLE_CLICK_MS;
    changedAt.current = -Infinity;
    if (own && !begun) return;
    const layer = layerAt(event.clientX, event.clientY)?.id ?? pressedLayer.current;
    // Editing: the layer only picked – the typing or format bar a click began let go – and the
    // list of layers opens on it (`pick`).
    if (editMode) {
      editing.select(null);
      layers.pick(slideId, layer, event.shiftKey);
      return;
    }
    onEdit();
    editing.setActive(true);
    layers.pick(slideId, layer, event.shiftKey);
  };

  return (
    <div
      ref={stageRef}
      data-layer-stage={slideId}
      className={cn(
        'absolute inset-0 touch-pan-x select-none',
        // On its way in or out, not to be clicked.
        !open && 'pointer-events-none',
        turning
          ? 'cursor-grabbing'
          : layers.turnKey
            ? 'cursor-grab'
            : editMode
              ? 'cursor-default'
              : // Reviewing as on the flat slide (`SlideFrame`): in box mode a box is clicked.
                boxes
                ? hovered
                  ? 'cursor-pointer'
                  : 'cursor-default'
                : 'cursor-crosshair',
      )}
      style={{
        perspective: `${perspective}px`,
        clipPath: clip,
        transition: easing?.replace('transform', 'clip-path'),
        ['--layer-color' as string]: color,
        ['--layer-tint' as string]: markTint(color),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onPointerLeave={() => {
        hoverAt.current = null;
        setPointerLayer(null);
        if (hovered) layers.setHovered(slideId, null);
      }}
      onPointerCancel={release}
      // The slide's own click would comment on the flat slide: the stage's comments on its planes.
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {width > 0 && (
        // Zoomed in (⌘/Ctrl + wheel, pinch – `useTimelineWheel`): the part looked at in the middle,
        // the stack larger, depth and all; at once, without the turn's easing.
        // Neither it nor the turned slide in it takes the pointer – only what lies on the planes:
        // a part of a plane turned away behind them would not get its clicks (in 3D, they lie
        // before it); the stage takes the rest.
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            transformStyle: 'preserve-3d',
            // The view is of the frame (where the pointer was): the slide floats in it.
            transform: zoom
              ? `scale3d(${zoom.scale}, ${zoom.scale}, ${zoom.scale}) translate(${-(zoom.x + 0.5 / zoom.scale - 0.5) * w}px, ${-(zoom.y + 0.5 / zoom.scale - 0.5) * h}px)`
              : undefined,
          }}
        >
          <div
            className="pointer-events-none absolute top-1/2 left-1/2"
            style={{
              width,
              height: width / aspect,
              transformStyle: 'preserve-3d',
              // Turned about the stack's middle – from the front too: scrolled sideways, the whole slide
              // floats against the track, its near layers ahead, its far ones behind.
              transform: `translate(-50%, -50%) scale(${fill}) rotateX(${view.pitch}deg) rotateY(${view.yaw}deg) translateZ(${(-gap * count) / 2}px)`,
              transition: easing,
            }}
          >
            {/* What lies under every element: page and master – the slide itself until drawn. */}
            <div
              ref={baseRef}
              data-plane
              data-z={0}
              className={cn(
                'pointer-events-none absolute inset-0 overflow-hidden bg-surface-2',
                framed && 'ring-1 ring-hairline-strong',
              )}
              style={{
                transform: depthAt(0),
                // From the front rounded as the slide on its own, turned as a plane.
                borderRadius: slideRadius,
                transition: easing && `${easing}, ${easing.replace('transform', 'border-radius')}`,
              }}
            >
              <PlaneCorners />
              <img
                src={drawn.background ?? src}
                alt=""
                draggable={false}
                decoding="async"
                className="size-full object-fill"
              />
            </div>
            {drawn.background &&
              order.map((id, at) => (
                <LayerPlane
                  key={id}
                  element={asShown(id)}
                  picture={drawn.pictures.get(id)}
                  drawnAs={drawnFrame(id)}
                  z={(at + 1) * gap}
                  scale={flatAt((at + 1) * gap)}
                  easing={easing}
                  framed={framed}
                  hovered={boxes && id === hovered}
                  color={color}
                  slideRadius={slideRadius}
                  neighbour={
                    outlinedAt < 0 ? null : neighbourFrame(Math.abs(at - outlinedAt), count)
                  }
                  // Picked shows while editing: reviewing, the comments' marks have the slide.
                  picked={editMode && picked.includes(id)}
                  // Its handles also under the pointer in box mode, as on the flat slide.
                  handled={editMode && (pickedIds.includes(id) || (boxes && id === hovered))}
                  live={drawnLive(id)}
                  typing={editing.textEditing === id}
                  pageWidthPt={editing.pageSize.width * PT_PER_CM}
                  pageHeightPt={editing.pageSize.height * PT_PER_CM}
                  slideWidth={width}
                  tilt={tiltOf(id)}
                  onPlace={placeStable}
                  // Only seen from the front, where it is dragged as on the slide; offline not: its
                  // tilted picture goes up to the server.
                  onTilt={editing.offline || !front ? undefined : tiltStable}
                  tiltFrontOnly={!editing.offline && !front}
                />
              ))}
            {/* The top of the stack, where general comments lie: its corners place them. */}
            <div
              ref={topRef}
              data-z={count * gap + MARK_LIFT}
              className="pointer-events-none absolute inset-0"
              style={{ transform: depthAt(count * gap + MARK_LIFT), transition: easing }}
            >
              <PlaneCorners />
            </div>
            {area && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{ transform: depthAt(area.z + MARK_LIFT) }}
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
                    style={{ transform: depthAt(z), transition: easing }}
                  >
                    {/* Its corners as seen: the connector lines map the marks through them. */}
                    <PlaneCorners />
                    {marks?.render(threads, draftOn !== undefined && id === draftPlane)}
                  </div>
                );
              })}
          </div>
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
      {/* Until its layers are drawn the slide shows as it is – only a failure tells. */}
      {active && !drawn.background && drawn.failed && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <span className="pointer-events-auto flex items-center gap-2 rounded-full bg-canvas/80 px-3 py-1.5 text-sm text-fg-muted">
            Die Ebenen ließen sich nicht zeichnen.
            <Button variant="soft" size="xs" onClick={drawn.retry}>
              Nochmal
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

/** A part of the slide as placed in `box` (both 0–1 of the slide). */
const within = (part: Rect, box: Rect): CSSProperties => ({
  left: `${((part.x - box.x) / box.w) * 100}%`,
  top: `${((part.y - box.y) / box.h) * 100}%`,
  width: `${(part.w / box.w) * 100}%`,
  height: `${(part.h / box.h) * 100}%`,
});

/**
 * One element on its plane: its picture alone where it lies, the plane only as large as it (a
 * slide of many elements would be as many slide-sized surfaces to draw – BER-185). The slide's
 * frame at its depth only for the layer hovered or picked (not from the front), and in white,
 * fading off, for the ones before and behind it; outlined as in box
 * mode (`EditLayer`): tight, tinted while hovered, a heavier line once picked.
 */
const LayerPlane = memo(function LayerPlane({
  element,
  picture,
  drawnAs,
  z,
  scale,
  easing,
  framed,
  hovered,
  color,
  slideRadius,
  neighbour,
  picked,
  handled,
  live,
  typing,
  pageWidthPt,
  pageHeightPt,
  slideWidth,
  tilt,
  onPlace,
  onTilt,
  tiltFrontOnly,
}: {
  element: EditableElement | undefined;
  picture: LayerPicture | undefined;
  /** Where the element was when its picture was drawn: the picture follows it from there. */
  drawnAs: Frame | undefined;
  z: number;
  /** Shrunk by this from the front: the stack looks flat (`LayerStage`). */
  scale: number;
  easing: string | undefined;
  framed: boolean;
  hovered: boolean;
  /** The viewer's colour: the picked layer's line. */
  color: string;
  /** The slide's corners as it shows (CSS): an element spanning it is outlined so. */
  slideRadius: string;
  /** Beside the outlined layer: its slide's frame in white, this strong (0–1). */
  neighbour: number | null;
  picked: boolean;
  /** Its frame with handles: picked, or under the pointer in box mode (editing). */
  handled: boolean;
  /**
   * Drawn by the browser instead of its picture: whole where it may (`paint`, `ElementView`),
   * else its box filled and outlined under its text while typed in.
   */
  live: boolean;
  typing: boolean;
  pageWidthPt: number;
  pageHeightPt: number;
  /** The slide's width on the stage (px, before it is shrunk or turned): a tilt's perspective. */
  slideWidth: number;
  /**
   * Tilted in depth: its picture tilted on its plane as the slide shows it – the same perspective
   * about its centre (`elementTransform`), not the stack's –, so from the front it looks as flat.
   */
  tilt: ElementTilt | null | undefined;
  /** Moved, resized or turned by its frame (picked): its new box and turn; `done` once stored. */
  onPlace: (
    element: EditableElement,
    rect: Rect,
    rotation: number,
    done: () => void,
    flip?: ElementFlip,
  ) => void;
  /** Tilted in depth by its turning handle with ⇧; `done` once stored. */
  onTilt?: (
    element: EditableElement,
    tilt: ElementTilt,
    done: () => void,
    mirror?: ElementFlip,
  ) => void;
  /** Turned away from the front: ⇧ on its turning handle says it tilts only from there. */
  tiltFrontOnly: boolean;
}) {
  if (!element) return null;
  // Its picture's box (an outline may reach beyond the element) – moved, stretched and turned
  // with the element since it was drawn –, else its own.
  const drawnBox = picture?.url && picture.box ? picture.box : null;
  const box = drawnBox
    ? drawnAs
      ? stretched(drawnBox, drawnAs.bbox, element.bbox)
      : drawnBox
    : element.bbox;
  // Turned and mirrored since: around its centre.
  const turned = drawnBox && drawnAs ? frameTransform(drawnAs, element) : undefined;
  // A turned one stretches along its own sides, not the slide's (`turnedCss`): its picture placed
  // in the plane from where it was drawn, turned back, stretched and turned on.
  const alongSides =
    drawnBox && drawnAs && (drawnAs.rotation || element.rotation)
      ? turnedCss(drawnBox, drawnAs, element)
      : null;
  if (box.w <= 0 || box.h <= 0) return null;
  const liveLook = live && element.live ? element.live : null;
  const label = elementLabel(element);
  const depth = { transform: `translateZ(${z}px) scale(${scale})`, transition: easing };
  const { bbox } = element;
  const tilted: CSSProperties | null = isTilted(tilt)
    ? {
        transform: `perspective(${TILT_DEPTH * slideWidth}px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transformOrigin: `${((bbox.x + bbox.w / 2 - box.x) / box.w) * 100}% ${((bbox.y + bbox.h / 2 - box.y) / box.h) * 100}%`,
      }
    : null;
  return (
    <>
      {framed && (picked || hovered) ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 border border-(--layer-color)"
          style={{ ...depth, borderRadius: slideRadius }}
        />
      ) : (
        framed &&
        neighbour !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 border border-white"
            style={{ ...depth, borderRadius: slideRadius, opacity: neighbour }}
          />
        )
      )}
      <div
        data-plane
        data-layer={element.id}
        data-z={z}
        data-box={`${box.x} ${box.y} ${box.w} ${box.h}`}
        className="pointer-events-none absolute"
        // Shrunk about the slide's middle, as the full planes are.
        style={{
          ...boxStyle(box),
          ...depth,
          transformOrigin: `${((0.5 - box.x) / box.w) * 100}% ${((0.5 - box.y) / box.h) * 100}%`,
        }}
      >
        <PlaneCorners />
        <div className="absolute inset-0" style={tilted ?? undefined}>
          {liveLook && (
            // Alone on its plane: the browser draws it whole – no slide under it to leave out.
            <div
              data-live-host=""
              className="absolute"
              style={{
                ...within({ x: 0, y: 0, w: 1, h: 1 }, box),
                ...liveLayerStyle(pageWidthPt, pageHeightPt),
              }}
            >
              {element.paint && (
                <ElementView
                  element={tilted ? { ...element, tilt: null } : element}
                  live={liveLook}
                  paint={element.paint}
                  typing={typing}
                  pageAspect={pageWidthPt / Math.max(1, pageHeightPt)}
                  pageWidthPt={pageWidthPt}
                />
              )}
              <LiveElementView
                // Tilted with its plane already.
                element={tilted ? { ...element, tilt: null } : element}
                live={liveLook}
                // Drawn whole above: here only its editor while typed in. Else its box filled and
                // outlined under its text.
                textOnly={!!element.paint}
                style={{
                  pointerEvents: typing ? 'auto' : 'none',
                  ...(element.paint && !typing && { visibility: 'hidden' }),
                }}
              >
                {typing ? <InlineTextEditor elementId={element.id} live={liveLook} /> : undefined}
              </LiveElementView>
            </div>
          )}
          {picture?.url && picture.box ? (
            <img
              src={picture.url}
              alt={label}
              draggable={false}
              decoding="async"
              // The stage finds what is under the pointer (`layerAt`): not its see-through parts.
              className={cn('absolute max-w-none', !alongSides && 'inset-0 size-full')}
              style={{
                ...(liveLook && { visibility: 'hidden' }),
                ...(alongSides && {
                  ...within(drawnBox!, box),
                  transform: alongSides.transform,
                  transformOrigin: alongSides.transformOrigin,
                }),
                ...(!alongSides &&
                  turned && {
                    transform: turned,
                    transformOrigin: `${((bbox.x + bbox.w / 2 - box.x) / box.w) * 100}% ${((bbox.y + bbox.h / 2 - box.y) / box.h) * 100}%`,
                  }),
              }}
            />
          ) : (
            // Not drawn (yet), or it draws nothing: its box, to find it by.
            <span className="absolute inset-0 rounded-thumb border border-dashed border-fg-subtle" />
          )}
          {/* Tilted with it: its box from the file, as the slide shows it. */}
          {/* Outlined as on the flat slide (`EditLayer`): picked where it cannot move or is
              locked, or under the pointer without handles – a moving one with handles has its
              frame's line. */}
          {((picked && !canMove(element)) ||
            (hovered && !picked && !(handled && canSize(element)))) && (
            <div
              className="pointer-events-none absolute"
              style={{
                ...within({ x: 0, y: 0, w: 1, h: 1 }, box),
                containerType: 'inline-size',
              }}
            >
              {/* The parent already tilts this picture; apply only the in-plane turn. */}
              <ShapeOutline
                shape={{ bbox: element.bbox, rotation: element.rotation }}
                variant="target"
                color={color}
              />
            </div>
          )}
        </div>
        {handled && canMove(element) && (
          // Beside the tilted picture, tilting itself as on the slide (`EditLayer`).
          <PlaneFrame
            element={element}
            color={color}
            box={box}
            emphasized={picked}
            tilt={tilt}
            onPlace={onPlace}
            onTilt={onTilt}
            tiltFrontOnly={tiltFrontOnly}
          />
        )}
      </div>
    </>
  );
});

/**
 * The picked element's frame on its plane, as on the slide (`EditableFrame`): moved by its border,
 * resized by its corners, turned by its handle – where the pointer is on the slide found from the
 * plane as it is seen, turned and spread. What lies inside keeps its clicks (typing, picking).
 */
function PlaneFrame({
  element,
  color,
  box,
  emphasized,
  tilt,
  onPlace,
  onTilt,
  tiltFrontOnly,
}: {
  element: EditableElement;
  color: string;
  /** What of the slide the plane spans. */
  box: Rect;
  /** Picked: its line heavier; else only under the pointer. */
  emphasized: boolean;
  /** Its tilt as shown. */
  tilt: ElementTilt | null | undefined;
  onPlace: (
    element: EditableElement,
    rect: Rect,
    rotation: number,
    done: () => void,
    flip?: ElementFlip,
  ) => void;
  onTilt?: (
    element: EditableElement,
    tilt: ElementTilt,
    done: () => void,
    mirror?: ElementFlip,
  ) => void;
  tiltFrontOnly: boolean;
}) {
  const editing = useEditing();
  const previewSurface = useRef({}).current;
  // The whole slide on the plane, its corners seen on screen: the frame's place in it.
  const slideRef = useRef<HTMLDivElement>(null);
  const toSlide = (x: number, y: number): Point | null => {
    const corners = slideRef.current && seenCorners(slideRef.current);
    return corners ? unprojectUnitSquare(corners)({ x, y }) : null;
  };
  return (
    <div
      ref={slideRef}
      className="pointer-events-none absolute"
      // As wide as the slide: a tilt's perspective is in its widths (`elementTransform`).
      style={{ ...within({ x: 0, y: 0, w: 1, h: 1 }, box), containerType: 'inline-size' }}
    >
      <PlaneCorners />
      <EditableFrame
        rect={element.bbox}
        color={color}
        handles={element.resizable}
        elementEdge
        offSlide
        emphasized={emphasized}
        // Line and move cursor once picked, as on the flat slide (`EditLayer`).
        outlined={emphasized}
        edgesOnly
        rotation={element.rotation}
        // ⇧ on its turning handle tilts it in depth (groups do not tilt).
        tilt={tilt}
        onTilt={
          element.resizable && onTilt
            ? (next, done, mirror) => onTilt(element, next, done, mirror)
            : undefined
        }
        // Pictures and drawn shapes mirror, pulled over a side or tilted over the edge.
        flip={element.resizable ? element.flip : null}
        tiltHint={
          tiltFrontOnly && element.resizable ? 'Kippen geht nur in der Frontalansicht' : undefined
        }
        onTiltPreview={(next) =>
          editing.setPreview(
            next && { elementId: element.id, rect: element.bbox, tilt: next },
            element.id,
            previewSurface,
          )
        }
        toSlide={toSlide}
        onCommit={(rect, done, flip) => onPlace(element, rect, element.rotation, done, flip)}
        // Groups do not turn.
        onRotate={
          element.resizable
            ? (rotation, done) => onPlace(element, element.bbox, rotation, done)
            : undefined
        }
        onPreview={(rect, rotation, flip) =>
          editing.setPreview(
            rect && { elementId: element.id, rect, rotation, flip },
            element.id,
            previewSurface,
          )
        }
        // A double click on its border is no double click on the stage (which lets the text go).
        onDoubleClick={() => {}}
      />
    </div>
  );
}
