import { isCentredGradient, stopOpacity, type GradientStop } from '@slider/shared';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  alongLine,
  angleTowards,
  colorAt,
  stopAt as stopOfGradient,
  handleLine,
  stopsBetween,
  stopsOnLine,
  type GradientLayer,
} from '../editing/fills/gradient';
import { useGradientTarget, type GradientTarget } from '../editing/fills/gradient-target';
import { useSnapLines } from '../template/useSnapLines';
import { DOME_RADIUS } from './lib/frame-outline';

/** Most stops a gradient has (as the file's schema). */
const MAX_STOPS = 8;
/** ⌥ snaps a direction to steps of this many degrees (as the turning handle). */
const SNAP = 15;
/** How near the line (px) its colours grow. */
const LINE_REACH = 18;
/** How far (px) the line may reach past its box – never out of reach, zoomed out too. */
const OVERHANG = 32;
/*
 * The gradient's chrome is no accent, as Linear draws such lines: a cased line with a soft shadow
 * and round knobs – in the light theme white with a dark shadow, in the dark one the other way
 * round –, so it shows on any slide, white or black. The theme's own pair: `primary` and what is
 * drawn on it.
 */
const CORE = 'var(--color-on-primary)';
/**
 * The casing around everything drawn, in the other tone: a stroke of its own (a drop shadow's
 * hairline vanished on the canvas around the slide, where the line's ends reach past it, and
 * zoomed out) – the core tone shows on light, the casing on dark.
 */
const CASE = 'var(--color-primary)';
/** How far (px) the casing shows either side of what it cases. */
const CASE_W = 1.25;
/** A soft shadow under it all. */
const HALO = 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))';
/** Knob sizes (radius, px): small always, larger with the pointer near. */
const END_R = { rest: 4.5, near: 7 };
const STOP_R = { rest: 3.5, near: 5 };
/** Grows and shrinks as the frame's brackets do. */
const KNOB_EASE = 'r 160ms cubic-bezier(0.22, 1, 0.36, 1)';

/** How near (screen px) a dragged end is caught at a line. */
const SNAP_REACH = 8;
/** How far around an end it is grabbed (px) – also a colour sitting there. */
const GRAB = 13;

type End = 'start' | 'end';

/**
 * How near the pointer grows an end's knob (px): as a frame's turning dome opens – from one dome's
 * width for a small box to five for a large one (`side`: its shorter side on screen).
 */
const reach = (side: number) => Math.min(5, Math.max(1, side / 50)) * 2 * DOME_RADIUS;

/** How far (px) the line may reach past each side of its box. */
type Room = { left: number; top: number; right: number; bottom: number };
const FULL_ROOM: Room = { left: OVERHANG, top: OVERHANG, right: OVERHANG, bottom: OVERHANG };

/**
 * The room past an unturned box (`box`: its place in the window, px): `OVERHANG`, or less where
 * the window ends sooner – an end stays where it can be grabbed. A turned box keeps `OVERHANG`.
 */
function roomIn(box: { left: number; top: number; right: number; bottom: number }): Room {
  const fit = (space: number) => Math.max(0, Math.min(OVERHANG, space - GRAB));
  return {
    left: fit(box.left),
    top: fit(box.top),
    right: fit(window.innerWidth - box.right),
    bottom: fit(window.innerHeight - box.bottom),
  };
}

/** How far (px) a linear gradient's handles lie beside the line through the box's middle. */
type Offset = { x: number; y: number };
const NO_OFFSET: Offset = { x: 0, y: 0 };

/**
 * Where a linear gradient's handles were dropped beside the line through the box's middle (as
 * fractions of the box) – the file knows only the direction; forgotten once the gradient turns
 * otherwise or another box shows its handles.
 */
type Dropped = { key: string; angle: number; x: number; y: number };
const placeKey = (now: GradientTarget) =>
  `${now.slideId}:${now.box.x}:${now.box.y}:${now.box.w}:${now.box.h}`;
const offsetOf = (at: Dropped | null, now: GradientTarget, w: number, h: number): Offset =>
  at && at.key === placeKey(now) && at.angle === now.layer.angle
    ? { x: at.x * w, y: at.y * h }
    : NO_OFFSET;

/**
 * Where an end was dropped past what the file can hold: its line runs from edge to edge of the box
 * (0–1), what lies past is cut off there in the colour it has there (`stopsOnLine`) – the handles
 * stay where dropped, `t0`/`t1` along the line, with the colours between them (`between`, 0–1
 * from end to end) as they were. Forgotten once the file's gradient is other than written.
 */
type Stretch = {
  key: string;
  kind: GradientLayer['kind'];
  angle: number;
  t0: number;
  t1: number;
  between: GradientStop[];
  /** The stops written to the file. */
  stops: GradientStop[];
};
const sameStops = (a: readonly GradientStop[], b: readonly GradientStop[]) =>
  a.length === b.length &&
  a.every(
    (stop, i) =>
      stop.color.toLowerCase() === b[i]!.color.toLowerCase() &&
      Math.abs(stop.at - b[i]!.at) < 0.002 &&
      Math.abs(stopOpacity(stop) - stopOpacity(b[i]!)) < 0.01,
  );
const stretchOf = (at: Stretch | null, now: GradientTarget): Stretch | null =>
  at &&
  at.key === placeKey(now) &&
  at.kind === now.layer.kind &&
  at.angle === now.layer.angle &&
  sameStops(at.stops, now.layer.stops)
    ? at
    : null;
/** Whether ends at `t0`/`t1` lie past what the file holds. */
const pastEdges = (t0: number, t1: number) => t0 < -1e-3 || t1 > 1 + 1e-3;

/**
 * The handles of a gradient in its `w` × `h` box, as a design tool has them: where its first and
 * its last colour sit – a linear one's start and end anywhere, one from a middle out (axial, or
 * from a centre) from there to where it ends. Along the file's line (`handleLine`: 0–1 as the
 * colours sit), a linear one's moved `offset` beside it – where it was dropped: it draws the same
 * anywhere across. The handles reach no further than the room past the box (`from`, `to`: where
 * along the line they are, then) – unless dropped further (`stretch`): there; a colour sits
 * where it shows.
 */
function handleGeometry(
  layer: GradientLayer,
  w: number,
  h: number,
  room: Room = FULL_ROOM,
  offset: Offset = NO_OFFSET,
  stretch: Stretch | null = null,
) {
  const line = handleLine(layer, w, h);
  const linear = layer.kind === 'linear';
  const off = linear ? offset : NO_OFFSET;
  const base = { x: line.x0 + off.x, y: line.y0 + off.y };
  const dx = line.x1 - line.x0;
  const dy = line.y1 - line.y0;
  const ats = layer.stops.map((stop) => stop.at);
  let first = linear ? Math.min(...ats) : 0;
  let last = Math.max(...ats);
  if (last - first < 0.01) {
    first = 0;
    last = 1;
  }
  let from = first;
  let to = last;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) from = Math.max(from, t);
    else to = Math.min(to, t);
    return true;
  };
  const inside =
    clip(-dx, base.x + room.left) &&
    clip(dx, w + room.right - base.x) &&
    clip(-dy, base.y + room.top) &&
    clip(dy, h + room.bottom - base.y);
  if (!inside || to - from < 1e-6) {
    from = first;
    to = last;
  }
  if (stretch) {
    from = stretch.t0;
    to = stretch.t1;
  }
  const point = (t: number) => ({ x: base.x + dx * t, y: base.y + dy * t });
  return {
    start: point(from),
    end: point(to),
    from,
    to,
    /** Where a colour at `at` shows. */
    at: point,
    /** Where along the line (as the colours sit) a point is. */
    along: (x: number, y: number) =>
      alongLine({ x0: base.x, y0: base.y, x1: base.x + dx, y1: base.y + dy }, x, y),
  };
}

/**
 * The gradient changed in a panel, over what it fills on this slide, in the frame's look: one cased
 * line along which it runs. Its ends open into rings as the pointer comes near – as the turning
 * dome does –, each dragged anywhere as in a design tool: a linear gradient's start and end, the
 * other end staying (its direction ⌥ in 15° steps); one from a middle out its end, how far and
 * which way it reaches; at the start of one out from a centre, that centre. Near the line its
 * colours show as points on it, dragged along it, picked by a click – a click on the line adds a
 * colour there.
 */
export function GradientHandles({ slideId, color }: { slideId: string; color: string }) {
  const target = useGradientTarget(slideId);
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [room, setRoom] = useState<Room>(FULL_ROOM);
  const roomNow = useRef(room);
  const [near, setNear] = useState({ start: false, end: false, line: false });
  const [dragging, setDragging] = useState<End | 'stop' | null>(null);
  const [hoverless] = useState(() => window.matchMedia('(hover: none)').matches);
  const latest = useRef(target);
  // The slide's own lines, guides and layout lines as shown – as a box is caught at them.
  const snapLines = useSnapLines(slideId);
  const lines = useRef(snapLines);
  const [caught, setCaught] = useState<{ x: number | null; y: number | null } | null>(null);
  const [dropped, setDropped] = useState<Dropped | null>(null);
  const droppedNow = useRef(dropped);
  const [stretched, setStretched] = useState<Stretch | null>(null);
  const stretchedNow = useRef(stretched);
  /** Remembers ends dropped past the box – now, for the next move in the same drag too. */
  const stretchTo = (next: Stretch | null) => {
    stretchedNow.current = next;
    setStretched(next);
  };
  useLayoutEffect(() => {
    latest.current = target;
    droppedNow.current = dropped;
    stretchedNow.current = stretched;
    lines.current = snapLines;
    roomNow.current = room;
  });
  /** The room past the box as it lies in the window now (`roomIn`). */
  const measureRoom = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    const now = latest.current;
    if (!rect || !now) return;
    const next =
      now.rotation === 0
        ? roomIn({
            left: rect.left + now.box.x * rect.width,
            top: rect.top + now.box.y * rect.height,
            right: rect.left + (now.box.x + now.box.w) * rect.width,
            bottom: rect.top + (now.box.y + now.box.h) * rect.height,
          })
        : FULL_ROOM;
    setRoom((was) =>
      was.left === next.left &&
      was.top === next.top &&
      was.right === next.right &&
      was.bottom === next.bottom
        ? was
        : next,
    );
  };

  const shown = target !== null;
  useLayoutEffect(() => {
    if (!shown) return;
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      setSize({ width: root.clientWidth, height: root.clientHeight });
      measureRoom();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [shown]);

  /**
   * A dragged end's pointer caught at the nearest line either way – the slide's edges and middles,
   * the guides and layout lines shown – within reach; `caught`: the lines it lies on.
   */
  const snapped = (event: { clientX: number; clientY: number }) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { point: event, caught: null };
    const nearest = (at: number, all: readonly number[], side: number) => {
      let best: number | null = null;
      for (const line of all)
        if (
          Math.abs(line - at) * side <= SNAP_REACH &&
          (best === null || Math.abs(line - at) < Math.abs(best - at))
        )
          best = line;
      return best;
    };
    const x = nearest((event.clientX - rect.left) / rect.width, lines.current.x, rect.width);
    const y = nearest((event.clientY - rect.top) / rect.height, lines.current.y, rect.height);
    return {
      point: {
        clientX: x === null ? event.clientX : rect.left + x * rect.width,
        clientY: y === null ? event.clientY : rect.top + y * rect.height,
      },
      caught: x === null && y === null ? null : { x, y },
    };
  };

  /** A pointer's place in the box's own (unturned) pixels, and the box's size. */
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const now = latest.current;
    if (!rect || !now) return null;
    const w = now.box.w * rect.width;
    const h = now.box.h * rect.height;
    const dx = event.clientX - rect.left - (now.box.x * rect.width + w / 2);
    const dy = event.clientY - rect.top - (now.box.y * rect.height + h / 2);
    const radians = (-now.rotation * Math.PI) / 180;
    return {
      x: dx * Math.cos(radians) - dy * Math.sin(radians) + w / 2,
      y: dx * Math.sin(radians) + dy * Math.cos(radians) + h / 2,
      w,
      h,
    };
  };

  // What the pointer is near: the ends open, the colours show.
  useEffect(() => {
    if (!shown || hoverless) return;
    let frame = 0;
    let at: { clientX: number; clientY: number } | null = null;
    const measure = () => {
      frame = 0;
      // The slide may have moved since (panned, zoomed): the room past it with it.
      measureRoom();
      const point = at && local(at);
      const now = latest.current;
      let next = { start: false, end: false, line: false };
      if (point && now) {
        const part = handleGeometry(
          now.layer,
          point.w,
          point.h,
          roomNow.current,
          offsetOf(droppedNow.current, now, point.w, point.h),
          stretchOf(stretchedNow.current, now),
        );
        const far = reach(Math.min(point.w, point.h));
        const to = (p: { x: number; y: number }) => Math.hypot(point.x - p.x, point.y - p.y);
        const { start, end } = part;
        const length = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
        const t =
          length === 0
            ? 0
            : Math.min(
                1,
                Math.max(
                  0,
                  ((point.x - start.x) * (end.x - start.x) +
                    (point.y - start.y) * (end.y - start.y)) /
                    length,
                ),
              );
        const foot = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
        next = {
          start: to(start) <= far,
          end: to(end) <= far,
          line: to(foot) <= LINE_REACH,
        };
      }
      setNear((was) =>
        was.start === next.start && was.end === next.end && was.line === next.line ? was : next,
      );
    };
    const follow = (event: PointerEvent) => {
      at = { clientX: event.clientX, clientY: event.clientY };
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      at = null;
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener('pointermove', follow, { passive: true });
    document.addEventListener('pointerout', leave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', follow);
      document.removeEventListener('pointerout', leave);
    };
    // `local` reads refs only.
  }, [shown, hoverless]);

  const centred = target ? isCentredGradient(target.layer.kind) : false;
  // An axial gradient's start is its middle: nothing to drag there.
  const startHandle = target?.layer.kind !== 'axial';
  if (!target) return null;

  const { box, rotation, layer, picked } = target;
  const w = box.w * size.width;
  const h = box.h * size.height;
  // While dragged, as last dropped: the file's gradient reaches here a frame later.
  const stretch =
    dragging && stretched?.key === placeKey(target) && stretched.kind === layer.kind
      ? stretched
      : stretchOf(stretched, target);
  const part = handleGeometry(layer, w, h, room, offsetOf(dropped, target, w, h), stretch);

  /** Follows the pointer until it lets go, `move` taking each place – an end's caught at lines. */
  const drag = (
    event: ReactPointerEvent,
    what: End | 'stop',
    move: (
      point: NonNullable<ReturnType<typeof local>>,
      event: PointerEvent,
      now: GradientTarget,
    ) => void,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    // Ends dropped past the box once, the gradient changed since (in the panel): forgotten. (A
    // colour's drag says itself whether they hold – one just added is not in the file yet.)
    if (what !== 'stop' && latest.current && !stretchOf(stretchedNow.current, latest.current))
      stretchTo(null);
    setDragging(what);
    const onMove = (next: PointerEvent) => {
      // An end goes anywhere in the window – where it can be grabbed again.
      const held = {
        clientX: Math.min(window.innerWidth - GRAB, Math.max(GRAB, next.clientX)),
        clientY: Math.min(window.innerHeight - GRAB, Math.max(GRAB, next.clientY)),
      };
      const caughtAt = what === 'stop' ? null : snapped(held);
      setCaught((was) =>
        was?.x === caughtAt?.caught?.x && was?.y === caughtAt?.caught?.y
          ? was
          : (caughtAt?.caught ?? null),
      );
      const point = local(caughtAt?.point ?? next);
      if (point && latest.current) move(point, next, latest.current);
    };
    const onUp = () => {
      setDragging(null);
      setCaught(null);
      element.removeEventListener('pointermove', onMove as EventListener);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
    };
    element.addEventListener('pointermove', onMove as EventListener);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
  };
  /** Where along the line (0–1, as its colours sit) a point is. */
  const stopAt = (point: { x: number; y: number; w: number; h: number }, now: GradientTarget) => {
    const geometry = handleGeometry(
      now.layer,
      point.w,
      point.h,
      roomNow.current,
      offsetOf(droppedNow.current, now, point.w, point.h),
      stretchOf(stretchedNow.current, now),
    );
    const t = geometry.along(point.x, point.y);
    return Math.round(Math.min(1, Math.max(0, t)) * 1000) / 1000;
  };

  /**
   * Drags an end anywhere, the other staying where it shows: the gradient runs from one to the
   * other with its colours between them as they were – in the file a direction and the colours
   * laid onto its line (`stopsOnLine`).
   */
  const moveEnd = (event: ReactPointerEvent, which: End) => {
    const sitting = layer.stops.findIndex(
      (stop) => Math.abs(stop.at - (which === 'start' ? part.from : part.to)) < 0.002,
    );
    if (sitting !== -1) target.pick(sitting);
    // As it was when grabbed: each move starts from there, nothing creeps. Dropped past the box
    // before, its colours as they were between the ends – the file holds only what is inside.
    const between = stretch?.between ?? stopsBetween(layer.stops, part.from, part.to);
    const staying = which === 'end' ? part.start : part.end;
    drag(event, which, (point, move, now) => {
      const linear = now.layer.kind === 'linear';
      const p0 = which === 'end' ? staying : point;
      const p1 = which === 'end' ? point : staying;
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 2) return;
      let angle = linear
        ? (Math.atan2(p1.x - p0.x, -(p1.y - p0.y)) * 180) / Math.PI
        : angleTowards(now.layer, p1.x, p1.y, point.w, point.h);
      angle = ((angle % 360) + 360) % 360;
      if (move.altKey) angle = (Math.round(angle / SNAP) * SNAP) % 360;
      angle = Math.round(angle * 10) / 10;
      const turned = { ...now.layer, angle };
      const line = handleLine(turned, point.w, point.h);
      const t0 = linear ? alongLine(line, p0.x, p0.y) : 0;
      const t1 = alongLine(line, p1.x, p1.y);
      if (t1 - t0 < 1e-3) return;
      if (linear && point.w > 0 && point.h > 0) {
        // The start's place beside the line through the middle: the handles stay where dropped.
        const foot = {
          x: line.x0 + (line.x1 - line.x0) * t0,
          y: line.y0 + (line.y1 - line.y0) * t0,
        };
        const next = {
          key: placeKey(now),
          angle,
          x: (p0.x - foot.x) / point.w,
          y: (p0.y - foot.y) / point.h,
        };
        droppedNow.current = next;
        setDropped(next);
      }
      const stops = stopsOnLine(between, t0, t1);
      stretchTo(
        pastEdges(t0, t1)
          ? { key: placeKey(now), kind: now.layer.kind, angle, t0, t1, between, stops }
          : null,
      );
      now.change({ ...turned, stops }, 'gradient-angle');
    });
  };
  /**
   * Drags colour `j` of ends dropped past the box (`was`) along the line, between the ends: the
   * file's stops laid anew from them, the colour picked where it lands among them.
   */
  const moveBetween = (event: ReactPointerEvent, j: number, was: Stretch) => {
    const moved = was.between[j] as GradientStop;
    const span = was.t1 - was.t0;
    drag(event, 'stop', (point, _move, now) => {
      // Inside the box, as a colour of the file: past its edges it would be cut off.
      const t = stopAt(point, now);
      const at = Math.round(Math.min(1, Math.max(0, (t - was.t0) / span)) * 1000) / 1000;
      const between = was.between.map((stop, i) => (i === j ? { ...stop, at } : stop));
      const stops = stopsOnLine(between, was.t0, was.t1);
      stretchTo({ ...was, between, stops });
      now.change({ ...now.layer, stops }, 'stop');
      const index = stops.findIndex(
        (stop) => stop.color === moved.color && Math.abs(stop.at - (was.t0 + at * span)) < 0.002,
      );
      if (index !== -1 && index !== now.picked) now.pick(index);
    });
  };
  /** Colour `index` of the file among the colours between ends dropped past the box. */
  const betweenIndex = (index: number) => {
    const stop = layer.stops[index];
    if (!stretch || !stop) return -1;
    const { between, t0, t1 } = stretch;
    return between.findIndex(
      (other, j) =>
        j > 0 &&
        j < between.length - 1 &&
        other.color === stop.color &&
        Math.abs(t0 + other.at * (t1 - t0) - stop.at) < 0.002,
    );
  };
  const moveCentre = (event: ReactPointerEvent) =>
    drag(event, 'start', (point, _move, now) => {
      if (point.w === 0 || point.h === 0) return;
      const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
      now.change(
        { ...now.layer, center: { x: clamp(point.x / point.w), y: clamp(point.y / point.h) } },
        'gradient-center',
      );
    });
  /** Drags stop `index` along the line – `added`: the layer with it, until the panel has it. */
  const moveStop = (event: ReactPointerEvent, index: number, added?: GradientLayer) => {
    target.pick(index);
    const j = added || !stretch ? -1 : betweenIndex(index);
    if (stretch && j !== -1) return moveBetween(event, j, stretch);
    stretchTo(null);
    drag(event, 'stop', (point, _move, now) => {
      const base = now.layer.stops.length > index ? now.layer : added;
      if (!base) return;
      const at = stopAt(point, { ...now, layer: base });
      now.change(
        { ...base, stops: base.stops.map((stop, i) => (i === index ? { ...stop, at } : stop)) },
        'stop',
      );
    });
  };
  /** A press on the line adds a colour there, of the colour it has there – dragged on from there. */
  const addStop = (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const point = local(event);
    if (!point || layer.stops.length >= MAX_STOPS) return;
    const at = stopAt(point, target);
    if (stretch) {
      // Among the colours between ends dropped past the box: they stay where they are.
      const span = stretch.t1 - stretch.t0;
      const u = Math.round(Math.min(1, Math.max(0, (at - stretch.t0) / span)) * 1000) / 1000;
      const between = [...stretch.between, stopOfGradient(stretch.between, u)];
      const stops = stopsOnLine(between, stretch.t0, stretch.t1);
      const next = { ...stretch, between, stops };
      stretchTo(next);
      target.change({ ...layer, stops });
      const index = stops.findIndex((stop) => Math.abs(stop.at - at) < 0.002);
      if (index !== -1) target.pick(index);
      moveBetween(event, between.length - 1, next);
      return;
    }
    const added = { ...layer, stops: [...layer.stops, stopOfGradient(layer.stops, at)] };
    target.change(added);
    moveStop(event, layer.stops.length, added);
  };

  const { start, end } = part;
  const big = {
    start: hoverless || near.start || dragging === 'start',
    end: hoverless || near.end || dragging === 'end',
    stops: hoverless || near.line || dragging !== null,
  };
  /** Whether a point lies on an end that is grabbed (an axial gradient's start is not). */
  const atEnd = (point: { x: number; y: number }) =>
    Math.hypot(point.x - end.x, point.y - end.y) < GRAB ||
    (startHandle && Math.hypot(point.x - start.x, point.y - start.y) < GRAB);
  /** Whether a stop sits at `at` (an end). */
  const atPoint = (stop: { at: number }, at: { x: number; y: number }) => {
    const point = part.at(stop.at);
    return Math.hypot(point.x - at.x, point.y - at.y) < GRAB;
  };
  /** The colour an end shows: the gradient's there. */
  const endColor = (which: End) =>
    stretch
      ? colorAt(stretch.between, which === 'start' ? 0 : 1)
      : colorAt(layer.stops, which === 'start' ? part.from : part.to);
  /**
   * Whether a colour lies on the part of the line shown – not one the file holds only as the cut
   * at the box's edge of ends dropped past it.
   */
  const onShown = (stop: { at: number }) =>
    stop.at >= part.from - 1e-3 &&
    stop.at <= part.to + 1e-3 &&
    !(stretch && ((stretch.t0 < 0 && stop.at < 1e-3) || (stretch.t1 > 1 && stop.at > 1 - 1e-3)));
  const swallow = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-20 overflow-visible"
      data-gradient-handles
    >
      {size.width > 0 && (
        <svg
          className="absolute inset-0 size-full overflow-visible"
          onClick={swallow}
          onDoubleClick={swallow}
          onContextMenu={swallow}
        >
          {/* The lines a dragged end is caught at, across the slide. */}
          {caught?.x != null && (
            <line
              x1={caught.x * size.width}
              x2={caught.x * size.width}
              y1={0}
              y2={size.height}
              stroke={color}
              strokeWidth={1}
              strokeOpacity={0.8}
            />
          )}
          {caught?.y != null && (
            <line
              x1={0}
              x2={size.width}
              y1={caught.y * size.height}
              y2={caught.y * size.height}
              stroke={color}
              strokeWidth={1}
              strokeOpacity={0.8}
            />
          )}
          <g
            transform={`translate(${box.x * size.width} ${box.y * size.height}) rotate(${rotation} ${w / 2} ${h / 2})`}
          >
            <g style={{ filter: HALO }}>
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={CASE}
                strokeWidth={1.5 + 2 * CASE_W}
                strokeLinecap="round"
              />
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={CORE}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            </g>
            {/* Wider than it shows: a click on the line adds a colour there. */}
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="transparent"
              strokeWidth={12}
              className="pointer-events-auto cursor-copy"
              onPointerDown={addStop}
            >
              <title>Klicken oder ziehen: Farbe hinzufügen</title>
            </line>
            {layer.stops.map((stop, index) => {
              const point = part.at(stop.at);
              // One sitting at an end is that end's knob; one past the room shows no knob.
              if (!onShown(stop) || atEnd(point)) return null;
              const on = index === picked;
              const r = big.stops ? STOP_R.near : STOP_R.rest;
              return (
                <g
                  key={index}
                  className="pointer-events-auto cursor-ew-resize"
                  onPointerDown={(event) => moveStop(event, index)}
                >
                  <title>{`Farbe bei ${Math.round(stop.at * 100)} %`}</title>
                  {/* Larger to grab than it shows. */}
                  <circle cx={point.x} cy={point.y} r={9} fill="transparent" />
                  <Knob x={point.x} y={point.y} r={r} fill={stop.color} picked={on} />
                </g>
              );
            })}
            {/* The ends, over the colours: small always, larger near – filled with their colour. */}
            {startHandle && (
              <Knob
                x={start.x}
                y={start.y}
                r={big.start ? END_R.near : END_R.rest}
                fill={endColor('start')}
                picked={layer.stops.findIndex((stop) => atPoint(stop, start)) === picked}
                end
              />
            )}
            <Knob
              x={end.x}
              y={end.y}
              r={big.end ? END_R.near : END_R.rest}
              fill={endColor('end')}
              picked={layer.stops.findIndex((stop) => atPoint(stop, end)) === picked}
              end
            />
            {/* The ends to grab, over the colours: each moved anywhere (a centre moved), always. */}
            {startHandle && (
              <circle
                cx={start.x}
                cy={start.y}
                r={GRAB}
                fill="transparent"
                className="pointer-events-auto cursor-move"
                onPointerDown={(event) => (centred ? moveCentre(event) : moveEnd(event, 'start'))}
              >
                <title>
                  {centred
                    ? 'Mitte verschieben'
                    : 'Anfang verschieben (⌥: Richtung in 15°-Schritten)'}
                </title>
              </circle>
            )}
            <circle
              cx={end.x}
              cy={end.y}
              r={GRAB}
              fill="transparent"
              className="pointer-events-auto cursor-move"
              onPointerDown={(event) => moveEnd(event, 'end')}
            >
              <title>Ende verschieben (⌥: Richtung in 15°-Schritten)</title>
            </circle>
          </g>
        </svg>
      )}
    </div>
  );
}

/**
 * A knob on the line, as Linear draws them: its colour in a ring of the theme's core tone, cased
 * in the other tone, a soft shadow around; the one picked with a second ring. An end's ring is thicker.
 */
function Knob({
  x,
  y,
  r,
  fill,
  picked,
  end = false,
}: {
  x: number;
  y: number;
  r: number;
  fill: string;
  picked: boolean;
  end?: boolean;
}) {
  const ring = end ? 2 : 1.5;
  return (
    <g className="pointer-events-none" style={{ filter: HALO }}>
      {picked && (
        <>
          <circle
            cx={x}
            cy={y}
            fill="none"
            stroke={CASE}
            strokeWidth={1.25 + 2 * CASE_W}
            style={{ r: r + 4, transition: KNOB_EASE }}
          />
          <circle
            cx={x}
            cy={y}
            fill="none"
            stroke={CORE}
            strokeWidth={1.25}
            style={{ r: r + 4, transition: KNOB_EASE }}
          />
        </>
      )}
      {/* The casing: a disc just past the ring. */}
      <circle
        cx={x}
        cy={y}
        fill={CASE}
        style={{ r: r + ring / 2 + CASE_W, transition: KNOB_EASE }}
      />
      <circle
        cx={x}
        cy={y}
        fill={fill}
        stroke={CORE}
        strokeWidth={ring}
        style={{ r, transition: KNOB_EASE }}
      />
    </g>
  );
}
