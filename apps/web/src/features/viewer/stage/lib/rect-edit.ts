import {
  clamp,
  isTurned,
  rectFromPoints,
  turnedCorners,
  type Point,
  type Rect,
  type TurnedBox,
} from '@slider/shared';

/** Pure geometry of moving and resizing a box on the slide (normalised 0–1 coordinates). */

export type RectCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface RectSize {
  w: number;
  h: number;
}

/** How close (screen pixels) a box is caught at a line (`snappedToLines`, `drawnRect`). */
export const LINE_SNAP_PX = 6;

/** Smallest box a resize leaves, relative to the slide. */
export const MIN_RECT_SIZE: RectSize = { w: 0.02, h: 0.02 };

/**
 * `start` moved by the pointer delta (`dx`, `dy` relative to the slide) – kept on the slide unless
 * not `bounded` (an element of the slide may lie partly or wholly off it).
 */
export function moved(start: Rect, dx: number, dy: number, bounded = true): Rect {
  if (!bounded) return { ...start, x: start.x + dx, y: start.y + dy };
  return {
    ...start,
    x: clamp(start.x + dx, 0, 1 - start.w),
    y: clamp(start.y + dy, 0, 1 - start.h),
  };
}

/** `start` with `corner` dragged to (`px`, `py`), the opposite corner fixed – on the slide if `bounded`. */
export function resized(
  start: Rect,
  corner: RectCorner,
  px: number,
  py: number,
  min: RectSize = MIN_RECT_SIZE,
  bounded = true,
): Rect {
  const x = bounded ? clamp(px, 0, 1) : px;
  const y = bounded ? clamp(py, 0, 1) : py;
  let { x: left, y: top } = start;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (corner === 'nw' || corner === 'sw') left = Math.min(x, right - min.w);
  else right = Math.max(x, left + min.w);
  if (corner === 'nw' || corner === 'ne') top = Math.min(y, bottom - min.h);
  else bottom = Math.max(y, top + min.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** A vector turned clockwise (as seen on the y-down slide) by `degrees`. */
function turned(x: number, y: number, degrees: number): { x: number; y: number } {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * Where `corner` of `rect` turned by `rotation` (degrees clockwise, around its centre) lies on
 * the slide. `aspect`: the slide's width over its height – turning happens in true proportions.
 */
export function turnedCorner(
  rect: Rect,
  corner: RectCorner,
  rotation: number,
  aspect: number,
): { x: number; y: number } {
  const sx = corner.endsWith('e') ? 1 : -1;
  const sy = corner.startsWith('s') ? 1 : -1;
  const offset = turned((sx * rect.w * aspect) / 2, (sy * rect.h) / 2, rotation);
  return {
    x: rect.x + rect.w / 2 + offset.x / aspect,
    y: rect.y + rect.h / 2 + offset.y,
  };
}

/**
 * `start`, turned by `rotation`, with `corner` dragged to (`px`, `py`) – the opposite corner
 * fixed where it is on the slide, the box keeping its turn. Not kept on the slide: a turned box
 * may reach over its edge.
 */
export function resizedTurned(
  start: Rect,
  corner: RectCorner,
  px: number,
  py: number,
  rotation: number,
  aspect: number,
  min: RectSize = MIN_RECT_SIZE,
): Rect {
  const sx = corner.endsWith('e') ? 1 : -1;
  const sy = corner.startsWith('s') ? 1 : -1;
  const opposite = `${sy > 0 ? 'n' : 's'}${sx > 0 ? 'w' : 'e'}` as RectCorner;
  const fixed = turnedCorner(start, opposite, rotation, aspect);
  // The drag from the fixed corner, in the box's own (unturned) directions.
  const local = turned((px - fixed.x) * aspect, py - fixed.y, -rotation);
  const w = Math.max(sx * local.x, min.w * aspect);
  const h = Math.max(sy * local.y, min.h);
  const half = turned((sx * w) / 2, (sy * h) / 2, rotation);
  const cx = fixed.x * aspect + half.x;
  const cy = fixed.y + half.y;
  return { x: (cx - w / 2) / aspect, y: cy - h / 2, w: w / aspect, h };
}

/**
 * `start`, turned by `rotation`, with `corner` dragged to (`px`, `py`) as `resizedTurned` does –
 * but pulled over the opposite side it does not stop there: it goes on, mirrored that way
 * (`mirrored`, in its own directions).
 */
export function resizedThrough(
  start: Rect,
  corner: RectCorner,
  px: number,
  py: number,
  rotation: number,
  aspect: number,
  min: RectSize = MIN_RECT_SIZE,
): { rect: Rect; mirrored: { x: boolean; y: boolean } } {
  const sx = corner.endsWith('e') ? 1 : -1;
  const sy = corner.startsWith('s') ? 1 : -1;
  const opposite = `${sy > 0 ? 'n' : 's'}${sx > 0 ? 'w' : 'e'}` as RectCorner;
  const fixed = turnedCorner(start, opposite, rotation, aspect);
  const local = turned((px - fixed.x) * aspect, py - fixed.y, -rotation);
  const along = { x: sx * local.x, y: sy * local.y };
  const mirrored = { x: along.x < 0, y: along.y < 0 };
  const w = Math.max(Math.abs(along.x), min.w * aspect);
  const h = Math.max(Math.abs(along.y), min.h);
  const half = turned(
    (sx * (mirrored.x ? -1 : 1) * w) / 2,
    (sy * (mirrored.y ? -1 : 1) * h) / 2,
    rotation,
  );
  const cx = fixed.x * aspect + half.x;
  const cy = fixed.y + half.y;
  return { rect: { x: (cx - w / 2) / aspect, y: cy - h / 2, w: w / aspect, h }, mirrored };
}

/** Within this of an axis (radians, 15°), a resize keeps to that side alone. */
const AXIS_WITHIN = Math.PI / 12;

/**
 * Where `corner` of `start` (turned by `rotation`) goes when dragged to (`px`, `py`) with ⇧: out or
 * in along the box's diagonal – the box keeps its proportions, what it is resized for most –,
 * close to an axis (or across the diagonal) only along its width or its height, whichever the
 * pointer moved further – the other side keeps its length.
 */
export function axisLocked(
  start: Rect,
  corner: RectCorner,
  px: number,
  py: number,
  rotation: number,
  aspect: number,
  bounded = true,
): { x: number; y: number } {
  const from = turnedCorner(start, corner, rotation, aspect);
  const local = turned((px - from.x) * aspect, py - from.y, -rotation);
  const sx = corner.endsWith('e') ? 1 : -1;
  const sy = corner.startsWith('s') ? 1 : -1;
  // The drag folded so the diagonal (out from the opposite corner) points right and down.
  const a = sx * local.x;
  const b = sy * local.y;
  const width = start.w * aspect;
  const diagonal = Math.atan2(start.h, width);
  const angle = Math.atan2(Math.abs(b), Math.abs(a));
  // Along the diagonal (growing or shrinking): all but a narrow band at either axis – narrower
  // still for a thin box, its diagonal close to an axis.
  const band = Math.min(AXIS_WITHIN, diagonal / 2, (Math.PI / 2 - diagonal) / 2);
  let along: { x: number; y: number };
  if (a * b > 0 && angle > band && angle < Math.PI / 2 - band) {
    const length = Math.hypot(width, start.h);
    let t = (a * width + b * start.h) / length ** 2;
    // Flat and kept on the slide: no further than its edge, so the proportions hold there too.
    if (rotation === 0 && bounded) {
      const room = (edge: number, at: number, by: number) =>
        by > 0 ? (edge - at) / by : by < 0 ? -at / by : Infinity;
      t = Math.min(t, room(1, from.x, sx * start.w), room(1, from.y, sy * start.h));
    }
    along = turned(sx * width * t, sy * start.h * t, rotation);
  } else {
    const wide = a * b > 0 ? angle < diagonal : Math.abs(local.x) >= Math.abs(local.y);
    along = wide ? turned(local.x, 0, rotation) : turned(0, local.y, rotation);
  }
  return { x: from.x + along.x / aspect, y: from.y + along.y };
}

/** A text's own size, of the slide: as wide as its longest line, and how high at a width. */
export interface TextSize {
  width: number;
  heightAt: (width: number) => number;
}

/**
 * `rect`, resized from `start` by `corner`, caught at the size of its text when close by
 * (`tolerance`, of the slide): the width at its longest line, the height at its text's at that
 * width – only a side the drag changes. Resized in proportion, the height follows the width.
 */
export function snappedToText(
  rect: Rect,
  start: Rect,
  corner: RectCorner,
  text: TextSize,
  tolerance: RectSize,
): Rect {
  const changedW = Math.abs(rect.w - start.w) > 1e-9;
  const changedH = Math.abs(rect.h - start.h) > 1e-9;
  const proportional = changedW && changedH && Math.abs(rect.w * start.h - rect.h * start.w) < 1e-9;
  let { w, h } = rect;
  if (changedW && Math.abs(w - text.width) < tolerance.w) {
    w = text.width;
    if (proportional) h = (w * start.h) / start.w;
  }
  if (changedH && !proportional) {
    const height = text.heightAt(w);
    if (Math.abs(h - height) < tolerance.h) h = height;
  }
  // The opposite corner stays.
  const x = corner === 'nw' || corner === 'sw' ? rect.x + rect.w - w : rect.x;
  const y = corner === 'nw' || corner === 'ne' ? rect.y + rect.h - h : rect.y;
  return { x, y, w, h };
}

/**
 * `rect` fitted to its text (a double click on a corner): as wide as its longest line, as high as
 * its text at that width – the corner opposite `corner` stays where it is on the slide, turned by
 * `rotation` too (`aspect`: the slide's width over its height).
 */
export function fittedToText(
  rect: Rect,
  corner: RectCorner,
  text: TextSize,
  rotation = 0,
  aspect = 1,
): Rect {
  const w = text.width;
  const h = text.heightAt(w);
  const sx = corner.endsWith('e') ? 1 : -1;
  const sy = corner.startsWith('s') ? 1 : -1;
  const opposite = `${sy > 0 ? 'n' : 's'}${sx > 0 ? 'w' : 'e'}` as RectCorner;
  const fixed = turnedCorner(rect, opposite, rotation, aspect);
  const reach = turned(sx * w * aspect, sy * h, rotation);
  return resizedTurned(
    rect,
    corner,
    fixed.x + reach.x / aspect,
    fixed.y + reach.y,
    rotation,
    aspect,
  );
}

/** Lines on the slide (0–1) a box is caught at: vertical ones at `x`, horizontal ones at `y`. */
export interface SnapLines {
  x: readonly number[];
  y: readonly number[];
}

/** The slide's own lines a box (and a gradient's end) is caught at: its edges and middles. */
export const SLIDE_LINES: readonly number[] = [0, 0.5, 1];

/** `lines` (guides, a layout grid – or none) and the slide's own edges and middles. */
export function withSlideLines(lines: SnapLines | null): SnapLines {
  return { x: [...SLIDE_LINES, ...(lines?.x ?? [])], y: [...SLIDE_LINES, ...(lines?.y ?? [])] };
}

/**
 * The lines of `boxes` – other elements on the slide – a moved or resized box is caught at: each
 * one's sides and middles, a turned or tilted one's by what it covers (`aspect`: the slide's width
 * over its height). One wholly off the slide gives none.
 */
export function boxLines(boxes: readonly TurnedBox[], aspect: number): SnapLines {
  const x: number[] = [];
  const y: number[] = [];
  for (const box of boxes) {
    let { x: left, y: top, w, h } = box.bbox;
    if (isTurned(box)) {
      const corners = turnedCorners(box, aspect);
      const xs = corners.map((corner) => corner.x);
      const ys = corners.map((corner) => corner.y);
      left = Math.min(...xs);
      top = Math.min(...ys);
      w = Math.max(...xs) - left;
      h = Math.max(...ys) - top;
    }
    if (left > 1 || top > 1 || left + w < 0 || top + h < 0) continue;
    x.push(left, left + w / 2, left + w);
    y.push(top, top + h / 2, top + h);
  }
  return { x, y };
}

/** Both sets of lines in one. */
export const joinLines = (a: SnapLines, b: SnapLines): SnapLines => ({
  x: [...a.x, ...b.x],
  y: [...a.y, ...b.y],
});

/** Of `lines`, those `rect` lies on – a side or its middle – to be drawn while it is dragged. */
export function caughtLines(rect: Rect, lines: SnapLines): SnapLines {
  const on = (edges: number[], all: readonly number[]) => [
    ...new Set(all.filter((line) => edges.some((edge) => Math.abs(edge - line) < 1e-6))),
  ];
  return {
    x: on([rect.x, rect.x + rect.w / 2, rect.x + rect.w], lines.x),
    y: on([rect.y, rect.y + rect.h / 2, rect.y + rect.h], lines.y),
  };
}

/** A side within this (of the slide) of a line lies on it: grown, it goes on to the next one. */
const ON_LINE = 5e-4;

/**
 * `rect` grown across (`x`: its width) or down (`y`: its height) to the next of `lines` on either
 * side – its left (top) side out to the nearest line before it, its right (bottom) side to the
 * nearest after it. A side already on a line goes on to the following one, a side with none left
 * on the slide (at or past its edge) stays. `null`: neither side can grow.
 */
export function grownToLines(rect: Rect, axis: 'x' | 'y', lines: SnapLines): Rect | null {
  const start = axis === 'x' ? rect.x : rect.y;
  const end = start + (axis === 'x' ? rect.w : rect.h);
  let before = start;
  let after = end;
  for (const line of lines[axis]) {
    if (line < 0 || line > 1) continue;
    if (line < start - ON_LINE && (before === start || line > before)) before = line;
    if (line > end + ON_LINE && (after === end || line < after)) after = line;
  }
  if (before === start && after === end) return null;
  return axis === 'x'
    ? { ...rect, x: before, w: after - before }
    : { ...rect, y: before, h: after - before };
}

/** The key of a catch at lines (`caught`): new for each new pair of lines, `null` for none. */
const catchKey = (x: { line: number } | null, y: { line: number } | null) =>
  x || y ? `${x?.line ?? '-'},${y?.line ?? '-'}` : null;

/** How far to shift so one of `edges` lies on the line nearest to it in `lines` – within `tolerance`. */
function nearestCatch(
  edges: readonly number[],
  lines: readonly number[],
  tolerance: number,
): { shift: number; line: number } | null {
  let best: { shift: number; line: number } | null = null;
  for (const edge of edges) {
    for (const line of lines) {
      const shift = line - edge;
      if (Math.abs(shift) < tolerance && (!best || Math.abs(shift) < Math.abs(best.shift)))
        best = { shift, line };
    }
  }
  return best;
}

/**
 * `rect` caught at `lines` close by (`tolerance`, of the slide): moved (`kind` 'move'), its sides
 * or its middle onto the nearest line either way; resized from `start` by a corner, only the sides
 * the drag changes – the opposite corner stays, and resized in proportion, it stays so. `caught`:
 * the lines it lies on now (a key, new for each new catch), `null` if none.
 */
export function snappedToLines(
  rect: Rect,
  start: Rect,
  kind: RectCorner | 'move',
  lines: SnapLines,
  tolerance: RectSize,
): { rect: Rect; caught: string | null } {
  if (kind === 'move') {
    const x = nearestCatch([rect.x, rect.x + rect.w / 2, rect.x + rect.w], lines.x, tolerance.w);
    const y = nearestCatch([rect.y, rect.y + rect.h / 2, rect.y + rect.h], lines.y, tolerance.h);
    return {
      rect: { ...rect, x: rect.x + (x?.shift ?? 0), y: rect.y + (y?.shift ?? 0) },
      caught: catchKey(x, y),
    };
  }
  const west = kind === 'nw' || kind === 'sw';
  const north = kind === 'nw' || kind === 'ne';
  const changedW = Math.abs(rect.w - start.w) > 1e-9;
  const changedH = Math.abs(rect.h - start.h) > 1e-9;
  const proportional = changedW && changedH && Math.abs(rect.w * start.h - rect.h * start.w) < 1e-9;
  // The side the corner pulls, each way: west/north moves the box's start, else its end.
  const sideX = west ? rect.x : rect.x + rect.w;
  const sideY = north ? rect.y : rect.y + rect.h;
  let x = changedW ? nearestCatch([sideX], lines.x, tolerance.w) : null;
  let y = changedH ? nearestCatch([sideY], lines.y, tolerance.h) : null;
  let w = rect.w + (x ? (west ? -x.shift : x.shift) : 0);
  let h = rect.h + (y ? (north ? -y.shift : y.shift) : 0);
  // Onto a line past the opposite side: not caught that way.
  if (w <= 1e-6) [x, w] = [null, rect.w];
  if (h <= 1e-6) [y, h] = [null, rect.h];
  if (proportional && (x || y)) {
    // In proportion, only the closer catch counts; the other side follows it.
    if (x && (!y || Math.abs(x.shift) <= Math.abs(y.shift))) {
      y = null;
      h = (w * start.h) / start.w;
    } else {
      x = null;
      w = (h * start.w) / start.h;
    }
  }
  return {
    rect: {
      x: west ? rect.x + rect.w - w : rect.x,
      y: north ? rect.y + rect.h - h : rect.y,
      w,
      h,
    },
    caught: catchKey(x, y),
  };
}

/** `point` caught at `lines` close by (`tolerance`, of the slide) – each way on its own. */
export function snappedPoint(
  point: Point,
  lines: SnapLines,
  tolerance: RectSize,
): { point: Point; caught: string | null } {
  const x = nearestCatch([point.x], lines.x, tolerance.w);
  const y = nearestCatch([point.y], lines.y, tolerance.h);
  return {
    point: { x: point.x + (x?.shift ?? 0), y: point.y + (y?.shift ?? 0) },
    caught: catchKey(x, y),
  };
}

/**
 * A new box drawn from `from` to the pointer at `to` (on the slide, both kept on it): its moving
 * corner caught at `lines` close by (`tolerance`) as a resized box's is; `null` lines: free. With
 * `square` it is square as seen (`aspect`: the slide's width over its height) – as far as the
 * pointer went further, no further than the slide's edge –, and only the closer catch counts, the
 * other side following it.
 */
export function drawnRect(
  from: Point,
  to: Point,
  lines: SnapLines | null,
  tolerance: RectSize,
  square = false,
  aspect = 1,
): { rect: Rect; caught: string | null } {
  if (!square) {
    const snapped = lines ? snappedPoint(to, lines, tolerance) : { point: to, caught: null };
    return { rect: rectFromPoints(from, snapped.point), caught: snapped.caught };
  }
  const sx = to.x < from.x ? -1 : 1;
  const sy = to.y < from.y ? -1 : 1;
  // Sides in the slide's heights; room up to the slide's edge each way.
  const room = Math.min((sx > 0 ? 1 - from.x : from.x) * aspect, sy > 0 ? 1 - from.y : from.y);
  const side = Math.min(room, Math.max(Math.abs(to.x - from.x) * aspect, Math.abs(to.y - from.y)));
  const cornerAt = (length: number) => ({
    x: from.x + (sx * length) / aspect,
    y: from.y + sy * length,
  });
  const corner = cornerAt(side);
  if (lines) {
    const x = nearestCatch([corner.x], lines.x, tolerance.w);
    const y = nearestCatch([corner.y], lines.y, tolerance.h);
    // The closer one as seen (each tolerance is the same pixels).
    const byX = x && (!y || Math.abs(x.shift) / tolerance.w <= Math.abs(y.shift) / tolerance.h);
    const caught = byX ? x : y;
    const length = caught
      ? byX
        ? Math.abs(corner.x + caught.shift - from.x) * aspect
        : Math.abs(corner.y + caught.shift - from.y)
      : side;
    if (caught && length <= room + 1e-9)
      return {
        rect: rectFromPoints(from, cornerAt(length)),
        caught: byX ? catchKey(caught, null) : catchKey(null, caught),
      };
  }
  return { rect: rectFromPoints(from, corner), caught: null };
}

/** Within this many degrees of a multiple of 45 a turn snaps to it. */
const SNAP_DEGREES = 4;

/** A turn as the editor keeps it: 0 ≤ turn < 360, to steps of 15° (`steps`) or snapped near 45°. */
export function snappedTurn(degrees: number, steps = false): number {
  let turn = ((degrees % 360) + 360) % 360;
  if (steps) turn = Math.round(turn / 15) * 15;
  else {
    const near = Math.round(turn / 45) * 45;
    turn = Math.abs(turn - near) <= SNAP_DEGREES ? near : Math.round(turn * 10) / 10;
  }
  return turn % 360;
}
