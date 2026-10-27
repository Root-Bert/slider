import type { Point } from '@slider/shared';

/** A plane's corners as seen: top left, top right, bottom right, bottom left. */
export type Quad = readonly [Point, Point, Point, Point];

/** Where a point of the plane (0–1 across and down) is seen. */
export type Projection = (point: Point) => Point;

const det = (a: number, b: number, c: number, d: number) => a * d - b * c;

/**
 * The perspective mapping of the unit square onto `quad` (Heckbert's square-to-quad): a plane of
 * the slide turned in 3D is seen as such a quad, and every point on it lands where this says –
 * found from its four corners alone, whatever transforms brought it there.
 */
export function projectUnitSquare(quad: Quad): Projection {
  const [a, b, x0, c, e, y0, g, h] = squareToQuad(quad);
  return ({ x: u, y: v }) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + x0) / w, y: (c * u + e * v + y0) / w };
  };
}

/**
 * The other way round: where on the plane (0–1 across and down) a point seen in `quad` lies – a
 * click on a plane of the slide turned in 3D, back on the slide.
 */
export function unprojectUnitSquare(quad: Quad): Projection {
  const [a, b, x0, c, e, y0, g, h] = squareToQuad(quad);
  // The mapping's matrix inverted (its adjugate: the scale cancels out).
  const m = [
    [e - y0 * h, x0 * h - b, b * y0 - x0 * e],
    [y0 * g - c, a - x0 * g, x0 * c - a * y0],
    [c * h - e * g, b * g - a * h, a * e - b * c],
  ] as const;
  return ({ x, y }) => {
    const w = m[2][0] * x + m[2][1] * y + m[2][2];
    return {
      x: (m[0][0] * x + m[0][1] * y + m[0][2]) / w,
      y: (m[1][0] * x + m[1][1] * y + m[1][2]) / w,
    };
  };
}

/** The square-to-quad matrix by rows, its last entry 1. */
function squareToQuad(
  quad: Quad,
): readonly [number, number, number, number, number, number, number, number] {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const d = det(dx1, dx2, dy1, dy2);
  // Seen straight on (or flat edge-on): no foreshortening.
  const g = d === 0 ? 0 : det(dx3, dx2, dy3, dy2) / d;
  const h = d === 0 ? 0 : det(dx1, dx3, dy1, dy3) / d;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
  ];
}
