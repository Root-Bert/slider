import { noise, paint, rng, stencil } from '../art';
import type { Color, FillLike, Layout, Picture, Shape, Stroke, Template } from '../model';
import { page, star } from '../shapes';

/*
 * Expressionismus: a woodcut printed in few harsh colours. Everything is cut with the knife –
 * planes that tilt, houses that lean, a sun with spikes – black holds it together, and where
 * the gouge slipped, slivers of the other colour show.
 */

const bone = '#f1e9d6';
const straw = '#e2d6ba';
const black = '#15120f';
const soot = '#4a433a';
const blue = '#17357e';
const orange = '#f1591c';
const green = '#b5d334';
const red = '#c2202b';
const yellow = '#f6c61f';
const purple = '#5b2a86';

const cut: Stroke = { color: black, width: 0.14, join: 'miter' };

type Point = readonly [number, number];

/** A plane cut out of colour, with its black edge. */
const plane = (pts: readonly Point[], fill: FillLike, stroke: Stroke | null = cut): Shape => ({
  t: 'poly',
  pts,
  fill,
  stroke,
});

/**
 * What the gouge left: slivers of one colour, thick in the middle and pointed at both ends,
 * lying along `angle` where `where` lets them (0 none … 1 dense).
 */
function gouges(
  color: Color,
  seed: number,
  where: (u: number, v: number) => number,
  angle: (u: number, v: number) => number,
  count = 1500,
): Picture {
  const surface = paint(page, 40);
  const { ctx, w, h, px } = surface;
  const random = rng(seed);
  const field = noise(seed + 1);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i += 1) {
    const [u, v] = [random(), random()];
    if (random() > where(u, v) * (0.35 + field(u * 6, v * 4) * 1.1)) continue;
    const turn = angle(u, v) + random.bell() * 0.22;
    const long = random.range(0.35, 1.25) * px;
    const wide = random.range(0.05, 0.13) * px;
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    const [x, y] = [u * w, v * h];
    ctx.beginPath();
    ctx.moveTo(x - (cos * long) / 2, y - (sin * long) / 2);
    ctx.quadraticCurveTo(
      x - sin * wide,
      y + cos * wide,
      x + (cos * long) / 2,
      y + (sin * long) / 2,
    );
    ctx.quadraticCurveTo(
      x + sin * wide,
      y - cos * wide,
      x - (cos * long) / 2,
      y - (sin * long) / 2,
    );
    ctx.fill();
  }
  return stencil(surface, color, 4);
}

const marks = (
  color: Color,
  seed: number,
  where: (u: number, v: number) => number,
  angle: (u: number, v: number) => number = () => -0.5,
  count?: number,
): Shape => ({ t: 'image', ...page, src: gouges(color, seed, where, angle, count) });

/** 1 inside a box of the page (in shares of it), 0 outside. */
const within = (u: number, v: number, l: number, t: number, r: number, b: number) =>
  u > l && u < r && v > t && v < b ? 1 : 0;

/** A house that leans: its wall, its gable, its crooked windows. */
function house(
  x: number,
  w: number,
  h: number,
  lean: number,
  fill: Color,
  lit: readonly Color[],
  base = 16.2,
): Shape[] {
  const top = base - h;
  const roof = w * 0.42;
  const shapes: Shape[] = [
    plane(
      [
        [x, base],
        [x + lean, top],
        [x + w * 0.45 + lean * 1.5, top - roof],
        [x + w + lean * 0.8, top + 0.3],
        [x + w, base],
      ],
      fill,
    ),
  ];
  const rowsOf = Math.max(1, Math.floor((h - 1) / 1.7));
  for (let row = 0; row < rowsOf; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const wy = top + 0.7 + row * 1.7;
      const shift = lean * (1 - (wy - top) / h);
      const wx = x + shift + w * (0.16 + column * 0.46);
      const [ww, wh] = [w * 0.22, 0.95];
      shapes.push(
        plane(
          [
            [wx, wy + column * 0.12],
            [wx + ww, wy + 0.1 - column * 0.1],
            [wx + ww - 0.08, wy + wh],
            [wx + 0.06, wy + wh + 0.1],
          ],
          lit[(row + column) % lit.length]!,
          null,
        ),
      );
    }
  }
  return shapes;
}

/** A sun as the knife makes it: spikes, and a core of another colour. */
const sun = (
  cx: number,
  cy: number,
  r: number,
  outer: Color,
  inner: Color,
  points = 11,
): Shape[] => [
  star(cx, cy, r, r * 0.56, points, outer, { stroke: cut, rotate: -80 }),
  star(cx, cy, r * 0.42, r * 0.3, 7, inner, { stroke: cut, rotate: -60 }),
];

/** The thick stroke under a title, cut to a point. */
const wedge = (x: number, y: number, length: number, color: Color = black): Shape =>
  plane(
    [
      [x, y],
      [x + length, y + 0.1],
      [x + length - 0.3, y + 0.24],
      [x, y + 0.42],
    ],
    color,
    null,
  );

/** A zigzag down the page from a point: the points of its edge. */
const zigzag = (x: number, from: number, to: number, swing: number, steps: number): Point[] =>
  Array.from({ length: steps + 1 }, (_, index): Point => [
    x + (index % 2 === 0 ? -swing : swing) - index * 0.12,
    from + ((to - from) * index) / steps,
  ]);

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: black,
    shapes: [
      plane(
        [
          [14.6, -0.5],
          [28.5, -0.5],
          [28.5, 16.2],
          [17.6, 16.2],
          [15.4, 11.6],
          [17.9, 8.4],
          [13.4, 5.5],
          [16.2, 2.5],
        ],
        orange,
      ),
      plane(
        [
          [21.5, -0.5],
          [28.5, -0.5],
          [28.5, 7.2],
          [25.4, 2.6],
        ],
        red,
      ),
      plane(
        [
          [17.9, 8.4],
          [28.5, 6.2],
          [28.5, 9],
          [16.6, 10.1],
        ],
        yellow,
      ),
      ...sun(21.4, 4.6, 2.5, yellow, red),
      ...house(17.6, 3.4, 4.6, -0.6, black, [green, yellow]),
      ...house(20.7, 3.6, 6.6, 0.7, blue, [yellow, bone]),
      ...house(24.2, 4.6, 5.2, -0.5, black, [green, orange]),
      plane(
        [
          [-0.5, 10.7],
          [13.6, 10.1],
          [14.8, 13],
          [-0.5, 13.8],
        ],
        blue,
      ),
      marks(bone, 3, (u, v) => within(u, v, 0, 0, 0.5, 0.12) + within(u, v, 0, 0.88, 0.62, 1)),
      marks(
        black,
        4,
        (u, v) => within(u, v, 0.55, 0, 1, 0.6) * 0.6,
        () => 0.9,
        900,
      ),
    ],
    title: { x: 1.6, y: 2, w: 11.4, h: 7.8, valign: 'middle', sample: 'Die Stadt\nerwacht' },
    subtitle: {
      x: 1.6,
      y: 11.05,
      w: 11.4,
      h: 1.7,
      valign: 'middle',
      sample: 'Schnitte in Schwarz',
    },
  },
  {
    name: 'Abschnitt',
    bg: blue,
    shapes: [
      plane(
        [
          [17.5, -0.5],
          [28.5, -0.5],
          [28.5, 9.5],
          [23.5, 12.5],
        ],
        purple,
        null,
      ),
      ...sun(22.6, 5.2, 2.9, orange, yellow, 9),
      plane(
        [
          [-0.5, 16.2],
          [-0.5, 12.6],
          [3, 9.9],
          [5.2, 12.2],
          [8.6, 9.4],
          [11.2, 12.4],
          [13.8, 10.6],
          [16.6, 13],
          [19.4, 10.2],
          [22.4, 13.6],
          [25.2, 11.4],
          [28.5, 13.8],
          [28.5, 16.2],
        ],
        black,
      ),
      plane(
        [
          [19.4, 10.2],
          [20.4, 12.6],
          [18.3, 12.9],
        ],
        green,
        null,
      ),
      plane(
        [
          [8.6, 9.4],
          [9.5, 11.6],
          [7.7, 11.9],
        ],
        bone,
        null,
      ),
      plane(
        [
          [25.2, 11.4],
          [26, 13.2],
          [24.4, 13.5],
        ],
        orange,
        null,
      ),
      plane(
        [
          [1.6, 2.3],
          [16.9, 1.7],
          [17.5, 8.5],
          [2.2, 9.1],
        ],
        black,
      ),
      plane(
        [
          [1.2, 1.9],
          [16.5, 1.3],
          [17.1, 8.1],
          [1.8, 8.7],
        ],
        bone,
      ),
      marks(
        bone,
        5,
        (u, v) => within(u, v, 0, 0.72, 1, 1) * 0.8,
        () => -0.9,
      ),
      marks(
        black,
        6,
        (u, v) => within(u, v, 0.64, 0, 1, 0.55) * 0.5,
        () => 0.6,
        800,
      ),
    ],
    title: {
      x: 2.4,
      y: 2.2,
      w: 13.6,
      h: 4,
      size: 44,
      color: black,
      valign: 'bottom',
      sample: 'Der Aufbruch',
    },
    subtitle: { x: 2.4, y: 6.35, w: 13.6, h: 1.4, color: red, sample: 'Zweiter Akt' },
  },
  {
    name: 'Inhalt',
    bg: bone,
    shapes: [
      plane(
        [
          [-0.5, -0.5],
          [3.9, -0.5],
          [2.3, 16.2],
          [-0.5, 16.2],
        ],
        orange,
      ),
      plane(
        [
          [-0.5, 6.4],
          [4.5, 9.8],
          [3.3, 16.2],
          [-0.5, 16.2],
        ],
        blue,
      ),
      plane(
        [
          [2.8, -0.5],
          [4.6, -0.5],
          [3.3, 7.4],
        ],
        black,
      ),
      plane(
        [
          [-0.5, 11.8],
          [2.2, 13.2],
          [0.6, 16.2],
          [-0.5, 16.2],
        ],
        green,
      ),
      wedge(5.9, 3.85, 20.3),
      ...sun(25.4, 12.9, 1.5, red, yellow, 9),
      marks(
        black,
        7,
        (u, v) => within(u, v, 0, 0, 0.12, 0.4),
        () => 1.3,
        2600,
      ),
      marks(
        bone,
        8,
        (u, v) => within(u, v, 0, 0.42, 0.14, 1),
        () => -1.1,
        2600,
      ),
    ],
    title: {
      x: 5.8,
      y: 1,
      w: 20.4,
      h: 2.6,
      size: 34,
      color: black,
      valign: 'bottom',
      sample: 'Was der Holzschnitt will',
    },
    body: {
      x: 5.8,
      y: 4.8,
      w: 18.6,
      h: 9.6,
      sample: [
        'Nicht abbilden, sondern ausdrücken',
        'Die Form darf brechen, wenn das Gefühl es verlangt',
        'Schwarz ist eine Farbe und zwar die stärkste',
        'Lieber roh und wahr als glatt und leer',
        'Jeder Schnitt bleibt stehen',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: bone,
    shapes: [
      plane(
        [
          [13.8, 1],
          [27.2, 2.2],
          [26.6, 14.4],
          [13.2, 13.2],
        ],
        green,
      ),
      plane(
        [
          [22, 10.5],
          [28.5, 9],
          [28.5, 16.2],
          [20.5, 16.2],
        ],
        blue,
      ),
      plane(
        [
          [14.6, 2.2],
          [26.5, 1.8],
          [26.3, 13.6],
          [14.9, 13.3],
        ],
        black,
        null,
      ),
      wedge(1.8, 4.75, 10.6),
      marks(
        black,
        9,
        (u, v) => within(u, v, 0.47, 0, 1, 1) * 0.5 + within(u, v, 0, 0.92, 0.45, 1),
        () => 0.4,
      ),
    ],
    pictures: [{ x: 15.3, y: 2.7, w: 10.5, h: 10.2 }],
    title: {
      x: 1.8,
      y: 1.2,
      w: 11.4,
      h: 3.3,
      size: 32,
      color: black,
      valign: 'bottom',
      sample: 'Die Straße bei Nacht',
    },
    body: {
      x: 1.8,
      y: 5.7,
      w: 11.2,
      h: 8.6,
      sample: [
        'Häuser neigen sich zueinander',
        'Licht fällt in Splittern',
        'Niemand geht hier gerade',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: black,
    shapes: [
      plane([...zigzag(14.4, 3, 16.4, 0.45, 9), [28.5, 16.4], [28.5, 3]], blue),
      plane(
        [
          [-0.5, -0.5],
          [28.5, -0.5],
          [28.5, 3.3],
          [21.5, 4.1],
          [14.9, 3.2],
          [7.5, 4.2],
          [-0.5, 3.4],
        ],
        orange,
      ),
      plane(
        [
          [23.6, -0.5],
          [28.5, -0.5],
          [28.5, 3.3],
          [25.4, 3.65],
        ],
        red,
      ),
      marks(
        black,
        11,
        (u, v) => within(u, v, 0, 0.9, 0.46, 1),
        () => -0.4,
      ),
    ],
    title: {
      x: 1.8,
      y: 0.75,
      w: 21,
      h: 2.3,
      size: 34,
      color: black,
      valign: 'middle',
      sample: 'Tag und Nacht',
    },
    body: [
      {
        x: 1.8,
        y: 5.2,
        w: 10.8,
        h: 9,
        size: 19,
        color: bone,
        sample: ['Fabrik, Lärm, Menge', 'Farben, die schreien', 'Kein Schatten zum Ausruhen'],
      },
      {
        x: 15.6,
        y: 5.2,
        w: 10.6,
        h: 9,
        size: 19,
        color: bone,
        sample: ['Laternen, Cafés, Rauch', 'Blau, das alles schluckt', 'Gesichter wie Masken'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: orange,
    shapes: [
      plane(
        [
          [-0.5, -0.5],
          [9, -0.5],
          [3.4, 5.2],
          [-0.5, 6.6],
        ],
        yellow,
      ),
      plane(
        [
          [-0.5, 12.4],
          [10.5, 11.6],
          [15.5, 16.2],
          [-0.5, 16.2],
        ],
        red,
      ),
      plane(
        [
          [20, -0.5],
          [28.5, -0.5],
          [28.5, 4.6],
        ],
        blue,
      ),
      plane(
        [
          [17.6, 4.5],
          [27.3, 3.7],
          [26.7, 12.5],
          [18.2, 13.1],
        ],
        purple,
        null,
      ),
      plane(
        [
          [17.1, 4.1],
          [26.8, 3.3],
          [26.2, 12.1],
          [17.7, 12.7],
        ],
        black,
      ),
      marks(
        black,
        12,
        (u, v) => within(u, v, 0, 0, 0.6, 0.2) * 0.7 + within(u, v, 0, 0.76, 0.6, 1),
        () => -0.7,
      ),
    ],
    title: {
      x: 1.4,
      y: 3.4,
      w: 15.2,
      h: 8,
      size: 138,
      color: black,
      align: 'left',
      valign: 'middle',
      sample: '73 %',
    },
    body: {
      x: 18.3,
      y: 4.6,
      w: 7.5,
      h: 7.2,
      size: 20,
      color: bone,
      valign: 'middle',
      sample: 'der Blätter entstanden in einer einzigen Nacht. Am Morgen war das Holz verbraucht.',
    },
  },
  {
    name: 'Zitat',
    bg: black,
    shapes: [
      plane(
        [
          [18, 9],
          [28.5, 6.6],
          [28.5, 16.2],
          [14.5, 16.2],
        ],
        orange,
      ),
      plane(
        [
          [2.4, 2.3],
          [25.9, 1.3],
          [25.2, 11.5],
          [1.8, 12.3],
        ],
        blue,
        { ...cut, color: bone },
      ),
      {
        t: 'text',
        x: 0.5,
        y: -6.9,
        w: 7,
        h: 6,
        text: '„',
        font: 'Bitter',
        bold: true,
        size: 230,
        color: green,
        valign: 'top',
      },
      marks(
        bone,
        13,
        (u, v) => within(u, v, 0, 0.95, 0.5, 1) + within(u, v, 0.4, 0, 1, 0.07),
        () => 0.5,
      ),
      marks(
        black,
        14,
        (u, v) => within(u, v, 0.6, 0.8, 1, 1) * 0.6,
        () => -0.6,
        1500,
      ),
    ],
    body: {
      x: 4.2,
      y: 3.4,
      w: 19.6,
      h: 6.9,
      font: 'Bitter',
      bold: true,
      size: 30,
      color: bone,
      lineHeight: 114,
      valign: 'middle',
      sample: 'Ich schneide nicht, was ich sehe. Ich schneide, was mich nicht schlafen lässt.',
    },
    subtitle: { x: 2.4, y: 13.2, w: 11.4, h: 1.4, color: green, sample: 'Aus der Werkstatt' },
  },
  {
    name: 'Bild',
    bg: black,
    shapes: [
      plane(
        [
          [0.6, 0.5],
          [12.4, 0.2],
          [9, 6.4],
          [0.3, 8.2],
        ],
        orange,
      ),
      plane(
        [
          [18.2, 9],
          [27.7, 7.2],
          [27.5, 15.3],
          [16.4, 14.6],
        ],
        green,
      ),
      plane(
        [
          [20, 0.3],
          [27.7, 0.5],
          [27.3, 6.4],
        ],
        blue,
      ),
      { t: 'rect', x: 1.95, y: 1.15, w: 24.1, h: 11.3, fill: bone, rotate: -0.6 },
      marks(
        bone,
        15,
        (u, v) => within(u, v, 0, 0.955, 0.56, 1) + within(u, v, 0, 0, 1, 0.03),
        () => -0.3,
      ),
    ],
    pictures: [{ x: 2.3, y: 1.5, w: 23.4, h: 10.6 }],
    title: {
      x: 2.3,
      y: 12.8,
      w: 13.6,
      h: 1.9,
      size: 26,
      valign: 'middle',
      sample: 'Vorstadt, gegen Morgen',
    },
  },
  {
    name: 'Schluss',
    bg: orange,
    shapes: [
      plane(
        [
          [16, -0.5],
          [28.5, -0.5],
          [28.5, 8],
          [21, 9.6],
        ],
        red,
      ),
      plane(
        [
          [-0.5, 8.8],
          [28.5, 6.9],
          [28.5, 9.9],
          [-0.5, 10.7],
        ],
        yellow,
      ),
      ...sun(22.8, 4.2, 2.7, yellow, red),
      ...house(-0.6, 3.6, 4.4, 0.5, black, [yellow, green]),
      ...house(2.7, 3.2, 6.2, -0.5, blue, [yellow, bone]),
      ...house(5.6, 4, 4.8, 0.6, black, [green, orange]),
      ...house(9.3, 3.2, 6.8, -0.4, purple, [yellow, orange]),
      ...house(12.2, 4.2, 4.2, 0.5, black, [yellow, green]),
      ...house(16.1, 3.4, 6, -0.6, blue, [bone, yellow]),
      ...house(19.2, 4.2, 5, 0.6, black, [green, yellow]),
      ...house(23.1, 3, 7, -0.5, black, [orange, yellow]),
      ...house(25.8, 3.4, 4.6, 0.4, blue, [yellow, green]),
      marks(
        black,
        16,
        (u, v) => within(u, v, 0, 0, 0.56, 0.1) + within(u, v, 0.55, 0, 1, 0.5) * 0.5,
        () => 0.8,
      ),
    ],
    title: {
      x: 1.6,
      y: 1.4,
      w: 16,
      h: 4,
      size: 72,
      color: black,
      valign: 'middle',
      sample: 'Danke.',
    },
    subtitle: {
      x: 1.7,
      y: 5.7,
      w: 14,
      h: 1.5,
      color: black,
      sample: 'Und jetzt hinaus auf die Straße',
    },
  },
];

const template: Template = {
  slug: 'expressionismus',
  name: 'Expressionismus',
  group: 'Kunststil',
  tags: [
    'Expressionismus',
    'Holzschnitt',
    'kantig',
    'laut',
    'dunkel',
    'Kontrast',
    'Stadt',
    'Theater',
    'Manifest',
  ],
  description:
    'Wie ein Holzschnitt: gezackte schwarze Schnitte, kippende Flächen und harte Komplementärfarben.',
  palette: {
    bg: bone,
    text: black,
    bg2: straw,
    text2: soot,
    accents: [blue, orange, green, red, yellow, purple],
  },
  fonts: { head: 'Bitter', body: 'Fira Sans' },
  text: {
    title: { font: 'Bitter', size: 60, color: bone, bold: true, upper: true, lineHeight: 100 },
    subtitle: { font: 'Fira Sans', size: 19, color: bone, bold: true, upper: true, spacing: 1.5 },
    body: { font: 'Fira Sans', size: 21, color: black, lineHeight: 122, paraSpace: 0.32 },
  },
  layouts,
};

export default template;
