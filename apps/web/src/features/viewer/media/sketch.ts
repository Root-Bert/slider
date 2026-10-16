/*
 * Drawings of the Bild tab: an empty slide drawn on with the slide's own tools, kept as the
 * slide's strokes (freehand, arrow, marker, boxes, text – normalised 0–1) and exported as PNG
 * in the look they have on the slide.
 */

import {
  isTextStroke,
  type AccentColor,
  type Point,
  type Rect,
  type Stroke,
  type TextStroke,
} from '@slider/shared';
import { STROKE_STYLE, strokePath, strokesBounds } from '../lib/stroke-path';

/** Paper of the sheet: a light grey, dark enough to sit in the app, light enough to stand out. */
export const SKETCH_BACKGROUND = '#3A3A3A';
/** Format when there is no slide to take it from (comments in a gap between slides). */
export const DEFAULT_SKETCH_ASPECT = 16 / 9;
/** Exported image: sharp enough to zoom in, a few hundred KB as PNG. */
export const SKETCH_EXPORT_WIDTH = 1600;
/** Sheet width (px) the on-screen line widths are meant for – the export scales from it. */
const REFERENCE_WIDTH = 1000;
/** Extra reach of the eraser beyond half a stroke's width, in px (as on the slide). */
const ERASER_REACH = 6;

/** Colours to draw in: one's own first, then the other reviewer colours. */
export function sketchPalette(own: AccentColor): AccentColor[] {
  const others: AccentColor[] = ['red', 'blue', 'green', 'violet', 'cyan', 'yellow'];
  return [own, ...others.filter((color) => color !== own)];
}

/** Whether there is anything to send. */
export const hasInk = (strokes: readonly Stroke[]) => strokes.length > 0;

/** The box of a box stroke (first and last point are opposite corners). */
export function boxOf(stroke: Stroke): Rect | null {
  if (isTextStroke(stroke) || stroke.tool !== 'rect') return null;
  const [a, b] = [stroke.points[0], stroke.points.at(-1)];
  if (!a || !b) return null;
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** Room around a drawing's own bounds for its selection frame (relative). */
const FRAME_PADDING = 0.015;

/** Where a selected stroke's frame goes: its box, its text box, or around its line. */
export function frameOf(stroke: Stroke): Rect | null {
  if (isTextStroke(stroke)) return { x: stroke.x, y: stroke.y, w: stroke.w, h: stroke.h };
  const box = boxOf(stroke);
  if (box) return box;
  const bounds = strokesBounds([stroke]);
  if (!bounds) return null;
  const x = Math.max(0, bounds.x - FRAME_PADDING);
  const y = Math.max(0, bounds.y - FRAME_PADDING);
  return {
    x,
    y,
    w: Math.min(1, bounds.x + bounds.w + FRAME_PADDING) - x,
    h: Math.min(1, bounds.y + bounds.h + FRAME_PADDING) - y,
  };
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** The stroke moved and scaled so that its frame `from` becomes `to`. */
export function placeStroke(stroke: Stroke, from: Rect, to: Rect): Stroke {
  if (isTextStroke(stroke)) return { ...stroke, x: to.x, y: to.y, w: to.w, h: to.h };
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  return {
    ...stroke,
    points: stroke.points.map((point) => ({
      x: round(to.x + (point.x - from.x) * sx),
      y: round(to.y + (point.y - from.y) * sy),
    })),
  };
}

/** Distance (px) from `p` to the segment `a`–`b`. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Whether the eraser at `p` (px on a sheet of `width` × `height` px) touches the stroke: the
 * line of a drawing, the border of a box. Text is not wiped (as on the slide) – it is deleted.
 */
export function eraserHits(stroke: Stroke, p: Point, width: number, height: number): boolean {
  if (isTextStroke(stroke)) return false;
  const px = ({ x, y }: Point) => ({ x: x * width, y: y * height });
  const box = boxOf(stroke);
  const points = box
    ? [
        { x: box.x, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x + box.w, y: box.y + box.h },
        { x: box.x, y: box.y + box.h },
        { x: box.x, y: box.y },
      ].map(px)
    : stroke.points.map(px);
  const reach = STROKE_STYLE[stroke.tool].width / 2 + ERASER_REACH;
  return points.some(
    (point, index) => segmentDistance(p, points[index - 1] ?? point, point) <= reach,
  );
}

/** A reviewer colour as the CSS colour the theme gives it. */
function accentHex(color: AccentColor): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-accent-${color}`)
    .trim();
  return value || '#141414';
}

/** `#rrggbb` mixed with white (`amount` of the colour), as `rgb()`. */
function liftTowardsWhite(hex: string, amount: number): string {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  if (channels.some(Number.isNaN)) return hex;
  const [r, g, b] = channels.map((value) => Math.round(value * amount + 255 * (1 - amount)));
  return `rgb(${r} ${g} ${b})`;
}

const withAlpha = (hex: string, alpha: number) =>
  `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;

const FONT_FAMILY = "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif";
/** Box and text as `TextMark` draws them: padding and line height in em. */
const TEXT_PADDING = { x: 0.35, y: 0.15 };
const TEXT_LINE_HEIGHT = 1.25;

/** Lines of `text` wrapped to `maxWidth` px, breaking long words anywhere (`overflow-wrap`). */
export function wrapText(
  context: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  maxWidth: number,
): string[] {
  const fits = (line: string) => context.measureText(line).width <= maxWidth;
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (fits(line + word)) {
        line += word;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = word.trimStart();
      // A word longer than the box breaks where it runs out of room.
      while (line && !fits(line)) {
        let cut = line.length - 1;
        while (cut > 1 && !fits(line.slice(0, cut))) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawText(
  context: CanvasRenderingContext2D,
  stroke: TextStroke,
  width: number,
  height: number,
) {
  const fontPx = stroke.fontSize * height;
  context.font = `600 ${fontPx}px ${FONT_FAMILY}`;
  const x = stroke.x * width;
  const w = stroke.w * width;
  const lines = wrapText(context, stroke.text, w - 2 * TEXT_PADDING.x * fontPx);
  const lineHeight = fontPx * TEXT_LINE_HEIGHT;
  // At least as tall as its lines (font metrics differ a little from the browser's layout).
  const h = Math.max(stroke.h * height, lines.length * lineHeight + 2 * TEXT_PADDING.y * fontPx);
  const y = stroke.y * height;
  const accent = accentHex(stroke.color);
  // The box: dark glass with a hairline in the colour, rounded like on the slide.
  context.beginPath();
  context.roundRect(x, y, w, h, fontPx * 0.25);
  context.fillStyle = withAlpha('#141414', 0.75);
  context.fill();
  context.lineWidth = Math.max(1, width / REFERENCE_WIDTH);
  context.strokeStyle = withAlpha(accent, 0.55);
  context.stroke();
  // The text: semibold, centred, the colour lifted towards white.
  context.fillStyle = liftTowardsWhite(accent, 0.75);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const top = y + (h - lines.length * lineHeight) / 2;
  lines.forEach((line, index) =>
    context.fillText(line, x + w / 2, top + lineHeight * (index + 0.5)),
  );
}

/** Paints the paper and every stroke as the slide shows it, on a canvas of `width` × `height`. */
export function renderSketch(
  context: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  width: number,
  height: number,
) {
  const scale = width / REFERENCE_WIDTH;
  context.fillStyle = SKETCH_BACKGROUND;
  context.fillRect(0, 0, width, height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    context.save();
    if (isTextStroke(stroke)) drawText(context, stroke, width, height);
    else {
      const color = accentHex(stroke.color);
      const box = boxOf(stroke);
      context.strokeStyle = color;
      if (box) {
        // A box looks like the slide's frames: a 2px rounded border.
        context.lineWidth = 2 * scale;
        context.beginPath();
        context.roundRect(box.x * width, box.y * height, box.w * width, box.h * height, 4 * scale);
        context.stroke();
      } else {
        const style = STROKE_STYLE[stroke.tool];
        // The path is normalised; scaled into the canvas, its width stays uniform.
        const path = new Path2D();
        path.addPath(
          new Path2D(strokePath(stroke, width / height)),
          new DOMMatrix([width, 0, 0, height, 0, 0]),
        );
        context.globalAlpha = style.opacity;
        context.lineWidth = style.width * scale;
        context.stroke(path);
      }
    }
    context.restore();
  }
}

/** The drawing as PNG, rendered fresh at export size in the format it was drawn in (width / height). */
export function exportSketch(strokes: readonly Stroke[], aspect: number): Promise<Blob> {
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
