import dagre from '@dagrejs/dagre';
import type { Diagram, DiagramEdge, DiagramGroup, DiagramNode, Shape } from './parse';

/*
 * Where everything of a diagram stands: each box as large as its words (wrapped past a width),
 * the boxes in rows by dagre – groups as frames around theirs –, each arrow a smooth curve from
 * edge to edge of its boxes. Measured in the page's own face, so the drawing fits its words.
 */

export interface Point {
  x: number;
  y: number;
}

export interface PlacedNode {
  node: DiagramNode;
  /** Its centre. */
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
}

export interface PlacedEdge {
  edge: DiagramEdge;
  index: number;
  points: Point[];
  /** Its words: where they stand (centre) and their lines. */
  label: { x: number; y: number; width: number; height: number; lines: string[] } | null;
}

export interface PlacedGroup {
  group: DiagramGroup;
  /** Its frame, top left. */
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  /** Its name's width, for the plate it stands on. */
  labelWidth: number;
}

export interface Placed {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  groups: PlacedGroup[];
  width: number;
  height: number;
}

/** How wide a text is in the drawing's face, in px. */
export type Measure = (text: string, size: number, weight: number) => number;

export const NODE_TEXT = 14;
export const LABEL_TEXT = 12.5;
export const GROUP_TEXT = 12.5;
export const LINE_HEIGHT = 1.4;
const MAX_TEXT = 200;
const PAD_X = 16;
const PAD_Y = 10;
const MIN_WIDTH = 56;

let canvas: CanvasRenderingContext2D | null | undefined;

/** The browser's measure, in the page's face; a guess by letters where there is no canvas (tests). */
export const measureText: Measure = (text, size, weight) => {
  if (canvas === undefined) {
    canvas =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!canvas) return text.length * size * 0.55;
  const family = getComputedStyle(document.body).fontFamily || 'Inter, sans-serif';
  canvas.font = `${weight} ${size}px ${family}`;
  return canvas.measureText(text).width;
};

/** Words wrapped so no line is wider than `max`; a word longer than that stands alone. */
export function wrap(text: string, max: number, measure: (text: string) => number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ').filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = words[0]!;
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (measure(next) <= max) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** A box's size for its words' block (`w` × `h`), by its shape. */
function boxSize(shape: Shape, w: number, h: number): { width: number; height: number } {
  const width = Math.max(MIN_WIDTH, w + PAD_X * 2);
  const height = h + PAD_Y * 2;
  switch (shape) {
    case 'rhombus': {
      // The words' block inside the diamond: (w/2)/a + (h/2)/b ≤ 1, a/b = 1.6.
      const a = (w + 1.6 * h) / 2 + 14;
      return { width: Math.max(2 * a, 72), height: Math.max((2 * a) / 1.6, 46) };
    }
    case 'circle':
    case 'double-circle': {
      const d = Math.max(Math.hypot(w, h) + 16, 48) + (shape === 'double-circle' ? 10 : 0);
      return { width: d, height: d };
    }
    case 'hexagon':
      return { width: width + height * 0.5, height };
    case 'stadium':
      return { width: Math.max(width, w + height), height };
    case 'subroutine':
      return { width: width + 16, height };
    case 'cylinder':
      return { width, height: height + 14 };
    case 'lean-right':
    case 'lean-left':
    case 'trapezoid':
    case 'trapezoid-alt':
      return { width: width + height * 0.6, height };
    case 'flag':
      return { width: width + 14, height };
    default:
      return { width, height };
  }
}

/** Where everything stands. */
export function layoutDiagram(diagram: Diagram, measure: Measure = measureText): Placed {
  const lineHeight = (size: number) => size * LINE_HEIGHT;
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  const horizontal = diagram.direction === 'LR' || diagram.direction === 'RL';
  g.setGraph({
    rankdir: diagram.direction,
    // Frames side by side need room for the name on their top line.
    nodesep: (horizontal ? 28 : 36) + (diagram.groups.size > 0 ? 12 : 0),
    ranksep: horizontal ? 56 : 52,
    edgesep: 18,
    marginx: 2,
    marginy: 2,
  });

  const placedLines = new Map<string, string[]>();
  for (const node of diagram.nodes.values()) {
    const lines = wrap(node.label, MAX_TEXT, (text) => measure(text, NODE_TEXT, 500));
    const w = Math.max(...lines.map((line) => measure(line, NODE_TEXT, 500)), 0);
    const h = lines.length * lineHeight(NODE_TEXT);
    placedLines.set(node.id, lines);
    g.setNode(node.id, boxSize(node.shape, w, h));
  }

  // Groups: a frame around their boxes; their name stands on the frame's top line.
  const crossed = crossedGroups(diagram);
  for (const group of diagram.groups.values()) {
    // A group keeps its own direction only while no arrow leaves it – as Mermaid does (dagre
    // lays such a group out on its own and draws no arrow across its frame).
    const own = group.direction && !crossed.has(group.id) ? group.direction : null;
    g.setNode(group.id, own ? { rankdir: own } : {});
  }
  for (const group of diagram.groups.values()) {
    if (group.parent) g.setParent(group.id, group.parent);
  }
  for (const node of diagram.nodes.values()) {
    if (node.group && diagram.groups.has(node.group)) g.setParent(node.id, node.group);
  }

  // An arrow to a group goes to a box inside it for the rows, and ends at the frame when drawn.
  const inside = (id: string): string | null => {
    if (diagram.nodes.has(id)) return id;
    if (!diagram.groups.has(id)) return null;
    for (const node of diagram.nodes.values()) {
      for (let at: string | null = node.group; at; at = diagram.groups.get(at)?.parent ?? null) {
        if (at === id) return node.id;
      }
    }
    return null;
  };

  const labelSizes = new Map<number, { width: number; height: number; lines: string[] }>();
  diagram.edges.forEach((edge, index) => {
    const from = inside(edge.from);
    const to = inside(edge.to);
    if (!from || !to) return;
    const label: Record<string, unknown> = {
      minlen: edge.length,
      weight: edge.stroke === 'invisible' ? 0 : 1,
    };
    if (edge.label) {
      const lines = wrap(edge.label, 160, (text) => measure(text, LABEL_TEXT, 400));
      const width = Math.max(...lines.map((line) => measure(line, LABEL_TEXT, 400))) + 12;
      const height = lines.length * lineHeight(LABEL_TEXT) + 6;
      labelSizes.set(index, { width, height, lines });
      Object.assign(label, { width, height, labelpos: 'c' });
    }
    g.setEdge(from, to, label, String(index));
  });

  dagre.layout(g);

  const nodes: PlacedNode[] = [];
  for (const node of diagram.nodes.values()) {
    const at = g.node(node.id);
    nodes.push({
      node,
      x: at.x!,
      y: at.y!,
      width: at.width,
      height: at.height,
      lines: placedLines.get(node.id)!,
    });
  }

  const depthOf = (group: DiagramGroup) => {
    let depth = 0;
    for (let at = group.parent; at; at = diagram.groups.get(at)?.parent ?? null) depth += 1;
    return depth;
  };
  const groups: PlacedGroup[] = [];
  for (const group of diagram.groups.values()) {
    const at = g.node(group.id);
    if (!at || at.x === undefined || !at.width) continue;
    groups.push({
      group,
      x: at.x - at.width / 2,
      y: at.y! - at.height / 2,
      width: at.width,
      height: at.height,
      depth: depthOf(group),
      labelWidth: group.label ? measure(group.label, GROUP_TEXT, 600) : 0,
    });
  }
  groups.sort((a, b) => a.depth - b.depth);
  const frames = new Map(groups.map((group) => [group.group.id, group]));

  const edges: PlacedEdge[] = [];
  diagram.edges.forEach((edge, index) => {
    const from = inside(edge.from);
    const to = inside(edge.to);
    if (!from || !to) return;
    const at = g.edge({ v: from, w: to, name: String(index) });
    if (!at?.points) return;
    let points: Point[] = at.points.map((p: Point) => ({ x: p.x, y: p.y }));
    const fromNode = nodes.find((n) => n.node.id === from);
    const toNode = nodes.find((n) => n.node.id === to);
    if (from === to) {
      points = selfLoop(fromNode!);
    } else {
      // dagre ends an arrow at the box's rectangle: a diamond or circle is met at its own edge,
      // a group at its frame.
      const fromFrame = frames.get(edge.from);
      const toFrame = frames.get(edge.to);
      if (fromFrame) points = clipStart(points, fromFrame);
      else if (fromNode) points[0] = boundary(fromNode, points[1] ?? points[0]!);
      if (toFrame) points = clipStart(points.reverse(), toFrame).reverse();
      else if (toNode)
        points[points.length - 1] = boundary(toNode, points.at(-2) ?? points.at(-1)!);
    }
    const size = labelSizes.get(index);
    edges.push({
      edge,
      index,
      points,
      label:
        size && at.x !== undefined
          ? { x: at.x, y: at.y!, width: size.width, height: size.height, lines: size.lines }
          : null,
    });
  });

  // The drawing's extent, everything in view.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (const n of nodes)
    take(n.x - n.width / 2, n.y - n.height / 2, n.x + n.width / 2, n.y + n.height / 2);
  for (const f of groups) take(f.x, f.y, f.x + f.width, f.y + f.height);
  for (const e of edges) {
    for (const p of e.points) take(p.x, p.y, p.x, p.y);
    if (e.label) {
      take(
        e.label.x - e.label.width / 2,
        e.label.y - e.label.height / 2,
        e.label.x + e.label.width / 2,
        e.label.y + e.label.height / 2,
      );
    }
  }
  if (!Number.isFinite(minX)) return { nodes: [], edges: [], groups: [], width: 0, height: 0 };
  const margin = 4;
  const dx = margin - minX;
  const dy = margin - minY;
  for (const n of nodes) {
    n.x += dx;
    n.y += dy;
  }
  for (const f of groups) {
    f.x += dx;
    f.y += dy;
  }
  for (const e of edges) {
    for (const p of e.points) {
      p.x += dx;
      p.y += dy;
    }
    if (e.label) {
      e.label.x += dx;
      e.label.y += dy;
    }
  }
  return {
    nodes,
    edges,
    groups,
    width: Math.ceil(maxX - minX + margin * 2),
    height: Math.ceil(maxY - minY + margin * 2),
  };
}

/** The groups an arrow goes into or out of (its two ends not both inside). */
function crossedGroups(diagram: Diagram): Set<string> {
  const chain = (id: string): string[] => {
    const out: string[] = [];
    let at: string | null = diagram.nodes.get(id)?.group ?? (diagram.groups.has(id) ? id : null);
    for (; at; at = diagram.groups.get(at)?.parent ?? null) out.push(at);
    return out;
  };
  const crossed = new Set<string>();
  for (const edge of diagram.edges) {
    const a = chain(edge.from);
    const b = chain(edge.to);
    for (const id of a) if (!b.includes(id)) crossed.add(id);
    for (const id of b) if (!a.includes(id)) crossed.add(id);
    // An arrow to a group itself is drawn to its frame: the group is crossed.
    if (diagram.groups.has(edge.from)) crossed.add(edge.from);
    if (diagram.groups.has(edge.to)) crossed.add(edge.to);
  }
  return crossed;
}

/** Where the line from a box's centre towards `toward` leaves the box's shape. */
function boundary(box: PlacedNode, toward: Point): Point {
  const dx = toward.x - box.x;
  const dy = toward.y - box.y;
  if (dx === 0 && dy === 0) return { x: box.x, y: box.y };
  const hw = box.width / 2;
  const hh = box.height / 2;
  let t: number;
  switch (box.node.shape) {
    case 'rhombus':
      t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
      break;
    case 'circle':
    case 'double-circle':
      t = hw / Math.hypot(dx, dy);
      break;
    default:
      t = Math.min(
        dx === 0 ? Infinity : hw / Math.abs(dx),
        dy === 0 ? Infinity : hh / Math.abs(dy),
      );
  }
  return { x: box.x + dx * t, y: box.y + dy * t };
}

/** The points from where the line first leaves `frame` on (it starts inside it). */
function clipStart(points: Point[], frame: PlacedGroup): Point[] {
  const inFrame = (p: Point) =>
    p.x >= frame.x &&
    p.x <= frame.x + frame.width &&
    p.y >= frame.y &&
    p.y <= frame.y + frame.height;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (inFrame(a) && !inFrame(b)) {
      // Step along a→b to the frame's edge.
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 20; k += 1) {
        const mid = (lo + hi) / 2;
        if (inFrame({ x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid })) lo = mid;
        else hi = mid;
      }
      const edge = { x: a.x + (b.x - a.x) * hi, y: a.y + (b.y - a.y) * hi };
      return [edge, ...points.slice(i + 1)];
    }
  }
  return points;
}

/** An arrow from a box back to itself: a loop out of its right side. */
function selfLoop(box: PlacedNode): Point[] {
  const right = box.x + box.width / 2;
  const top = box.y - box.height / 4;
  const bottom = box.y + box.height / 4;
  return [
    { x: right, y: top },
    { x: right + 28, y: top - 6 },
    { x: right + 28, y: bottom + 6 },
    { x: right, y: bottom },
  ];
}

/** A smooth curve through the points (a B-spline, as Mermaid draws its arrows: d3's curveBasis). */
export function curvePath(points: readonly Point[]): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = '';
  let x0 = NaN;
  let y0 = NaN;
  let x1 = NaN;
  let y1 = NaN;
  let state = 0;
  const bezier = (x: number, y: number) => {
    d += `C${f((2 * x0 + x1) / 3)},${f((2 * y0 + y1) / 3)},${f((x0 + 2 * x1) / 3)},${f((y0 + 2 * y1) / 3)},${f((x0 + 4 * x1 + x) / 6)},${f((y0 + 4 * y1 + y) / 6)}`;
  };
  for (const { x, y } of points) {
    if (state === 0) {
      state = 1;
      d += `M${f(x)},${f(y)}`;
    } else if (state === 1) {
      state = 2;
    } else {
      if (state === 2) {
        state = 3;
        d += `L${f((5 * x0 + x1) / 6)},${f((5 * y0 + y1) / 6)}`;
      }
      bezier(x, y);
    }
    x0 = x1;
    x1 = x;
    y0 = y1;
    y1 = y;
  }
  if (state === 3) bezier(x1, y1);
  if (state >= 2) d += `L${f(x1)},${f(y1)}`;
  return d;
}
