/*
 * Drawings of the Bild tab: strokes kept as vectors (normalised 0–1, so the canvas can be any
 * size and undo is just dropping the last stroke), rendered onto a canvas and exported as PNG.
 */

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

/** Paints the paper and every stroke, smoothed through the midpoints of its points. */
export function renderSketch(
  context: CanvasRenderingContext2D,
  strokes: readonly SketchStroke[],
  width: number,
  height: number,
) {
  context.save();
  context.fillStyle = SKETCH_BACKGROUND;
  context.fillRect(0, 0, width, height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    const [first, ...rest] = stroke.points;
    if (!first) continue;
    const color = stroke.tool === 'eraser' ? SKETCH_BACKGROUND : stroke.color;
    const lineWidth = Math.max(1, stroke.width * width);
    const x = (point: [number, number]) => point[0] * width;
    const y = (point: [number, number]) => point[1] * height;
    if (rest.length === 0) {
      // A tap: a dot.
      context.fillStyle = color;
      context.beginPath();
      context.arc(x(first), y(first), lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(x(first), y(first));
    let previous = first;
    for (const point of rest) {
      context.quadraticCurveTo(
        x(previous),
        y(previous),
        (x(previous) + x(point)) / 2,
        (y(previous) + y(point)) / 2,
      );
      previous = point;
    }
    context.lineTo(x(previous), y(previous));
    context.stroke();
  }
  context.restore();
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
