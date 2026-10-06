import type { Point, Rect, Stroke, StrokeTool } from '@slider/shared';

/** Visual style per drawing tool. Widths are screen pixels (strokes use `non-scaling-stroke`). */
export const STROKE_STYLE: Record<StrokeTool, { width: number; opacity: number }> = {
  pen: { width: 3, opacity: 1 },
  arrow: { width: 3, opacity: 1 },
  highlighter: { width: 16, opacity: 0.4 },
};

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

export const strokePath = (stroke: Pick<Stroke, 'tool' | 'points'>, aspectRatio: number): string =>
  stroke.tool === 'arrow' ? arrowPath(stroke.points, aspectRatio) : smoothPath(stroke.points);

/** Bounding box of all points of all strokes (normalised). */
export function strokesBounds(strokes: readonly Pick<Stroke, 'points'>[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const { x, y } of stroke.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
