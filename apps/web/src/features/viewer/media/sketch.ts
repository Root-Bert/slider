/*
 * Drawings of the Bild tab, with the tools of the slide: freehand, arrow, marker, box and text.
 * Everything is kept as vectors (normalised 0–1, so the canvas can be any size), rendered onto a
 * canvas and exported as PNG. The eraser removes whole strokes, like on the slide.
 */

import { getStroke, type StrokeOptions } from 'perfect-freehand';

/** The tool bar's tools, in the order of the slide's tool bar (plus box and text). */
export type SketchTool = 'pen' | 'arrow' | 'highlighter' | 'rect' | 'text' | 'eraser';

type Pair = [number, number];

/** Freehand and marker follow their points; arrow and box run from the first to the last. */
export interface SketchPathStroke {
  tool: 'pen' | 'arrow' | 'highlighter' | 'rect';
  color: string;
  /** Line width relative to the canvas width. */
  width: number;
  /** `[x, y]` pairs, 0–1 across the canvas. */
  points: Pair[];
}

/** Text written on the sheet: top-left corner, wrap width (relative), font size (of the height). */
export interface SketchTextStroke {
  tool: 'text';
  color: string;
  x: number;
  y: number;
  w: number;
  text: string;
  fontSize: number;
}

export type SketchStroke = SketchPathStroke | SketchTextStroke;

/** Paper of the canvas – white like a slide, so the sheet stands out against the dark composer. */
export const SKETCH_BACKGROUND = '#FFFFFF';
/** Format when there is no slide to take it from (comments in a gap between slides). */
export const DEFAULT_SKETCH_ASPECT = 16 / 9;
/** Exported image: sharp enough to zoom in, a few hundred KB as PNG. */
export const SKETCH_EXPORT_WIDTH = 1600;

/** Line widths (of the canvas width) per tool, fine and bold. */
export const SKETCH_WIDTHS = {
  pen: { fine: 0.004, bold: 0.012 },
  arrow: { fine: 0.004, bold: 0.01 },
  rect: { fine: 0.004, bold: 0.01 },
  highlighter: { fine: 0.025, bold: 0.05 },
} as const;
/** Text size (of the canvas height), fine and bold. */
export const SKETCH_FONT_SIZES = { fine: 0.05, bold: 0.08 } as const;
/** Wiggle room of the eraser around a stroke, in px. */
const ERASER_REACH = 8;
const MARKER_OPACITY = 0.4;
const FONT_FAMILY = "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif";
const LINE_HEIGHT = 1.25;

/** Pen colours: ink, the viewer's own colour, then colours that read on the white paper. */
export function sketchPalette(ownColor: string): string[] {
  const colors = ['#141414', ownColor, '#EF4444', '#0048FF', '#22C55E'];
  return colors.filter(
    (color, index) =>
      colors.findIndex((other) => other.toLowerCase() === color.toLowerCase()) === index,
  );
}

/** Drops points closer than `minDistance` to the previous one (pointer events come in bursts). */
export function addPoint(points: readonly Pair[], point: Pair, minDistance = 0.002): Pair[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < minDistance) return [...points];
  return [...points, point];
}

/** Arrow and box: only where the drag started and where it is now. */
export const isTwoPointTool = (tool: SketchTool) => tool === 'arrow' || tool === 'rect';

/**
 * Pen feel of `perfect-freehand`: lines thin out when drawn fast and swell when slow, with
 * tapered ends.
 */
const PEN: StrokeOptions = {
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
};

/** Paints the paper and every stroke. */
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
    context.save();
    if (stroke.tool === 'text') drawText(context, stroke, width, height);
    else drawPath(context, stroke, width, height);
    context.restore();
  }
  context.restore();
}

function drawPath(
  context: CanvasRenderingContext2D,
  stroke: SketchPathStroke,
  width: number,
  height: number,
) {
  const points = stroke.points.map(([x, y]): Pair => [x * width, y * height]);
  const [first] = points;
  const last = points.at(-1);
  if (!first || !last) return;
  const lineWidth = Math.max(1, stroke.width * width);
  context.fillStyle = stroke.color;
  context.strokeStyle = stroke.color;
  context.lineWidth = lineWidth;
  switch (stroke.tool) {
    case 'pen':
      // A filled freehand outline; a tap gives a dot.
      context.fill(outlinePath(getStroke(points, { ...PEN, size: lineWidth, last: true })));
      return;
    case 'highlighter':
      // Multiply: what is underneath shows through, like a real marker. One path, so the
      // stroke doesn't darken where it crosses itself.
      context.globalAlpha = MARKER_OPACITY;
      context.globalCompositeOperation = 'multiply';
      context.stroke(smoothPath(points));
      return;
    case 'arrow': {
      const angle = Math.atan2(last[1] - first[1], last[0] - first[0]);
      const head = lineWidth * 3 + 10;
      const wing = (offset: number): Pair => [
        last[0] - Math.cos(angle + offset) * head,
        last[1] - Math.sin(angle + offset) * head,
      ];
      const path = new Path2D();
      path.moveTo(...first);
      path.lineTo(...last);
      path.moveTo(...wing(Math.PI / 7));
      path.lineTo(...last);
      path.lineTo(...wing(-Math.PI / 7));
      context.stroke(path);
      return;
    }
    case 'rect':
      context.strokeRect(
        Math.min(first[0], last[0]),
        Math.min(first[1], last[1]),
        Math.abs(last[0] - first[0]),
        Math.abs(last[1] - first[1]),
      );
      return;
  }
}

/** Path through the points, smoothed through their midpoints. */
function smoothPath(points: readonly Pair[]): Path2D {
  const path = new Path2D();
  const [first, ...rest] = points;
  if (!first) return path;
  path.moveTo(...first);
  if (rest.length === 0) path.lineTo(...first);
  let previous = first;
  for (const point of rest) {
    path.quadraticCurveTo(
      previous[0],
      previous[1],
      (previous[0] + point[0]) / 2,
      (previous[1] + point[1]) / 2,
    );
    previous = point;
  }
  path.lineTo(...previous);
  return path;
}

/** Closed path around a freehand outline, smoothed through the midpoints of its points. */
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

/** CSS font of a text stroke at a canvas `height` in px – the editor uses the same. */
export const sketchFont = (fontSize: number, height: number) =>
  `500 ${fontSize * height}px ${FONT_FAMILY}`;
export const SKETCH_LINE_HEIGHT = LINE_HEIGHT;

/** Lines of a text stroke wrapped to its width, and the box they fill (px). */
export function layoutText(
  context: CanvasRenderingContext2D,
  stroke: SketchTextStroke,
  width: number,
  height: number,
) {
  context.save();
  context.font = sketchFont(stroke.fontSize, height);
  const maxWidth = stroke.w * width;
  const lines: string[] = [];
  for (const paragraph of stroke.text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word;
      if (line && context.measureText(next).width > maxWidth && word.trim()) {
        lines.push(line.trimEnd());
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  const widest = Math.max(0, ...lines.map((line) => context.measureText(line).width));
  context.restore();
  const lineHeight = stroke.fontSize * height * LINE_HEIGHT;
  return {
    lines,
    lineHeight,
    box: { x: stroke.x * width, y: stroke.y * height, w: widest, h: lines.length * lineHeight },
  };
}

function drawText(
  context: CanvasRenderingContext2D,
  stroke: SketchTextStroke,
  width: number,
  height: number,
) {
  const { lines, lineHeight, box } = layoutText(context, stroke, width, height);
  context.font = sketchFont(stroke.fontSize, height);
  context.fillStyle = stroke.color;
  context.textBaseline = 'middle';
  lines.forEach((line, index) => context.fillText(line, box.x, box.y + lineHeight * (index + 0.5)));
}

/** Distance from `p` to the segment `a`–`b`. */
function segmentDistance(p: Pair, a: Pair, b: Pair): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Whether the eraser at `p` (px) touches the stroke on a canvas of `width` × `height` px. */
export function eraserHits(
  context: CanvasRenderingContext2D,
  stroke: SketchStroke,
  p: Pair,
  width: number,
  height: number,
): boolean {
  if (stroke.tool === 'text') {
    const { box } = layoutText(context, stroke, width, height);
    return (
      p[0] >= box.x - ERASER_REACH &&
      p[0] <= box.x + box.w + ERASER_REACH &&
      p[1] >= box.y - ERASER_REACH &&
      p[1] <= box.y + box.h + ERASER_REACH
    );
  }
  const points = stroke.points.map(([x, y]): Pair => [x * width, y * height]);
  const reach = (stroke.width * width) / 2 + ERASER_REACH;
  const [first] = points;
  const last = points.at(-1);
  if (!first || !last) return false;
  if (stroke.tool === 'rect') {
    const corners: Pair[] = [first, [last[0], first[1]], last, [first[0], last[1]]];
    return corners.some(
      (corner, index) => segmentDistance(p, corner, corners[(index + 1) % 4] ?? corner) <= reach,
    );
  }
  const line = stroke.tool === 'arrow' ? [first, last] : points;
  return line.some((point, index) => segmentDistance(p, line[index - 1] ?? point, point) <= reach);
}

/** The text stroke under `p` (px), topmost first, for editing it. */
export function textAt(
  context: CanvasRenderingContext2D,
  strokes: readonly SketchStroke[],
  p: Pair,
  width: number,
  height: number,
): number {
  for (let index = strokes.length - 1; index >= 0; index--) {
    const stroke = strokes[index];
    if (stroke?.tool !== 'text') continue;
    const { box } = layoutText(context, stroke, width, height);
    if (p[0] >= box.x && p[0] <= box.x + box.w && p[1] >= box.y && p[1] <= box.y + box.h)
      return index;
  }
  return -1;
}

/** Whether there is anything to send. */
export const hasInk = (strokes: readonly SketchStroke[]) => strokes.length > 0;

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
