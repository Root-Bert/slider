/**
 * Routing for the connector lines between a mark on the slide and its comment card (B1, B4).
 * Pure functions on pixel coordinates; measuring the DOM happens in `useConnectorLayout`.
 * Matches the Figma connector vectors point for point (see the fixtures in the tests).
 *
 * Every line leaves its mark horizontally towards the nearest vertical slide edge, runs down in
 * its own "lane" beside the slide, turns into its own "bus" row above the cards and drops into
 * the top of its card – or, with the thread panel open, into the stacked thread blob (B4):
 *
 *   mark ──┐ lane
 *          │
 *          └──────── bus ───┐
 *                           ▼ card
 *
 * Lanes and bus rows never share a coordinate, and their order is chosen so lines don't cross.
 * Cards below the first band are reached through the free margin beside the board: the bus row
 * ends there, the line runs down the margin and turns in above the card's band.
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
  /** Horizontal extent of the mark – decides the exit side (nearest slide edge). */
  anchor: { left: number; right: number };
  /** Where the line leaves the mark, per exit side. */
  start: Record<Side, Px>;
  /** Entry point at the top edge of the card; ignored in blob mode. */
  target: Px;
  /**
   * Fixed vertical lane right of the slide (gap comments run down the divider line). The line
   * starts on it, so it takes no lane of its own.
   */
  fixedLaneX?: number | undefined;
  /** The card sits in a lower band: run down this side's margin, turn in above `bandTop`. */
  margin?: { side: Side; bandTop: number } | undefined;
}

export interface LayoutFrame {
  slide: Box;
  /** Outer limits for lanes: the stage's left edge and the gap divider line right of the slide. */
  corridor: { left: number; right: number };
  /** Band for the bus rows (card mode). */
  busTop: number;
  busBottom: number;
  /** Cards (by thread id) a final drop must not pass behind. */
  obstacles?: ReadonlyMap<string, Box> | undefined;
  /** Free x ranges beside the board for lines to lower bands. */
  margins?: Record<Side, { from: number; to: number }> | undefined;
}

export interface BlobFrame {
  slide: Box;
  corridor: { left: number; right: number };
  /** The stacked thread blob all lines merge into. */
  blob: { left: number; right: number; top: number };
}

export interface Connector {
  id: string;
  points: Px[];
}

/** Lane pitch and distance of the first lane from the slide edge. */
const LANE_PITCH = 8;
/** Lanes reach at most this far out from the slide. */
const LANE_REACH = 24;
/** Keep lanes this far from the stage edge (left) and the gap divider line (right). */
const LEFT_MARGIN = 12;
const DIVIDER_MARGIN = 8;
const MIN_LANE_PITCH = 3;
const BUS_PITCH = 10;
const MIN_BUS_PITCH = 4;
/** Blob mode (B4): bus rows 40px above the blob, 25px apart. */
const BLOB_BUS_OFFSET = 40;
const BLOB_BUS_PITCH = 25;
/** Blob entries start 36px in and are at most 40px apart. */
const BLOB_ENTRY_INSET = 36;
const BLOB_ENTRY_PITCH = 40;
/** Detour around a card: the last jog runs this far above the target card. */
const DETOUR_DROP = 12;
/** Clearance kept from cards when looking for a free vertical gutter. */
const GUTTER_CLEARANCE = 6;
/** Gutters narrower than twice this are used down their middle. */
const WIDE_GUTTER = 24;
/** Lines from the margin turn in this far above their band, 10px apart. */
const JOG_DROP = 12;
const JOG_PITCH = 10;

/** Nearest vertical slide edge; ties go left. */
export const exitSide = (anchor: { left: number; right: number }, slide: Box): Side =>
  anchor.left - slide.left <= slide.right - anchor.right ? 'left' : 'right';

/**
 * Lane x positions for `count` lines on one side, outermost first. Lanes start at the outer end
 * of the corridor (≤ 24px from the slide) and step 8px inwards. One extra line goes 8px inside
 * the slide edge; beyond that all lanes spread evenly (≥ 3px apart).
 */
export function assignLanes(
  side: Side,
  count: number,
  slide: Box,
  corridor: { left: number; right: number },
): number[] {
  const dir = side === 'left' ? 1 : -1; // from the outer end towards the slide
  const inner = side === 'left' ? slide.left - LANE_PITCH : slide.right + LANE_PITCH;
  let outer =
    side === 'left'
      ? Math.max(corridor.left + LEFT_MARGIN, slide.left - LANE_REACH)
      : Math.min(corridor.right - DIVIDER_MARGIN, slide.right + LANE_REACH);
  // Corridor narrower than one pitch: a single lane at the inner end.
  if ((inner - outer) * dir < 0) outer = inner;
  const span = Math.abs(inner - outer);
  const capacity = Math.floor(span / LANE_PITCH) + 1;

  if (count <= capacity)
    return Array.from({ length: count }, (_, i) => outer + dir * i * LANE_PITCH);
  if (count === capacity + 1) {
    const lanes = Array.from({ length: capacity }, (_, i) => outer + dir * i * LANE_PITCH);
    lanes.push(side === 'left' ? slide.left + LANE_PITCH : slide.right - LANE_PITCH);
    return lanes;
  }
  const pitch = Math.max(MIN_LANE_PITCH, span / (count - 1));
  return Array.from({ length: count }, (_, i) => outer + dir * i * pitch);
}

interface Routed {
  id: string;
  side: Side;
  start: Px;
  laneX: number;
  /** Rank within its side, 0 = outermost lane. */
  rank: number;
  target: Px;
  /** Where the bus row ends: the target x, or a free gutter when the drop would hit a card. */
  busEndX: number;
  busY: number;
  detour: boolean;
  /** Where a margin line turns in towards its card (or a detour's last jog). */
  jogY: number | null;
  margin: ConnectorRequest['margin'];
}

/** Assigns sides and lanes; per side the topmost mark gets the outermost lane, so stubs never cross lanes. */
function withLanes(
  requests: readonly ConnectorRequest[],
  slide: Box,
  corridor: { left: number; right: number },
): Routed[] {
  const routed: Routed[] = [];
  const fixed = requests.filter((request) => request.fixedLaneX !== undefined);
  for (const side of ['left', 'right'] as const) {
    const group = requests
      .filter(
        (request) => request.fixedLaneX === undefined && exitSide(request.anchor, slide) === side,
      )
      .sort((a, b) => a.start[side].y - b.start[side].y);
    const lanes = assignLanes(side, group.length, slide, corridor);
    group.forEach((request, index) => {
      routed.push(
        base(
          request,
          side,
          request.start[side],
          lanes[index]!,
          side === 'right' ? index + fixed.length : index,
        ),
      );
    });
  }
  // Fixed lanes (the divider) lie outside every right lane.
  fixed.forEach((request, index) => {
    routed.push(base(request, 'right', request.start.right, request.fixedLaneX!, index));
  });
  return routed;
}

const base = (
  request: ConnectorRequest,
  side: Side,
  start: Px,
  laneX: number,
  rank: number,
): Routed => ({
  id: request.id,
  side,
  start,
  laneX,
  rank,
  target: request.target,
  busEndX: request.target.x,
  busY: 0,
  detour: false,
  jogY: null,
  margin: request.margin,
});

type BusLine = Pick<Routed, 'side' | 'laneX' | 'busEndX'>;

const strictlyBetween = (value: number, a: number, b: number) =>
  value > Math.min(a, b) + 0.5 && value < Math.max(a, b) - 0.5;

/** Crossings caused when `a`'s bus row lies above `b`'s. */
const crossCost = (a: BusLine, b: BusLine) =>
  (strictlyBetween(b.laneX, a.laneX, a.busEndX) ? 1 : 0) +
  (strictlyBetween(a.busEndX, b.laneX, b.busEndX) ? 1 : 0);

const totalCost = (order: readonly BusLine[]) => {
  let cost = 0;
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++) cost += crossCost(order[i]!, order[j]!);
  return cost;
};

/**
 * Top-to-bottom order of the bus rows. Starts with the rightmost target on top, then swaps
 * neighbours while that removes crossings. Lines running outwards end up with outer lane → upper
 * row, lines running inwards with outer lane → lower row. If crossings remain, moving single
 * rows anywhere else gets one more chance.
 */
export function orderBusRows<T extends BusLine>(lines: readonly T[]): T[] {
  // Lines running out to the left margin only meet each other: outer lane on top, above all.
  const outwardLeft = (line: BusLine) => line.side === 'left' && line.busEndX < line.laneX - 0.5;
  let order = [...lines].sort((a, b) =>
    outwardLeft(a) || outwardLeft(b)
      ? Number(outwardLeft(b)) - Number(outwardLeft(a)) || a.laneX - b.laneX
      : b.busEndX - a.busEndX,
  );
  for (let pass = 0, improved = true; improved && pass < order.length * order.length; pass++) {
    improved = false;
    for (let i = 0; i + 1 < order.length; i++) {
      const a = order[i]!;
      const b = order[i + 1]!;
      if (crossCost(b, a) < crossCost(a, b)) {
        order[i] = b;
        order[i + 1] = a;
        improved = true;
      }
    }
  }
  let cost = totalCost(order);
  for (let pass = 0, improved = cost > 0; improved && pass < order.length; pass++) {
    improved = false;
    for (let from = 0; from < order.length && cost > 0; from++)
      for (let to = 0; to < order.length && cost > 0; to++) {
        if (to === from) continue;
        const moved = [...order];
        moved.splice(to, 0, ...moved.splice(from, 1));
        const movedCost = totalCost(moved);
        if (movedCost < cost) {
          order = moved;
          cost = movedCost;
          improved = true;
        }
      }
  }
  return order;
}

/**
 * A free x for the vertical run from `fromY` down to `toY` that misses every card except the
 * target – nearest to `preferredX`. `null` when the straight drop is already free.
 */
export function findGutter(
  preferredX: number,
  fromY: number,
  toY: number,
  obstacles: readonly Box[],
): number | null {
  const blocking = obstacles.filter((box) => box.top < toY && box.bottom > fromY);
  const hits = (x: number) => blocking.some((box) => x > box.left - 1 && x < box.right + 1);
  if (!hits(preferredX)) return null;

  const intervals = blocking
    .map((box) => [box.left - GUTTER_CLEARANCE, box.right + GUTTER_CLEARANCE] as const)
    .sort((a, b) => a[0] - b[0]);
  // Merge the blocked intervals; free x positions lie before, between and after them.
  const merged: [number, number][] = [];
  for (const [left, right] of intervals) {
    const last = merged.at(-1);
    if (last && left <= last[1]) last[1] = Math.max(last[1], right);
    else merged.push([left, right]);
  }
  const candidates = [merged[0]![0], merged.at(-1)![1]];
  for (let i = 1; i < merged.length; i++) {
    const from = merged[i - 1]![1];
    const to = merged[i]![0];
    // Narrow gutters are used down their middle, wide ones as close to the target as possible.
    candidates.push(
      to - from < 2 * WIDE_GUTTER ? (from + to) / 2 : Math.min(Math.max(preferredX, from), to),
    );
  }
  return candidates.reduce((best, x) =>
    Math.abs(x - preferredX) < Math.abs(best - preferredX) ? x : best,
  );
}

/** Card mode (B1): every line ends at the top of its own card. */
export function layoutConnectors(
  requests: readonly ConnectorRequest[],
  frame: LayoutFrame,
): Connector[] {
  const routed = withLanes(requests, frame.slide, frame.corridor);
  if (frame.margins) routeMargins(routed, frame.margins);

  for (const line of routed) {
    if (line.margin && frame.margins) continue;
    // Nearly straight down: skip the bus row.
    if (Math.abs(line.target.x - line.laneX) < 1) line.busEndX = line.laneX;
    const others = frame.obstacles
      ? [...frame.obstacles].filter(([id]) => id !== line.id).map(([, box]) => box)
      : [];
    const gutter = findGutter(line.busEndX, frame.busBottom, line.target.y, others);
    if (gutter !== null) {
      line.busEndX = gutter;
      line.detour = true;
      line.jogY = line.target.y - DETOUR_DROP;
    }
  }

  const order = orderBusRows(routed);
  const pitch =
    order.length > 1
      ? Math.max(
          MIN_BUS_PITCH,
          Math.min(BUS_PITCH, (frame.busBottom - frame.busTop) / (order.length - 1)),
        )
      : 0;
  order.forEach((line, index) => (line.busY = frame.busTop + index * pitch));

  return routed.map((line) => ({ id: line.id, points: polyline(line) }));
}

/**
 * Lines to lower bands: their bus row ends in the margin, they run down there and turn in above
 * their band. Per side, the line to the deepest band – and within a band the outermost card –
 * runs outermost and turns in lowest, so the turns never cross another margin line.
 */
function routeMargins(routed: Routed[], margins: Record<Side, { from: number; to: number }>) {
  for (const side of ['left', 'right'] as const) {
    const outward = side === 'left' ? 1 : -1;
    const group = routed
      .filter((line) => line.margin?.side === side)
      .sort((a, b) => b.margin!.bandTop - a.margin!.bandTop || outward * (a.target.x - b.target.x));
    if (group.length === 0) continue;
    const { from, to } = margins[side];
    // Lines leaving the slide on this side keep their lanes, shifted as a whole into the margin
    // where they reach into the board: every line moves alike, so none jogs across another.
    const lanes = group.map((line) => line.laneX);
    const ordered = group.every(
      (line, index) =>
        line.side === side && (index === 0 || outward * (line.laneX - lanes[index - 1]!) > 0),
    );
    const innermost = lanes.at(-1)!;
    const shift = outward * Math.max(0, outward * (innermost - (side === 'left' ? to : from)));
    const outermost = lanes[0]! - shift;
    const fits =
      ordered && (side === 'left' ? outermost >= from - LANE_PITCH : outermost <= to + LANE_PITCH);
    const pitch =
      group.length > 1 ? Math.min(LANE_PITCH, Math.max(0, to - from) / (group.length - 1)) : 0;
    const centre = (from + to) / 2;
    const outer = centre - (outward * pitch * (group.length - 1)) / 2;
    group.forEach((line, index) => {
      line.busEndX = fits ? line.laneX - shift : outer + outward * index * pitch;
    });
    // Turns above each band: the outermost line lowest.
    const ranks = new Map<number, number>();
    for (const line of group) {
      const { bandTop } = line.margin!;
      const rank = ranks.get(bandTop) ?? 0;
      ranks.set(bandTop, rank + 1);
      line.jogY = bandTop - JOG_DROP - rank * JOG_PITCH;
      line.detour = true;
    }
  }
}

/**
 * Blob mode (B4, thread panel open): all lines merge into the stacked thread blob, entering it
 * clockwise (left lanes outer→inner, then right lanes inner→outer).
 */
export function layoutBlobConnectors(
  requests: readonly ConnectorRequest[],
  frame: BlobFrame,
): Connector[] {
  const routed = withLanes(requests, frame.slide, frame.corridor);
  const { blob } = frame;
  const bySide = (side: Side) =>
    routed.filter((line) => line.side === side).sort((a, b) => a.rank - b.rank);
  const clockwise = [...bySide('left'), ...bySide('right').reverse()];
  const pitch = Math.min(
    BLOB_ENTRY_PITCH,
    (blob.right - blob.left - 2 * BLOB_ENTRY_INSET) / Math.max(1, clockwise.length - 1),
  );
  clockwise.forEach((line, index) => {
    line.target = { x: blob.left + BLOB_ENTRY_INSET + index * pitch, y: blob.top };
    line.busEndX = Math.abs(line.target.x - line.laneX) < 1 ? line.laneX : line.target.x;
  });

  // Per side, lines that need a jog get rows above the blob, the outermost lane lowest.
  for (const side of ['left', 'right'] as const) {
    let row = 0;
    for (const line of bySide(side)) {
      if (line.busEndX === line.laneX) line.busY = blob.top;
      else line.busY = blob.top - BLOB_BUS_OFFSET - row++ * BLOB_BUS_PITCH;
    }
  }
  return routed.map((line) => ({ id: line.id, points: polyline(line) }));
}

function polyline(line: Routed): Px[] {
  const { start, laneX, busY, busEndX, target } = line;
  const points: Px[] = [
    start,
    { x: laneX, y: start.y },
    { x: laneX, y: busY },
    { x: busEndX, y: busY },
  ];
  if (line.detour && line.jogY !== null) {
    points.push({ x: busEndX, y: line.jogY }, { x: target.x, y: line.jogY });
  }
  points.push(line.detour ? target : { x: busEndX, y: target.y });
  return dedupe(points);
}

/** Drops repeated points and the middle of straight runs. */
function dedupe(points: Px[]): Px[] {
  const distinct = points.filter((point, index) => {
    const previous = points[index - 1];
    return (
      !previous || Math.abs(previous.x - point.x) > 0.5 || Math.abs(previous.y - point.y) > 0.5
    );
  });
  return distinct.filter((point, index) => {
    const previous = distinct[index - 1];
    const next = distinct[index + 1];
    if (!previous || !next) return true;
    const vertical = Math.abs(previous.x - point.x) < 0.5 && Math.abs(next.x - point.x) < 0.5;
    const horizontal = Math.abs(previous.y - point.y) < 0.5 && Math.abs(next.y - point.y) < 0.5;
    return !vertical && !horizontal;
  });
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * SVG path through the polyline with rounded corners. A corner's radius shrinks on short
 * segments: inner segments are shared by two corners (half each), the first and last segment
 * belong to one corner only (a 4px stub gets r=4, as in Figma).
 */
export function roundedPath(points: readonly Px[], radius = 8): string {
  const [first] = points;
  if (!first) return '';
  let d = `M${round(first.x)} ${round(first.y)}`;
  const last = points.length - 1;
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
    const r = Math.min(
      radius,
      i === 1 ? inLength : inLength / 2,
      i + 1 === last ? outLength : outLength / 2,
    );
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

/** Clearance kept between the panel link and a card it would otherwise run through. */
const PANEL_LINK_CLEARANCE = 6;

/**
 * Polyline of the link from the focused thread to the thread panel (B4). Straight across when
 * nothing is in the way; otherwise it leaves through the gap beside its column (`exitX`), runs
 * along `laneY` (above every column's cards) to `entryX` next to the panel and drops back to the
 * dock height – so it never crosses other slides' cards.
 */
export function panelLinkPoints(
  from: Px,
  toX: number,
  obstacles: readonly Box[],
  lanes: { exitX: number; laneY: number; entryX: number },
): Px[] {
  const end = { x: toX, y: from.y };
  const blocked = obstacles.some(
    (box) =>
      box.right > from.x + 1 &&
      box.left < toX &&
      box.top - PANEL_LINK_CLEARANCE < from.y &&
      box.bottom + PANEL_LINK_CLEARANCE > from.y,
  );
  const entryX = Math.min(lanes.entryX, toX);
  const exitX = Math.min(Math.max(lanes.exitX, from.x), entryX);
  if (!blocked || lanes.laneY >= from.y || exitX >= entryX) return [from, end];
  return [
    from,
    { x: exitX, y: from.y },
    { x: exitX, y: lanes.laneY },
    { x: entryX, y: lanes.laneY },
    { x: entryX, y: from.y },
    end,
  ];
}

export interface Band {
  top: number;
  bottom: number;
}

export interface FadeStop {
  y: number;
  opacity: number;
}

/** Lines fade out over this distance above the band and back in below it. */
const FADE_ABOVE_FROM = 28;
const FADE_ABOVE_TO = 10;
const FADE_BELOW = 12;

/**
 * Vertical opacity profile shared by all lines: they fade out just above the band between the
 * slides and the comments (minimap, controls row and split handle), stay hidden through the
 * whole band – no stubs between its rows – and fade back in below it. `null` (nothing measured)
 * hides nothing. Stops are ascending in y.
 */
export function fadeStops(band: Band | null): FadeStop[] {
  if (!band) return [];
  const top = band.top - FADE_ABOVE_TO;
  const bottom = Math.max(top, band.bottom);
  return [
    { y: Math.min(top, band.top - FADE_ABOVE_FROM), opacity: 1 },
    { y: top, opacity: 0 },
    { y: bottom, opacity: 0 },
    { y: bottom + FADE_BELOW, opacity: 1 },
  ];
}
