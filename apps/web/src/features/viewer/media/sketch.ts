/*
 * Drawings of the Bild tab: strokes kept as vectors (normalised 0–1, so the canvas can be any
 * size and undo is just dropping the last stroke), rendered onto a canvas and exported as PNG.
 */

import { getStroke, type StrokeOptions } from 'perfect-freehand';

export type SketchTool = 'pen' | 'eraser';

export interface SketchStroke {
  tool: SketchTool;
  color: string;
  /** Line width relative to the canvas width. */
  width: number;
  /** `[x, y]` pairs, 0–1 across the canvas. */
  points: [number, number][];
}

/** Paper of the canvas – white like a slide, so the sheet stands out against the dark composer. */
export const SKETCH_BACKGROUND = '#FFFFFF';
/** Format when there is no slide to take it from (comments in a gap between slides). */
export const DEFAULT_SKETCH_ASPECT = 16 / 9;
/** Exported image: sharp enough to zoom in, a few hundred KB as PNG. */
export const SKETCH_EXPORT_WIDTH = 1600;

export const SKETCH_WIDTHS = { fine: 0.004, bold: 0.012 } as const;
/** The eraser is wider than any pen – it paints the paper back. */
export const ERASER_WIDTH = 0.04;

/** Pen colours: ink, the viewer's own colour, then colours that read on the white paper. */
export function sketchPalette(ownColor: string): string[] {
  const colors = ['#141414', ownColor, '#EF4444', '#0048FF', '#22C55E'];
  return colors.filter(
    (color, index) =>
      colors.findIndex((other) => other.toLowerCase() === color.toLowerCase()) === index,
  );
}

/** Drops points closer than `minDistance` to the previous one (pointer events come in bursts). */
export function addPoint(
  points: readonly [number, number][],
  point: [number, number],
  minDistance = 0.002,
): [number, number][] {
  const last = points[points.length - 1];
  if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < minDistance) return [...points];
  return [...points, point];
}

/**
 * Pen feel of `perfect-freehand`: lines thin out when drawn fast and swell when slow, with
 * tapered ends. The eraser keeps one width – it paints the paper back where it goes.
 */
const PEN: StrokeOptions = {
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
};
const ERASER: StrokeOptions = { thinning: 0, smoothing: 0.5, streamline: 0.5 };

/** Paints the paper and every stroke as a filled freehand outline (a tap gives a dot). */
export function renderSketch(
  context: CanvasRenderingContext2D,
  strokes: readonly SketchStroke[],
  width: number,
  height: number,
) {
  context.save();
  context.fillStyle = SKETCH_BACKGROUND;
  context.fillRect(0, 0, width, height);
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const outline = getStroke(
      stroke.points.map(([x, y]) => [x * width, y * height]),
      {
        ...(stroke.tool === 'eraser' ? ERASER : PEN),
        size: Math.max(1, stroke.width * width),
        last: true,
      },
    );
    context.fillStyle = stroke.tool === 'eraser' ? SKETCH_BACKGROUND : stroke.color;
    context.fill(outlinePath(outline));
  }
  context.restore();
}

/** Closed path around the outline, smoothed through the midpoints of its points. */
function outlinePath(outline: number[][]): Path2D {
  const path = new Path2D();
  const [first] = outline;
  if (!first) return path;
  const mid = (a: number[], b: number[]) =>
    [((a[0] ?? 0) + (b[0] ?? 0)) / 2, ((a[1] ?? 0) + (b[1] ?? 0)) / 2] as const;
  path.moveTo(...mid(first, outline[1] ?? first));
  for (let index = 1; index <= outline.length; index++) {
    const point = outline[index % outline.length] ?? first;
    const next = outline[(index + 1) % outline.length] ?? first;
    path.quadraticCurveTo(point[0] ?? 0, point[1] ?? 0, ...mid(point, next));
  }
  path.closePath();
  return path;
}

/** Whether anything is left to see – strokes that are all erased still count (cheap and honest). */
export const hasInk = (strokes: readonly SketchStroke[]) =>
  strokes.some((stroke) => stroke.tool === 'pen' && stroke.points.length > 0);

/** The drawing as PNG, rendered fresh at export size in the format it was drawn in (width / height). */
export function exportSketch(strokes: readonly SketchStroke[], aspect: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = SKETCH_EXPORT_WIDTH;
  canvas.height = Math.round(SKETCH_EXPORT_WIDTH / aspect);
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('Das Bild konnte nicht erstellt werden.'));
  renderSketch(context, strokes, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Das Bild konnte nicht erstellt werden.')),
      'image/png',
    ),
  );
}
