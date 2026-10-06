/**
 * Routing for the connector lines between a mark on the slide and its comment card (B1).
 * Pure functions on pixel coordinates; measuring the DOM happens in `useConnectorLayout`.
 *
 * Every line leaves its anchor sideways to a vertical "lane" next to the slide, runs down to a
 * horizontal "bus" just above the comment cards and drops into the top of its card:
 *
 *   anchor ──┐ lane
 *            │
 *            └──────── bus ───┐
 *                             ▼ card
 */

export interface Px {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Side = 'left' | 'right';

export interface ConnectorRequest {
  id: string;
  /** Anchor box on screen (zero-sized for pins). */
  anchor: Box;
  /** Normalised horizontal centre of the anchor on its slide – decides the exit side. */
  anchorCenterX: number;
  /** Entry point at the top edge of the card. */
  target: Px;
}

export interface LayoutFrame {
  slide: Box;
  /** y of the first bus line (top of the band between controls and cards). */
  busTop: number;
  /** Available space for lanes on each side of the slide and for the bus band. */
  laneSpace: { left: number; right: number };
  busSpace: number;
}

export interface Connector {
  id: string;
  points: Px[];
}

const LANE_GAP = 8;
const MAX_SPACING = 6;

const spacing = (space: number, count: number) =>
  Math.min(MAX_SPACING, count > 1 ? (space - LANE_GAP) / (count - 1) : 0);

/**
 * Lays out all connectors of one slide. Within a side, the line to the outermost card gets the
 * outermost lane and the lowest bus, which keeps lines of the same side from crossing.
 */
export function layoutConnectors(
  requests: readonly ConnectorRequest[],
  frame: LayoutFrame,
): Connector[] {
  const bySide: Record<Side, ConnectorRequest[]> = { left: [], right: [] };
  for (const request of requests)
    bySide[request.anchorCenterX < 0.5 ? 'left' : 'right'].push(request);

  // Outermost card first: leftmost targets for the left side, rightmost for the right side.
  bySide.left.sort((a, b) => a.target.x - b.target.x);
  bySide.right.sort((a, b) => b.target.x - a.target.x);

  const total = requests.length;
  const busStep = spacing(frame.busSpace, total);
  // Bus slots are shared between both sides; interleave so each side keeps its ordering.
  let busSlot = total - 1;

  const connectors: Connector[] = [];
  for (const side of ['left', 'right'] as const) {
    const group = bySide[side];
    const laneStep = spacing(frame.laneSpace[side], group.length);
    group.forEach((request, index) => {
      const offset = LANE_GAP + (group.length - 1 - index) * laneStep;
      const laneX = side === 'left' ? frame.slide.left - offset : frame.slide.right + offset;
      const busY = frame.busTop + busSlot * busStep;
      busSlot -= 1;
      connectors.push({ id: request.id, points: routeConnector(request, side, laneX, busY) });
    });
  }
  return connectors;
}

/** The orthogonal polyline for one connector. */
export function routeConnector(
  request: ConnectorRequest,
  side: Side,
  laneX: number,
  busY: number,
): Px[] {
  const { anchor, target } = request;
  const start: Px = {
    x: side === 'left' ? anchor.left : anchor.right,
    y: (anchor.top + anchor.bottom) / 2,
  };
  return dedupe([
    start,
    { x: laneX, y: start.y },
    { x: laneX, y: busY },
    { x: target.x, y: busY },
    target,
  ]);
}

function dedupe(points: Px[]): Px[] {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return (
      !previous || Math.abs(previous.x - point.x) > 0.5 || Math.abs(previous.y - point.y) > 0.5
    );
  });
}

const round = (value: number) => Math.round(value * 10) / 10;

/** SVG path through the polyline with rounded corners (radius shrinks on short segments). */
export function roundedPath(points: readonly Px[], radius = 10): string {
  const [first] = points;
  if (!first) return '';
  let d = `M${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < points.length; i++) {
    const corner = points[i]!;
    const next = points[i + 1];
    if (!next) {
      d += `L${round(corner.x)} ${round(corner.y)}`;
      break;
    }
    const previous = points[i - 1]!;
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const before = towards(corner, previous, r, inLength);
    const after = towards(corner, next, r, outLength);
    d += `L${round(before.x)} ${round(before.y)}Q${round(corner.x)} ${round(corner.y)} ${round(after.x)} ${round(after.y)}`;
  }
  return d;
}

function towards(from: Px, to: Px, distance: number, length: number): Px {
  if (length === 0) return from;
  return {
    x: from.x + ((to.x - from.x) / length) * distance,
    y: from.y + ((to.y - from.y) / length) * distance,
  };
}
