import { describe, expect, it } from 'vitest';
import { bandCapacity, brickLayout, planBands } from './card-layout';
import {
  assignLanes,
  fadeStops,
  findGutter,
  layoutBlobConnectors,
  layoutConnectors,
  panelLinkPoints,
  roundedPath,
  type Box,
  type Connector,
  type ConnectorRequest,
  type Px,
} from './connector-routing';

// Figma B1 (105:111) / B4 (92:2550): slide 32..512 × 32..302, gap divider at 544.
const slide: Box = { left: 32, top: 32, right: 512, bottom: 302 };
const corridor = { left: 0, right: 544 };

const at = (x: number, y: number) => ({ left: { x, y }, right: { x, y } });
const marks: Omit<ConnectorRequest, 'target'>[] = [
  { id: 'annaPpt', anchor: { left: 54, right: 78 }, start: at(54, 62) },
  {
    id: 'lenaThread',
    anchor: { left: 84, right: 150 },
    start: { left: { x: 84, y: 176 }, right: { x: 150, y: 132 } },
  },
  {
    id: 'maxText',
    anchor: { left: 44, right: 234 },
    start: { left: { x: 44, y: 255 }, right: { x: 234, y: 255 } },
  },
  {
    id: 'maxLogo',
    anchor: { left: 448, right: 492 },
    start: { left: { x: 448, y: 265 }, right: { x: 492, y: 265 } },
  },
  {
    id: 'lenaVideo',
    anchor: { left: 447, right: 457 },
    start: { left: { x: 447, y: 214 }, right: { x: 457, y: 214 } },
  },
  {
    id: 'annaBild',
    anchor: { left: 390, right: 479 },
    start: { left: { x: 390, y: 150 }, right: { x: 484, y: 150 } },
  },
  {
    id: 'robert',
    anchor: { left: 473, right: 483 },
    start: { left: { x: 473, y: 60 }, right: { x: 483, y: 60 } },
  },
];

const b1Targets: Record<string, Px> = {
  annaPpt: { x: 42, y: 580 },
  lenaThread: { x: 344, y: 696 },
  maxText: { x: 418, y: 580 },
  maxLogo: { x: 720, y: 768 },
  lenaVideo: { x: 794, y: 580 },
  annaBild: { x: 1072, y: 684 },
  robert: { x: 1146, y: 580 },
};
const b1Requests = marks.map((mark) => ({ ...mark, target: b1Targets[mark.id]! }));

/** Polyline as Figma writes it: `M x y` followed by H/V segments. */
const svgOf = (points: readonly Px[]) =>
  'M' +
  points
    .map((point, i) => {
      if (i === 0) return `${point.x} ${point.y}`;
      return points[i - 1]!.y === point.y ? `H${point.x}` : `V${point.y}`;
    })
    .join(' ');

const byId = (connectors: Connector[]) =>
  Object.fromEntries(connectors.map((connector) => [connector.id, svgOf(connector.points)]));

type Segment = { a: Px; b: Px; id: string };
const segmentsOf = (connectors: Connector[], horizontal: boolean): Segment[] =>
  connectors.flatMap(({ id, points }) =>
    points
      .slice(1)
      .map((b, i) => ({ a: points[i]!, b, id }))
      .filter(({ a, b }) => (horizontal ? a.y === b.y && a.x !== b.x : a.x === b.x && a.y !== b.y)),
  );

/** Number of places where a horizontal segment of one line crosses a vertical one of another. */
function crossings(connectors: Connector[]): number {
  const inside = (v: number, a: number, b: number) =>
    v > Math.min(a, b) + 1 && v < Math.max(a, b) - 1;
  let count = 0;
  for (const h of segmentsOf(connectors, true))
    for (const v of segmentsOf(connectors, false))
      if (h.id !== v.id && inside(v.a.x, h.a.x, h.b.x) && inside(h.a.y, v.a.y, v.b.y)) count++;
  return count;
}

describe('layoutConnectors (card mode, Figma B1)', () => {
  const frame = { slide, corridor, busTop: 500, busBottom: 560 };

  it('reproduces the Figma connector vectors exactly', () => {
    expect(byId(layoutConnectors(b1Requests, frame))).toEqual({
      annaPpt: 'M54 62 H12 V560 H42 V580',
      lenaThread: 'M84 176 H20 V550 H344 V696',
      maxText: 'M44 255 H40 V540 H418 V580',
      maxLogo: 'M492 265 H504 V530 H720 V768',
      lenaVideo: 'M457 214 H520 V520 H794 V580',
      annaBild: 'M484 150 H528 V510 H1072 V684',
      robert: 'M483 60 H536 V500 H1146 V580',
    });
  });

  it('has no crossings', () => {
    expect(crossings(layoutConnectors(b1Requests, frame))).toBe(0);
  });

  it('has no crossings for random marks with cards in clockwise order', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 50; run++) {
      const count = 2 + Math.floor(random() * 6);
      const requests = Array.from({ length: count }, (_, i) => {
        const x = 40 + random() * 460;
        const y = 40 + random() * 250;
        return {
          id: `m${i}`,
          anchor: { left: x, right: x },
          start: at(x, y),
          target: { x: 0, y: 600 },
        };
      });
      // Clockwise: left exits top→bottom, then right exits bottom→top.
      const left = requests.filter((r) => r.anchor.left - 32 <= 512 - r.anchor.right);
      const right = requests.filter((r) => !left.includes(r));
      const ordered = [
        ...left.sort((a, b) => a.start.left.y - b.start.left.y),
        ...right.sort((a, b) => b.start.right.y - a.start.right.y),
      ];
      ordered.forEach((request, i) => (request.target = { x: 40 + i * 180, y: 600 }));
      const busBottom = 500 + 10 * (count - 1);
      expect(crossings(layoutConnectors(requests, { ...frame, busBottom }))).toBe(0);
    }
  });

  it('runs straight down when the card sits under the lane', () => {
    const [line] = layoutConnectors([{ ...b1Requests[6]!, target: { x: 536.4, y: 580 } }], frame);
    expect(line!.points).toHaveLength(3);
  });

  it('runs a gap comment down its fixed lane without a stub', () => {
    const [line] = layoutConnectors(
      [
        {
          id: 'gap',
          anchor: { left: 544, right: 544 },
          start: at(544, 190),
          fixedLaneX: 544,
          target: { x: 900, y: 580 },
        },
      ],
      frame,
    );
    expect(svgOf(line!.points)).toBe('M544 190 V500 H900 V580');
  });

  it('detours through a gutter instead of dropping behind another card', () => {
    const obstacles = new Map<string, Box>([
      ['row1', { left: 16, top: 580, right: 296, bottom: 680 }],
      ['row1b', { left: 392, top: 580, right: 672, bottom: 680 }],
    ]);
    const [line] = layoutConnectors([{ ...b1Requests[0]!, target: { x: 250, y: 760 } }], {
      ...frame,
      obstacles,
    });
    const xs = line!.points.map((point) => point.x);
    // Bus → gutter between the row-1 cards → jog above the target → down into the card.
    expect(xs.at(-1)).toBe(250);
    const gutterX = line!.points.at(-3)!.x;
    expect(gutterX).toBeGreaterThan(296);
    expect(gutterX).toBeLessThan(392);
    expect(line!.points.at(-2)).toEqual({ x: 250, y: 748 });
  });
});

/** Segments that run through a card other than the line's own (the last one ends in its card). */
function behindCards(connectors: Connector[], cards: ReadonlyMap<string, Box>): string[] {
  const hits: string[] = [];
  for (const { id, points } of connectors)
    points.slice(1).forEach((b, i) => {
      const a = points[i]!;
      for (const [cardId, box] of cards) {
        if (cardId === id && i === points.length - 2) continue;
        const overlaps =
          Math.max(a.x, b.x) > box.left + 1 &&
          Math.min(a.x, b.x) < box.right - 1 &&
          Math.max(a.y, b.y) > box.top + 1 &&
          Math.min(a.y, b.y) < box.bottom - 1;
        if (overlaps) hits.push(`${id} behind ${cardId}`);
      }
    });
  return hits;
}

/**
 * Cards for `requests` (in clockwise order) as CommentBoard places them on a board starting at
 * x=32 below the bus rows, and the routing frame for them.
 */
function boardFor(requests: ConnectorRequest[], width: number, leftCount: number) {
  const boardLeft = 32;
  const cardsTop = 580;
  const plan = planBands(requests.length, leftCount, bandCapacity(width));
  const heights = plan.order.map((index) => 80 + ((index * 37) % 60));
  const layout = brickLayout(heights, width, plan.bandGap);
  const bandTops = new Map<number, number>();
  layout.cards.forEach((card) =>
    bandTops.set(card.band, Math.min(bandTops.get(card.band) ?? card.top, card.top)),
  );
  const cards = new Map<string, Box>();
  const routed = plan.order.map((index, position) => {
    const card = layout.cards[position]!;
    const request = requests[index]!;
    const box = {
      left: boardLeft + card.left,
      top: cardsTop + card.top,
      right: boardLeft + card.left + card.width,
      bottom: cardsTop + card.top + heights[position]!,
    };
    cards.set(request.id, box);
    const side = plan.margin[position];
    return {
      ...request,
      target: { x: box.left + 26, y: box.top },
      margin: side ? { side, bandTop: cardsTop + bandTops.get(card.band)! } : undefined,
    };
  });
  const margins = {
    left: { from: 8, to: boardLeft - 10 },
    right: { from: boardLeft + width + 10, to: boardLeft + width + boardLeft - 8 },
  };
  return { routed, cards, margins, plan };
}

describe('layoutConnectors with several card bands', () => {
  const frame = { slide, corridor, busTop: 500, busBottom: 560 };

  it('runs the lines to lower bands down the margins without crossings', () => {
    // 1024px window: five cards fit into the first band, two go below.
    const { routed, cards, margins, plan } = boardFor(b1Requests, 960, 3);
    expect(plan.margin.filter(Boolean)).toHaveLength(2);
    const connectors = layoutConnectors(routed, { ...frame, obstacles: cards, margins });
    expect(crossings(connectors)).toBe(0);
    expect(behindCards(connectors, cards)).toEqual([]);
    // The outermost left line keeps its lane in the margin and turns in above the second band.
    const annaPpt = connectors.find((connector) => connector.id === 'annaPpt')!;
    expect(annaPpt.points[1]!.x).toBe(12);
    expect(annaPpt.points.at(-1)).toEqual(routed.find((r) => r.id === 'annaPpt')!.target);
  });

  it('has no crossings for random marks at any board width', () => {
    let seed = 11;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 200; run++) {
      const count = 2 + Math.floor(random() * 11);
      const width = 700 + Math.floor(random() * 800);
      const requests: ConnectorRequest[] = Array.from({ length: count }, (_, i) => {
        const x = 40 + random() * 460;
        const y = 40 + random() * 250;
        return {
          id: `m${i}`,
          anchor: { left: x, right: x },
          start: at(x, y),
          target: { x: 0, y: 0 },
        };
      });
      const isLeft = (r: ConnectorRequest) => r.anchor.left - 32 <= 512 - r.anchor.right;
      const ordered = [
        ...requests.filter(isLeft).sort((a, b) => a.start.left.y - b.start.left.y),
        ...requests.filter((r) => !isLeft(r)).sort((a, b) => b.start.right.y - a.start.right.y),
      ];
      const { routed, cards, margins } = boardFor(ordered, width, requests.filter(isLeft).length);
      const connectors = layoutConnectors(routed, {
        ...frame,
        corridor: { left: 0, right: Math.min(544, 32 + width) },
        obstacles: cards,
        margins,
      });
      expect(crossings(connectors), `run ${run}: ${count} cards, ${width}px`).toBe(0);
      expect(behindCards(connectors, cards), `run ${run}`).toEqual([]);
    }
  });
});

describe('layoutBlobConnectors (thread panel open, Figma B4)', () => {
  it('merges all lines into the blob like Figma', () => {
    const connectors = layoutBlobConnectors(
      marks.map((mark) => ({ ...mark, target: { x: 0, y: 0 } })),
      { slide, corridor, blob: { left: 260, right: 620, top: 630 } },
    );
    expect(byId(connectors)).toEqual({
      annaPpt: 'M54 62 H12 V590 H296 V630',
      lenaThread: 'M84 176 H20 V565 H336 V630',
      maxText: 'M44 255 H40 V540 H376 V630',
      maxLogo: 'M492 265 H504 V540 H416 V630',
      lenaVideo: 'M457 214 H520 V565 H456 V630',
      annaBild: 'M484 150 H528 V590 H496 V630',
      robert: 'M483 60 H536 V630',
    });
    expect(crossings(connectors)).toBe(0);
  });
});

describe('assignLanes', () => {
  it('steps 8px in from the outer end, then uses one lane inside the slide edge', () => {
    expect(assignLanes('right', 4, slide, corridor)).toEqual([536, 528, 520, 504]);
    expect(assignLanes('left', 3, slide, corridor)).toEqual([12, 20, 40]);
  });

  it('keeps the right lanes clear of the gap divider', () => {
    expect(assignLanes('right', 1, slide, { left: 0, right: 530 })).toEqual([522]);
  });

  it('spreads many lanes within the corridor, at least 3px apart', () => {
    for (const side of ['left', 'right'] as const) {
      const lanes = assignLanes(side, 10, slide, corridor);
      const sorted = [...lanes].sort((a, b) => a - b);
      sorted.slice(1).forEach((x, i) => expect(x - sorted[i]!).toBeGreaterThanOrEqual(3 - 1e-9));
      for (const x of lanes) {
        if (side === 'left') expect(x).toBeGreaterThanOrEqual(12);
        else expect(x).toBeLessThanOrEqual(536);
      }
    }
  });
});

describe('findGutter', () => {
  const cards: Box[] = [
    { left: 0, top: 0, right: 280, bottom: 100 },
    { left: 376, top: 0, right: 656, bottom: 100 },
  ];
  it('is null when the straight drop is free', () => {
    expect(findGutter(320, -50, 200, cards)).toBeNull();
  });
  it('finds the nearest free x next to the blocking cards', () => {
    expect(findGutter(100, -50, 200, cards)).toBe(-6);
    expect(findGutter(260, -50, 200, cards)).toBe(286);
  });
});

describe('panelLinkPoints', () => {
  const from = { x: 300, y: 500 };
  const lanes = { exitX: 330, laneY: 420, entryX: 1030 };
  const card = (left: number, top: number): Box => ({
    left,
    right: left + 240,
    top,
    bottom: top + 90,
  });

  it('runs straight to the panel when no card is in the way', () => {
    expect(panelLinkPoints(from, 1036, [card(400, 600), card(700, 380)], lanes)).toEqual([
      from,
      { x: 1036, y: 500 },
    ]);
  });

  it('detours above the other columns when a card sits on its height', () => {
    expect(panelLinkPoints(from, 1036, [card(400, 450)], lanes)).toEqual([
      from,
      { x: 330, y: 500 },
      { x: 330, y: 420 },
      { x: 1030, y: 420 },
      { x: 1030, y: 500 },
      { x: 1036, y: 500 },
    ]);
  });

  it('ignores cards left of the source and keeps the lanes between source and panel', () => {
    expect(panelLinkPoints(from, 1036, [card(20, 450)], lanes)).toHaveLength(2);
    const points = panelLinkPoints(from, 1036, [card(400, 450)], { ...lanes, exitX: 2000 });
    expect(Math.max(...points.map((point) => point.x))).toBe(1036);
  });
});

describe('roundedPath', () => {
  it('rounds corners with radius 8', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toBe('M0 0L92 0Q100 0 100 8L100 100');
  });

  it('lets a short first stub use its full length (Figma: 4px stub, r=4)', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 100 },
        { x: 50, y: 100 },
      ]),
    ).toBe('M0 0L0 0Q4 0 4 4L4 92Q4 100 12 100L50 100');
  });

  it('halves shared inner segments', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 10 },
        { x: 100, y: 10 },
      ]),
    ).toBe('M0 0L45 0Q50 0 50 5L50 5Q50 10 55 10L100 10');
  });
});

describe('fadeStops', () => {
  it('matches the Figma B1 gradient', () => {
    expect(fadeStops({ top: 350, bottom: 414 }, { top: 442, bottom: 482 })).toEqual([
      { y: 322, opacity: 1 },
      { y: 340, opacity: 0 },
      { y: 424, opacity: 0 },
      { y: 433, opacity: 0.85 },
      { y: 442, opacity: 0 },
      { y: 484, opacity: 0 },
      { y: 496, opacity: 1 },
    ]);
  });

  it('only hides the control row without a minimap', () => {
    expect(fadeStops(null, { top: 442, bottom: 482 })).toEqual([
      { y: 424, opacity: 1 },
      { y: 442, opacity: 0 },
      { y: 484, opacity: 0 },
      { y: 496, opacity: 1 },
    ]);
  });
});
