import { paper, rng } from '../art';
import type { Color, Fill, FillLike, Layout, Shape, Stroke, Template } from '../model';
import { page } from '../shapes';

/*
 * Kubismus: a thing seen from several sides at once and laid flat – planes that overlap and let
 * each other through, shaded as facets, in the colours of a studio: ochre, grey-blue, brown,
 * off-white. Thin construction lines run on past what they bound; a guitar, a bottle and a glass
 * stand on the table.
 */

const canvas = '#ebe3d2';
const sand = '#d9ccb2';
const coal = '#231e19';
const umber = '#5f564b';
const ochre = '#c8963e';
const greyBlue = '#7f95a6';
const brown = '#6b4a32';
const slate = '#3f5566';
const olive = '#8c8a68';
const rust = '#a8552f';

const chalk = '#f6f1e6';
const night = '#2f2620';

const hair: Stroke = { color: coal, width: 0.03, join: 'miter' };
const hairLight: Stroke = { color: chalk, width: 0.03, join: 'miter' };

type Point = readonly [number, number];

/** A facet's shading: from one tone to the other across it. */
const shade = (from: Color, to: Color, angle = 120, opacity = 0.94): Fill => ({
  t: 'linear',
  angle,
  opacity,
  stops: [
    [0, from],
    [1, to],
  ],
});

const facet = (pts: readonly Point[], fill: FillLike, stroke: Stroke | null = hair): Shape => ({
  t: 'poly',
  pts,
  fill,
  stroke,
});

const line = (x1: number, y1: number, x2: number, y2: number, stroke: Stroke = hair): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke,
});

const ground = paper(canvas, { grain: 0.035, clouds: 0.05, seed: 19 });
const primed: Shape = { t: 'image', ...page, src: ground };

/** The tones facets are shaded in: light side, dark side. */
const TONES: readonly (readonly [Color, Color])[] = [
  ['#e0b866', ochre],
  ['#b3c2cd', greyBlue],
  ['#8c6645', brown],
  [chalk, sand],
  ['#5f7789', slate],
  ['#b5b08c', olive],
  ['#d9ccb2', '#b9a383'],
];

/**
 * Planes broken round a point: `count` facets along two directions, the large ones first, each
 * letting the ones beneath through; some of their edges drawn on as construction lines.
 */
function shards(
  cx: number,
  cy: number,
  radius: number,
  count: number,
  seed: number,
  options: { stroke?: Stroke; tones?: readonly (readonly [Color, Color])[]; spread?: number } = {},
): Shape[] {
  const random = rng(seed);
  const stroke = options.stroke ?? hair;
  const tones = options.tones ?? TONES;
  const first = ((random.range(-28, 8) * Math.PI) / 180) as number;
  const second = first + (random.range(58, 82) * Math.PI) / 180;
  const shapes: Shape[] = [];
  const lines: Shape[] = [];
  for (let i = 0; i < count; i += 1) {
    const size = radius * random.range(0.3, 0.62) * (1 - (i / count) * 0.5);
    const [x, y] = [
      cx + random.bell() * radius * (options.spread ?? 0.8),
      cy + random.bell() * radius * (options.spread ?? 0.8) * 0.75,
    ];
    const tilt = random.bell() * 0.12;
    const [a, b] = [size * random.range(0.55, 1), size * random.range(0.3, 0.75)];
    const d1: Point = [Math.cos(first + tilt) * a, Math.sin(first + tilt) * a];
    const d2: Point = [Math.cos(second + tilt) * b, Math.sin(second + tilt) * b];
    const skew = random.range(-0.5, 0.5);
    const pts: Point[] = [
      [x - d1[0] - d2[0], y - d1[1] - d2[1]],
      [x + d1[0] - d2[0], y + d1[1] - d2[1]],
      [x + d1[0] * (1 + skew) + d2[0], y + d1[1] * (1 + skew) + d2[1]],
      [x - d1[0] + d2[0], y - d1[1] + d2[1]],
    ];
    if (random() < 0.3) pts.pop();
    const tone = tones[Math.floor(random() * tones.length)]!;
    shapes.push(
      facet(pts, shade(tone[0], tone[1], random.range(60, 200), random.range(0.74, 0.95)), stroke),
    );
    if (random() < 0.45) {
      const [p, q] = [pts[0]!, pts[1]!];
      const reach = random.range(0.5, 1.1);
      lines.push(
        line(
          p[0] - (q[0] - p[0]) * reach,
          p[1] - (q[1] - p[1]) * reach,
          q[0] + (q[0] - p[0]) * reach,
          q[1] + (q[1] - p[1]) * reach,
          stroke,
        ),
      );
    }
  }
  return [...shapes, ...lines];
}

/**
 * The still life: a guitar taken apart, a bottle in two halves that do not meet, a glass, the
 * table as a plane of wood grain. Drawn round a point in units of `s` centimetres; `flip` -1
 * mirrors it.
 */
function stillLife(cx: number, cy: number, s: number, flip: 1 | -1 = 1): Shape[] {
  const at = (x: number, y: number): Point => [cx + x * s * flip, cy + y * s];
  const poly = (pts: readonly Point[], fill: FillLike, stroke: Stroke | null = hair): Shape =>
    facet(
      pts.map(([x, y]) => at(x, y)),
      fill,
      stroke,
    );
  const oval = (
    x: number,
    y: number,
    rx: number,
    ry: number,
    fill: FillLike,
    stroke: Stroke | null = hair,
    rotate = 0,
  ): Shape => {
    const [px, py] = at(x, y);
    return {
      t: 'ellipse',
      x: px - rx * s,
      y: py - ry * s,
      w: rx * 2 * s,
      h: ry * 2 * s,
      fill,
      stroke,
      rotate: rotate * flip,
    };
  };
  const rule = (x1: number, y1: number, x2: number, y2: number, stroke: Stroke = hair): Shape => {
    const [a, b] = [at(x1, y1), at(x2, y2)];
    return line(a[0], a[1], b[0], b[1], stroke);
  };
  const strings = Array.from({ length: 4 }, (_, index) =>
    rule(-0.22 + index * 0.2, 2.85, 2.05 + index * 0.19, -7.85 - index * 0.03, {
      color: chalk,
      width: 0.028,
    }),
  );
  const sign = at(-3.1, -6.6);
  return [
    // The planes behind.
    poly(
      [
        [-6.6, -5.8],
        [-0.6, -6.9],
        [1, 1.6],
        [-5.2, 2.8],
      ],
      shade('#b3c2cd', greyBlue, 150, 0.9),
    ),
    poly(
      [
        [-1.6, -7.2],
        [5.3, -5.7],
        [4.3, 2.1],
        [0.2, 3.1],
      ],
      shade(chalk, sand, 100, 0.92),
    ),
    poly(
      [
        [1.6, -4.2],
        [6.5, -2.7],
        [5.5, 4.1],
        [2.4, 3.3],
      ],
      shade('#5f7789', slate, 200, 0.88),
    ),
    // The table, its grain.
    poly(
      [
        [-7.4, 2.7],
        [5.7, 1.3],
        [6.7, 5.7],
        [-6.4, 6.7],
      ],
      { t: 'hatch', color: brown, distance: 0.13 * s, angle: 6, bg: '#d9b06a' },
    ),
    poly(
      [
        [-7.4, 2.7],
        [-2.2, 2.15],
        [-4, 6.5],
        [-6.4, 6.7],
      ],
      shade(brown, night, 160, 0.55),
      null,
    ),
    // The bottle: a dark half and a light half, slipped.
    poly(
      [
        [-5.35, -1.8],
        [-4.3, -1.8],
        [-4.3, 4.3],
        [-5.35, 4.3],
      ],
      shade(slate, '#2b3b48', 180),
    ),
    poly(
      [
        [-4.3, -2.15],
        [-3.25, -2.15],
        [-3.25, 3.95],
        [-4.3, 3.95],
      ],
      shade(chalk, '#cfd6d8', 90),
    ),
    poly(
      [
        [-4.78, -4.6],
        [-4.3, -4.6],
        [-4.3, -1.8],
        [-5.35, -1.8],
      ],
      shade(slate, '#2b3b48', 180),
    ),
    poly(
      [
        [-4.3, -4.95],
        [-3.82, -4.95],
        [-3.25, -2.15],
        [-4.3, -2.15],
      ],
      shade(chalk, '#cfd6d8', 90),
    ),
    oval(-4.3, -4.78, 0.5, 0.15, chalk),
    poly(
      [
        [-5.05, 0.5],
        [-3.5, 0.15],
        [-3.42, 1.95],
        [-4.97, 2.3],
      ],
      { t: 'hatch', color: umber, distance: 0.085 * s, angle: 0, bg: chalk },
    ),
    // The guitar: its body round on one side, a flat plane on the other.
    oval(-0.2, -1.9, 1.75, 1.9, shade('#8c6645', brown, 140), hair, -14),
    oval(-0.9, 1.25, 2.5, 3, shade('#8c6645', '#4f3626', 140), hair, -14),
    poly(
      [
        [0.1, -3.9],
        [2.5, -3.2],
        [3.3, 3.4],
        [0.5, 4.6],
      ],
      shade('#e6c47c', ochre, 110, 0.93),
    ),
    oval(0.55, 1.55, 2.5, 3, null, hair, -14),
    oval(0.1, 0.4, 0.82, 0.82, night),
    oval(0.5, 0.2, 1.05, 1.05, null, hair),
    poly(
      [
        [-0.25, -2.6],
        [0.75, -2.8],
        [2.8, -8],
        [1.9, -7.85],
      ],
      shade(night, '#4f3626', 180),
    ),
    ...strings,
    poly(
      [
        [1.7, -7.9],
        [3.05, -8.1],
        [3.55, -9.4],
        [2.4, -9.3],
      ],
      shade('#c26a3f', rust, 120),
    ),
    poly(
      [
        [-0.7, 2.95],
        [1.1, 2.65],
        [1.15, 3],
        [-0.65, 3.3],
      ],
      night,
    ),
    // The glass.
    poly(
      [
        [3.6, 0.2],
        [5.4, 0.2],
        [5.05, 3.9],
        [3.95, 3.9],
      ],
      shade('#dfe7ea', '#9fb1bd', 100, 0.72),
    ),
    oval(4.5, 0.2, 0.9, 0.22, shade(chalk, '#cfd6d8', 90, 0.9)),
    rule(4.5, 3.9, 4.5, 5),
    oval(4.5, 5.05, 0.8, 0.18, null),
    // A sign as stencilled on a crate.
    {
      t: 'text',
      x: sign[0] - 1.2 * s,
      y: sign[1] - 1.2 * s,
      w: 2.4 * s,
      h: 2.4 * s,
      text: '&',
      font: 'Roboto Slab',
      bold: true,
      size: 46 * s,
      color: night,
      align: 'center',
      valign: 'middle',
    },
    // Construction lines, on past what they bound.
    rule(-8, -3.1, 7.2, -6.3),
    rule(-7.6, 5.4, 7.6, 3.7),
    rule(0.1, -9.2, 0.62, 6.9),
    rule(-6.9, -6.9, -4.6, 7.2),
    rule(6.5, -2.7, 4.9, 7.2),
  ];
}

/** Hairline and a short bar: what stands under a title. */
const underline = (x: number, y: number, length: number, color: Color = ochre): Shape[] => [
  line(x, y, x + length, y),
  facet(
    [
      [x, y - 0.11],
      [x + 2.6, y - 0.11],
      [x + 2.45, y + 0.11],
      [x, y + 0.11],
    ],
    color,
    null,
  ),
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: canvas,
    shapes: [
      primed,
      ...shards(20.4, 7.6, 7.4, 9, 11),
      ...stillLife(20.3, 8.9, 0.9),
      line(0, 12.9, 13.2, 11.9),
      ...underline(1.9, 9.25, 9.4),
    ],
    title: { x: 1.8, y: 2.9, w: 11, h: 6, valign: 'bottom', sample: 'Die Dinge,\nzerlegt' },
    subtitle: { x: 1.8, y: 9.7, w: 10.4, h: 1.5, sample: 'Ein Gegenstand, viele Ansichten' },
  },
  {
    name: 'Abschnitt',
    bg: night,
    shapes: [
      facet(
        [
          [14.2, -0.5],
          [23, -0.5],
          [18.2, 16.2],
          [11.2, 16.2],
        ],
        shade('#4a6072', '#2d3e4c', 170, 1),
        hairLight,
      ),
      facet(
        [
          [17.5, -0.5],
          [28.5, -0.5],
          [28.5, 10.4],
          [21.4, 13.6],
        ],
        shade('#d9ad55', ochre, 140, 1),
        hairLight,
      ),
      ...shards(22.2, 8.4, 5.6, 9, 23, { stroke: hairLight }),
      { t: 'ellipse', x: 20.2, y: 6.1, w: 3.4, h: 3.4, fill: night, stroke: hairLight },
      { t: 'ellipse', x: 20.9, y: 5.6, w: 4.2, h: 4.2, fill: null, stroke: hairLight },
      ...[0, 1, 2, 3].map((index) =>
        line(20.6 + index * 0.42, 15.2, 23.4 + index * 0.4, 0.6, { color: chalk, width: 0.028 }),
      ),
      line(0, 10.9, 16, 9.9, hairLight),
      line(1.8, 0, 2.5, 15.75, hairLight),
    ],
    title: {
      x: 3.2,
      y: 4.4,
      w: 12.4,
      h: 5,
      size: 46,
      color: chalk,
      valign: 'bottom',
      sample: 'Von allen\nSeiten',
    },
    subtitle: { x: 3.2, y: 10.9, w: 11, h: 1.5, color: '#e0b866', sample: 'Zweiter Teil' },
  },
  {
    name: 'Inhalt',
    bg: canvas,
    shapes: [
      primed,
      ...shards(24.2, 8.6, 4.4, 5, 31, { spread: 0.5 }),
      ...stillLife(24.4, 9.6, 0.62),
      ...underline(1.9, 3.75, 17.4),
    ],
    title: {
      x: 1.8,
      y: 1.1,
      w: 18,
      h: 2.4,
      size: 34,
      valign: 'bottom',
      sample: 'Wie der Kubismus sieht',
    },
    body: {
      x: 1.8,
      y: 4.5,
      w: 17.6,
      h: 9.8,
      sample: [
        'Ein Ding hat mehr als eine Ansicht',
        'Alle Seiten stehen zugleich im Bild',
        'Die Form zählt mehr als die Farbe',
        'Raum wird Fläche, Fläche wird Rhythmus',
        'Was fehlt, ergänzt der Blick',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: canvas,
    shapes: [
      primed,
      ...shards(2.4, 2.6, 3.8, 6, 47, { spread: 0.6 }),
      ...shards(12.6, 13.2, 3.6, 6, 48, { spread: 0.6 }),
      // The picture's edges, drawn on across the page.
      line(1.8, 0.5, 1.8, 15.25),
      line(13.4, 0.9, 13.4, 14.9),
      line(0.5, 2.2, 15.2, 2.2),
      line(0.6, 13.6, 14.4, 13.6),
      { t: 'rect', x: 1.8, y: 2.2, w: 11.6, h: 11.4, fill: sand },
      ...underline(15.1, 4.75, 11.1, greyBlue),
    ],
    pictures: [{ x: 1.8, y: 2.2, w: 11.6, h: 11.4 }],
    title: {
      x: 15,
      y: 1.4,
      w: 11.2,
      h: 3.1,
      size: 32,
      valign: 'bottom',
      sample: 'Der Tisch im Atelier',
    },
    body: {
      x: 15,
      y: 5.5,
      w: 11.2,
      h: 8.8,
      sample: ['Gitarre, Flasche, Glas', 'Mehr braucht ein Stillleben nicht', 'Der Rest ist Umbau'],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: canvas,
    shapes: [
      primed,
      ...shards(14, 9.6, 9.5, 8, 53, { spread: 0.9 }),
      ...shards(26.8, 9.8, 3.2, 5, 54, { spread: 0.5 }),
      ...shards(1.2, 9.4, 3, 4, 55, { spread: 0.5 }),
      facet(
        [
          [1.2, 4.5],
          [13.5, 4.05],
          [13.75, 14.45],
          [1.5, 14.9],
        ],
        chalk,
      ),
      facet(
        [
          [14.3, 4.5],
          [26.75, 4.1],
          [26.45, 14.9],
          [14.6, 14.5],
        ],
        chalk,
      ),
      line(13.3, 2.6, 14.9, 15.75),
      line(0, 4.55, 28, 3.55),
      ...underline(1.9, 3.45, 9, rust),
    ],
    title: {
      x: 1.8,
      y: 0.9,
      w: 24.4,
      h: 2.3,
      size: 34,
      valign: 'bottom',
      sample: 'Analytisch, synthetisch',
    },
    body: [
      {
        x: 2.2,
        y: 5.3,
        w: 10.8,
        h: 8.6,
        size: 19,
        sample: [
          'Der Gegenstand wird zerlegt',
          'Wenige, gedämpfte Farben',
          'Facetten, eng verschränkt',
        ],
      },
      {
        x: 15.3,
        y: 5.3,
        w: 10.6,
        h: 8.6,
        size: 19,
        sample: ['Das Bild wird gebaut', 'Papier, Schrift, Holzmaser', 'Große, klare Flächen'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: canvas,
    shapes: [
      primed,
      facet(
        [
          [-0.5, 1.4],
          [9.5, -0.5],
          [13.6, 9],
          [3, 14.8],
        ],
        shade('#b3c2cd', greyBlue, 150, 0.8),
      ),
      // A disc in two halves that do not meet.
      {
        t: 'ellipse',
        x: 2.6,
        y: 2,
        w: 11.4,
        h: 11.4,
        kind: 'section',
        start: 78,
        end: 258,
        fill: shade('#e6c47c', ochre, 130, 0.95),
        stroke: hair,
      },
      {
        t: 'ellipse',
        x: 3.5,
        y: 3.2,
        w: 11.4,
        h: 11.4,
        kind: 'section',
        start: 258,
        end: 78,
        fill: shade(chalk, sand, 100, 0.93),
        stroke: hair,
      },
      facet(
        [
          [9.4, 9.2],
          [15.8, 8],
          [16.4, 12.6],
          [10.6, 14.2],
        ],
        shade('#8c6645', brown, 160, 0.9),
      ),
      line(0.4, 14.6, 16.8, 0.8),
      line(6.6, 0.4, 9.9, 15.4),
      line(0, 9.6, 17, 6.2),
      ...underline(17.5, 5.1, 8.7, slate),
    ],
    title: {
      x: 2.2,
      y: 4.2,
      w: 13.4,
      h: 7.4,
      size: 140,
      align: 'center',
      valign: 'middle',
      sample: '6',
    },
    body: {
      x: 17.4,
      y: 5.7,
      w: 8.8,
      h: 6.4,
      size: 21,
      sample:
        'Ansichten derselben Gitarre in einem Bild. Keine davon ist die richtige, erst zusammen stimmen sie.',
    },
  },
  {
    name: 'Zitat',
    bg: '#34485a',
    shapes: [
      facet(
        [
          [21.6, -0.5],
          [28.5, -0.5],
          [28.5, 5.2],
          [20.9, 7.4],
        ],
        shade('#2b3b48', '#3f5566', 160, 1),
        hairLight,
      ),
      facet(
        [
          [20.8, 6.4],
          [28.5, 3.6],
          [28.5, 16.2],
          [17.4, 16.2],
        ],
        shade('#55697a', '#3f5566', 120, 1),
        hairLight,
      ),
      ...shards(24.2, 11.6, 5.6, 10, 61, { stroke: hairLight, spread: 0.6 }),
      line(0, 13.1, 28, 11.6, hairLight),
      line(21.7, 0, 20.3, 15.75, hairLight),
      {
        t: 'text',
        x: 2,
        y: 0.5,
        w: 5,
        h: 3.6,
        text: '“',
        font: 'Source Serif 4',
        bold: true,
        size: 150,
        color: '#e0b866',
        valign: 'top',
      },
    ],
    body: {
      x: 2.6,
      y: 4,
      w: 15.8,
      h: 6.2,
      font: 'Source Serif 4',
      italic: true,
      size: 31,
      color: chalk,
      lineHeight: 112,
      valign: 'middle',
      sample: 'Ich male die Dinge, wie ich sie denke, nicht wie ich sie sehe.',
    },
    subtitle: { x: 2.6, y: 10.7, w: 13, h: 1.4, color: '#e0b866', sample: 'Notiz aus dem Atelier' },
  },
  {
    name: 'Bild',
    bg: canvas,
    shapes: [
      primed,
      ...shards(3.4, 3, 4.6, 6, 71, { spread: 0.55 }),
      ...shards(24.6, 11.6, 5, 7, 79, { spread: 0.55 }),
      line(2.6, 0.3, 2.6, 15.4),
      line(25.4, 0.5, 25.4, 15),
      line(0.4, 1.5, 27.6, 1.5),
      line(0.5, 11.9, 27.5, 11.9),
      { t: 'rect', x: 2.6, y: 1.5, w: 22.8, h: 10.4, fill: sand },
      facet(
        [
          [2.6, 12.55],
          [15.6, 12.4],
          [15.3, 14.55],
          [2.6, 14.7],
        ],
        night,
        null,
      ),
    ],
    pictures: [{ x: 2.6, y: 1.5, w: 22.8, h: 10.4 }],
    title: {
      x: 3.2,
      y: 12.6,
      w: 11.8,
      h: 1.9,
      size: 24,
      color: chalk,
      valign: 'middle',
      sample: 'Stillleben mit Gitarre',
    },
  },
  {
    name: 'Schluss',
    bg: night,
    shapes: [
      ...shards(14, 7.9, 12.5, 15, 97, { stroke: hairLight, spread: 0.75 }),
      facet(
        [
          [6.6, 4.1],
          [21.9, 3.5],
          [22.3, 12.3],
          [6.2, 12.9],
        ],
        night,
        null,
      ),
      facet(
        [
          [6.2, 3.6],
          [21.5, 3],
          [21.9, 11.8],
          [5.8, 12.4],
        ],
        chalk,
      ),
      line(3, 12.5, 25.5, 11.65),
      line(6.05, 1.6, 5.65, 14.4),
      ...underline(11.2, 8.35, 5.6),
    ],
    title: {
      x: 7,
      y: 4,
      w: 14,
      h: 4,
      size: 60,
      align: 'center',
      valign: 'bottom',
      sample: 'Danke',
    },
    subtitle: {
      x: 7.4,
      y: 8.9,
      w: 13.2,
      h: 1.6,
      color: umber,
      align: 'center',
      sample: 'Setzen Sie es neu zusammen',
    },
  },
];

const template: Template = {
  slug: 'kubismus',
  name: 'Kubismus',
  group: 'Kunststil',
  tags: [
    'Kubismus',
    'Facetten',
    'Collage',
    'geometrisch',
    'gedämpft',
    'Ocker',
    'Stillleben',
    'Atelier',
    'Architektur',
  ],
  description:
    'Zerlegte, sich überlagernde Flächen in Ocker, Graublau und Braun mit feinen Konstruktionslinien und einem Stillleben.',
  palette: {
    bg: canvas,
    text: coal,
    bg2: sand,
    text2: umber,
    accents: [ochre, greyBlue, brown, slate, olive, rust],
  },
  fonts: { head: 'Bricolage Grotesque', body: 'Source Serif 4' },
  text: {
    title: { font: 'Bricolage Grotesque', size: 60, color: coal, bold: true, lineHeight: 96 },
    subtitle: { font: 'Source Serif 4', size: 20, color: umber, italic: true },
    body: { font: 'Source Serif 4', size: 21, color: coal, lineHeight: 124, paraSpace: 0.32 },
  },
  layouts,
};

export default template;
