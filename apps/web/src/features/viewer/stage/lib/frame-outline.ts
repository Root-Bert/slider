import type { RectCorner } from './rect-edit';

/**
 * The line around a picked slide element as one stroke: it runs along the box's edge and, where a
 * handle sits, out around it – a square bracket over each corner, a dome over the middle of the
 * top edge for turning. Pixels, the box's top left at 0,0.
 */

/** Half the side of a corner handle. */
export const CORNER_HALF = 7;
/** Radius of the turning dome. */
export const DOME_RADIUS = 10;
/** Rounding of the brackets' outer corners. */
const BEND = 3;
/** Rounding where the line leaves the edge for a bracket and comes back. */
const FILLET = 2;

interface Vertex {
  x: number;
  y: number;
  /** Rounded by this much (0: sharp). */
  r: number;
}

const v = (x: number, y: number, r = 0): Vertex => ({ x, y, r });

/** Straight line left between two brackets on a short side, at least. */
const BETWEEN = 4;

/**
 * The bracket's corners around `corner` of a `w` × `h` box, in clockwise order. Outwards always as
 * large; inwards along a short side only so far that the line runs on between it and the next one –
 * a flat box keeps its size, its brackets get shorter. Opened by `open` (0: shrunk to the box's
 * corner, 1: full): the line grows out of the corner into the bracket.
 */
function bracket(corner: RectCorner, w: number, h: number, open = 1): Vertex[] {
  const a = CORNER_HALF * open;
  const ix = Math.max(0, Math.min(CORNER_HALF, (w - BETWEEN) / 2)) * open;
  const iy = Math.max(0, Math.min(CORNER_HALF, (h - BETWEEN) / 2)) * open;
  const b = BEND * open;
  // Where it leaves the edge: rounded no more than it runs along it.
  const fx = Math.min(FILLET, ix);
  const fy = Math.min(FILLET, iy);
  switch (corner) {
    case 'nw':
      return [v(0, iy, fy), v(-a, iy, b), v(-a, -a, b), v(ix, -a, b), v(ix, 0, fx)];
    case 'ne':
      return [v(w - ix, 0, fx), v(w - ix, -a, b), v(w + a, -a, b), v(w + a, iy, b), v(w, iy, fy)];
    case 'se':
      return [
        v(w, h - iy, fy),
        v(w + a, h - iy, b),
        v(w + a, h + a, b),
        v(w - ix, h + a, b),
        v(w - ix, h, fx),
      ];
    case 'sw':
      return [v(ix, h, fx), v(ix, h + a, b), v(-a, h + a, b), v(-a, h - iy, b), v(0, h - iy, fy)];
  }
}

const unit = (from: Vertex, to: Vertex) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

/** A closed polygon as path data, each vertex rounded by its `r`. */
function polygon(vertices: Vertex[], dome?: { cx: number; open: number }): string {
  const parts: string[] = [];
  vertices.forEach((point, index) => {
    const before = vertices[(index + vertices.length - 1) % vertices.length]!;
    const after = vertices[(index + 1) % vertices.length]!;
    const command = index === 0 ? 'M' : 'L';
    if (point.r === 0) parts.push(`${command}${point.x} ${point.y}`);
    else {
      const back = unit(point, before);
      const ahead = unit(point, after);
      parts.push(
        `${command}${point.x + back.x * point.r} ${point.y + back.y * point.r}`,
        `Q${point.x} ${point.y} ${point.x + ahead.x * point.r} ${point.y + ahead.y * point.r}`,
      );
    }
    // The dome sits on the top edge, right after the top left corner's last vertex.
    if (dome && dome.open > 0 && index === 0) {
      // Leaving the edge and coming back softly, as at the brackets; grown by how far it is open.
      const R = DOME_RADIUS * dome.open;
      const F = FILLET * dome.open;
      const lift = 0.4;
      const [dx, dy] = [R * Math.cos(lift), R * Math.sin(lift)];
      parts.push(
        `L${dome.cx - R - F} 0`,
        `Q${dome.cx - R} 0 ${dome.cx - dx} ${-dy}`,
        `A${R} ${R} 0 0 1 ${dome.cx + dx} ${-dy}`,
        `Q${dome.cx + R} 0 ${dome.cx + R + F} 0`,
      );
    }
  });
  return `${parts.join(' ')} Z`;
}

const ORDER: RectCorner[] = ['nw', 'ne', 'se', 'sw'];

/** A handle the line runs out around: a corner's bracket or the turning dome. */
export type FrameHandle = RectCorner | 'turn';

/** How far each handle's bracket or dome is opened (0 to 1); a handle not named is fully open. */
export type BracketOpening = Partial<Record<FrameHandle, number>>;

/**
 * The outline of a `w` × `h` box as one closed stroke, with brackets over `corners` – each opened as
 * far as `opening` says – and, when `dome`, the turning dome over its top edge (opened as `turn`). A box too narrow for
 * the dome between its brackets gets it on its own.
 */
export function frameOutline(
  w: number,
  h: number,
  corners: readonly RectCorner[],
  dome: boolean,
  opening: BracketOpening = {},
): string {
  const cx = w / 2;
  const roomy = w >= 2 * (CORNER_HALF + DOME_RADIUS + FILLET) + 4;
  // From the top left corner on, clockwise; the dome is drawn after the first vertex (top edge).
  const vertices: Vertex[] = [];
  for (const corner of ORDER) {
    if (corners.includes(corner)) vertices.push(...bracket(corner, w, h, opening[corner] ?? 1));
    else
      vertices.push(
        corner === 'nw' ? v(0, 0) : corner === 'ne' ? v(w, 0) : corner === 'se' ? v(w, h) : v(0, h),
      );
  }
  // Start on the top edge: the dome follows right after.
  const firstTop = corners.includes('nw') ? 4 : 0;
  const ordered = [...vertices.slice(firstTop), ...vertices.slice(0, firstTop)];
  const open = opening.turn ?? 1;
  const R = DOME_RADIUS * open;
  const domePath = `M${cx - R} 0 A${R} ${R} 0 0 1 ${cx + R} 0 Z`;
  const line = polygon(ordered, dome && roomy ? { cx, open } : undefined);
  return dome && !roomy && open > 0 ? `${line} ${domePath}` : line;
}

/** An open line through `vertices`, its inner vertices rounded by their `r`. */
function polyline(vertices: Vertex[]): string {
  return vertices
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L';
      const before = vertices[index - 1];
      const after = vertices[index + 1];
      if (point.r === 0 || !before || !after) return `${command}${point.x} ${point.y}`;
      const back = unit(point, before);
      const ahead = unit(point, after);
      return (
        `${command}${point.x + back.x * point.r} ${point.y + back.y * point.r} ` +
        `Q${point.x} ${point.y} ${point.x + ahead.x * point.r} ${point.y + ahead.y * point.r}`
      );
    })
    .join(' ');
}

/**
 * The handles alone, for a frame whose line follows the shape (a triangle) instead of its box: each
 * corner's bracket as its own short line, the turning dome over the top edge's middle.
 */
export function handleMarks(
  w: number,
  h: number,
  corners: readonly RectCorner[],
  dome: boolean,
  opening: BracketOpening = {},
): string {
  // A closed bracket would be a lone dot off the shape: left out until the pointer nears it.
  const parts = corners
    .filter((corner) => (opening[corner] ?? 1) > 0)
    .map((corner) => polyline(bracket(corner, w, h, opening[corner] ?? 1)));
  const R = DOME_RADIUS * (opening.turn ?? 1);
  if (dome && R > 0) parts.push(`M${w / 2 - R} 0 A${R} ${R} 0 0 1 ${w / 2 + R} 0 Z`);
  return parts.join(' ');
}
