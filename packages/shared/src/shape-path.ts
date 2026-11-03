import { z } from 'zod';
import { Formulas, Unknown } from './text-area';

/*
 * A drawn shape's own outline (`draw:enhanced-path` – a cloud, a moon, PowerPoint's presets as
 * LibreOffice imports them) as LibreOffice lays it out (`EnhancedCustomShape2d`): its commands,
 * formulas, view box, the views of its parts (`drawooo:sub-view-size`) and stretch points – what
 * the browser cuts a fill drawn over the shape to (`fillArea`).
 */

/** What `draw:enhanced-geometry` says about a shape's own outline. */
export const shapePathSchema = z.object({
  /** `drawooo:enhanced-path` (with PowerPoint's arcs), else `draw:enhanced-path`. */
  path: z.string(),
  viewBox: z.string().optional(),
  /** `draw:equation`s by name. */
  equations: z.record(z.string(), z.string()).optional(),
  /** `drawooo:sub-view-size`: each part's own view (pairs of width and height). */
  subViews: z.string().optional(),
  stretchX: z.string().optional(),
  stretchY: z.string().optional(),
});
export type ShapePath = z.infer<typeof shapePathSchema>;

/** One step of an outline: to a point, a cubic curve to its last point, or closed. */
export type OutlineStep =
  | { op: 'M' | 'L'; points: [[number, number]] }
  | { op: 'C'; points: [[number, number], [number, number], [number, number]] }
  | { op: 'Z'; points: [] };

type Point = [number, number];

/**
 * Cubic curves along an ellipse (`rx`, `ry` about `c`, y down) from angle `from` to `to` (its
 * parameter, radians), with the point it starts at.
 */
export function ellipseArc(
  c: Point,
  rx: number,
  ry: number,
  from: number,
  to: number,
): { start: Point; steps: OutlineStep[] } {
  const steps: OutlineStep[] = [];
  const parts = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2) - 1e-9));
  const delta = (to - from) / parts;
  const k = (4 / 3) * Math.tan(delta / 4);
  const at = (t: number): Point => [c[0] + rx * Math.cos(t), c[1] + ry * Math.sin(t)];
  for (let i = 0; i < parts; i++) {
    const a = from + i * delta;
    const b = a + delta;
    const [p0, p3] = [at(a), at(b)];
    steps.push({
      op: 'C',
      points: [
        [p0[0] - k * rx * Math.sin(a), p0[1] + k * ry * Math.cos(a)],
        [p3[0] + k * rx * Math.sin(b), p3[1] - k * ry * Math.cos(b)],
        p3,
      ],
    });
  }
  return { start: at(from), steps };
}

/** An angle on an ellipse as seen (`visual`, radians) as the ellipse's own parameter. */
const parameterOf = (visual: number, rx: number, ry: number) =>
  Math.atan2(rx * Math.sin(visual), ry * Math.cos(visual));

const COMMANDS = new Set('MLCQZNFSGTUABWVXY'.split(''));
/** Coordinates each command takes per repeat. */
const ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  C: 6,
  Q: 4,
  G: 4,
  T: 6,
  U: 6,
  A: 8,
  B: 8,
  W: 8,
  V: 8,
  X: 2,
  Y: 2,
};

/**
 * The area a custom shape fills – its parts not marked unfilled (`F`) – as steps in a `width` ×
 * `height` box (its own units, top left at 0,0), not mirrored; `null` when the geometry cannot be
 * read (an unknown command or formula). `modifiers`: `draw:modifiers`. `lines`: its parts only
 * drawn as lines instead (a cloud's arcs inside it), none: `[]`.
 */
export function shapeAreaSteps(
  geometry: ShapePath,
  type: string | undefined,
  modifiers: readonly number[] | undefined,
  width: number,
  height: number,
  lines = false,
): OutlineStep[] | null {
  if (!(width > 0) || !(height > 0)) return null;
  const ooxml = (type ?? '').startsWith('ooxml-');
  const view = (geometry.viewBox ?? '0 0 21600 21600').trim().split(/\s+/).map(Number);
  const [left = 0, top = 0, viewWidth = 21600, viewHeight = 21600] = view;
  if (view.some((n) => !Number.isFinite(n))) return null;
  // The box in LibreOffice's logic units (1/100 mm), with its width and height in cm.
  const logWidth = width * 1000;
  const logHeight = height * 1000;
  const stretchX = Number(geometry.stretchX ?? NaN);
  const stretchY = Number(geometry.stretchY ?? NaN);
  const formulas = new Formulas(geometry.equations ?? {}, [...(modifiers ?? [])], {
    left,
    top,
    right: left + viewWidth,
    bottom: top + viewHeight,
    width: viewWidth,
    height: viewHeight,
    logwidth: logWidth,
    logheight: logHeight,
    xstretch: Number.isFinite(stretchX) ? stretchX : 0,
    ystretch: Number.isFinite(stretchY) ? stretchY : 0,
    hasstroke: 1,
    hasfill: 1,
  });
  const subViews = (geometry.subViews ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
  const tokens =
    geometry.path.match(
      /\?[A-Za-z0-9_]+|\$\d+|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[a-z][a-z0-9]*|[A-Z]/g,
    ) ?? [];

  try {
    const filled: OutlineStep[] = [];
    const stroked: OutlineStep[] = [];
    let part: OutlineStep[] = [];
    let partFilled = true;
    let partIndex = 0;
    // A part's own view: how its coordinates map onto the box (`SetPathSize`).
    let scale = { x: 1, y: 1, ratioX: 1, ratioY: 1, viewW: viewWidth, viewH: viewHeight };
    const setView = () => {
      const [subW = 0, subH = 0] = subViews.slice(partIndex * 2, partIndex * 2 + 2);
      const viewW = subW && subH ? subW : viewWidth;
      const viewH = subW && subH ? subH : viewHeight;
      if (!ooxml && (viewW <= 0 || viewH <= 0)) throw new Unknown('view');
      // Along a stretch point, a box longer that way keeps its corners (`along`).
      const ratioX = !ooxml && Number.isFinite(stretchX) && width > height ? width / height : 1;
      const ratioY = !ooxml && Number.isFinite(stretchY) && height > width ? height / width : 1;
      scale = {
        // Box widths per unit of the view.
        x: viewW > 0 ? 1 / viewW : 1 / logWidth,
        y: viewH > 0 ? 1 / viewH : 1 / logHeight,
        ratioX,
        ratioY,
        viewW,
        viewH,
      };
    };
    setView();
    const along = (n: number, origin: number, view: number, stretch: number, ratio: number) => {
      const at = n - origin;
      if (ratio <= 1) return at / view;
      return (at > stretch - origin ? at + view * (ratio - 1) : at) / (view * ratio);
    };
    const x = (n: number) =>
      (ooxml || scale.viewW <= 0
        ? n * scale.x
        : along(n, left, scale.viewW, stretchX, scale.ratioX)) * width;
    const y = (n: number) =>
      (ooxml || scale.viewH <= 0
        ? n * scale.y
        : along(n, top, scale.viewH, stretchY, scale.ratioY)) * height;
    // A radius: scaled, never moved.
    const rx = (n: number) => (n * scale.x * width) / scale.ratioX;
    const ry = (n: number) => (n * scale.y * height) / scale.ratioY;

    let current: Point | null = null;
    let start: Point | null = null;
    const moveTo = (p: Point) => {
      part.push({ op: 'M', points: [p] });
      current = start = p;
    };
    const lineTo = (p: Point) => {
      if (!current) return moveTo(p);
      part.push({ op: 'L', points: [p] });
      current = p;
    };
    // An arc: a line to where it starts (a new part of the outline: `move`), then its curves.
    const curves = ({ start: begin, steps }: ReturnType<typeof ellipseArc>, move: boolean) => {
      if (move || !current) moveTo(begin);
      else lineTo(begin);
      part.push(...steps);
      current = steps.at(-1)?.points.at(-1) ?? begin;
    };
    const endPart = () => {
      (partFilled ? filled : stroked).push(...part);
      part = [];
      partFilled = true;
      current = start = null;
      partIndex += 1;
      setView();
    };

    let i = 0;
    let command = '';
    // The coordinates read so far (each a point): X and Y look back one.
    let previous: Point | null = null;
    // X and Y: how many quarters so far, and which way the first went (`EnhancedCustomShape2d`).
    let quadrant = 0;
    let firstDirection = true;
    const value = (token: string | undefined) => {
      if (token === undefined || COMMANDS.has(token)) throw new Unknown('end');
      return formulas.value(token);
    };
    const pointAt = (): Point => {
      const p: Point = [x(value(tokens[i])), y(value(tokens[i + 1]))];
      i += 2;
      previous = p;
      return p;
    };
    while (i < tokens.length) {
      const token = tokens[i]!;
      if (/^[A-Z]$/.test(token)) {
        if (!COMMANDS.has(token)) throw new Unknown(token);
        command = token;
        i += 1;
        if (command === 'Z') {
          if (current && start) part.push({ op: 'Z', points: [] });
          current = start;
          continue;
        }
        if (command === 'N') {
          endPart();
          continue;
        }
        if (command === 'F') {
          partFilled = false;
          continue;
        }
        if (command === 'S') continue;
        // X and Y count their points from the first after the letter.
        quadrant = 0;
        firstDirection = true;
      } else if (!command || !ARITY[command]) {
        throw new Unknown(token);
      }
      const arity = ARITY[command]!;
      if (i + arity > tokens.length) throw new Unknown('short');
      switch (command) {
        case 'M':
          moveTo(pointAt());
          // More points after one move are lines to them.
          command = 'L';
          break;
        case 'L':
          lineTo(pointAt());
          break;
        case 'C': {
          const c1 = pointAt();
          const c2 = pointAt();
          const p = pointAt();
          if (!current) moveTo(c1);
          part.push({ op: 'C', points: [c1, c2, p] });
          current = p;
          break;
        }
        case 'Q': {
          const c = pointAt();
          const p = pointAt();
          const from: Point = current ?? c;
          if (!current) moveTo(c);
          part.push({
            op: 'C',
            points: [
              [from[0] + ((c[0] - from[0]) * 2) / 3, from[1] + ((c[1] - from[1]) * 2) / 3],
              [p[0] + ((c[0] - p[0]) * 2) / 3, p[1] + ((c[1] - p[1]) * 2) / 3],
              p,
            ],
          });
          current = p;
          break;
        }
        case 'G': {
          // PowerPoint's arc: radii, then start and swing (degrees, clockwise as seen) – on from
          // where the outline is.
          const ownW = value(tokens[i]);
          const ownH = value(tokens[i + 1]);
          const wR = rx(ownW);
          const hR = ry(ownH);
          const startAngle = value(tokens[i + 2]);
          const swing = value(tokens[i + 3]);
          i += 4;
          if (!current) throw new Unknown('G');
          const at = current as Point;
          const deg = Math.PI / 180;
          // Angles as seen in the path's own view, before it is stretched over the box.
          const t1 = parameterOf(startAngle * deg, ownW, ownH);
          let t2 = parameterOf((startAngle + swing) * deg, ownW, ownH);
          const turns = Math.floor(Math.abs(swing) / 360) * 2 * Math.PI;
          if (swing > 0) {
            while (t2 <= t1 + 1e-12) t2 += 2 * Math.PI;
            t2 += turns;
          } else if (swing < 0) {
            while (t2 >= t1 - 1e-12) t2 -= 2 * Math.PI;
            t2 -= turns;
          } else break;
          const centre: Point = [at[0] - wR * Math.cos(t1), at[1] - hR * Math.sin(t1)];
          if (wR > 0 && hR > 0) {
            const { steps } = ellipseArc(centre, wR, hR, t1, t2);
            part.push(...steps);
            current = steps.at(-1)?.points.at(-1) ?? at;
          }
          break;
        }
        case 'T':
        case 'U': {
          // An ellipse's arc about its centre, radii, angles as seen (degrees, clockwise as seen
          // – measured by drawing them in LibreOffice).
          const c = pointAt();
          const w = rx(value(tokens[i]));
          const h = ry(value(tokens[i + 1]));
          const a0 = value(tokens[i + 2]);
          const a1 = value(tokens[i + 3]);
          i += 4;
          const full = Math.trunc(a0) % 360 === Math.trunc(a1) % 360;
          const p0 = parameterOf((a0 * Math.PI) / 180, w, h);
          let diff = full ? 2 * Math.PI : parameterOf((a1 * Math.PI) / 180, w, h) - p0;
          if (diff < 0) diff += 2 * Math.PI;
          curves(ellipseArc(c, w, h, p0, p0 + diff), command === 'U');
          break;
        }
        case 'A':
        case 'B':
        case 'W':
        case 'V': {
          const p1 = pointAt();
          const p2 = pointAt();
          const p3 = pointAt();
          const p4 = pointAt();
          const clockwise = command === 'W' || command === 'V';
          const w = Math.abs(p2[0] - p1[0]) / 2;
          const h = Math.abs(p2[1] - p1[1]) / 2;
          if (w <= 0 || h <= 0) break;
          const c: Point = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
          let [from, to] = clockwise ? [p4, p3] : [p3, p4];
          // A box given the other way round along one side: the arc runs the other way.
          if (p1[0] > p2[0] !== p1[1] > p2[1]) [from, to] = [to, from];
          const param = (p: Point) =>
            parameterOf(Math.atan2(c[1] - p[1], p[0] - c[0] || 1e-9), w, h);
          const pFrom = param(from);
          let diff = param(to) - pFrom;
          if (diff <= 0) diff += 2 * Math.PI;
          const steps = clockwise
            ? ellipseArc(c, w, h, -pFrom - diff, -pFrom)
            : ellipseArc(c, w, h, -pFrom, -pFrom - diff);
          curves(steps, command === 'B' || command === 'V');
          break;
        }
        case 'X':
        case 'Y': {
          // A quarter of an ellipse to the point, first along x (`X`) or y: its corner the point's
          // x and the previous one's y (or the other way), the controls halfway to it.
          const before = previous;
          const p = pointAt();
          if (!before || !current) {
            lineTo(p);
            break;
          }
          const [dx, dy] = [p[0] - before[0], p[1] - before[1]];
          const differ = dx < 0 !== dy < 0;
          let alongX = command === 'X';
          if (quadrant === 0) firstDirection = differ;
          else if (differ !== firstDirection) alongX = !alongX;
          quadrant += 1;
          const corner: Point = alongX ? [p[0], before[1]] : [before[0], p[1]];
          part.push({
            op: 'C',
            points: [
              [before[0] + (corner[0] - before[0]) / 2, before[1] + (corner[1] - before[1]) / 2],
              [p[0] + (corner[0] - p[0]) / 2, p[1] + (corner[1] - p[1]) / 2],
              p,
            ],
          });
          current = p;
          break;
        }
      }
    }
    (partFilled ? filled : stroked).push(...part);
    if (!filled.some((step) => step.op !== 'M')) return null;
    return lines ? stroked : filled;
  } catch (error) {
    if (error instanceof Unknown) return null;
    throw error;
  }
}
