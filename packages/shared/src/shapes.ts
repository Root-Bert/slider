import { offsetInRect, pointInRect, rectArea, rectCenter, type Point, type Rect } from './geometry';
import type { Anchor, Guide, Shape, ShapeRef } from './model';
import { DEFAULT_ASPECT, turnedBoxContains, type TurnedBox } from './turned-box';

/**
 * Finds the shape under a point, preferring the smallest (most specific) one – a turned or tilted
 * one as it shows (`aspect`: the slide's width over its height).
 * Used when placing an anchor so it can follow the object across revisions (BER-98, BER-111).
 */
export function hitTestShapes<T extends TurnedBox>(
  shapes: readonly T[],
  point: Point,
  aspect = DEFAULT_ASPECT,
): T | null {
  let best: T | null = null;
  for (const shape of shapes) {
    if (!turnedBoxContains(shape, point, aspect)) continue;
    if (!best || rectArea(shape.bbox) <= rectArea(best.bbox)) best = shape;
  }
  return best;
}

export function shapeRefAt(
  shapes: readonly Shape[],
  point: Point,
  aspect = DEFAULT_ASPECT,
): ShapeRef | null {
  const shape = hitTestShapes(shapes, point, aspect);
  return shape
    ? { shapeId: shape.id, offset: offsetInRect(shape.bbox, point), ...identityOf(shape) }
    : null;
}

/** What a reference remembers of its shape to recognise it again (see {@link refShape}). */
function identityOf(shape: Shape): Pick<ShapeRef, 'name' | 'bbox'> {
  return { name: shape.name, bbox: { ...shape.bbox } };
}

/** Below this an axis counts as degenerate (lines), compared by touching instead of overlap. */
const FLAT = 1e-6;

/** Whether two intervals cover at least half of the shorter one (or touch, when it is flat). */
function axisOverlaps(start: number, size: number, otherStart: number, otherSize: number): boolean {
  const overlap = Math.min(start + size, otherStart + otherSize) - Math.max(start, otherStart);
  const shorter = Math.min(size, otherSize);
  return shorter <= FLAT ? overlap >= -FLAT : overlap >= shorter / 2;
}

function boxesOverlap(a: Rect, b: Rect): boolean {
  return axisOverlaps(a.x, a.w, b.x, b.w) && axisOverlaps(a.y, a.h, b.y, b.h);
}

/**
 * The shape a reference is bound to, or `null` when it is gone. The id alone is not enough:
 * producers like Google Slides or LibreOffice renumber shapes, so another object can inherit it.
 * A candidate counts as the same shape when it kept its name, or – renamed – still largely
 * covers the place it had. References from before names and boxes were stored trust the id.
 */
export function refShape(shapes: readonly Shape[], ref: ShapeRef): Shape | null {
  const shape = shapes.find((candidate) => candidate.id === ref.shapeId);
  if (!shape) return null;
  if (ref.name === undefined && ref.bbox === undefined) return shape;
  if (ref.name !== undefined && shape.name === ref.name) return shape;
  return ref.bbox && boxesOverlap(ref.bbox, shape.bbox) ? shape : null;
}

/** Resolves a shape reference back to slide coordinates, or `null` when the shape is gone. */
export function resolveShapeRef(shapes: readonly Shape[], ref: ShapeRef): Point | null {
  const shape = refShape(shapes, ref);
  return shape ? pointInRect(shape.bbox, ref.offset) : null;
}

/** Binds a box to `shape`: its centre and size relative to the shape's bounds. */
export function shapeRefForRect(shape: Shape, rect: Rect): ShapeRef {
  const { bbox } = shape;
  return {
    shapeId: shape.id,
    offset: offsetInRect(bbox, rectCenter(rect)),
    size: { w: bbox.w > 0 ? rect.w / bbox.w : 1, h: bbox.h > 0 ? rect.h / bbox.h : 1 },
    ...identityOf(shape),
  };
}

/** Binds a box to the shape under its centre, or `null` when there is none. */
export function rectShapeRefAt(
  shapes: readonly Shape[],
  rect: Rect,
  aspect = DEFAULT_ASPECT,
): ShapeRef | null {
  const shape = hitTestShapes(shapes, rectCenter(rect), aspect);
  return shape ? shapeRefForRect(shape, rect) : null;
}

/** Below this share of overlap (intersection over union) a box is not about a shape. */
const MIN_COVER = 0.3;

/**
 * Binds a box placed by area alone (the AI's comments) to the shape it is about: the one it
 * covers best, else the shape under its centre; `null` when there is none.
 */
export function rectShapeRefOver(
  shapes: readonly Shape[],
  rect: Rect,
  aspect = DEFAULT_ASPECT,
): ShapeRef | null {
  let best: Shape | null = null;
  let bestCover = MIN_COVER;
  for (const shape of shapes) {
    const { bbox } = shape;
    const w = Math.min(rect.x + rect.w, bbox.x + bbox.w) - Math.max(rect.x, bbox.x);
    const h = Math.min(rect.y + rect.h, bbox.y + bbox.h) - Math.max(rect.y, bbox.y);
    if (w <= 0 || h <= 0) continue;
    const cover = (w * h) / (rectArea(rect) + rectArea(bbox) - w * h);
    if (cover >= bestCover) {
      best = shape;
      bestCover = cover;
    }
  }
  return best ? shapeRefForRect(best, rect) : rectShapeRefAt(shapes, rect, aspect);
}

/**
 * Where a bound box sits now: around its shape's current place, scaled with it (with `size`) or
 * just moved along (older boxes). The stored `rect` while the shape is gone (or the id now
 * belongs to another shape).
 */
export function resolveRectAnchor(shapes: readonly Shape[], rect: Rect, ref: ShapeRef): Rect {
  const shape = refShape(shapes, ref);
  if (!shape) return rect;
  const { bbox } = shape;
  const center = pointInRect(bbox, ref.offset);
  const w = Math.min(1, ref.size ? ref.size.w * bbox.w : rect.w);
  const h = Math.min(1, ref.size ? ref.size.h * bbox.h : rect.h);
  return {
    x: Math.min(Math.max(0, center.x - w / 2), 1 - w),
    y: Math.min(Math.max(0, center.y - h / 2), 1 - h),
    w,
    h,
  };
}

/** Shapes may sit this close past a guide (normalised, ≈ 3 px on a 1280 px slide). */
const GUIDE_TOLERANCE = 0.0025;
/** Within this of the slide's edge a shape bleeds off it – crossing the margin on purpose. */
const BLEED = 0.005;

export interface GuideOverflow {
  shape: Shape;
  /** The parts of the shape beyond the outer guides, in slide coordinates. */
  overflow: Rect[];
}

/**
 * Shapes that cross the outer guides: per direction with at least two guides, the outermost pair
 * marks the margins, and a shape straddling one of them sticks out. Inner guides (centre lines,
 * columns) are crossed on purpose by wider boxes and do not count; neither do shapes entirely
 * outside the margins (footers, page numbers) or bleeding off the slide on that side
 * (backgrounds, edge-to-edge pictures).
 */
export function guideOverflows(
  shapes: readonly Shape[],
  guides: readonly Guide[],
): GuideOverflow[] {
  const margins = (orientation: Guide['orientation']): [number, number] | null => {
    const positions = guides
      .filter((guide) => guide.orientation === orientation)
      .map((guide) => guide.position);
    return positions.length >= 2 ? [Math.min(...positions), Math.max(...positions)] : null;
  };
  const vertical = margins('vertical');
  const horizontal = margins('horizontal');
  if (!vertical && !horizontal) return [];

  const crosses = (start: number, end: number, line: number) =>
    start < line - GUIDE_TOLERANCE && end > line + GUIDE_TOLERANCE;
  const bleedsBefore = (start: number) => start <= BLEED;
  const bleedsAfter = (end: number) => end >= 1 - BLEED;

  const result: GuideOverflow[] = [];
  for (const shape of shapes) {
    const { x, y, w, h } = shape.bbox;
    const overflow: Rect[] = [];
    if (vertical) {
      const [left, right] = vertical;
      if (crosses(x, x + w, left) && !bleedsBefore(x)) overflow.push({ x, y, w: left - x, h });
      if (crosses(x, x + w, right) && !bleedsAfter(x + w))
        overflow.push({ x: right, y, w: x + w - right, h });
    }
    if (horizontal) {
      const [top, bottom] = horizontal;
      if (crosses(y, y + h, top) && !bleedsBefore(y)) overflow.push({ x, y, w, h: top - y });
      if (crosses(y, y + h, bottom) && !bleedsAfter(y + h))
        overflow.push({ x, y: bottom, w, h: y + h - bottom });
    }
    if (overflow.length > 0) result.push({ shape, overflow });
  }
  return result;
}

/** Intersection over union of two boxes: 1 the same, 0 apart. */
export function boxOverlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const common = w * h;
  return common / (rectArea(a) + rectArea(b) - common);
}

/** From this overlap on, a box for the AI is about the same area as a thread's box. */
export const SAME_AREA_OVERLAP = 0.6;

/** What {@link threadForRequest} reads of a root comment. */
export interface RequestThreadRoot {
  id: string;
  slideId: string | null;
  parentId: string | null;
  status: 'open' | 'done';
  anchor: Anchor;
  createdAt: string | Date;
}

/**
 * The open thread a new request to the AI on `slideId` (speaking to it, a box for it) belongs
 * to – it goes there as a reply, the thread its context – or `null`: a new thread. Kept narrow:
 * only a box (its shape where it is bound to one, `shapes` given) that covers about the same area
 * as a thread's single box on the same slide, both bound to the same element if both are bound.
 * Resolved threads stay closed; the closest match wins, then the newest.
 */
export function threadForRequest<T extends RequestThreadRoot>(
  roots: readonly T[],
  slideId: string | null,
  anchor: Anchor,
  shapes: readonly Shape[] = [],
): T | null {
  if (anchor.type !== 'rect' || anchor.more?.length || slideId === null) return null;
  const at = (rect: Rect, ref: ShapeRef | null) =>
    ref && shapes.length > 0 ? resolveRectAnchor(shapes, rect, ref) : rect;
  const box = at(anchor.rect, anchor.shapeRef);
  let best: { root: T; overlap: number; time: number } | null = null;
  for (const root of roots) {
    const other = root.anchor;
    if (root.parentId !== null || root.status !== 'open' || root.slideId !== slideId) continue;
    if (other.type !== 'rect' || other.more?.length) continue;
    if (anchor.shapeRef && other.shapeRef && anchor.shapeRef.shapeId !== other.shapeRef.shapeId)
      continue;
    const overlap = boxOverlap(box, at(other.rect, other.shapeRef));
    if (overlap < SAME_AREA_OVERLAP) continue;
    const time = new Date(root.createdAt).getTime();
    if (
      !best ||
      overlap > best.overlap + 1e-6 ||
      (Math.abs(overlap - best.overlap) <= 1e-6 && time > best.time)
    )
      best = { root, overlap, time };
  }
  return best?.root ?? null;
}
