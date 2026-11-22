import type { Box, Color, FillLike, Shape, Stroke } from './model';
import { PAGE } from './model';
import type { Rng } from './art';

/*
 * Decoration drawn as shapes of the file (sharp at any size, recoloured with the palette):
 * rays, stripes, dots, waves, blobs, stars. Each gives shapes to put into a layout.
 */

type Point = readonly [number, number];

/** The whole page as a box. */
export const page: Box = { x: 0, y: 0, w: PAGE.w, h: PAGE.h };

/** A box moved in from the page's edges. */
export const inset = (left: number, top = left, right = left, bottom = top): Box => ({
  x: left,
  y: top,
  w: PAGE.w - left - right,
  h: PAGE.h - top - bottom,
});

/** `count` boxes side by side in `box`, `gap` apart. */
export const columns = (box: Box, count: number, gap: number): Box[] =>
  Array.from({ length: count }, (_, index) => {
    const w = (box.w - gap * (count - 1)) / count;
    return { x: box.x + index * (w + gap), y: box.y, w, h: box.h };
  });

/** `count` boxes one under the other in `box`, `gap` apart. */
export const rows = (box: Box, count: number, gap: number): Box[] =>
  Array.from({ length: count }, (_, index) => {
    const h = (box.h - gap * (count - 1)) / count;
    return { x: box.x, y: box.y + index * (h + gap), w: box.w, h };
  });

/** Points turned `degrees` clockwise round a centre. */
export const turned = (pts: readonly Point[], degrees: number, cx: number, cy: number): Point[] => {
  const angle = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return pts.map(([x, y]) => [
    cx + (x - cx) * cos - (y - cy) * sin,
    cy + (x - cx) * sin + (y - cy) * cos,
  ]);
};

/** Rays from a point, every second gap filled: a sunburst. Cut it with the page yourself. */
export function sunburst(
  cx: number,
  cy: number,
  radius: number,
  count: number,
  fill: FillLike,
  options: { from?: number; to?: number; share?: number } = {},
): Shape[] {
  const from = ((options.from ?? 0) * Math.PI) / 180;
  const to = ((options.to ?? 360) * Math.PI) / 180;
  const step = (to - from) / count;
  const share = options.share ?? 0.5;
  return Array.from({ length: count }, (_, index): Shape => {
    const a = from + index * step;
    const b = a + step * share;
    return {
      t: 'poly',
      fill,
      pts: [
        [cx, cy],
        [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius],
        [cx + Math.cos(b) * radius, cy + Math.sin(b) * radius],
      ],
    };
  });
}

/** Parallel stripes filling a box, turned or upright. */
export function stripes(
  box: Box,
  count: number,
  fill: FillLike | ((index: number) => FillLike),
  options: { share?: number; vertical?: boolean } = {},
): Shape[] {
  const share = options.share ?? 0.5;
  return Array.from({ length: count }, (_, index): Shape => {
    const paint = typeof fill === 'function' ? fill(index) : fill;
    if (options.vertical) {
      const w = box.w / count;
      return { t: 'rect', x: box.x + index * w, y: box.y, w: w * share, h: box.h, fill: paint };
    }
    const h = box.h / count;
    return { t: 'rect', x: box.x, y: box.y + index * h, w: box.w, h: h * share, fill: paint };
  });
}

/** Slanted bands across a box (a parallelogram each), leaning `lean` centimetres. */
export function slants(
  box: Box,
  count: number,
  lean: number,
  fill: FillLike | ((index: number) => FillLike),
  share = 0.5,
): Shape[] {
  const w = box.w / count;
  return Array.from({ length: count }, (_, index): Shape => {
    const x = box.x + index * w;
    return {
      t: 'poly',
      fill: typeof fill === 'function' ? fill(index) : fill,
      pts: [
        [x + lean, box.y],
        [x + lean + w * share, box.y],
        [x + w * share, box.y + box.h],
        [x, box.y + box.h],
      ],
    };
  });
}

/** A grid of dots in a box. Keep it small (each dot is a shape) – for screens use `halftone`. */
export function dots(
  box: Box,
  columnCount: number,
  rowCount: number,
  size: number,
  fill: FillLike,
): Shape[] {
  const shapes: Shape[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      shapes.push({
        t: 'ellipse',
        x: box.x + (columnCount === 1 ? 0 : (column * (box.w - size)) / (columnCount - 1)),
        y: box.y + (rowCount === 1 ? 0 : (row * (box.h - size)) / (rowCount - 1)),
        w: size,
        h: size,
        fill,
      });
    }
  }
  return shapes;
}

/** Grid lines over a box, `step` apart. */
export function gridLines(box: Box, step: number, stroke: Stroke): Shape[] {
  const shapes: Shape[] = [];
  for (let x = box.x; x <= box.x + box.w + 0.001; x += step) {
    shapes.push({ t: 'line', x1: x, y1: box.y, x2: x, y2: box.y + box.h, stroke });
  }
  for (let y = box.y; y <= box.y + box.h + 0.001; y += step) {
    shapes.push({ t: 'line', x1: box.x, y1: y, x2: box.x + box.w, y2: y, stroke });
  }
  return shapes;
}

/** A star (or a burst, with many shallow points) round a centre. */
export function star(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
  fill: FillLike,
  options: { stroke?: Stroke; rotate?: number } = {},
): Shape {
  const start = ((options.rotate ?? -90) * Math.PI) / 180;
  return {
    t: 'poly',
    fill,
    stroke: options.stroke,
    pts: Array.from({ length: points * 2 }, (_, index): Point => {
      const angle = start + (index * Math.PI) / points;
      const radius = index % 2 === 0 ? outer : inner;
      return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    }),
  };
}

/** A regular polygon round a centre. */
export const polygon = (
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  fill: FillLike,
  options: { stroke?: Stroke; rotate?: number } = {},
): Shape => ({
  t: 'poly',
  fill,
  stroke: options.stroke,
  pts: Array.from({ length: sides }, (_, index): Point => {
    const angle = (((options.rotate ?? -90) + (index * 360) / sides) * Math.PI) / 180;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  }),
});

const n = (value: number) => Number(value.toFixed(2));

/** A smooth closed curve through points (Catmull-Rom), as a path's `d`. */
export function smoothPath(points: readonly Point[], closed = true): string {
  const count = points.length;
  const at = (index: number) =>
    closed ? points[(index + count) % count]! : points[Math.min(count - 1, Math.max(0, index))]!;
  let d = `M${n(points[0]![0])} ${n(points[0]![1])}`;
  const last = closed ? count : count - 1;
  for (let i = 0; i < last; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += ` C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(
      p2[0] - (p3[0] - p1[0]) / 6,
    )} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return closed ? `${d} Z` : d;
}

/** An organic blob filling a box: a circle whose rim wanders. */
export function blob(
  box: Box,
  random: Rng,
  fill: FillLike,
  options: { points?: number; wobble?: number; stroke?: Stroke; rotate?: number } = {},
): Shape {
  const count = options.points ?? 8;
  const wobble = options.wobble ?? 0.28;
  const points = Array.from({ length: count }, (_, index): Point => {
    const angle = (index / count) * Math.PI * 2;
    const radius = 500 * (1 - wobble * random());
    return [500 + Math.cos(angle) * radius, 500 + Math.sin(angle) * radius];
  });
  return {
    t: 'path',
    ...box,
    d: smoothPath(points),
    vb: [1000, 1000],
    fill,
    stroke: options.stroke,
    rotate: options.rotate,
  };
}

/**
 * A wave band across a box: its upper edge a wave of `waves` crests `height` (0 … 1 of the box)
 * high, filled down to the box's bottom.
 */
export function wave(
  box: Box,
  waves: number,
  height: number,
  fill: FillLike,
  options: { phase?: number; stroke?: Stroke } = {},
): Shape {
  const steps = Math.max(8, Math.round(waves * 12));
  const amplitude = (height * 1000) / 2;
  const points: Point[] = Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return [
      t * 1000,
      amplitude - Math.sin(t * waves * Math.PI * 2 + (options.phase ?? 0)) * amplitude,
    ];
  });
  return {
    t: 'path',
    ...box,
    d: `${smoothPath(points, false)} L1000 1000 L0 1000 Z`,
    vb: [1000, 1000],
    fill,
    stroke: options.stroke,
  };
}

/** A wavy or zigzag line across a box (not filled). */
export function squiggle(
  box: Box,
  waves: number,
  stroke: Stroke,
  options: { zigzag?: boolean; rotate?: number } = {},
): Shape {
  const count = Math.round(waves * 2);
  const points: Point[] = Array.from({ length: count + 1 }, (_, index) => [
    (index / count) * 1000,
    index % 2 === 0 ? 900 : 100,
  ]);
  return {
    t: 'path',
    ...box,
    d: options.zigzag
      ? points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${n(x)} ${n(y)}`).join(' ')
      : smoothPath(points, false),
    vb: [1000, 1000],
    fill: null,
    stroke: { join: 'round', cap: 'round', ...stroke },
    rotate: options.rotate,
  };
}

/** A ring: a circle drawn as a line only. */
export const ring = (cx: number, cy: number, radius: number, stroke: Stroke): Shape => ({
  t: 'ellipse',
  x: cx - radius,
  y: cy - radius,
  w: radius * 2,
  h: radius * 2,
  fill: null,
  stroke,
});

/** A filled circle round a centre. */
export const disc = (cx: number, cy: number, radius: number, fill: FillLike): Shape => ({
  t: 'ellipse',
  x: cx - radius,
  y: cy - radius,
  w: radius * 2,
  h: radius * 2,
  fill,
});

/** A hairline, horizontal or vertical. */
export const rule = (
  x: number,
  y: number,
  length: number,
  color: Color,
  width = 0.03,
  vertical = false,
): Shape => ({
  t: 'line',
  x1: x,
  y1: y,
  x2: vertical ? x : x + length,
  y2: vertical ? y + length : y,
  stroke: { color, width },
});
