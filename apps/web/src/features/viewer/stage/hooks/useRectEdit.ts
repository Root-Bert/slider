import type { ElementFlip, ElementTilt, Point, Rect } from '@slider/shared';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { folded, overTheEdge, unfolded } from '../../editing/tilt/tilt-math';
import {
  axisLocked,
  LINE_SNAP_PX,
  moved,
  resized,
  resizedThrough,
  resizedTurned,
  snappedToLines,
  snappedTurn,
  turnedCorner,
  type RectCorner,
  type RectSize,
  type SnapLines,
} from '../lib/rect-edit';

export { resized, type RectCorner } from '../lib/rect-edit';

/** Marks the frame element; corner handles inside it find it by this. */
export const FRAME_ATTR = 'data-editable-frame';

/** Set on the page while a box is dragged: its cursor everywhere, nothing else hovers. */
const DRAG_LOCK_ATTR = 'data-frame-drag';
/** Marks the dragged frame while the page is locked: it alone still takes the pointer. */
const GRABBED_ATTR = 'data-frame-grabbed';

const lockPage = (frame: HTMLElement, cursor: string) => {
  const root = document.documentElement;
  root.setAttribute(DRAG_LOCK_ATTR, '');
  root.style.setProperty('--frame-drag-cursor', cursor);
  frame.setAttribute(GRABBED_ATTR, '');
};

const unlockPage = (frame: HTMLElement | undefined) => {
  const root = document.documentElement;
  root.removeAttribute(DRAG_LOCK_ATTR);
  root.style.removeProperty('--frame-drag-cursor');
  frame?.removeAttribute(GRABBED_ATTR);
};

/** Pointer travel (px) before a press on a box counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;

/** Degrees of tilt per pixel its turning handle is dragged with ⇧ – unless measured (`tiltPerPx`). */
const TILT_PER_PX = 0.3;
/** Dragged from its centre out to a corner (as seen), it tilts this far (degrees) … */
const TILT_SPAN = 65;
/** … yet never faster or slower than this per pixel: a tiny element stays controllable. */
const TILT_PER_PX_MAX = 0.4;
const TILT_PER_PX_MIN = 0.15;
/** Steepest tilt by dragging. */
const MAX_TILT = 70;
/** Closer than this (degrees) to flat on an axis, it is flat on that axis. */
const AXIS_FLAT_WITHIN = 3;
/** Closer than this (degrees, both axes together) to straight, it is straight: it snaps hard. */
const STRAIGHT_WITHIN = 5;

/** Out of the straight snap: `tilt` is no small one. */
const leftStraight = (tilt: ElementTilt) => Math.hypot(tilt.x, tilt.y) >= STRAIGHT_WITHIN;

/** Degrees per pixel for a box this large on screen (px): the larger, the calmer. */
export const tiltPerPx = (width: number, height: number) => {
  const reach = Math.hypot(width, height) / 2;
  return reach > 0
    ? Math.max(TILT_PER_PX_MIN, Math.min(TILT_PER_PX_MAX, TILT_SPAN / reach))
    : TILT_PER_PX;
};

/**
 * `start` tilted by a drag of `dx`/`dy` pixels with ⇧, unsnapped – when it `flips`, on over the
 * edge up to half a turn (its back, mirrored).
 */
const tiltRaw = (
  start: ElementTilt,
  dx: number,
  dy: number,
  perPx: number,
  flips = false,
): ElementTilt => {
  const reach = flips ? 180 : MAX_TILT;
  const clamp = (value: number) => Math.max(-reach, Math.min(reach, Math.round(value)));
  // Up: its top away; right: its right side away.
  return { x: clamp(start.x - dy * perPx), y: clamp(start.y + dx * perPx) };
};

/**
 * `start` tilted by a drag of `dx`/`dy` pixels with ⇧, snapping to straight – once `armed`: a
 * drag starting straight tilts by a little at once, and snaps only once it was out and comes back.
 * When it `flips`, dragged on it goes over the edge: past its steepest it jumps to its back
 * (never edge-on), tilted the other way, and comes straight again – mirrored – at half a turn.
 */
export const tiltBy = (
  start: ElementTilt,
  dx: number,
  dy: number,
  armed = true,
  perPx = TILT_PER_PX,
  flips = false,
): ElementTilt => {
  const raw = tiltRaw(start, dx, dy, perPx, flips);
  const foldedX = folded(raw.x);
  const foldedY = folded(raw.y);
  const steepest = (angle: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, angle));
  let x = steepest(foldedX.angle);
  let y = steepest(foldedY.angle);
  if (armed) {
    if (Math.hypot(x, y) < STRAIGHT_WITHIN) {
      x = 0;
      y = 0;
    } else {
      if (Math.abs(x) < AXIS_FLAT_WITHIN) x = 0;
      if (Math.abs(y) < AXIS_FLAT_WITHIN) y = 0;
    }
  }
  return { x: foldedX.over ? unfolded(x) : x, y: foldedY.over ? unfolded(y) : y };
};

/** A tilt dragged so far: whether its snaps catch it yet (it was out of straight once). */
export const tiltArmed = (
  armed: boolean,
  start: ElementTilt,
  dx: number,
  dy: number,
  perPx = TILT_PER_PX,
  flips = false,
) => armed || leftStraight(tiltRaw(start, dx, dy, perPx, flips));

type Drag = {
  kind: 'move' | 'turn' | 'tilt' | RectCorner;
  /** Where a point on screen lies on the slide (0–1), as the slide is seen when the drag began. */
  at: (x: number, y: number) => Point | null;
  /** The slide's width to its height. */
  aspect: number;
  /** Where the pointer was pressed: on screen (px) … */
  pointerX: number;
  pointerY: number;
  /** … and on the slide. */
  from: Point;
  /** Where on the handle it was grabbed, from the box's corner (on the slide) – the corner keeps that offset. */
  grab: Point;
  start: Rect;
  /** The turn when the drag began (degrees). */
  turn: number;
  /** A turn: the pointer's angle around the box's centre when it began (degrees). */
  angle: number;
  moved: boolean;
  /** A tilt: it was out of straight once, so it snaps from then on. */
  armed: boolean;
  /** A tilt: a drag on screen along the slide's own axes as it is seen (`slideAxes`). */
  axes: (dx: number, dy: number) => { dx: number; dy: number };
  /** A tilt: degrees per pixel, for the box as large as it is seen (`tiltPerPx`). */
  perPx: number;
  /** How it was mirrored when the drag began; `null`: it does not mirror. */
  flip: ElementFlip | null;
  /** The frame that holds the pointer. */
  frame: HTMLElement;
  /** The cursor the page shows while it is dragged (the grabbed handle's). */
  cursor: string;
  /** How close it is caught at a line, of the slide (`LINE_SNAP_PX` as the slide is seen). */
  tolerance: RectSize;
};

/** Pixels apart the slide's axes are measured on screen. */
const AXES_PX = 24;

/**
 * A drag on screen (`dx`/`dy`, px) turned to the slide's own axes as the slide is seen around
 * `x`/`y` – turned in depth (the layers), right on screen may run along its height; its length
 * kept. Seen flat, it stays as it is.
 */
const slideAxes = (
  at: (x: number, y: number) => Point | null,
  x: number,
  y: number,
  aspect: number,
) => {
  const origin = at(x, y);
  const right = at(x + AXES_PX, y);
  const down = at(x, y + AXES_PX);
  if (!origin || !right || !down) return (dx: number, dy: number) => ({ dx, dy });
  // Slide units per pixel on screen, both of the slide's height.
  const xx = ((right.x - origin.x) * aspect) / AXES_PX;
  const yx = (right.y - origin.y) / AXES_PX;
  const xy = ((down.x - origin.x) * aspect) / AXES_PX;
  const yy = (down.y - origin.y) / AXES_PX;
  return (dx: number, dy: number) => {
    const sx = xx * dx + xy * dy;
    const sy = yx * dx + yy * dy;
    const along = Math.hypot(sx, sy);
    const length = Math.hypot(dx, dy);
    return along > 0 ? { dx: (sx / along) * length, dy: (sy / along) * length } : { dx, dy };
  };
};

/** `tiltPerPx` of the frame as it is seen. */
const tiltPerPxOf = (frame: HTMLElement) => {
  const seen = frame.getBoundingClientRect();
  return tiltPerPx(seen.width, seen.height);
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** The angle (degrees) of a point around a box's centre, both on a slide of `aspect` – as seen. */
const angleAround = (box: Rect, point: Point, aspect: number) =>
  (Math.atan2(point.y - (box.y + box.h / 2), (point.x - (box.x + box.w / 2)) * aspect) * 180) /
  Math.PI;

export interface RectEditOptions {
  /**
   * Follows the box as shown while dragged (`null` once it is back to `rect`) – and its turn,
   * when it can be turned.
   */
  onPreview?: (rect: Rect | null, rotation?: number, flip?: ElementFlip) => void;
  /** Smallest box a resize leaves, relative to the slide. */
  minSize?: RectSize;
  /** Moved and resized only on the slide (else it may go off it, as a slide's elements may). */
  keepOnSlide?: boolean;
  /** A resize of the unturned box, caught where it should be (a text's own size). */
  snapResize?: (rect: Rect, start: Rect, corner: RectCorner) => Rect;
  /**
   * Lines it is caught at while moved or resized unturned (the guides, a layout grid) – its sides,
   * moved also its middle. ⌘ (Ctrl) held, it goes free.
   */
  snapLines?: SnapLines | null;
  /** The box is turned by this much (degrees clockwise, around its centre). */
  rotation?: number;
  /** It can be turned by its handle: the new turn; call `done` once it is stored. */
  onRotate?: (rotation: number, done: () => void) => void;
  /** Tilted in depth by this much (degrees around the slide's axes). */
  tilt?: ElementTilt | null;
  /**
   * Its turning handle dragged with ⇧, it tilts in depth – up and down around the horizontal axis, sideways around
   * the vertical one: the new tilt; call `done` once it is stored.
   */
  onTilt?: (tilt: ElementTilt, done: () => void, mirror?: ElementFlip) => void;
  /**
   * Follows the tilt as shown while dragged with ⇧ (`null` once it is back to `tilt`) – over the
   * edge (it `flip`s), beyond 90°.
   */
  onTiltPreview?: (tilt: ElementTilt | null) => void;
  /**
   * How it is mirrored – then it mirrors: a corner pulled over the opposite side (the new
   * mirroring comes with `onCommit`), tilted over the edge (`onTilt`'s `mirror`). `null` or left
   * out: it does not.
   */
  flip?: ElementFlip | null;
  /**
   * Where a point on screen lies on the slide (0–1) – for a slide not seen flat (turned in depth,
   * the layers); else the frame's offset parent is the slide box, as it is seen.
   */
  toSlide?: (x: number, y: number) => Point | null;
}

/**
 * Typing in the box when it is grabbed (its border, a corner, the turning handle): the text keeps
 * the focus and its caret – moved, resized, turned or tilted, typing goes on where it was.
 */
const keepTyping = (event: { preventDefault: () => void }) => {
  if (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable)
    event.preventDefault();
};

/**
 * Moving (drag the box) and resizing (drag a corner) a box on the slide, in normalised slide
 * coordinates. Shows the box as dragged until `onCommit`'s `done` – so it doesn't jump back
 * while the new place is stored. A press without a drag stays a click (`wasDragged` is false).
 * Every movable box on the slide (frames, the draft's box, text on the slide) goes through here,
 * so its badge and connector line follow it the same way (`onPreview`).
 */
export function useRectEdit(
  rect: Rect,
  /** Placed: its box – and, pulled over a side, how it is mirrored now (`flip`). */
  onCommit: (rect: Rect, done: () => void, flip?: ElementFlip) => void,
  {
    onPreview,
    minSize,
    snapResize,
    snapLines = null,
    keepOnSlide = true,
    rotation = 0,
    onRotate,
    tilt = null,
    onTilt,
    onTiltPreview,
    toSlide,
    flip = null,
  }: RectEditOptions = {},
) {
  const dragRef = useRef<Drag | null>(null);
  const draggedRef = useRef(false);
  const [preview, setPreviewState] = useState<Rect | null>(null);
  const previewRef = useRef<Rect | null>(null);
  const [turnPreview, setTurnPreview] = useState<number | null>(null);
  const turnRef = useRef<number | null>(null);
  const flipRef = useRef<ElementFlip | null>(null);
  const [flipShown, setFlipShown] = useState<ElementFlip | null>(null);
  const tiltRef = useRef<ElementTilt | null>(null);
  const [tiltShown, setTiltShown] = useState<ElementTilt | null>(null);
  const [caught, setCaught] = useState<string | null>(null);
  const onPreviewRef = useRef(onPreview);
  const onTiltPreviewRef = useRef(onTiltPreview);
  useLayoutEffect(() => {
    onPreviewRef.current = onPreview;
    onTiltPreviewRef.current = onTiltPreview;
  });
  const setTiltPreview = (next: ElementTilt | null) => {
    tiltRef.current = next;
    setTiltShown(next);
    onTiltPreviewRef.current?.(next);
  };
  const setPreview = (
    next: Rect | null,
    turn: number | null = null,
    mirrored: ElementFlip | null = null,
  ) => {
    previewRef.current = next;
    turnRef.current = next && turn;
    flipRef.current = next && mirrored;
    setPreviewState(next);
    setTurnPreview(next && turn);
    setFlipShown(next && mirrored);
    onPreviewRef.current?.(
      next,
      next && turn !== null ? turn : undefined,
      (next && mirrored) ?? undefined,
    );
  };
  // Each drag that gets going outdates the stores still pending of those before: only the last
  // one's puts the box back to what the deck says – an earlier one, stored slowly (the slide is
  // drawn anew), would take the box from under the pointer mid-drag, or drop the drag's place.
  const generationRef = useRef(0);
  const settled = () => {
    const generation = generationRef.current;
    return () => {
      if (generation !== generationRef.current) return;
      if (previewRef.current) setPreview(null);
      if (tiltRef.current) setTiltPreview(null);
    };
  };
  // Unmounted mid-drag (or before the commit settled): nothing is shown as dragged any more.
  useEffect(
    () => () => {
      if (previewRef.current) onPreviewRef.current?.(null);
      if (tiltRef.current) onTiltPreviewRef.current?.(null);
      if (dragRef.current) unlockPage(dragRef.current.frame);
    },
    [],
  );

  const start = (event: ReactPointerEvent<HTMLElement>, grabbed: Drag['kind']) => {
    if (event.button !== 0) return;
    // ⇧ on the turning handle tilts in depth instead, as ⇧ and dragging turns a slide in the layers.
    const kind = grabbed === 'turn' && event.shiftKey && onTilt ? 'tilt' : grabbed;
    const frame = event.currentTarget.closest<HTMLElement>(`[${FRAME_ATTR}]`);
    // The slide box: the annotation layer is the frame's offset parent.
    const parent = frame?.offsetParent;
    if (!frame || !(parent instanceof HTMLElement)) return;
    const slide = parent.getBoundingClientRect();
    if (parent.offsetWidth <= 0 || parent.offsetHeight <= 0 || slide.width <= 0) return;
    const at =
      toSlide ??
      ((x: number, y: number) => ({
        x: (x - slide.left) / slide.width,
        y: (y - slide.top) / slide.height,
      }));
    const pressed = at(event.clientX, event.clientY);
    if (!pressed) return;
    event.preventDefault();
    // The slide below must not start a comment of its own.
    event.stopPropagation();
    // Captured by the frame: a corner handle's moves reach it too.
    frame.setPointerCapture(event.pointerId);
    // A drag that ended without a click (cancelled) must not swallow the next one.
    draggedRef.current = false;
    const from = preview ?? rect;
    const turn = turnPreview ?? rotation;
    // Its laid-out size: the slide may be seen turned in depth.
    const aspect = parent.offsetWidth / parent.offsetHeight;
    // The corner doesn't jump to the pointer: a handle may sit off the corner (outside the box).
    const corner =
      kind === 'move' || kind === 'turn' || kind === 'tilt'
        ? null
        : turnedCorner(from, kind, turn, aspect);
    dragRef.current = {
      kind,
      at,
      aspect,
      pointerX: event.clientX,
      pointerY: event.clientY,
      from: pressed,
      grab: corner ? { x: pressed.x - corner.x, y: pressed.y - corner.y } : { x: 0, y: 0 },
      start: from,
      turn,
      angle: angleAround(from, pressed, aspect),
      moved: false,
      armed: leftStraight(tilt ?? { x: 0, y: 0 }),
      // Measured once, as the slide is seen now: what is tilted while dragged moves it no more.
      axes: slideAxes(at, event.clientX, event.clientY, aspect),
      perPx: tiltPerPxOf(frame),
      flip: flipRef.current ?? flip,
      frame,
      // A move shows its cursor once dragged, also where the box rests with the plain one.
      cursor:
        kind === 'tilt' || kind === 'turn'
          ? 'grabbing'
          : kind === 'move'
            ? 'move'
            : getComputedStyle(event.currentTarget).cursor || 'default',
      tolerance: { w: LINE_SNAP_PX / slide.width, h: LINE_SNAP_PX / Math.max(1, slide.height) },
    };
    // ⇧ held, it tilts from the press on: it rests straight for a while (snapped), yet it is
    // dragged already – its cursor stays, and nothing it passes over lights up.
    if (kind === 'tilt') lockPage(frame, dragRef.current.cursor);
  };

  const follow = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { aspect } = drag;
    const point = drag.at(event.clientX, event.clientY);
    if (!point) return;
    const dx = event.clientX - drag.pointerX;
    const dy = event.clientY - drag.pointerY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      lockPage(drag.frame, drag.cursor);
      generationRef.current += 1;
    }
    drag.moved = true;
    // Turning by its handle, ⇧ pressed or let go on the way switches to tilting and back – each
    // from where the pointer is then, the other one back to where it began.
    const switched = onTilt && (drag.kind === 'turn' || drag.kind === 'tilt');
    if (switched && (drag.kind === 'tilt') !== event.shiftKey) {
      setCaught(null);
      drag.pointerX = event.clientX;
      drag.pointerY = event.clientY;
      drag.from = point;
      if (event.shiftKey) {
        if (previewRef.current) setPreview(null);
        drag.kind = 'tilt';
        drag.armed = leftStraight(tilt ?? { x: 0, y: 0 });
        drag.axes = slideAxes(drag.at, event.clientX, event.clientY, aspect);
      } else {
        if (tiltRef.current) setTiltPreview(null);
        drag.kind = 'turn';
        drag.angle = angleAround(drag.start, point, aspect);
      }
      return;
    }
    if (drag.kind === 'tilt') {
      const from = tilt ?? { x: 0, y: 0 };
      // Along the slide as it is seen: the camera turned, its top still goes away pulled up it.
      const along = drag.axes(dx, dy);
      const flips = drag.flip !== null;
      drag.armed = tiltArmed(drag.armed, from, along.dx, along.dy, drag.perPx, flips);
      const tilted = tiltBy(from, along.dx, along.dy, drag.armed, drag.perPx, flips);
      setTiltPreview(tilted);
      // Caught flat again (or flat on its back, over the edge): it pulses as a straight turn does.
      const flat = (angle: number) => angle % 180 === 0;
      setCaught(
        drag.armed && flat(tilted.x) && flat(tilted.y) ? `flat${tilted.x},${tilted.y}` : null,
      );
      return;
    }
    const turning = onRotate ? drag.turn : null;
    if (drag.kind === 'turn') {
      const angle = angleAround(drag.start, point, aspect);
      // ⌥ turns in steps of 15°; else it snaps to the nearest 45° close by.
      const turn = snappedTurn(drag.turn + angle - drag.angle, event.altKey);
      setPreview(drag.start, turn);
      setCaught(event.altKey || turn % 45 === 0 ? `turn${turn}` : null);
      return;
    }
    // Unturned, caught at the lines close by – free with ⌘ (Ctrl).
    const snapping = snapLines && drag.turn === 0 && !event.metaKey && !event.ctrlKey;
    const onLines = (next: Rect, kind: RectCorner | 'move') => {
      if (!snapping || !snapLines) return next;
      const snapped = snappedToLines(next, drag.start, kind, snapLines, drag.tolerance);
      // A line that would make it smaller than it may be does not catch it.
      if (minSize && (snapped.rect.w < minSize.w || snapped.rect.h < minSize.h)) {
        setCaught(null);
        return next;
      }
      setCaught(snapped.caught && `line${snapped.caught}`);
      return snapped.rect;
    };
    if (!snapping) setCaught(null);
    if (drag.kind === 'move') {
      const next = moved(drag.start, point.x - drag.from.x, point.y - drag.from.y, keepOnSlide);
      setPreview(onLines(next, 'move'), turning);
      return;
    }
    let px = point.x - drag.grab.x;
    let py = point.y - drag.grab.y;
    // Free; with ⇧ it keeps to the nearest axis: the proportions near the diagonal, else only the
    // width or the height.
    if (event.shiftKey)
      ({ x: px, y: py } = axisLocked(
        drag.start,
        drag.kind,
        px,
        py,
        drag.turn,
        aspect,
        keepOnSlide,
      ));
    // Pulled over the opposite side, it mirrors that way.
    if (drag.flip) {
      const { rect: next, mirrored } = resizedThrough(
        drag.start,
        drag.kind,
        px,
        py,
        drag.turn,
        aspect,
        minSize,
      );
      // Not pulled over a side, its pulled sides are those of the corner.
      const through = mirrored.x || mirrored.y;
      setPreview(through ? next : onLines(next, drag.kind), turning, {
        x: drag.flip.x !== mirrored.x,
        y: drag.flip.y !== mirrored.y,
      });
    } else if (drag.turn === 0) {
      const next = resized(drag.start, drag.kind, px, py, minSize, keepOnSlide);
      const onGrid = onLines(next, drag.kind);
      setPreview(snapResize ? snapResize(onGrid, drag.start, drag.kind) : onGrid, turning);
    } else {
      setPreview(resizedTurned(drag.start, drag.kind, px, py, drag.turn, aspect, minSize), turning);
    }
  };

  // Drawn before the browser paints this frame: left to React's scheduler, a move would show one
  // frame late – the box trailing the pointer.
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => flushSync(() => follow(event));

  const end = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) unlockPage(drag.frame);
    setCaught(null);
    if (drag?.kind === 'tilt') {
      const shown = tiltRef.current;
      if (!drag.moved || !shown) return;
      draggedRef.current = true;
      // Over the edge: stored mirrored, tilted back by half a turn.
      const { tilt: next, mirror } = overTheEdge(shown);
      const same = !mirror && next.x === (tilt?.x ?? 0) && next.y === (tilt?.y ?? 0);
      if (same || !onTilt) settled()();
      else onTilt(next, settled(), mirror ?? undefined);
      return;
    }
    const placed = previewRef.current;
    if (!drag?.moved || !placed) return;
    draggedRef.current = true;
    if (drag.kind === 'turn') {
      const turn = turnRef.current ?? drag.turn;
      if (turn === drag.turn || !onRotate) settled()();
      else onRotate(turn, settled());
      return;
    }
    const mirrored = flipRef.current;
    onCommit(
      { x: round(placed.x), y: round(placed.y), w: round(placed.w), h: round(placed.h) },
      settled(),
      mirrored && drag.flip && (mirrored.x !== drag.flip.x || mirrored.y !== drag.flip.y)
        ? mirrored
        : undefined,
    );
  };

  return {
    /** The box as shown: as dragged, else `rect`. */
    rect: preview ?? rect,
    /** Its turn as shown: as dragged, else `rotation`. */
    rotation: turnPreview ?? rotation,
    /** Its tilt as shown: as dragged with ⇧, else `tilt`. */
    tilt: tiltShown ?? tilt,
    /** How it is mirrored as shown: as dragged, else `flip`. */
    flip: flipShown ?? flip,
    dragging: preview !== null || tiltShown !== null,
    /**
     * The turn it is caught at while turned (at 45°, or a step with ⌥), flat again while tilted,
     * or the lines it is caught at while moved or resized – a new key for each new catch; `null`: free.
     */
    caught,
    /** Spread on the box: dragging it moves it. */
    boxProps: {
      onMouseDown: keepTyping,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => start(event, 'move'),
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
    /** Spread on the turning handle. */
    turnProps: {
      onMouseDown: keepTyping,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => start(event, 'turn'),
    },
    /** Spread on a corner handle. */
    cornerProps: (corner: RectCorner) => ({
      onMouseDown: keepTyping,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => start(event, corner),
    }),
    /** True once after a drag: the click that ends it is no click. */
    wasDragged: () => {
      const dragged = draggedRef.current;
      draggedRef.current = false;
      return dragged;
    },
  };
}
