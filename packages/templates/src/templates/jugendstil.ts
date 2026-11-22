import type { Color, FillLike, Layout, Shape, Stroke, Template } from '../model';
import { smoothPath } from '../shapes';

/*
 * Jugendstil: the line that grows. Stems swing out like a whip and roll in at their ends, leaves
 * and buds sit on them in an even rhythm, frames are drawn in fine double lines of gold – on
 * ivory, with sage, plum and a deep green.
 */

const ivory = '#f6f0e1';
const linen = '#e9dfc6';
const aubergine = '#3a2433';
const mauve = '#6a5560';
const gold = '#b8964f';
const sage = '#8fa286';
const plum = '#6f3f5c';
const forest = '#42594b';
const rose = '#c9a09a';
const lagoon = '#6f9090';

const paleGold = '#d9c189';
const paleSage = '#dfe3cf';

type Point = readonly [number, number];
/** Where a drawing's points go on the page – for mirrored halves. */
type Place = (point: Point) => Point;
const same: Place = (point) => point;
const mirrored =
  (axis: number): Place =>
  ([x, y]) => [axis * 2 - x, y];
const upsideDown =
  (axis: number, inner: Place = same): Place =>
  (point) => {
    const [x, y] = inner(point);
    return [x, axis * 2 - y];
  };

/** A point on the smooth curve through `pts`, `t` 0 … 1 along it. */
function on(pts: readonly Point[], t: number): Point {
  const last = pts.length - 1;
  const place = Math.min(last - 1e-6, Math.max(0, t * last));
  const i = Math.floor(place);
  const f = place - i;
  const at = (index: number) => pts[Math.min(last, Math.max(0, index))]!;
  const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
  const axis = (k: 0 | 1) =>
    0.5 *
    (2 * p1[k] +
      (p2[k] - p0[k]) * f +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f +
      (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * f * f * f);
  return [axis(0), axis(1)];
}

const heading = (pts: readonly Point[], t: number) => {
  const [a, b] = [on(pts, Math.max(0, t - 0.01)), on(pts, Math.min(1, t + 0.01))];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
};

const PROFILES = {
  /** A whiplash line: swelling, then thinning to nothing. */
  whip: (t: number) => 0.12 + 0.88 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) ** 0.8,
  /** Thick where it starts, a hair where it ends. */
  taper: (t: number) => 1 - 0.93 * t ** 0.8,
  leaf: (t: number) => Math.sin(Math.PI * t ** 0.8),
  bud: (t: number) => Math.sin(Math.PI * t ** 0.58),
};

/** A band along the curve through `pts`, as wide as its profile says: a stem, a leaf, a bud. */
function band(
  place: Place,
  pts: readonly Point[],
  width: number,
  fill: FillLike,
  profile: keyof typeof PROFILES = 'whip',
  samples = 16,
): Shape {
  const [left, right]: [Point[], Point[]] = [[], []];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const [x, y] = on(pts, t);
    const turn = heading(pts, t);
    const half = Math.max(0.004, (width / 2) * PROFILES[profile](t));
    left.push(place([x - Math.sin(turn) * half, y + Math.cos(turn) * half]));
    right.push(place([x + Math.sin(turn) * half, y - Math.cos(turn) * half]));
  }
  const outline = [...left, ...right.reverse()].map(([x, y]): Point => [x * 100, y * 100]);
  return {
    t: 'path',
    x: 0,
    y: 0,
    w: 28,
    h: 15.75,
    vb: [2800, 1575],
    d: smoothPath(outline),
    fill,
    stroke: null,
  };
}

/** The points of a line rolling in: from a point, along a heading, turning `dir` (1 clockwise). */
function curl(from: Point, turn: number, size: number, dir: 1 | -1, turns = 1.3): Point[] {
  const centre: Point = [
    from[0] + Math.cos(turn + (dir * Math.PI) / 2) * size,
    from[1] + Math.sin(turn + (dir * Math.PI) / 2) * size,
  ];
  const start = turn - (dir * Math.PI) / 2;
  const steps = Math.round(turns * 9);
  return Array.from({ length: steps }, (_, index): Point => {
    const k = (index + 1) / steps;
    const angle = start + dir * k * turns * Math.PI * 2;
    const radius = size * (1 - 0.84 * k);
    return [centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius];
  });
}

const dot = (place: Place, [x, y]: Point, r: number, fill: FillLike): Shape => {
  const [px, py] = place([x, y]);
  return { t: 'ellipse', x: px - r, y: py - r, w: r * 2, h: r * 2, fill };
};

/** A leaf from a point: out to one side of a heading, bending back towards it. */
const leaf = (
  place: Place,
  base: Point,
  turn: number,
  side: 1 | -1,
  length: number,
  fill: FillLike,
  open = 0.95,
): Shape =>
  band(
    place,
    [
      base,
      [
        base[0] + Math.cos(turn + side * open) * length * 0.5,
        base[1] + Math.sin(turn + side * open) * length * 0.5,
      ],
      [
        base[0] + Math.cos(turn + side * open * 0.62) * length,
        base[1] + Math.sin(turn + side * open * 0.62) * length,
      ],
    ],
    length * 0.34,
    fill,
    'leaf',
    10,
  );

/** A bud on the end of a stem, in its calyx. */
const bud = (
  place: Place,
  base: Point,
  turn: number,
  size: number,
  fill: FillLike,
  calyx: FillLike,
): Shape[] => [
  band(
    place,
    [base, [base[0] + Math.cos(turn) * size, base[1] + Math.sin(turn) * size]],
    size * 0.62,
    fill,
    'bud',
    10,
  ),
  leaf(place, base, turn, 1, size * 0.62, calyx, 0.75),
  leaf(place, base, turn, -1, size * 0.62, calyx, 0.75),
];

interface Vine {
  width: number;
  fill: FillLike;
  /** Leaves: where along the stem (0 … 1), to which side, how long. */
  leaves?: readonly (readonly [number, 1 | -1, number])[];
  leafFill?: FillLike;
  /** The stem rolls in at its end: size and direction. */
  curl?: readonly [number, 1 | -1];
  /** Or it ends in a bud. */
  bud?: readonly [number, FillLike];
}

/** A stem through points with its leaves and its end. */
function vine(place: Place, pts: readonly Point[], look: Vine): Shape[] {
  const end = pts[pts.length - 1]!;
  const turn = heading(pts, 1);
  const stem = look.curl ? [...pts, ...curl(end, turn, look.curl[0], look.curl[1])] : pts;
  return [
    ...(look.leaves ?? []).map(([t, side, length]) =>
      leaf(place, on(pts, t), heading(pts, t), side, length, look.leafFill ?? sage),
    ),
    band(place, stem, look.width, look.fill, look.curl ? 'taper' : 'whip', look.curl ? 34 : 18),
    ...(look.bud ? bud(place, end, turn, look.bud[0], look.bud[1], look.fill) : []),
  ];
}

/** Half a flourish: a line swinging out to the right of a point and rolling in, a second under it. */
const swing = (place: Place, x: number, y: number, s: number, color: Color = gold): Shape[] => [
  ...vine(
    place,
    [
      [x + 0.25 * s, y],
      [x + 1.7 * s, y + 0.06 * s],
      [x + 3.1 * s, y - 0.28 * s],
      [x + 4.3 * s, y - 0.1 * s],
    ],
    { width: 0.1 * s, fill: color, curl: [0.42 * s, -1] },
  ),
  ...vine(
    place,
    [
      [x + 1.5 * s, y + 0.06 * s],
      [x + 2.3 * s, y + 0.36 * s],
      [x + 3.1 * s, y + 0.3 * s],
    ],
    { width: 0.075 * s, fill: color, curl: [0.26 * s, 1] },
  ),
  leaf(place, [x + 0.9 * s, y + 0.02 * s], 0, -1, 0.6 * s, color, 0.7),
];

/** A whole flourish, both ways from its centre. */
const flourish = (
  x: number,
  y: number,
  s: number,
  color: Color = gold,
  place: Place = same,
): Shape[] => [
  ...swing(place, x, y, s, color),
  ...swing((point) => place(mirrored(x)(point)), x, y, s, color),
  dot(place, [x, y], 0.11 * s, color),
];

/** The fine double line of a frame. */
const framed = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: Color = gold,
  r = 0,
): Shape[] => {
  const outer: Stroke = { color, width: 0.045 };
  const inner: Stroke = { color, width: 0.02 };
  return [
    { t: 'rect', x, y, w, h, r, fill: null, stroke: outer },
    {
      t: 'rect',
      x: x + 0.17,
      y: y + 0.17,
      w: w - 0.34,
      h: h - 0.34,
      r: Math.max(0, r - 0.17),
      fill: null,
      stroke: inner,
    },
  ];
};

/** The frame of a page with a small sprout in every corner. */
const pageFrame = (color: Color = gold, leafColor: Color = sage): Shape[] => {
  const [l, t, r, b] = [0.75, 0.75, 27.25, 15];
  const corner = (x: number, y: number, sx: 1 | -1, sy: 1 | -1): Shape[] => {
    const place: Place = ([px, py]) => [x + (px - l) * sx, y + (py - t) * sy];
    return [
      leaf(place, [l + 0.17, t + 0.17], 0, 1, 1.25, leafColor, 0.32),
      leaf(place, [l + 0.17, t + 0.17], Math.PI / 2, -1, 1.25, leafColor, 0.32),
      dot(place, [l + 0.62, t + 0.62], 0.1, color),
    ];
  };
  return [
    ...framed(l, t, r - l, b - t, color),
    ...corner(l, t, 1, 1),
    ...corner(r, t, -1, 1),
    ...corner(l, b, 1, -1),
    ...corner(r, b, -1, -1),
  ];
};

/** The plant of the title: three stems out of long leaves, in a tall arched field. */
const lily = (x: number, y: number): Shape[] => {
  const p = (dx: number, dy: number): Point => [x + dx, y + dy];
  return [
    band(same, [p(-0.1, 0), p(-2.1, -1.5), p(-2.8, -3.9)], 0.95, sage, 'leaf'),
    band(same, [p(0.1, 0), p(2.2, -1.3), p(2.9, -3.4)], 0.95, sage, 'leaf'),
    band(same, [p(0, 0), p(-0.9, -2), p(-0.7, -4.6)], 0.7, lagoon, 'leaf'),
    band(same, [p(0, 0), p(0.9, -1.8), p(0.6, -4)], 0.7, lagoon, 'leaf'),
    ...vine(same, [p(-0.25, 0), p(-1.5, -2.6), p(-1.1, -5.1), p(-2.1, -7)], {
      width: 0.13,
      fill: paleGold,
      curl: [0.62, -1],
      leaves: [
        [0.5, -1, 0.9],
        [0.78, 1, 0.75],
      ],
    }),
    ...vine(same, [p(0.25, 0), p(1.6, -2.2), p(1.2, -4.6), p(2.2, -6.5), p(1.9, -8)], {
      width: 0.13,
      fill: paleGold,
      bud: [1, rose],
      leaves: [
        [0.45, 1, 0.9],
        [0.7, -1, 0.75],
      ],
    }),
    ...vine(same, [p(0, 0), p(-0.5, -3), p(0.4, -6.1), p(-0.2, -8.6), p(0.05, -10.1)], {
      width: 0.16,
      fill: paleGold,
      bud: [1.35, ivory],
      leaves: [
        [0.42, -1, 1],
        [0.62, 1, 0.9],
        [0.8, -1, 0.75],
      ],
    }),
  ];
};

/** One side of the arch over a quotation: a stem up the side, over the top, rolling in. */
const archSide = (place: Place): Shape[] => [
  ...vine(
    place,
    [
      [24.5, 15.2],
      [25.4, 11],
      [24.8, 6.4],
      [22.2, 3.3],
      [18.6, 2.1],
      [15.7, 2.6],
    ],
    {
      width: 0.2,
      fill: gold,
      curl: [0.8, 1],
      leafFill: sage,
      leaves: [
        [0.1, -1, 1.2],
        [0.2, 1, 1.1],
        [0.31, -1, 1.2],
        [0.42, 1, 1.1],
        [0.53, -1, 1.15],
        [0.64, 1, 1],
        [0.75, -1, 1],
        [0.85, 1, 0.85],
      ],
    },
  ),
  ...vine(
    place,
    [
      [25.25, 10.2],
      [26.3, 8.8],
      [26.2, 7.2],
    ],
    { width: 0.1, fill: gold, bud: [0.85, rose] },
  ),
  ...vine(
    place,
    [
      [22.6, 3.6],
      [22.9, 5],
      [22.2, 6.1],
    ],
    { width: 0.1, fill: gold, bud: [0.8, rose] },
  ),
];

/** One side of the spray a talk ends on. */
const spraySide = (place: Place): Shape[] => [
  band(
    place,
    [
      [14.2, 15],
      [17.2, 14.1],
      [20.6, 14.4],
    ],
    0.85,
    sage,
    'leaf',
  ),
  band(
    place,
    [
      [14.2, 15],
      [16, 13.2],
      [18.4, 12.9],
    ],
    0.7,
    lagoon,
    'leaf',
  ),
  ...vine(
    place,
    [
      [14.3, 15],
      [16.8, 13.3],
      [19.8, 12.7],
      [22.6, 11.5],
    ],
    {
      width: 0.15,
      fill: gold,
      curl: [0.85, -1],
      leaves: [
        [0.45, -1, 1],
        [0.68, 1, 0.9],
        [0.86, -1, 0.8],
      ],
    },
  ),
  ...vine(
    place,
    [
      [14.2, 15],
      [15.1, 12.5],
      [16.7, 10.9],
      [18.7, 10.3],
    ],
    {
      width: 0.14,
      fill: gold,
      curl: [0.65, -1],
      leaves: [
        [0.5, -1, 0.9],
        [0.78, 1, 0.8],
      ],
    },
  ),
  ...vine(
    place,
    [
      [14.1, 15],
      [14.5, 12.4],
      [15.3, 10.4],
      [15.2, 8.9],
    ],
    { width: 0.12, fill: gold, bud: [0.95, rose], leaves: [[0.6, 1, 0.75]] },
  ),
];

/** A wreath round a medallion: leaves up both sides from its foot, two buds where it stays open. */
const wreath = (cx: number, cy: number, radius: number): Shape[] => {
  const side = (place: Place): Shape[] => {
    const shapes: Shape[] = [];
    for (let i = 0; i < 9; i += 1) {
      const angle = Math.PI / 2 - 0.16 - i * 0.29;
      const base: Point = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
      const tangent = angle - Math.PI / 2;
      shapes.push(leaf(place, base, tangent, 1, 1.25, i % 2 === 0 ? sage : forest, 0.7));
      shapes.push(leaf(place, base, tangent, -1, 0.95, i % 2 === 0 ? forest : sage, 0.55));
      if (i % 3 === 1) {
        shapes.push(
          dot(
            place,
            [
              cx + Math.cos(angle - 0.14) * (radius + 0.95),
              cy + Math.sin(angle - 0.14) * (radius + 0.95),
            ],
            0.13,
            gold,
          ),
        );
      }
    }
    const end = Math.PI / 2 - 0.16 - 9 * 0.29;
    shapes.push(
      ...bud(
        place,
        [cx + Math.cos(end) * radius, cy + Math.sin(end) * radius],
        end - Math.PI / 2 - 0.25,
        0.95,
        rose,
        gold,
      ),
    );
    return shapes;
  };
  return [...side(same), ...side(mirrored(cx))];
};

/** Three leaves fanning out of a corner, and a dot. */
const fan = (x: number, y: number, towards: number): Shape[] => [
  leaf(same, [x, y], towards, 1, 1.3, sage, 0.75),
  leaf(same, [x, y], towards, -1, 1.3, sage, 0.75),
  band(
    same,
    [
      [x, y],
      [x + Math.cos(towards) * 1.5, y + Math.sin(towards) * 1.5],
    ],
    0.42,
    forest,
    'leaf',
    10,
  ),
  dot(same, [x, y], 0.16, gold),
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: ivory,
    shapes: [
      ...pageFrame(),
      { t: 'rect', x: 18.15, y: 1.75, w: 7.7, h: 12.35, r: 3.85, fill: gold },
      { t: 'rect', x: 18.15, y: 6, w: 7.7, h: 8.1, fill: gold },
      { t: 'rect', x: 18.4, y: 2, w: 7.2, h: 11.85, r: 3.6, fill: forest },
      { t: 'rect', x: 18.4, y: 6, w: 7.2, h: 7.85, fill: forest },
      ...lily(22, 13.85),
      ...swing(same, 2.05, 9.75, 1.25),
    ],
    title: { x: 2.2, y: 2.7, w: 14.8, h: 5.9, valign: 'bottom', sample: 'Die Linie,\ndie wächst' },
    subtitle: { x: 2.25, y: 10.75, w: 13, h: 1.4, sample: 'Ornament und Natur um 1900' },
  },
  {
    name: 'Abschnitt',
    bg: plum,
    shapes: [
      ...pageFrame(paleGold, '#9a6f88'),
      ...flourish(14, 4.5, 2, paleGold),
      ...flourish(14, 4.5, 2, paleGold, upsideDown(7.875)),
      ...bud(same, [14, 3.6], -Math.PI / 2, 1, rose, paleGold),
      ...bud(same, [14, 12.15], Math.PI / 2, 1, rose, paleGold),
    ],
    title: {
      x: 4,
      y: 5.2,
      w: 20,
      h: 3.4,
      size: 46,
      color: ivory,
      align: 'center',
      valign: 'bottom',
      sample: 'Aus der Pflanze',
    },
    subtitle: {
      x: 6,
      y: 8.9,
      w: 16,
      h: 1.4,
      color: paleGold,
      align: 'center',
      sample: 'Zweites Kapitel',
    },
  },
  {
    name: 'Inhalt',
    bg: ivory,
    shapes: [
      { t: 'rect', x: 1.2, y: 1.2, w: 2.7, h: 13.35, r: 1.35, fill: paleSage },
      ...framed(1.2, 1.2, 2.7, 13.35, gold, 1.35),
      ...vine(
        same,
        [
          [2.55, 14],
          [2.05, 11.4],
          [3, 8.8],
          [2.05, 6.2],
          [2.7, 4],
          [2.5, 3.1],
        ],
        {
          width: 0.15,
          fill: gold,
          bud: [1.1, rose],
          leafFill: sage,
          leaves: [
            [0.12, 1, 0.95],
            [0.24, -1, 0.95],
            [0.37, 1, 0.95],
            [0.5, -1, 0.95],
            [0.63, 1, 0.9],
            [0.76, -1, 0.85],
            [0.88, 1, 0.7],
          ],
        },
      ),
      ...swing(same, 5.15, 4.4, 1.1),
    ],
    title: {
      x: 5.3,
      y: 1.1,
      w: 20.9,
      h: 2.4,
      size: 36,
      valign: 'bottom',
      sample: 'Woran man ihn erkennt',
    },
    body: {
      x: 5.3,
      y: 5.2,
      w: 20.4,
      h: 9.2,
      sample: [
        'Geschwungene Linien statt rechter Winkel',
        'Pflanzen und Blüten als Vorlage für alles',
        'Schrift, Bild und Rahmen aus einem Guss',
        'Gold, Salbei und gedeckte Töne',
        'Handwerk, das man dem Stück ansieht',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: ivory,
    shapes: [
      {
        t: 'ellipse',
        x: 4.9,
        y: 0.75,
        w: 6,
        h: 4.9,
        kind: 'section',
        start: 0,
        end: 180,
        fill: paleSage,
        stroke: { color: gold, width: 0.045 },
      },
      leaf(same, [7.9, 3.1], -Math.PI / 2 - 1.05, 1, 2, sage, 0.3),
      leaf(same, [7.9, 3.1], -Math.PI / 2 + 1.05, -1, 2, sage, 0.3),
      leaf(same, [7.9, 3.1], -Math.PI / 2 - 0.5, 1, 2.1, forest, 0.3),
      leaf(same, [7.9, 3.1], -Math.PI / 2 + 0.5, -1, 2.1, forest, 0.3),
      ...bud(same, [7.9, 3.15], -Math.PI / 2, 1.7, rose, gold),
      { t: 'rect', x: 2.25, y: 3.2, w: 11.3, h: 10.2, fill: ivory },
      ...framed(2.25, 3.2, 11.3, 10.2),
      ...vine(
        same,
        [
          [2.25, 13.4],
          [1.7, 14.1],
          [2.3, 14.7],
          [3.6, 14.6],
        ],
        { width: 0.1, fill: gold, curl: [0.3, -1] },
      ),
      ...vine(
        mirrored(7.9),
        [
          [2.25, 13.4],
          [1.7, 14.1],
          [2.3, 14.7],
          [3.6, 14.6],
        ],
        { width: 0.1, fill: gold, curl: [0.3, -1] },
      ),
      ...swing(same, 15.05, 5.3, 1.1),
    ],
    pictures: [{ x: 2.65, y: 3.6, w: 10.5, h: 9.4 }],
    title: {
      x: 15.2,
      y: 1.4,
      w: 11,
      h: 3,
      size: 34,
      valign: 'bottom',
      sample: 'Das Haus als Ganzes',
    },
    body: {
      x: 15.2,
      y: 6.1,
      w: 11,
      h: 8.2,
      sample: [
        'Vom Türgriff bis zum Giebel ein Entwurf',
        'Jedes Detail folgt derselben Linie',
        'Nichts ist nur Zutat',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: ivory,
    shapes: [
      ...flourish(14, 4.0, 0.9),
      { t: 'rect', x: 1.5, y: 4.9, w: 11.3, h: 9.5, r: 1, fill: '#fbf7ec' },
      ...framed(1.5, 4.9, 11.3, 9.5, gold, 1),
      { t: 'rect', x: 15.2, y: 4.9, w: 11.3, h: 9.5, r: 1, fill: '#fbf7ec' },
      ...framed(15.2, 4.9, 11.3, 9.5, gold, 1),
      ...vine(
        same,
        [
          [14, 14.4],
          [13.65, 12],
          [14.35, 9.6],
          [13.7, 7.3],
          [14, 6.2],
        ],
        {
          width: 0.13,
          fill: gold,
          bud: [0.95, rose],
          leafFill: sage,
          leaves: [
            [0.15, 1, 0.8],
            [0.3, -1, 0.8],
            [0.46, 1, 0.8],
            [0.62, -1, 0.8],
            [0.78, 1, 0.7],
          ],
        },
      ),
    ],
    title: {
      x: 3,
      y: 0.9,
      w: 22,
      h: 2.3,
      size: 36,
      align: 'center',
      valign: 'bottom',
      sample: 'Natur und Geometrie',
    },
    body: [
      {
        x: 2.3,
        y: 5.6,
        w: 9.8,
        h: 8.2,
        size: 19,
        sample: ['Ranken, Blüten, Wellen', 'Die Linie schwingt frei', 'Paris, Brüssel, Nancy'],
      },
      {
        x: 16,
        y: 5.6,
        w: 9.8,
        h: 8.2,
        size: 19,
        sample: ['Quadrat, Kreis, Raster', 'Die Linie ordnet', 'Wien, Glasgow, Darmstadt'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: ivory,
    shapes: [
      ...wreath(8.3, 7.7, 5.05),
      {
        t: 'ellipse',
        x: 3.25,
        y: 2.65,
        w: 10.1,
        h: 10.1,
        fill: null,
        stroke: { color: gold, width: 0.06 },
      },
      { t: 'ellipse', x: 3.7, y: 3.1, w: 9.2, h: 9.2, fill: plum },
      {
        t: 'ellipse',
        x: 3.95,
        y: 3.35,
        w: 8.7,
        h: 8.7,
        fill: null,
        stroke: { color: paleGold, width: 0.025 },
      },
      ...swing(same, 16.35, 5.25, 1.1),
    ],
    title: {
      x: 4.1,
      y: 5,
      w: 8.4,
      h: 5.4,
      size: 84,
      color: ivory,
      align: 'center',
      valign: 'middle',
      sample: '1897',
    },
    body: {
      x: 16.5,
      y: 6,
      w: 9.7,
      h: 6,
      size: 21,
      sample:
        'schließen sich in Wien junge Künstler zusammen. Ihr Wahlspruch steht bis heute über der Tür.',
    },
  },
  {
    name: 'Zitat',
    bg: forest,
    shapes: [
      ...archSide(same),
      ...archSide(mirrored(14)),
      ...bud(same, [14, 2.9], Math.PI / 2, 1.1, rose, gold),
      ...flourish(14, 11.05, 0.9, paleGold),
    ],
    body: {
      x: 6.4,
      y: 4.6,
      w: 15.2,
      h: 5.9,
      font: 'Fraunces',
      italic: true,
      size: 29,
      color: ivory,
      lineHeight: 116,
      align: 'center',
      valign: 'middle',
      sample: 'Der Zeit ihre Kunst, der Kunst ihre Freiheit.',
    },
    subtitle: {
      x: 7,
      y: 11.8,
      w: 14,
      h: 1.4,
      color: paleGold,
      align: 'center',
      sample: 'Wahlspruch über dem Portal',
    },
  },
  {
    name: 'Bild',
    bg: ivory,
    shapes: [
      ...fan(2.75, 1.45, (-3 * Math.PI) / 4),
      ...fan(25.25, 1.45, -Math.PI / 4),
      ...fan(2.75, 12.25, (3 * Math.PI) / 4),
      ...fan(25.25, 12.25, Math.PI / 4),
      { t: 'rect', x: 2.75, y: 1.45, w: 22.5, h: 10.8, fill: ivory },
      ...framed(2.75, 1.45, 22.5, 10.8),
      ...flourish(14, 14.55, 0.8),
    ],
    pictures: [{ x: 3.15, y: 1.85, w: 21.7, h: 10 }],
    title: {
      x: 5,
      y: 12.55,
      w: 18,
      h: 1.6,
      size: 24,
      bold: false,
      italic: true,
      align: 'center',
      valign: 'middle',
      sample: 'Treppenhaus, Blick nach oben',
    },
  },
  {
    name: 'Schluss',
    bg: ivory,
    shapes: [
      ...pageFrame(),
      ...spraySide(same),
      ...spraySide(mirrored(14)),
      ...vine(
        same,
        [
          [14, 15],
          [14, 11.5],
          [14, 8.6],
        ],
        { width: 0.14, fill: gold, bud: [1.25, plum] },
      ),
      ...flourish(14, 6.2, 0.9),
    ],
    title: {
      x: 4,
      y: 1.9,
      w: 20,
      h: 3.8,
      size: 58,
      align: 'center',
      valign: 'bottom',
      sample: 'Vielen Dank',
    },
    subtitle: { x: 6, y: 6.7, w: 16, h: 1.3, align: 'center', sample: 'Auf bald' },
  },
];

const template: Template = {
  slug: 'jugendstil',
  name: 'Jugendstil',
  group: 'Kunststil',
  tags: [
    'Jugendstil',
    'Art nouveau',
    'Ornament',
    'Ranken',
    'floral',
    'Gold',
    'elegant',
    'Einladung',
    'Kultur',
  ],
  description:
    'Schwingende Linien, stilisierte Ranken und feine Goldrahmen in Salbei, Pflaume und Tannengrün auf Elfenbein.',
  palette: {
    bg: ivory,
    text: aubergine,
    bg2: linen,
    text2: mauve,
    accents: [gold, sage, plum, forest, rose, lagoon],
  },
  fonts: { head: 'Fraunces', body: 'Josefin Sans' },
  text: {
    title: { font: 'Fraunces', size: 58, color: aubergine, bold: true, lineHeight: 100 },
    subtitle: {
      font: 'Josefin Sans',
      size: 17,
      color: plum,
      bold: true,
      upper: true,
      spacing: 2.5,
    },
    body: { font: 'Josefin Sans', size: 22, color: aubergine, lineHeight: 128, paraSpace: 0.3 },
  },
  layouts,
};

export default template;
