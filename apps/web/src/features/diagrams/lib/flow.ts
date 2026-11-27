import {
  absolutePosition,
  framesFirst,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type DiagramSide,
} from '@slider/shared';
import { Position, type Edge, type InternalNode, type Node } from '@xyflow/react';

/*
 * The diagram as the canvas (React Flow) shows it. The diagram is the one truth – what is saved
 * and what ⌘Z steps through; the canvas's nodes and edges are drawn from it on every change (a
 * drag moves the boxes in the diagram itself, kept out of the history until it is let go).
 */

export type BoxData = { box: DiagramNode };
export type ArrowData = { arrow: DiagramEdge };
export type BoxNode = Node<BoxData, 'box' | 'frame'>;
export type ArrowEdge = Edge<ArrowData, 'arrow'>;

/*
 * Layers, set by hand (`zIndexMode="manual"`): frames at the bottom, an inner frame over its outer
 * one; arrows over frames; boxes over arrows – an arrow never hides a box's words.
 */
export const ARROW_Z = 500;
export const BOX_Z = 1000;

function frameDepth(byId: ReadonlyMap<string, DiagramNode>, box: DiagramNode): number {
  let depth = 0;
  for (let at = box.parent; at && depth < 64; depth += 1) at = byId.get(at)?.parent;
  return depth;
}

/**
 * The diagram's boxes as the canvas's nodes. A box unchanged keeps its node (same object): the
 * canvas does not draw it again. Sizes are the box's own – given as measured, so nothing waits for
 * the browser to measure (an arrow drawn at once, nothing hidden after undo).
 */
export function nodesOf(
  diagram: Diagram,
  selected: ReadonlySet<string>,
  cache: WeakMap<DiagramNode, BoxNode>,
): BoxNode[] {
  const byId = new Map(diagram.nodes.map((box) => [box.id, box]));
  return framesFirst(diagram.nodes).map((box) => {
    const isSelected = selected.has(box.id);
    const known = cache.get(box);
    if (known && Boolean(known.selected) === isSelected) return known;
    const node: BoxNode = {
      id: box.id,
      type: box.shape === 'frame' ? 'frame' : 'box',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      measured: { width: box.width, height: box.height },
      // Where arrows hold on, given rather than measured: the arrow finds its side itself.
      handles: [
        { type: 'source', position: Position.Bottom, x: box.width / 2, y: box.height / 2 },
        { type: 'target', position: Position.Top, x: box.width / 2, y: box.height / 2 },
      ],
      ...(box.parent && byId.has(box.parent) && { parentId: box.parent }),
      data: { box },
      selected: isSelected,
      // What is picked lies over the rest while it is moved, as in Figma.
      zIndex: box.shape === 'frame' ? frameDepth(byId, box) : BOX_Z + (isSelected ? 1 : 0),
    };
    cache.set(box, node);
    return node;
  });
}

export function edgesOf(
  diagram: Diagram,
  selected: ReadonlySet<string>,
  cache: WeakMap<DiagramEdge, ArrowEdge>,
): ArrowEdge[] {
  return diagram.edges.map((arrow) => {
    const isSelected = selected.has(arrow.id);
    const known = cache.get(arrow);
    if (known && Boolean(known.selected) === isSelected) return known;
    const edge: ArrowEdge = {
      id: arrow.id,
      type: 'arrow',
      source: arrow.from,
      target: arrow.to,
      data: { arrow },
      selected: isSelected,
      zIndex: ARROW_Z,
    };
    cache.set(arrow, edge);
    return edge;
  });
}

// ── Arrows that find their side ────────────────────────────────────────────────────────────────

export type Rect = { x: number; y: number; width: number; height: number };

export const rectOf = (node: InternalNode): Rect => ({
  x: node.internals.positionAbsolute.x,
  y: node.internals.positionAbsolute.y,
  width: node.measured.width ?? node.width ?? 0,
  height: node.measured.height ?? node.height ?? 0,
});

const POSITION: Record<DiagramSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/** The side of `from` that faces `to` – across the larger gap, as a person would draw it. */
export function facingSide(from: Rect, to: Rect): DiagramSide {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  // Gaps between the boxes, not their centres: two boxes side by side join at their sides even
  // where one is much taller.
  const gapX = Math.max(to.x - (from.x + from.width), from.x - (to.x + to.width));
  const gapY = Math.max(to.y - (from.y + from.height), from.y - (to.y + to.height));
  const horizontal = gapX > 0 || gapY > 0 ? gapX > gapY : Math.abs(dx) / from.width > Math.abs(dy) / from.height;
  if (horizontal) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

export function sidePoint(rect: Rect, side: DiagramSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    default:
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
}

/** Where an arrow leaves and meets its boxes. */
export function arrowEnds(from: Rect, to: Rect, arrow: Pick<DiagramEdge, 'fromSide' | 'toSide'>) {
  const fromSide = arrow.fromSide ?? facingSide(from, to);
  const toSide = arrow.toSide ?? facingSide(to, from);
  const start = sidePoint(from, fromSide);
  const end = sidePoint(to, toSide);
  return {
    sourceX: start.x,
    sourceY: start.y,
    sourcePosition: POSITION[fromSide],
    targetX: end.x,
    targetY: end.y,
    targetPosition: POSITION[toSide],
  };
}

/** A box's place on the canvas, through its frames. */
export function absoluteOf(diagram: Diagram, id: string): Rect | null {
  const node = diagram.nodes.find((each) => each.id === id);
  if (!node) return null;
  return { ...absolutePosition(diagram.nodes, node), width: node.width, height: node.height };
}

/** A fresh id no box or arrow has. */
export function freshId(taken: (id: string) => boolean, prefix = 'n'): string {
  for (;;) {
    const id = `${prefix}${Math.random().toString(36).slice(2, 7)}`;
    if (!taken(id)) return id;
  }
}
