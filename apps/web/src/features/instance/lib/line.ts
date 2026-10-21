import { roundedPath, type Px } from '@/lib/rounded-path';

/**
 * Counts over time spread across `width`, the first at the left edge and the latest at the right
 * one (one value: in the middle). `y` maps a count to pixels.
 */
export function spread(
  values: readonly number[],
  width: number,
  y: (value: number) => number,
): Px[] {
  const gaps = values.length - 1;
  return values.map((value, index) => ({
    x: gaps > 0 ? (index / gaps) * width : width / 2,
    y: y(value),
  }));
}

/**
 * The line through the points, its corners rounded like the comment connectors (`radius`,
 * shrinking on short segments), and the area below it down to `baseline`.
 */
export function linePaths(
  points: readonly Px[],
  baseline: number,
  radius = 8,
): { line: string; area: string } {
  const line = roundedPath(points, radius);
  const first = points[0];
  const last = points.at(-1);
  const area = first && last ? `${line}L${last.x} ${baseline}L${first.x} ${baseline}Z` : '';
  return { line, area };
}
