import type { PathStroke, PathStrokeTool, Point, Rect, Stroke } from '@slider/shared';

/** Visual style per drawing tool. Widths are screen pixels (strokes use `non-scaling-stroke`). */
export const STROKE_STYLE: Record<PathStrokeTool, { width: number; opacity: number }> = {
  pen: { width: 3, opacity: 1 },
  arrow: { width: 3, opacity: 1 },
  highlighter: { width: 16, opacity: 0.4 },
  rect: { width: 3, opacity: 1 },
  ellipse: { width: 3, opacity: 1 },
};

/** Shapes are spanned by two corners and drawn by dragging; a tap leaves nothing. */
export const isShapeTool = (tool: PathStrokeTool) => tool === 'rect' || tool === 'ellipse';

/** Minimum distance (normalised) between recorded points – keeps payloads small and lines smooth. */
export const MIN_POINT_DISTANCE = 0.002;

/** Appends `next` unless it is too close to the previous point. Returns the same array if skipped. */
export function appendPoint(
  points: readonly Point[],
  next: Point,
  minDistance = MIN_POINT_DISTANCE,
): Point[] {
  const last = points.at(-1);
  if (last && Math.hypot(next.x - last.x, next.y - last.y) < minDistance) return points as Point[];
  return [...points, next];
}

const fmt = (value: number) => Number(value.toFixed(4));
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Smooth path through the points: quadratic Béziers using each point as control point and the
 * midpoints between neighbours as anchors – cheap and visually close to a Catmull-Rom spline.
 */
export function smoothPath(points: readonly Point[]): string {
  const [first, ...rest] = points;
  if (!first) return '';
  if (rest.length === 0) return `M${fmt(first.x)} ${fmt(first.y)}`;
  if (rest.length === 1)
    return `M${fmt(first.x)} ${fmt(first.y)}L${fmt(rest[0]!.x)} ${fmt(rest[0]!.y)}`;

  let d = `M${fmt(first.x)} ${fmt(first.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const control = points[i]!;
    const end = mid(control, points[i + 1]!);
    d += `Q${fmt(control.x)} ${fmt(control.y)} ${fmt(end.x)} ${fmt(end.y)}`;
  }
  const last = points.at(-1)!;
  return `${d}L${fmt(last.x)} ${fmt(last.y)}`;
}

/** Arrow head length relative to the slide height. */
const ARROW_HEAD = 0.035;
const ARROW_ANGLE = Math.PI / 7;

/**
 * Straight arrow from the first to the last point. The head is computed in aspect-corrected
 * space so it isn't skewed by the non-uniform `viewBox` scaling.
 */
export function arrowPath(points: readonly Point[], aspectRatio: number): string {
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end) return '';
  const dx = (end.x - start.x) * aspectRatio;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const wing = (offset: number): Point => ({
    x: end.x - (Math.cos(angle + offset) * ARROW_HEAD) / aspectRatio,
    y: end.y - Math.sin(angle + offset) * ARROW_HEAD,
  });
  const left = wing(ARROW_ANGLE);
  const right = wing(-ARROW_ANGLE);
  return (
    `M${fmt(start.x)} ${fmt(start.y)}L${fmt(end.x)} ${fmt(end.y)}` +
    `M${fmt(left.x)} ${fmt(left.y)}L${fmt(end.x)} ${fmt(end.y)}L${fmt(right.x)} ${fmt(right.y)}`
  );
}

/** Normalised box spanned by the first and last point of a shape stroke. */
function shapeBox(points: readonly Point[]): Rect | null {
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end) return null;
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

/** Rectangle through two opposite corners. */
export function rectPath(points: readonly Point[]): string {
  const box = shapeBox(points);
  if (!box) return '';
  const { x, y, w, h } = box;
  return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
}

/**
 * Ellipse inscribed in the box of two opposite corners. Two arcs in normalised units – the
 * non-uniform `viewBox` scaling keeps it an ellipse at every slide size.
 */
export function ellipsePath(points: readonly Point[]): string {
  const box = shapeBox(points);
  if (!box) return '';
  const rx = box.w / 2;
  const ry = box.h / 2;
  const cy = box.y + ry;
  const arc = `A${fmt(rx)} ${fmt(ry)} 0 1 0`;
  return (
    `M${fmt(box.x)} ${fmt(cy)}${arc} ${fmt(box.x + box.w)} ${fmt(cy)}` +
    `${arc} ${fmt(box.x)} ${fmt(cy)}Z`
  );
}

export function strokePath(stroke: Pick<PathStroke, 'tool' | 'points'>, aspectRatio: number) {
  switch (stroke.tool) {
    case 'arrow':
      return arrowPath(stroke.points, aspectRatio);
    case 'rect':
      return rectPath(stroke.points);
    case 'ellipse':
      return ellipsePath(stroke.points);
    default:
      return smoothPath(stroke.points);
  }
}

/** The box of a text annotation. */
export const textBox = (stroke: Extract<Stroke, { tool: 'text' }>): Rect => ({
  x: stroke.x,
  y: stroke.y,
  w: stroke.w,
  h: stroke.h,
});

/**
 * Points that describe where a stroke reaches: every point of a freehand line or arrow, the
 * edge midpoints of a shape or text box (its outermost points left/right and top/bottom).
 */
export function strokeOutline(stroke: Stroke): Point[] {
  const box =
    stroke.tool === 'text'
      ? textBox(stroke)
      : isShapeTool(stroke.tool)
        ? shapeBox(stroke.points)
        : null;
  if (stroke.tool !== 'text' && !box) return stroke.points;
  if (!box) return [];
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return [
    { x: box.x, y: cy },
    { x: box.x + box.w, y: cy },
    { x: cx, y: box.y },
    { x: cx, y: box.y + box.h },
  ];
}

/** Bounding box of all strokes (normalised). */
export function strokesBounds(strokes: readonly Stroke[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const { x, y } of strokeOutline(stroke)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
