import { ACCENT_COLORS, type AccentColor } from '@slider/shared';

/*
 * A drawing on a page – pen and marker strokes, written by hand – kept in the Markdown file as a
 * fenced block of its own, one stroke a line, so a stroke drawn is one line more in the file (the
 * page sends only the lines that changed) and a stroke wiped one line less:
 *
 *   ```ink 400
 *   pen text 3 120 40 121 42 125 47
 *   marker yellow 18 300 80 420 82
 *   ```
 *
 * The block is INK_WIDTH units wide at any width it is shown; the number after `ink` is its
 * height in the same units. A stroke: its tool, its colour (`text` – the page's text colour – or
 * an accent), its width and its points as whole numbers. A line the page does not read is kept
 * as it stands.
 */

export const INK_WIDTH = 1000;
export const INK_HEIGHT = 360;
/** Drawn near its foot, the block grows by this much (no fixed sheet to write off). */
export const INK_GROW = 240;
export const INK_MAX_HEIGHT = 20_000;
/** A line of the file holds 20 000 characters: a longer stroke goes on in a line of its own. */
const MAX_POINTS = 1500;

export type InkTool = 'pen' | 'marker';
export type InkColor = 'text' | AccentColor;
export type InkPoint = readonly [number, number];

export interface InkStroke {
  tool: InkTool;
  color: InkColor;
  width: number;
  points: InkPoint[];
}

export interface Ink {
  height: number;
  /** Each stroke with its line in the block (0: the fence). */
  strokes: { line: number; stroke: InkStroke }[];
}

/** The fence's first line: ```ink, its height after it. */
const OPEN = /^\s{0,3}(`{3,}|~{3,})\s*ink(?:\s+(\d+))?\s*$/i;
const COLORS = new Set<string>(['text', ...ACCENT_COLORS]);

/** Whether the block's lines are a drawing: ```ink, closed. */
export function isInkFence(lines: readonly string[]): boolean {
  const open = OPEN.exec(lines[0] ?? '');
  if (!open || lines.length < 2) return false;
  const close = lines.at(-1)!.trim();
  return close.startsWith(open[1]!) && /^[`~]+$/.test(close);
}

export function parseStroke(line: string): InkStroke | null {
  const [tool, color, width, ...rest] = line.trim().split(/\s+/);
  if ((tool !== 'pen' && tool !== 'marker') || !color || !COLORS.has(color)) return null;
  const size = Number(width);
  if (!Number.isFinite(size) || size <= 0 || rest.length < 2 || rest.length % 2 !== 0) return null;
  const numbers = rest.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const points: InkPoint[] = [];
  for (let at = 0; at < numbers.length; at += 2) points.push([numbers[at]!, numbers[at + 1]!]);
  return { tool, color: color as InkColor, width: size, points };
}

export function parseInk(text: string): Ink {
  const lines = text.split('\n');
  const height = Number(OPEN.exec(lines[0] ?? '')?.[2]);
  const strokes: Ink['strokes'] = [];
  lines.slice(1, isInkFence(lines) ? -1 : undefined).forEach((line, index) => {
    const stroke = parseStroke(line);
    if (stroke) strokes.push({ line: index + 1, stroke });
  });
  return {
    height: Number.isFinite(height) && height > 0 ? Math.min(height, INK_MAX_HEIGHT) : INK_HEIGHT,
    strokes,
  };
}

const round = (value: number) => Math.round(value);

/** A stroke as its lines – more than one when it is longer than a line holds. */
export function strokeLines(stroke: InkStroke): string[] {
  const lines: string[] = [];
  for (let at = 0; at < stroke.points.length; at += MAX_POINTS) {
    // Each piece starts where the one before ended: no gap in the line.
    const piece = stroke.points.slice(Math.max(0, at - 1), at + MAX_POINTS);
    const flat = piece.flatMap(([x, y]) => [round(x), round(y)]).join(' ');
    lines.push(`${stroke.tool} ${stroke.color} ${round(stroke.width)} ${flat}`);
  }
  return lines;
}

/** An empty drawing, as a new one is written. */
export const newInk = (height = INK_HEIGHT) => `\`\`\`ink ${height}\n\`\`\``;

/** The block with these strokes drawn: before its closing fence (or at its end, unclosed). */
export function addStrokes(text: string, strokes: readonly InkStroke[]): string {
  const lines = text.split('\n');
  const end = isInkFence(lines) ? lines.length - 1 : lines.length;
  lines.splice(end, 0, ...strokes.flatMap(strokeLines));
  return lines.join('\n');
}

/** The block without the strokes on these lines (as `parseInk` numbered them). */
export function removeLines(text: string, gone: ReadonlySet<number>): string {
  return text
    .split('\n')
    .filter((_, index) => !gone.has(index))
    .join('\n');
}

/** The block at this height: its first line written anew, the rest as it stands. */
export function setHeight(text: string, height: number): string {
  const lines = text.split('\n');
  const open = OPEN.exec(lines[0] ?? '');
  const fence = open?.[1] ?? '```';
  lines[0] = `${fence}ink ${round(Math.min(Math.max(height, 80), INK_MAX_HEIGHT))}`;
  return lines.join('\n');
}

/** Whether the point lies within `radius` of the stroke's line (the eraser's touch). */
export function touches(stroke: InkStroke, [x, y]: InkPoint, radius: number): boolean {
  const reach = radius + stroke.width / 2;
  const { points } = stroke;
  if (points.length === 1) return Math.hypot(points[0]![0] - x, points[0]![1] - y) <= reach;
  for (let at = 1; at < points.length; at += 1) {
    const [ax, ay] = points[at - 1]!;
    const [bx, by] = points[at]!;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= reach) return true;
  }
  return false;
}

/**
 * A smooth path through the points: quadratic curves with each point as control and the middles
 * between neighbours as anchors (as the slide's strokes are drawn).
 */
export function inkPath(points: readonly InkPoint[]): string {
  const [first, ...rest] = points;
  if (!first) return '';
  if (rest.length === 0) return `M${first[0]} ${first[1]}h0.01`;
  if (rest.length === 1) return `M${first[0]} ${first[1]}L${rest[0]![0]} ${rest[0]![1]}`;
  let d = `M${first[0]} ${first[1]}`;
  for (let at = 1; at < points.length - 1; at += 1) {
    const [cx, cy] = points[at]!;
    const [nx, ny] = points[at + 1]!;
    d += `Q${cx} ${cy} ${(cx + nx) / 2} ${(cy + ny) / 2}`;
  }
  const last = points.at(-1)!;
  return `${d}L${last[0]} ${last[1]}`;
}
