import dagre from '@dagrejs/dagre';
import { z } from 'zod';
import { authorSchema } from './model';

/*
 * A diagram („Diagramm“) – a Cloud file of its own (`Name.diagram`, JSON), drawn and changed on a
 * canvas as in draw.io: boxes of a few shapes, arrows that stay on their boxes, frames that hold
 * boxes as a group. The editor, the AI tools and the pages that show one all read it from here:
 * the format, the changes the AI makes by name, the tidy layout, a box's size for its words.
 *
 * Positions are a box's top left corner, inside a frame relative to the frame (as the canvas
 * keeps them); a frame comes before what lies in it.
 */

export const DIAGRAM_EXTENSION = 'diagram';
export const DIAGRAM_MIME = 'application/vnd.slider.diagram+json';

export const DIAGRAM_SHAPES = [
  'rect',
  'rounded',
  'pill',
  'rhombus',
  'ellipse',
  'cylinder',
  'hexagon',
  'parallelogram',
  'document',
  'note',
  'text',
  'frame',
] as const;
export type DiagramShape = (typeof DIAGRAM_SHAPES)[number];

/** Tints that follow light and dark; anything else is a colour of one's own as `#rrggbb`. */
export const DIAGRAM_TINTS = ['gray', 'blue', 'cyan', 'green', 'yellow', 'red', 'violet'] as const;
export type DiagramTint = (typeof DIAGRAM_TINTS)[number];

const colorSchema = z.union([z.enum(DIAGRAM_TINTS), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
export type DiagramColor = z.infer<typeof colorSchema>;

export const DIAGRAM_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type DiagramSide = (typeof DIAGRAM_SIDES)[number];

const idSchema = z.string().trim().min(1).max(64);
const coord = z.number().finite().min(-1_000_000).max(1_000_000);
const extent = z.number().finite().min(8).max(20_000);

export const diagramNodeSchema = z.object({
  id: idSchema,
  shape: z.enum(DIAGRAM_SHAPES),
  x: coord,
  y: coord,
  width: extent,
  height: extent,
  text: z.string().max(4_000),
  color: colorSchema.optional(),
  /** The frame it lies in. */
  parent: idSchema.optional(),
  /** Text size: small, normal, large. */
  size: z.enum(['s', 'm', 'l']).optional(),
});
export type DiagramNode = z.infer<typeof diagramNodeSchema>;

export const DIAGRAM_LINES = ['solid', 'dashed', 'dotted'] as const;
export const DIAGRAM_ENDS = ['none', 'arrow'] as const;
export const DIAGRAM_ROUTES = ['elbow', 'curve', 'straight'] as const;

export const diagramEdgeSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  /** Where it leaves and meets its boxes; none: the side facing the other box. */
  fromSide: z.enum(DIAGRAM_SIDES).optional(),
  toSide: z.enum(DIAGRAM_SIDES).optional(),
  label: z.string().max(1_000).optional(),
  line: z.enum(DIAGRAM_LINES).optional(),
  start: z.enum(DIAGRAM_ENDS).optional(),
  end: z.enum(DIAGRAM_ENDS).optional(),
  route: z.enum(DIAGRAM_ROUTES).optional(),
  color: colorSchema.optional(),
});
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

export const DIAGRAM_DIRECTIONS = ['TB', 'LR'] as const;
export type DiagramDirection = (typeof DIAGRAM_DIRECTIONS)[number];

export const MAX_DIAGRAM_NODES = 1_000;
export const MAX_DIAGRAM_EDGES = 2_000;

export const diagramSchema = z.object({
  format: z.literal('slider-diagram'),
  version: z.literal(1),
  /** The way „Aufräumen“ lays it out. */
  direction: z.enum(DIAGRAM_DIRECTIONS).optional(),
  nodes: z.array(diagramNodeSchema).max(MAX_DIAGRAM_NODES),
  edges: z.array(diagramEdgeSchema).max(MAX_DIAGRAM_EDGES),
});
export type Diagram = z.infer<typeof diagramSchema>;

export const emptyDiagram = (): Diagram => ({
  format: 'slider-diagram',
  version: 1,
  nodes: [],
  edges: [],
});

/**
 * A diagram file's text read as a diagram: the file as written, made whole where it can be (an
 * arrow to a box that is not there, a frame inside itself, the same id twice) – never thrown away
 * for a small mistake. `null` when it is no diagram at all.
 */
export function readDiagram(text: string): Diagram | null {
  if (text.trim() === '') return emptyDiagram();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = diagramSchema.safeParse(raw);
  if (!parsed.success) return null;
  return repairDiagram(parsed.data);
}

/** The file's text: stable, readable, one box or arrow a line. */
export function writeDiagram(diagram: Diagram): string {
  const lines = [
    '{',
    `  "format": "slider-diagram",`,
    `  "version": 1,`,
    ...(diagram.direction ? [`  "direction": ${JSON.stringify(diagram.direction)},`] : []),
    '  "nodes": [',
    diagram.nodes.map((node) => `    ${JSON.stringify(roundNode(node))}`).join(',\n'),
    '  ],',
    '  "edges": [',
    diagram.edges.map((edge) => `    ${JSON.stringify(edge)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ];
  return lines.filter((line, at) => line !== '' || at === lines.length - 1).join('\n');
}

const round = (value: number) => Math.round(value * 10) / 10;
const roundNode = (node: DiagramNode): DiagramNode => ({
  ...node,
  x: round(node.x),
  y: round(node.y),
  width: round(node.width),
  height: round(node.height),
});

/** Ids unique, frames before their boxes and never inside themselves, arrows between boxes there. */
export function repairDiagram(diagram: Diagram): Diagram {
  const seen = new Set<string>();
  const nodes = diagram.nodes.filter((node) => !seen.has(node.id) && seen.add(node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const frameOf = (node: DiagramNode) => {
    const parent = node.parent ? byId.get(node.parent) : undefined;
    return parent && parent.shape === 'frame' && parent.id !== node.id ? parent.id : undefined;
  };
  // A parent chain that comes back to itself is cut where it closes.
  const fixed = nodes.map((node) => {
    const visited = new Set([node.id]);
    for (let at = frameOf(node); at; at = frameOf(byId.get(at)!)) {
      if (visited.has(at)) return { ...node, parent: undefined };
      visited.add(at);
    }
    const parent = frameOf(node);
    return parent === node.parent ? node : { ...node, parent };
  });
  const edgeIds = new Set<string>();
  const edges = diagram.edges.filter(
    (edge) =>
      byId.has(edge.from) && byId.has(edge.to) && !edgeIds.has(edge.id) && edgeIds.add(edge.id),
  );
  return { ...diagram, nodes: framesFirst(fixed), edges };
}

/** Every frame before what lies in it (the canvas needs a parent before its children). */
export function framesFirst(nodes: readonly DiagramNode[]): DiagramNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depth = (node: DiagramNode): number => {
    let count = 0;
    for (let at = node.parent; at && byId.has(at) && count < 64; at = byId.get(at)!.parent)
      count += 1;
    return count;
  };
  return nodes
    .map((node, index) => ({ node, index, depth: depth(node) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map((each) => each.node);
}

// ── Sizes ──────────────────────────────────────────────────────────────────────────────────────

/** Width of a text in px at a size – the canvas measures for real, the server estimates. */
export type MeasureText = (text: string, size: number) => number;

/** Inter's average advance: close enough to size a box made where nothing is measured. */
export const estimateText: MeasureText = (text, size) => {
  let width = 0;
  for (const char of text) {
    if (/[mwMW@]/.test(char)) width += 0.85;
    else if (/[A-ZÄÖÜ]/.test(char)) width += 0.68;
    else if (/[ilIjt.,:;'|!]/.test(char)) width += 0.3;
    else if (char === ' ') width += 0.28;
    else width += 0.56;
  }
  return width * size;
};

export const DIAGRAM_TEXT_SIZE = { s: 12, m: 14, l: 18 } as const;
export const DIAGRAM_LINE_HEIGHT = 1.35;
const MAX_TEXT_WIDTH = 220;

/** The lines a text breaks into within a width. */
export function wrapText(text: string, max: number, measure: MeasureText, size: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, size) > max) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** A box just large enough for its words in its shape (a diamond needs more room around them). */
export function sizeFor(
  shape: DiagramShape,
  text: string,
  measure: MeasureText = estimateText,
  textSize: keyof typeof DIAGRAM_TEXT_SIZE = 'm',
): { width: number; height: number } {
  const size = DIAGRAM_TEXT_SIZE[textSize];
  const lines = wrapText(text || ' ', MAX_TEXT_WIDTH, measure, size);
  const w = Math.max(...lines.map((line) => measure(line, size)), 0);
  const h = lines.length * size * DIAGRAM_LINE_HEIGHT;
  const box = (padX: number, padY: number, minW: number, minH: number) => ({
    width: Math.ceil(Math.max(minW, w + padX * 2) / 4) * 4,
    height: Math.ceil(Math.max(minH, h + padY * 2) / 4) * 4,
  });
  switch (shape) {
    case 'rhombus':
      return box(w * 0.35 + 24, h * 0.35 + 22, 140, 88);
    case 'ellipse':
      return box(w * 0.12 + 22, 18, 120, 64);
    case 'hexagon':
      return box(34, 14, 140, 60);
    case 'parallelogram':
      return box(36, 14, 140, 56);
    case 'cylinder':
      return box(20, 24, 120, 76);
    case 'document':
      return box(20, 18, 140, 68);
    case 'pill':
      return box(28, 14, 120, 48);
    case 'note':
      return box(16, 16, 160, 96);
    case 'text':
      return box(4, 4, 40, 24);
    case 'frame':
      return box(24, 24, 320, 200);
    default:
      return box(20, 14, 132, 56);
  }
}

// ── Tidy layout („Aufräumen“) ──────────────────────────────────────────────────────────────────

export const FRAME_PAD = 28;
export const FRAME_TITLE = 40;

/**
 * Every box placed anew, in rows along the direction: each frame first lays out what lies in it,
 * then stands in its own level as one block of that size – frames never overlap, an arrow never
 * runs through a group it does not belong to. Sizes stay; frames take the size of their content.
 */
export function layoutDiagram(diagram: Diagram, direction?: DiagramDirection): Diagram {
  const dir = direction ?? diagram.direction ?? 'TB';
  const byId = new Map(diagram.nodes.map((node) => [node.id, { ...node }]));
  const children = new Map<string | null, string[]>();
  for (const node of byId.values()) {
    const parent = node.parent && byId.get(node.parent)?.shape === 'frame' ? node.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), node.id]);
  }
  // Which of a level's own boxes holds a box (itself, or the frame it lies in at that level).
  const atLevel = (id: string, level: string | null): string | null => {
    let at: DiagramNode | undefined = byId.get(id);
    let guard = 0;
    while (at && guard++ < 64) {
      const parent = at.parent && byId.get(at.parent)?.shape === 'frame' ? at.parent : null;
      if (parent === level) return at.id;
      at = parent ? byId.get(parent) : undefined;
    }
    return null;
  };

  const layoutLevel = (level: string | null): { width: number; height: number } => {
    const ids = children.get(level) ?? [];
    for (const id of ids) {
      const node = byId.get(id)!;
      if (node.shape === 'frame' && (children.get(id)?.length ?? 0) > 0) {
        const inner = layoutLevel(id);
        node.width = inner.width + FRAME_PAD * 2;
        node.height = inner.height + FRAME_TITLE + FRAME_PAD;
      }
    }
    if (ids.length === 0) return { width: 0, height: 0 };
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: dir, nodesep: 48, ranksep: 72, edgesep: 24, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const id of ids) {
      const node = byId.get(id)!;
      g.setNode(id, { width: node.width, height: node.height });
    }
    diagram.edges.forEach((edge, index) => {
      const from = atLevel(edge.from, level);
      const to = atLevel(edge.to, level);
      if (!from || !to || from === to) return;
      const label = edge.label ? estimateText(edge.label, 12) + 16 : 0;
      g.setEdge(from, to, label ? { width: label, height: 22, labelpos: 'c' } : {}, String(index));
    });
    dagre.layout(g);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const at = g.node(id);
      const node = byId.get(id)!;
      node.x = at.x! - node.width / 2;
      node.y = at.y! - node.height / 2;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    const offsetX = (level ? FRAME_PAD : 0) - minX;
    const offsetY = (level ? FRAME_TITLE : 0) - minY;
    for (const id of ids) {
      const node = byId.get(id)!;
      node.x = round(node.x + offsetX);
      node.y = round(node.y + offsetY);
    }
    return { width: maxX - minX, height: maxY - minY };
  };
  layoutLevel(null);
  return { ...diagram, direction: dir, nodes: diagram.nodes.map((node) => byId.get(node.id)!) };
}

// ── Changes by name (the AI's, and anything else that does not draw) ───────────────────────────

const changeColor = colorSchema.describe(
  `One of ${DIAGRAM_TINTS.join(', ')} – or #rrggbb only where a colour is asked for exactly.`,
);
const boxShape = z.enum(DIAGRAM_SHAPES).exclude(['frame']);

export const diagramChangeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add_box'),
    id: idSchema,
    text: z.string().max(4_000),
    shape: boxShape.optional(),
    color: changeColor.optional(),
    frame: idSchema.optional(),
  }),
  z.object({
    type: z.literal('add_frame'),
    id: idSchema,
    text: z.string().max(400),
    color: changeColor.optional(),
    frame: idSchema.optional(),
  }),
  z.object({
    type: z.literal('change_box'),
    id: idSchema,
    text: z.string().max(4_000).optional(),
    shape: boxShape.optional(),
    color: changeColor.nullable().optional(),
    frame: idSchema.nullable().optional(),
  }),
  z.object({ type: z.literal('delete_box'), id: idSchema }),
  z.object({
    type: z.literal('connect'),
    from: idSchema,
    to: idSchema,
    label: z.string().max(1_000).optional(),
    line: z.enum(DIAGRAM_LINES).optional(),
    end: z.enum(DIAGRAM_ENDS).optional(),
    start: z.enum(DIAGRAM_ENDS).optional(),
  }),
  z.object({
    type: z.literal('change_arrow'),
    from: idSchema,
    to: idSchema,
    label: z.string().max(1_000).optional(),
    line: z.enum(DIAGRAM_LINES).optional(),
    end: z.enum(DIAGRAM_ENDS).optional(),
    start: z.enum(DIAGRAM_ENDS).optional(),
  }),
  z.object({ type: z.literal('disconnect'), from: idSchema, to: idSchema }),
]);
export type DiagramChange = z.infer<typeof diagramChangeSchema>;

/**
 * The changes an AI sent, each read on its own: what is well formed is done, each that is not is
 * said by its place – one wrong field never throws the rest away.
 */
export function readDiagramChanges(raw: unknown): { changes: DiagramChange[]; problems: string[] } {
  const list = Array.isArray(raw) ? raw : [];
  const changes: DiagramChange[] = [];
  const problems: string[] = [];
  if (!Array.isArray(raw)) problems.push('changes must be a list');
  list.forEach((each, index) => {
    const read = diagramChangeSchema.safeParse(each);
    if (read.success) changes.push(read.data);
    else {
      const issue = read.error.issues[0];
      const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
      problems.push(`change ${index + 1}: ${issue?.message ?? 'not understood'}${where}`);
    }
  });
  return { changes, problems };
}

const GAP = 72;

/**
 * Changes applied in order; what cannot be done is said (`problems`) and the rest still done. A new
 * box goes next to the box it is first connected from (along the direction, beside its siblings
 * where that spot is taken); one with nothing to go by goes under everything. `tidy` lays out all.
 */
export function applyDiagramChanges(
  diagram: Diagram,
  changes: readonly DiagramChange[],
  options: { tidy?: boolean; direction?: DiagramDirection; measure?: MeasureText } = {},
): { diagram: Diagram; problems: string[] } {
  const measure = options.measure ?? estimateText;
  let nodes = diagram.nodes.map((node) => ({ ...node }));
  let edges = diagram.edges.map((edge) => ({ ...edge }));
  const problems: string[] = [];
  const unplaced = new Set<string>();
  const find = (id: string) => nodes.find((node) => node.id === id);
  const isFrame = (id: string | undefined | null) => !!id && find(id)?.shape === 'frame';
  // Within an id's 64 characters (two long box ids would make a file no one can read), room left
  // for a number.
  const edgeId = (from: string, to: string) => {
    const stem = `${from}-${to}`.slice(0, 58).trimEnd();
    let id = stem;
    for (let n = 2; edges.some((edge) => edge.id === id); n += 1) id = `${stem}-${n}`;
    return id;
  };

  for (const change of changes) {
    switch (change.type) {
      case 'add_box':
      case 'add_frame': {
        if (find(change.id)) {
          problems.push(`„${change.id}“ is there already – change_box changes it.`);
          break;
        }
        if (change.frame && !isFrame(change.frame)) {
          problems.push(
            `No frame „${change.frame}“ for „${change.id}“ – it lies outside any frame.`,
          );
        }
        const shape: DiagramShape =
          change.type === 'add_frame' ? 'frame' : (change.shape ?? 'rounded');
        nodes.push({
          id: change.id,
          shape,
          x: 0,
          y: 0,
          ...sizeFor(shape, change.text, measure),
          text: change.text,
          ...(change.color && { color: change.color }),
          ...(change.frame && isFrame(change.frame) && { parent: change.frame }),
        });
        unplaced.add(change.id);
        break;
      }
      case 'change_box': {
        const node = find(change.id);
        if (!node) {
          problems.push(`No box „${change.id}“ to change.`);
          break;
        }
        if (change.text !== undefined) node.text = change.text;
        if (change.shape && node.shape !== 'frame') node.shape = change.shape;
        if (change.color === null) delete node.color;
        else if (change.color) node.color = change.color;
        if ((change.text !== undefined || change.shape) && node.shape !== 'frame') {
          const fit = sizeFor(node.shape, node.text, measure);
          node.width = Math.max(node.width, fit.width);
          node.height = Math.max(node.height, fit.height);
        }
        if (change.frame === null && node.parent) {
          const at = absolutePosition(nodes, node);
          delete node.parent;
          node.x = at.x;
          node.y = at.y;
        } else if (change.frame && change.frame !== node.parent) {
          if (!isFrame(change.frame) || change.frame === node.id) {
            problems.push(`No frame „${change.frame}“ for „${node.id}“.`);
          } else {
            node.parent = change.frame;
            unplaced.add(node.id);
          }
        }
        break;
      }
      case 'delete_box': {
        const node = find(change.id);
        if (!node) {
          problems.push(`No box „${change.id}“ to delete.`);
          break;
        }
        // What lay in a frame stays, where it was.
        for (const child of nodes.filter((each) => each.parent === node.id)) {
          const at = absolutePosition(nodes, child);
          child.parent = node.parent;
          const base = node.parent ? absolutePosition(nodes, find(node.parent)!) : { x: 0, y: 0 };
          child.x = at.x - base.x;
          child.y = at.y - base.y;
        }
        nodes = nodes.filter((each) => each.id !== node.id);
        edges = edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
        break;
      }
      case 'connect': {
        if (!find(change.from) || !find(change.to)) {
          problems.push(`No box „${find(change.from) ? change.to : change.from}“ to connect.`);
          break;
        }
        if (edges.some((edge) => edge.from === change.from && edge.to === change.to)) {
          problems.push(
            `${change.from} → ${change.to} is there already – change_arrow changes it.`,
          );
          break;
        }
        edges.push({
          id: edgeId(change.from, change.to),
          from: change.from,
          to: change.to,
          ...(change.label && { label: change.label }),
          ...(change.line && change.line !== 'solid' && { line: change.line }),
          ...(change.end && { end: change.end }),
          ...(change.start && { start: change.start }),
        });
        break;
      }
      case 'change_arrow': {
        const edge = edges.find((each) => each.from === change.from && each.to === change.to);
        if (!edge) {
          problems.push(`No arrow ${change.from} → ${change.to} to change.`);
          break;
        }
        if (change.label !== undefined) {
          if (change.label) edge.label = change.label;
          else delete edge.label;
        }
        if (change.line) edge.line = change.line;
        if (change.end) edge.end = change.end;
        if (change.start) edge.start = change.start;
        break;
      }
      case 'disconnect': {
        const before = edges.length;
        edges = edges.filter((edge) => !(edge.from === change.from && edge.to === change.to));
        if (edges.length === before) problems.push(`No arrow ${change.from} → ${change.to}.`);
        break;
      }
    }
  }

  let next = repairDiagram({ ...diagram, nodes, edges });
  if (options.direction) next = { ...next, direction: options.direction };
  if (options.tidy) return { diagram: layoutDiagram(next), problems };
  return { diagram: placeNew(next, unplaced), problems };
}

/** A box's position on the canvas, through the frames it lies in. */
export function absolutePosition(
  nodes: readonly DiagramNode[],
  node: DiagramNode,
): { x: number; y: number } {
  let x = node.x;
  let y = node.y;
  let guard = 0;
  for (let at = node.parent; at && guard++ < 64;) {
    const parent = nodes.find((each) => each.id === at);
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    at = parent.parent;
  }
  return { x, y };
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box, gap = 16) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

/** New boxes put where they belong without moving anything drawn by hand; frames grow to hold them. */
function placeNew(diagram: Diagram, unplaced: Set<string>): Diagram {
  if (unplaced.size === 0) return diagram;
  const dir = diagram.direction ?? 'TB';
  const nodes = diagram.nodes.map((node) => ({ ...node }));
  const placed = (node: DiagramNode) => !unplaced.has(node.id);
  // Boxes in the order they came, then frames from the innermost out – a frame is placed with
  // the size of what was put in it.
  const depth = (node: DiagramNode) => {
    let count = 0;
    for (let at = node.parent; at && count < 64; count += 1) {
      at = nodes.find((each) => each.id === at)?.parent;
    }
    return count;
  };
  const fresh = nodes.filter((node) => unplaced.has(node.id));
  const order = [
    ...fresh.filter((node) => node.shape !== 'frame'),
    ...fresh.filter((node) => node.shape === 'frame').sort((a, b) => depth(b) - depth(a)),
  ];
  for (const node of order) {
    if (node.shape === 'frame') {
      wrapFrame(nodes, node);
      growFrame(nodes, node);
    }
    const siblings = nodes.filter(
      (each) =>
        each.id !== node.id && (each.parent ?? null) === (node.parent ?? null) && placed(each),
    );
    const source = diagram.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => nodes.find((each) => each.id === edge.from))
      .find((each) => each && placed(each) && (each.parent ?? null) === (node.parent ?? null));
    let x: number;
    let y: number;
    if (source) {
      x =
        dir === 'TB' ? source.x + source.width / 2 - node.width / 2 : source.x + source.width + GAP;
      y =
        dir === 'TB'
          ? source.y + source.height + GAP
          : source.y + source.height / 2 - node.height / 2;
    } else if (siblings.length > 0) {
      const bottom = Math.max(...siblings.map((each) => each.y + each.height));
      const right = Math.max(...siblings.map((each) => each.x + each.width));
      const left = Math.min(...siblings.map((each) => each.x));
      const top = Math.min(...siblings.map((each) => each.y));
      x = dir === 'TB' ? left : right + GAP;
      y = dir === 'TB' ? bottom + GAP : top;
    } else {
      x = node.parent ? FRAME_PAD : 0;
      y = node.parent ? FRAME_TITLE : 0;
    }
    // Beside what is there, across the direction.
    const box = { x, y, width: node.width, height: node.height };
    for (let tries = 0; tries < 200 && siblings.some((each) => overlaps(box, each)); tries += 1) {
      if (dir === 'TB') box.x += node.width / 2 + 24;
      else box.y += node.height / 2 + 24;
    }
    node.x = round(box.x);
    node.y = round(box.y);
    unplaced.delete(node.id);
  }
  // Frames hold what lies in them.
  for (const frame of [...nodes].reverse()) if (frame.shape === 'frame') growFrame(nodes, frame);
  return { ...diagram, nodes };
}

/** A new frame around boxes put in it: they keep their places on the canvas. */
function wrapFrame(nodes: DiagramNode[], frame: DiagramNode) {
  const inside = nodes.filter((node) => node.parent === frame.id);
  if (inside.length === 0) return;
  const minX = Math.min(...inside.map((node) => node.x));
  const minY = Math.min(...inside.map((node) => node.y));
  for (const node of inside) {
    node.x = round(node.x - minX + FRAME_PAD);
    node.y = round(node.y - minY + FRAME_TITLE);
  }
}

/** A frame large enough for what lies in it. */
function growFrame(nodes: DiagramNode[], frame: DiagramNode) {
  const inside = nodes.filter((node) => node.parent === frame.id);
  if (inside.length === 0) return;
  const right = Math.max(...inside.map((node) => node.x + node.width)) + FRAME_PAD;
  const bottom = Math.max(...inside.map((node) => node.y + node.height)) + FRAME_PAD;
  frame.width = round(Math.max(frame.width, right));
  frame.height = round(Math.max(frame.height, bottom));
}

/**
 * The diagram as the AI reads it: boxes by id with their text, shape, colour and frame, arrows
 * between ids – no positions (it changes by name; places are the canvas's).
 */
export function describeDiagram(diagram: Diagram): string {
  const box = (node: DiagramNode) =>
    JSON.stringify({
      id: node.id,
      ...(node.shape === 'frame' ? { frame: true } : { shape: node.shape }),
      text: node.text,
      ...(node.color && { color: node.color }),
      ...(node.parent && { in: node.parent }),
    });
  const arrow = (edge: DiagramEdge) =>
    JSON.stringify({
      from: edge.from,
      to: edge.to,
      ...(edge.label && { label: edge.label }),
      ...(edge.line && edge.line !== 'solid' && { line: edge.line }),
      ...(edge.end === 'none' && { end: 'none' }),
      ...(edge.start === 'arrow' && { start: 'arrow' }),
    });
  return [
    `direction: ${diagram.direction ?? 'TB'}`,
    'boxes:',
    ...diagram.nodes.map(box),
    'arrows:',
    ...diagram.edges.map(arrow),
  ].join('\n');
}

// ── Two people at once ──────────────────────────────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mergeById<T extends { id: string }>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
): T[] {
  const was = new Map(base.map((each) => [each.id, each]));
  const mineById = new Map(mine.map((each) => [each.id, each]));
  const theirsById = new Map(theirs.map((each) => [each.id, each]));
  const merged: T[] = [];
  for (const their of theirs) {
    const before = was.get(their.id);
    const my = mineById.get(their.id);
    if (!before) {
      // Theirs new; mine too only by chance of the same id – mine wins, as it is on my screen.
      merged.push(my ?? their);
    } else if (!my) {
      // I deleted it: gone, unless they changed it meanwhile – then nothing of theirs is lost.
      if (!same(before, their)) merged.push(their);
    } else {
      merged.push(same(before, my) ? their : my);
    }
  }
  for (const my of mine) {
    if (theirsById.has(my.id)) continue;
    const before = was.get(my.id);
    // New of mine stays; one they deleted comes back only where I changed it.
    if (!before || !same(before, my)) merged.push(my);
  }
  return merged;
}

/**
 * What I drew on `base` joined with what someone else saved on it meanwhile (`theirs`): box by
 * box and arrow by arrow, the one who changed a thing keeps it; both changed it – mine.
 */
export function mergeDiagrams(base: Diagram, mine: Diagram, theirs: Diagram): Diagram {
  return repairDiagram({
    ...theirs,
    ...(!same(base.direction, mine.direction) && { direction: mine.direction }),
    nodes: mergeById(base.nodes, mine.nodes, theirs.nodes),
    edges: mergeById(base.edges, mine.edges, theirs.edges),
  });
}

// ── The API ─────────────────────────────────────────────────────────────────

export const diagramFileSchema = z.object({
  /** The file's id in Cloud. */
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  fileName: z.string(),
  /** Where it lies („Meine Dateien“, an area, a folder in one). */
  place: z.string(),
  versionId: z.string().nullable(),
  updatedBy: authorSchema.nullable(),
  updatedAt: z.iso.datetime(),
  canEdit: z.boolean(),
});
export type DiagramFile = z.infer<typeof diagramFileSchema>;

export const diagramOpenedSchema = z.object({
  file: diagramFileSchema,
  diagram: diagramSchema,
});
export type DiagramOpened = z.infer<typeof diagramOpenedSchema>;

export const createDiagramInputSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().optional(),
  areaId: z.string().optional(),
  /** What it starts with (a diagram drawn elsewhere, turned into a file); empty without. */
  diagram: diagramSchema.optional(),
});
export type CreateDiagramInput = z.infer<typeof createDiagramInputSchema>;

export const saveDiagramInputSchema = z.object({
  diagram: diagramSchema,
  /** The version this was drawn on: someone else's save since is joined in, not overwritten. */
  baseVersionId: z.string().nullable(),
  /** Which open editor saved – it does not hear its own save back. */
  clientId: z.string().min(1).max(64),
});
export type SaveDiagramInput = z.infer<typeof saveDiagramInputSchema>;

export const diagramSavedSchema = z.object({
  versionId: z.string().nullable(),
  /** The diagram as it is now: with someone else's changes where they were joined in. */
  diagram: diagramSchema,
  joined: z.boolean(),
});
export type DiagramSaved = z.infer<typeof diagramSavedSchema>;

export const askDiagramInputSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  /** The diagram as it is on the screen, not yet saved perhaps. */
  diagram: diagramSchema,
  /** What is picked: „das hier“ means these. */
  picked: z.array(idSchema).max(MAX_DIAGRAM_NODES).optional(),
});
export type AskDiagramInput = z.infer<typeof askDiagramInputSchema>;

export const diagramAnswerSchema = z.object({
  changes: z.array(diagramChangeSchema),
  /** Lay it all out anew afterwards („Aufräumen“). */
  tidy: z.boolean(),
  direction: z.enum(DIAGRAM_DIRECTIONS).optional(),
  /** What the AI says about it, one sentence – or why it did nothing. */
  note: z.string(),
});
export type DiagramAnswer = z.infer<typeof diagramAnswerSchema>;
