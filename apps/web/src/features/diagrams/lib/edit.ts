import {
  absolutePosition,
  FRAME_PAD,
  FRAME_TITLE,
  sizeFor,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type DiagramShape,
  type DiagramSide,
} from '@slider/shared';
import { freshId, type Rect } from './flow';

/*
 * What one does to a diagram by hand, each a pure step from one diagram to the next – the editor
 * commits it as one step back (⌘Z). Positions are the boxes' own: inside a frame, from its corner.
 */

export const GAP = 72;

export const takenIn = (diagram: Diagram) => {
  const ids = new Set([...diagram.nodes.map((n) => n.id), ...diagram.edges.map((e) => e.id)]);
  return (id: string) => ids.has(id);
};

export const boxById = (diagram: Diagram, id: string) => diagram.nodes.find((n) => n.id === id);

/** A box's place and size on the canvas, through its frames. */
export function rectIn(diagram: Diagram, box: DiagramNode): Rect {
  return { ...absolutePosition(diagram.nodes, box), width: box.width, height: box.height };
}

/** Frames inside frames: every id below `id`. */
export function descendants(diagram: Diagram, id: string): Set<string> {
  const out = new Set<string>();
  let added = true;
  while (added) {
    added = false;
    for (const box of diagram.nodes) {
      if (box.parent && (box.parent === id || out.has(box.parent)) && !out.has(box.id)) {
        out.add(box.id);
        added = true;
      }
    }
  }
  return out;
}

/** The innermost frame a point lies in, but none of `skip` (the boxes moved and what is in them). */
export function frameAt(
  diagram: Diagram,
  point: { x: number; y: number },
  skip: ReadonlySet<string> = new Set(),
): DiagramNode | undefined {
  let best: DiagramNode | undefined;
  let bestArea = Infinity;
  for (const box of diagram.nodes) {
    if (box.shape !== 'frame' || skip.has(box.id)) continue;
    const rect = rectIn(diagram, box);
    if (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height &&
      rect.width * rect.height < bestArea
    ) {
      best = box;
      bestArea = rect.width * rect.height;
    }
  }
  return best;
}

export function updateBoxes(
  diagram: Diagram,
  ids: ReadonlySet<string>,
  change: (box: DiagramNode) => DiagramNode,
): Diagram {
  let changed = false;
  const nodes = diagram.nodes.map((box) => {
    if (!ids.has(box.id)) return box;
    const next = change(box);
    if (next !== box) changed = true;
    return next;
  });
  return changed ? { ...diagram, nodes } : diagram;
}

export function updateArrows(
  diagram: Diagram,
  ids: ReadonlySet<string>,
  change: (arrow: DiagramEdge) => DiagramEdge,
): Diagram {
  let changed = false;
  const edges = diagram.edges.map((arrow) => {
    if (!ids.has(arrow.id)) return arrow;
    const next = change(arrow);
    if (next !== arrow) changed = true;
    return next;
  });
  return changed ? { ...diagram, edges } : diagram;
}

/** Boxes (a frame with what is in it) and arrows gone; arrows to a box gone go with it. */
export function removeIds(diagram: Diagram, ids: ReadonlySet<string>): Diagram {
  const gone = new Set<string>();
  for (const box of diagram.nodes) {
    if (!ids.has(box.id)) continue;
    gone.add(box.id);
    for (const inner of descendants(diagram, box.id)) gone.add(inner);
  }
  const nodes = diagram.nodes.filter((box) => !gone.has(box.id));
  const edges = diagram.edges.filter(
    (arrow) => !ids.has(arrow.id) && !gone.has(arrow.from) && !gone.has(arrow.to),
  );
  if (nodes.length === diagram.nodes.length && edges.length === diagram.edges.length) {
    return diagram;
  }
  return { ...diagram, nodes, edges };
}

/** A box into another frame (or none), where it stands on the canvas. */
export function reparent(diagram: Diagram, id: string, parent: string | undefined): Diagram {
  const box = boxById(diagram, id);
  if (!box || box.parent === parent) return diagram;
  if (parent && (parent === id || descendants(diagram, id).has(parent))) return diagram;
  const at = absolutePosition(diagram.nodes, box);
  const frame = parent ? boxById(diagram, parent) : undefined;
  const origin = frame ? absolutePosition(diagram.nodes, frame) : { x: 0, y: 0 };
  const { parent: _old, ...rest } = box;
  const next: DiagramNode = {
    ...rest,
    x: Math.round(at.x - origin.x),
    y: Math.round(at.y - origin.y),
    ...(frame && { parent: frame.id }),
  };
  // A frame's boxes come after it (`framesFirst` draws them so): the box moves to the end.
  const nodes = diagram.nodes.filter((each) => each.id !== id);
  nodes.push(next);
  // What lies in it comes along after it, in its order.
  const inner = descendants(diagram, id);
  const moved = nodes.filter((each) => inner.has(each.id));
  return { ...diagram, nodes: [...nodes.filter((each) => !inner.has(each.id)), ...moved] };
}

/** After a drag: each moved box lies in the frame its middle was let go over. */
export function dropInFrames(diagram: Diagram, moved: readonly string[]): Diagram {
  let next = diagram;
  const movedSet = new Set(moved);
  for (const id of moved) {
    const box = boxById(next, id);
    if (!box) continue;
    // Moved with its frame: it stays in it.
    if (box.parent && movedSet.has(box.parent)) continue;
    const rect = rectIn(next, box);
    const skip = new Set([id, ...descendants(next, id)]);
    const frame = frameAt(next, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, skip);
    next = reparent(next, id, frame?.id);
  }
  return next;
}

/** A new box where `rect` says (on the canvas), in the frame it lies in. */
export function addBox(
  diagram: Diagram,
  shape: DiagramShape,
  rect: Rect,
  extra: Partial<Pick<DiagramNode, 'text' | 'color' | 'size'>> = {},
): { diagram: Diagram; id: string } {
  const id = freshId(takenIn(diagram));
  const frame =
    shape === 'frame'
      ? undefined
      : frameAt(diagram, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  const origin = frame ? absolutePosition(diagram.nodes, frame) : { x: 0, y: 0 };
  const box: DiagramNode = {
    id,
    shape,
    x: Math.round(rect.x - origin.x),
    y: Math.round(rect.y - origin.y),
    width: Math.round(Math.max(16, rect.width)),
    height: Math.round(Math.max(16, rect.height)),
    text: extra.text ?? '',
    ...(extra.color && { color: extra.color }),
    ...(extra.size && { size: extra.size }),
    ...(frame && { parent: frame.id }),
  };
  let next: Diagram = { ...diagram, nodes: [...diagram.nodes, box] };
  if (shape === 'frame') {
    // Drawn around boxes: they are in it now, as in Figma.
    const inside = diagram.nodes.filter((each) => {
      if (each.parent) return false;
      const r = rectIn(diagram, each);
      return (
        r.x >= rect.x &&
        r.y >= rect.y &&
        r.x + r.width <= rect.x + rect.width &&
        r.y + r.height <= rect.y + rect.height
      );
    });
    // Frames first: a frame drawn later around older ones goes before them.
    next = { ...next, nodes: [box, ...diagram.nodes] };
    for (const each of inside) next = reparent(next, each.id, id);
  }
  return { diagram: next, id };
}

/** A box's default size for its shape, its middle at `at`. */
export function defaultRect(shape: DiagramShape, at: { x: number; y: number }): Rect {
  const size = sizeFor(shape, '');
  return { x: at.x - size.width / 2, y: at.y - size.height / 2, ...size };
}

export function connect(
  diagram: Diagram,
  from: string,
  to: string,
  extra: Partial<DiagramEdge> = {},
): { diagram: Diagram; id: string | null } {
  if (from === to) return { diagram, id: null };
  const known = diagram.edges.find((arrow) => arrow.from === from && arrow.to === to);
  if (known) return { diagram, id: known.id };
  const id = freshId(takenIn(diagram), 'e');
  return {
    diagram: { ...diagram, edges: [...diagram.edges, { ...extra, id, from, to }] },
    id,
  };
}

const overlaps = (a: Rect, b: Rect, pad = 12) =>
  a.x < b.x + b.width + pad &&
  b.x < a.x + a.width + pad &&
  a.y < b.y + b.height + pad &&
  b.y < a.y + a.height + pad;

/**
 * A box like `fromId` on its `side`, joined by an arrow (FigJam's „+“ beside a box): it moves
 * along until it stands free of the others.
 */
export function addConnected(
  diagram: Diagram,
  fromId: string,
  side: DiagramSide,
): { diagram: Diagram; id: string } | null {
  const from = boxById(diagram, fromId);
  if (!from || from.shape === 'frame') return null;
  const rect = rectIn(diagram, from);
  const shape = from.shape === 'text' ? 'rounded' : from.shape;
  const size = from.shape === 'text' ? sizeFor('rounded', '') : rect;
  const step = { x: 0, y: 0 };
  let at: Rect;
  if (side === 'right' || side === 'left') {
    const x = side === 'right' ? rect.x + rect.width + GAP : rect.x - GAP - size.width;
    at = { x, y: rect.y + rect.height / 2 - size.height / 2, width: size.width, height: size.height };
    step.y = size.height + 24;
  } else {
    const y = side === 'bottom' ? rect.y + rect.height + GAP : rect.y - GAP - size.height;
    at = { x: rect.x + rect.width / 2 - size.width / 2, y, width: size.width, height: size.height };
    step.x = size.width + 24;
  }
  const others = diagram.nodes.filter((each) => each.shape !== 'frame').map((each) => rectIn(diagram, each));
  for (let tries = 0; tries < 12 && others.some((other) => overlaps(other, at)); tries += 1) {
    at = { ...at, x: at.x + step.x, y: at.y + step.y };
  }
  const added = addBox(diagram, shape, at, { ...(from.color && { color: from.color }) });
  const joined = connect(added.diagram, fromId, added.id);
  return { diagram: joined.diagram, id: added.id };
}

/** A frame around the boxes, they in it. */
export function frameAround(diagram: Diagram, ids: ReadonlySet<string>): { diagram: Diagram; id: string } | null {
  const boxes = diagram.nodes.filter((box) => ids.has(box.id));
  if (boxes.length === 0) return null;
  // Only those whose frame is not picked too: the others come along in it.
  const top = boxes.filter((box) => !box.parent || !ids.has(box.parent));
  const rects = top.map((box) => rectIn(diagram, box));
  const x = Math.min(...rects.map((r) => r.x)) - FRAME_PAD;
  const y = Math.min(...rects.map((r) => r.y)) - FRAME_TITLE;
  const right = Math.max(...rects.map((r) => r.x + r.width)) + FRAME_PAD;
  const bottom = Math.max(...rects.map((r) => r.y + r.height)) + FRAME_PAD;
  const parents = new Set(top.map((box) => box.parent));
  const parent = parents.size === 1 ? [...parents][0] : undefined;
  const id = freshId(takenIn(diagram));
  const origin = parent ? rectIn(diagram, boxById(diagram, parent)!) : { x: 0, y: 0 };
  const frame: DiagramNode = {
    id,
    shape: 'frame',
    x: Math.round(x - origin.x),
    y: Math.round(y - origin.y),
    width: Math.round(right - x),
    height: Math.round(bottom - y),
    text: '',
    ...(parent && { parent }),
  };
  // Before the first of them: it lies under them.
  const first = diagram.nodes.findIndex((box) => ids.has(box.id));
  const nodes = [...diagram.nodes];
  nodes.splice(first, 0, frame);
  let next: Diagram = { ...diagram, nodes };
  for (const box of top) next = reparent(next, box.id, id);
  return { diagram: next, id };
}

// ── Copy and paste ────────────────────────────────────────────────────────────────────────────

export const CLIP_FORMAT = 'slider-diagram-clip';

export interface Clip {
  format: typeof CLIP_FORMAT;
  /** Positions on the canvas for those at the top, as they lay. */
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

/** The picked boxes (a frame with what is in it) and the arrows between them, and picked arrows' ends. */
export function copyOf(diagram: Diagram, ids: ReadonlySet<string>): Clip | null {
  const take = new Set<string>();
  for (const box of diagram.nodes) {
    if (!ids.has(box.id)) continue;
    take.add(box.id);
    for (const inner of descendants(diagram, box.id)) take.add(inner);
  }
  if (take.size === 0) return null;
  const nodes = diagram.nodes
    .filter((box) => take.has(box.id))
    .map((box) => {
      if (box.parent && take.has(box.parent)) return box;
      const { parent: _parent, ...rest } = box;
      return { ...rest, ...absolutePosition(diagram.nodes, box) };
    });
  const edges = diagram.edges.filter((arrow) => take.has(arrow.from) && take.has(arrow.to));
  return { format: CLIP_FORMAT, nodes, edges };
}

export function readClip(text: string): Clip | null {
  try {
    const value = JSON.parse(text) as Partial<Clip>;
    if (value?.format !== CLIP_FORMAT || !Array.isArray(value.nodes)) return null;
    return { format: CLIP_FORMAT, nodes: value.nodes, edges: value.edges ?? [] };
  } catch {
    return null;
  }
}

/**
 * The clip laid in with fresh ids, moved by `offset` – or its middle at `at` (where the pointer
 * is). The new boxes are given back to be picked.
 */
export function pasteClip(
  diagram: Diagram,
  clip: Clip,
  place: { offset: { x: number; y: number } } | { at: { x: number; y: number } },
): { diagram: Diagram; ids: string[] } {
  const taken = takenIn(diagram);
  const fresh = new Map<string, string>();
  const used = new Set<string>();
  const newId = (prefix: string) => {
    const id = freshId((each) => taken(each) || used.has(each), prefix);
    used.add(id);
    return id;
  };
  for (const box of clip.nodes) fresh.set(box.id, newId('n'));
  const top = clip.nodes.filter((box) => !box.parent || !fresh.has(box.parent));
  let dx = 0;
  let dy = 0;
  if ('offset' in place) {
    dx = place.offset.x;
    dy = place.offset.y;
  } else if (top.length > 0) {
    const left = Math.min(...top.map((b) => b.x));
    const upper = Math.min(...top.map((b) => b.y));
    const right = Math.max(...top.map((b) => b.x + b.width));
    const lower = Math.max(...top.map((b) => b.y + b.height));
    dx = place.at.x - (left + right) / 2;
    dy = place.at.y - (upper + lower) / 2;
  }
  const nodes: DiagramNode[] = clip.nodes.map((box) => {
    const inner = box.parent && fresh.has(box.parent);
    const { parent: _parent, ...rest } = box;
    return {
      ...rest,
      id: fresh.get(box.id)!,
      x: inner ? box.x : Math.round(box.x + dx),
      y: inner ? box.y : Math.round(box.y + dy),
      ...(inner && { parent: fresh.get(box.parent!)! }),
    };
  });
  const edges: DiagramEdge[] = clip.edges
    .filter((arrow) => fresh.has(arrow.from) && fresh.has(arrow.to))
    .map((arrow) => ({
      ...arrow,
      id: newId('e'),
      from: fresh.get(arrow.from)!,
      to: fresh.get(arrow.to)!,
    }));
  // Frames before boxes; the top ones dropped into the frame they land in.
  const frames = nodes.filter((box) => box.shape === 'frame');
  const rest = nodes.filter((box) => box.shape !== 'frame');
  let next: Diagram = {
    ...diagram,
    nodes: [...diagram.nodes, ...frames, ...rest],
    edges: [...diagram.edges, ...edges],
  };
  const topIds = top.map((box) => fresh.get(box.id)!);
  next = dropInFrames(next, topIds);
  return { diagram: next, ids: topIds };
}

/** A box's height grown to hold its words (a text box takes their size). */
export function fitToText(box: DiagramNode): DiagramNode {
  if (box.shape === 'frame') return box;
  const needed = sizeFor(box.shape, box.text, undefined, box.size ?? 'm');
  if (box.shape === 'text') {
    return needed.width === box.width && needed.height === box.height ? box : { ...box, ...needed };
  }
  // Words wrap within its width: as many lines as that takes.
  const lines = needed.width > box.width ? Math.ceil(needed.width / box.width) : 1;
  const height = Math.max(box.height, Math.min(needed.height * lines, 20_000));
  return height === box.height ? box : { ...box, height };
}
