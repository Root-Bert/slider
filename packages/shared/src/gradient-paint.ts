import { isCentredGradient, stopOpacity, type FillLayer, type GradientStop } from './editing';

/*
 * A gradient's geometry as LibreOffice draws it – so the editor's previews, the pictures of
 * layers it bakes and the handles over the slide all agree with the slide's own picture:
 *  - linear: from corner to corner of its direction (as CSS's);
 *  - axial: the same line, from its middle out to both sides;
 *  - radial: a circle of half the shape's diagonal around its centre;
 *  - ellipsoid: an ellipse of the shape's proportions, √2 as large, turned;
 *  - square / rectangular: a square of the longer side / a rectangle of the shape, turned and
 *    grown to still cover the shape.
 */

export type GradientLayer = Extract<FillLayer, { type: 'gradient' }>;

export const sortedStops = (stops: readonly GradientStop[]) =>
  [...stops].sort((a, b) => a.at - b.at);

/** Whether any colour of the gradient is see-through. */
export const seeThrough = (stops: readonly GradientStop[]) =>
  stops.some((stop) => stopOpacity(stop) < 1);

const channel = (color: string, i: number) => parseInt(color.slice(1 + i * 2, 3 + i * 2), 16);

const MIDDLE = { x: 0.5, y: 0.5 };
export const centerOf = (layer: GradientLayer) =>
  isCentredGradient(layer.kind) ? (layer.center ?? MIDDLE) : MIDDLE;

/** The CSS gradient line of `angle` through a `width` × `height` box: its start and end. */
export function gradientLine(angle: number, width: number, height: number) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  return {
    x0: width / 2 - dx * half,
    y0: height / 2 - dy * half,
    x1: width / 2 + dx * half,
    y1: height / 2 + dy * half,
  };
}

/**
 * A centred form in a `width` × `height` box: its centre (px), the direction its first axis runs
 * (turned clockwise by the layer's angle) and its half sizes along both axes.
 */
export function centredForm(layer: GradientLayer, width: number, height: number) {
  const center = centerOf(layer);
  const radians = layer.kind === 'radial' ? 0 : (layer.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let hx: number;
  let hy: number;
  if (layer.kind === 'radial') hx = hy = Math.hypot(width, height) / 2;
  else if (layer.kind === 'ellipsoid') {
    hx = (width * Math.SQRT2) / 2;
    hy = (height * Math.SQRT2) / 2;
  } else {
    const w = layer.kind === 'square' ? Math.max(width, height) : width;
    const h = layer.kind === 'square' ? w : height;
    hx = (w * Math.abs(cos) + h * Math.abs(sin)) / 2;
    hy = (h * Math.abs(cos) + w * Math.abs(sin)) / 2;
  }
  return { cx: center.x * width, cy: center.y * height, cos, sin, hx, hy };
}

/** Stops as a CSS gradient's (0–100 %), an axial one's mirrored around its middle. */
export function lineStops(layer: GradientLayer): GradientStop[] {
  const stops = sortedStops(layer.stops);
  if (layer.kind !== 'axial') return stops;
  return [
    ...stops.map((stop) => ({ ...stop, at: 0.5 - stop.at / 2 })).reverse(),
    ...stops.map((stop) => ({ ...stop, at: 0.5 + stop.at / 2 })),
  ];
}

/** The two stops `at` (0–1) lies between and how far past the first; past the ends, the end twice. */
function around(stops: readonly GradientStop[], at: number) {
  const sorted = sortedStops(stops);
  const after = sorted.findIndex((stop) => stop.at >= at);
  if (after <= 0) {
    const end = sorted[after === -1 ? sorted.length - 1 : 0] as GradientStop;
    return { a: end, b: end, t: 0 };
  }
  const a = sorted[after - 1] as GradientStop;
  const b = sorted[after] as GradientStop;
  return { a, b, t: b.at === a.at ? 0 : (at - a.at) / (b.at - a.at) };
}

/** The colour of `stops` at `at` (0–1), between them. */
export function colorAt(stops: readonly GradientStop[], at: number): string {
  const { a, b, t } = around(stops, at);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(a.color, i) + (channel(b.color, i) - channel(a.color, i)) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** How opaque `stops` are at `at` (0–1), between them – apart from their colour, as LibreOffice. */
export function opacityAt(stops: readonly GradientStop[], at: number): number {
  const { a, b, t } = around(stops, at);
  return stopOpacity(a) + (stopOpacity(b) - stopOpacity(a)) * t;
}

/** 256 colours along the stops, as RGBA. */
function ramp(stops: readonly GradientStop[]): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const color = colorAt(stops, i / 255);
    for (let c = 0; c < 3; c++) table[i * 4 + c] = channel(color, c);
    table[i * 4 + 3] = Math.round(opacityAt(stops, i / 255) * 255);
  }
  return table;
}

/** Where along a line (0 at its start, 1 at its end) the point `x`, `y` falls, straight across. */
export function alongLine(
  line: { x0: number; y0: number; x1: number; y1: number },
  x: number,
  y: number,
): number {
  const dx = line.x1 - line.x0;
  const dy = line.y1 - line.y0;
  const length = dx * dx + dy * dy;
  return length === 0 ? 0 : ((x - line.x0) * dx + (y - line.y0) * dy) / length;
}

/**
 * A gradient's pixels in a `width` × `height` box as LibreOffice draws it (RGBA, not
 * premultiplied; its layer's opacity is the caller's): colour and opacity run apart, as there.
 * The editor (`paintGradient`) and the server (baked backdrops) paint gradients with it.
 */
export function gradientPixels(
  layer: GradientLayer,
  width: number,
  height: number,
): Uint8ClampedArray {
  const centred = isCentredGradient(layer.kind);
  const { cx, cy, cos, sin, hx, hy } = centredForm(layer, width, height);
  const line = gradientLine(layer.angle, width, height);
  const table = ramp(centred ? layer.stops : lineStops(layer));
  const data = new Uint8ClampedArray(width * height * 4);
  const round = layer.kind === 'radial' || layer.kind === 'ellipsoid';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let t: number;
      if (!centred) t = alongLine(line, x + 0.5, y + 0.5);
      else {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        // Into the form's own axes (it is turned clockwise on screen).
        const u = (dx * cos + dy * sin) / hx;
        const v = (-dx * sin + dy * cos) / hy;
        t = round ? Math.hypot(u, v) : Math.max(Math.abs(u), Math.abs(v));
      }
      const index = Math.min(255, Math.max(0, Math.round(t * 255))) * 4;
      const at = (y * width + x) * 4;
      data[at] = table[index] as number;
      data[at + 1] = table[index + 1] as number;
      data[at + 2] = table[index + 2] as number;
      data[at + 3] = table[index + 3] as number;
    }
  }
  return data;
}
