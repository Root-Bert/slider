import type { Box, Color, Layout, Shape, Template } from '../model';
import { disc, smoothPath } from '../shapes';

/*
 * Mid-Century: the living room of 1955 – kidney tables, boomerangs, atomic starbursts and
 * pendant lamps, thin wires crossing, in mustard, teal, burnt orange and olive on cream.
 */

const cream = '#f5ecd7';
const sand = '#eadbb8';
const ink = '#2b2622';
const brown = '#5f5146';
const mustard = '#dba51c';
const teal = '#1e7574';
const orange = '#c9521f';
const olive = '#7b7a35';
const aqua = '#8dbcae';
const rust = '#8a3a1c';

const head = 'DM Serif Display';
const sans = 'Josefin Sans';

type Point = readonly [number, number];

const KIDNEY = smoothPath([
  [150, 350],
  [400, 120],
  [750, 180],
  [910, 450],
  [820, 770],
  [560, 870],
  [420, 660],
  [220, 700],
  [90, 560],
]);
const BOOMERANG = smoothPath([
  [70, 230],
  [300, 110],
  [640, 250],
  [870, 560],
  [910, 860],
  [790, 910],
  [650, 650],
  [440, 440],
  [200, 380],
  [50, 320],
]);
const SPARKLE = 'M500 0 Q545 455 1000 500 Q545 545 500 1000 Q455 545 0 500 Q455 455 500 0 Z';
const QUOTE_TABLE = smoothPath([
  [60, 430],
  [240, 130],
  [600, 50],
  [900, 190],
  [965, 520],
  [860, 830],
  [580, 930],
  [400, 830],
  [200, 900],
  [65, 700],
]);
const DOME = 'M0 1000 Q0 0 500 0 Q1000 0 1000 1000 Z';

const kidney = (box: Box, fill: Color, rotate = 0): Shape => ({
  t: 'path',
  ...box,
  d: KIDNEY,
  vb: [1000, 1000],
  fill,
  rotate,
});
const boomerang = (box: Box, fill: Color, rotate = 0): Shape => ({
  t: 'path',
  ...box,
  d: BOOMERANG,
  vb: [1000, 1000],
  fill,
  rotate,
});
/** A four-pointed star with hollow sides. */
const sparkle = (cx: number, cy: number, r: number, fill: Color, rotate = 0): Shape => ({
  t: 'path',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  d: SPARKLE,
  vb: [1000, 1000],
  fill,
  rotate,
});

/** An atomic starburst: thin rays, long and short in turn, a ball on each long one. */
function atom(
  cx: number,
  cy: number,
  r: number,
  color: Color,
  options: { rays?: number; ball?: Color; width?: number; turn?: number } = {},
): Shape[] {
  const rays = options.rays ?? 12;
  const width = options.width ?? Math.max(0.035, r * 0.022);
  const shapes: Shape[] = [];
  for (let i = 0; i < rays; i += 1) {
    const angle = ((options.turn ?? 0) * Math.PI) / 180 + (i / rays) * Math.PI * 2;
    const reach = i % 2 === 0 ? r : r * 0.58;
    const [x, y] = [cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach];
    shapes.push({
      t: 'line',
      x1: cx + Math.cos(angle) * r * 0.12,
      y1: cy + Math.sin(angle) * r * 0.12,
      x2: x,
      y2: y,
      stroke: { color, width, cap: 'round' },
    });
    if (i % 2 === 0) shapes.push(disc(x, y, r * 0.075, options.ball ?? color));
  }
  shapes.push(disc(cx, cy, r * 0.13, options.ball ?? color));
  return shapes;
}

const wire = (a: Point, b: Point, color: Color = ink, width = 0.04): Shape => ({
  t: 'line',
  x1: a[0],
  y1: a[1],
  x2: b[0],
  y2: b[1],
  stroke: { color, width, cap: 'round' },
});

/** A pendant lamp on its wire from the top of the page. */
function lamp(
  x: number,
  drop: number,
  w: number,
  fill: Color,
  kind: 'dome' | 'cone' | 'saucer',
  cord: Color,
  bulb: Color,
): Shape[] {
  const h = kind === 'saucer' ? w * 0.36 : kind === 'cone' ? w * 0.8 : w * 0.62;
  const shade: Shape =
    kind === 'dome'
      ? { t: 'path', x: x - w / 2, y: drop, w, h, d: DOME, vb: [1000, 1000], fill }
      : kind === 'cone'
        ? {
            t: 'poly',
            fill,
            pts: [
              [x - w * 0.12, drop],
              [x + w * 0.12, drop],
              [x + w / 2, drop + h],
              [x - w / 2, drop + h],
            ],
          }
        : { t: 'ellipse', x: x - w / 2, y: drop, w, h, fill };
  return [
    wire([x, -0.2], [x, drop + 0.05], cord, 0.05),
    disc(x, drop + h + (kind === 'saucer' ? -0.02 : 0.08), w * 0.11, bulb),
    shade,
  ];
}

/** A coloured tile with its ornament, as on a pattern sheet of the time. */
function tile(box: Box, fill: Color, mark: Color, kind: number): Shape[] {
  const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2];
  const r = Math.min(box.w, box.h) * 0.34;
  const ground: Shape = { t: 'rect', ...box, fill };
  switch (kind % 4) {
    case 0:
      return [ground, ...atom(cx, cy, r, mark, { rays: 12, turn: 15 })];
    case 1:
      return [ground, sparkle(cx, cy, r * 1.1, mark)];
    case 2:
      return [
        ground,
        boomerang({ x: cx - r * 1.15, y: cy - r * 1.15, w: r * 2.3, h: r * 2.3 }, mark, -25),
      ];
    default:
      return [
        ground,
        sparkle(cx - r * 0.35, cy + r * 0.25, r * 0.8, mark),
        sparkle(cx + r * 0.6, cy - r * 0.55, r * 0.42, mark),
      ];
  }
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: cream,
    shapes: [
      kidney({ x: 13.2, y: 0.2, w: 15.5, h: 13.4 }, teal, 14),
      boomerang({ x: 11.6, y: 8.4, w: 8.4, h: 7.6 }, mustard, -24),
      kidney({ x: 20.4, y: 8.6, w: 7.6, h: 6.6 }, orange, -38),
      wire([13.6, 16], [27.2, -0.3]),
      wire([17.2, 16], [22.2, -0.3]),
      wire([11.2, 1.4], [28.3, 11.9]),
      ...atom(21.2, 5.6, 2.7, cream, { rays: 16, ball: mustard }),
      sparkle(16.2, 2.5, 0.85, ink),
      sparkle(26.2, 1.6, 0.5, orange),
      sparkle(14.3, 6.6, 0.42, mustard),
      disc(25.6, 13.9, 0.45, olive),
      disc(12.3, 13.6, 0.22, ink),
      { t: 'rect', x: 1.8, y: 9.75, w: 3.2, h: 0.14, fill: orange },
    ],
    title: {
      x: 1.8,
      y: 2.6,
      w: 11.6,
      h: 6.7,
      valign: 'bottom',
      size: 60,
      sample: 'Form folgt\nFreude',
    },
    subtitle: {
      x: 1.8,
      y: 10.3,
      w: 10.6,
      h: 2.6,
      sample: 'Wohnen und Gestalten zwischen gestern und morgen',
    },
  },
  {
    name: 'Abschnitt',
    bg: teal,
    shapes: [
      wire([-0.3, 12.9], [28.3, 12.9], '#4f9a95', 0.04),
      ...lamp(15.6, 3.6, 3.4, mustard, 'dome', cream, cream),
      ...lamp(20, 6.6, 4.4, orange, 'saucer', cream, cream),
      ...lamp(24.3, 2.2, 2.7, cream, 'cone', cream, mustard),
      sparkle(17.6, 9.6, 0.5, mustard),
      sparkle(25.6, 9.4, 0.8, cream),
      sparkle(13.4, 1.8, 0.4, aqua),
      boomerang({ x: 20.6, y: 10.4, w: 6.4, h: 5.8 }, '#16605f', 150),
      { t: 'rect', x: 1.8, y: 5.2, w: 0.14, h: 6.6, fill: mustard },
    ],
    title: {
      x: 2.6,
      y: 5,
      w: 11.6,
      h: 4.8,
      valign: 'bottom',
      color: cream,
      size: 52,
      sample: 'Das Wohnzimmer',
    },
    subtitle: {
      x: 2.6,
      y: 10.2,
      w: 11.6,
      h: 1.6,
      color: '#f1d58a',
      sample: 'Zweiter Teil: Licht und Linie',
    },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      ...tile({ x: 1.2, y: 1.2, w: 2.9, h: 3.7 }, mustard, cream, 0),
      ...tile({ x: 1.2, y: 4.9, w: 2.9, h: 2.9 }, teal, cream, 1),
      ...tile({ x: 1.2, y: 7.8, w: 2.9, h: 3.2 }, orange, cream, 2),
      ...tile({ x: 1.2, y: 11, w: 2.9, h: 3.55 }, olive, cream, 3),
      { t: 'rect', x: 5.4, y: 3.75, w: 2.6, h: 0.12, fill: orange },
      sparkle(26, 13.6, 0.55, mustard),
      sparkle(26.9, 12.7, 0.26, teal),
    ],
    title: {
      x: 5.4,
      y: 1.1,
      w: 21,
      h: 2.4,
      valign: 'middle',
      size: 38,
      sample: 'Was ein guter Stuhl kann',
    },
    body: {
      x: 5.4,
      y: 4.4,
      w: 20.4,
      h: 10.1,
      sample: [
        'Er trägt, ohne schwer zu wirken',
        'Seine Linie folgt dem Körper, nicht der Mode',
        'Holz, Stahlrohr und Stoff zeigen, was sie sind',
        'Man stapelt ihn, wenn Gäste gehen',
        'Nach zwanzig Jahren sitzt man noch gern darauf',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: cream,
    shapes: [
      kidney({ x: 12.6, y: 0.4, w: 15.6, h: 15.2 }, sand, 100),
      { t: 'rect', x: 15.9, y: 3, w: 11, h: 10.9, fill: mustard },
      boomerang({ x: 22.6, y: 11.2, w: 5, h: 4.5 }, teal, 160),
      ...atom(15.2, 2.4, 1.5, orange, { rays: 12 }),
      wire([13.4, 14.9], [18.6, 14.9]),
      { t: 'rect', x: 1.8, y: 4.15, w: 2.6, h: 0.12, fill: orange },
    ],
    title: {
      x: 1.8,
      y: 0.9,
      w: 12,
      h: 3,
      valign: 'bottom',
      size: 32,
      sample: 'Licht macht den Raum',
    },
    body: {
      x: 1.8,
      y: 4.8,
      w: 11.6,
      h: 9.7,
      sample: [
        'Eine Lampe tief über dem Tisch',
        'Eine zweite neben dem Sessel',
        'Die Decke bleibt dunkel und ruhig',
        'So entsteht Nähe statt Helligkeit',
      ],
    },
    pictures: [{ x: 15.2, y: 2.3, w: 11, h: 10.9 }],
  },
  {
    name: 'Zwei Spalten',
    bg: cream,
    shapes: [
      { t: 'rect', x: 1.8, y: 4.5, w: 11.7, h: 10, r: 0.5, fill: sand },
      { t: 'rect', x: 14.5, y: 4.5, w: 11.7, h: 10, r: 0.5, fill: sand },
      disc(2.3, 4.7, 0.95, teal),
      sparkle(2.3, 4.7, 0.6, cream),
      disc(15, 4.7, 0.95, orange),
      sparkle(15, 4.7, 0.6, cream),
      ...atom(25.2, 2.2, 1.35, mustard, { rays: 12, ball: orange }),
      wire([19.5, 2.9], [28.3, 2.9]),
      sparkle(21.9, 1.5, 0.3, teal),
    ],
    title: {
      x: 1.8,
      y: 1.1,
      w: 19.5,
      h: 2.4,
      valign: 'middle',
      size: 38,
      sample: 'Gestern und heute',
    },
    body: [
      {
        x: 3.1,
        y: 5.5,
        w: 9.9,
        h: 8.5,
        size: 20,
        sample: [
          'Die gute Stube nur für den Sonntag',
          'Schwere Schränke an jeder Wand',
          'Ein Licht in der Mitte der Decke',
        ],
      },
      {
        x: 15.8,
        y: 5.5,
        w: 9.9,
        h: 8.5,
        size: 20,
        sample: [
          'Ein Raum für jeden Tag der Woche',
          'Leichte Möbel auf schlanken Beinen',
          'Viele kleine Lichter, wo man sitzt',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: mustard,
    shapes: [
      kidney({ x: 15.4, y: -3.2, w: 15, h: 12 }, '#e3b53c', 200),
      ...atom(8, 7.9, 7.3, ink, { rays: 24, ball: orange, width: 0.05, turn: 7.5 }),
      disc(8, 7.9, 4.75, cream),
      {
        t: 'ellipse',
        x: 3.55,
        y: 3.45,
        w: 8.9,
        h: 8.9,
        fill: null,
        stroke: { color: ink, width: 0.05 },
      },
      boomerang({ x: 22.4, y: 10.6, w: 5.6, h: 5.2 }, teal, 150),
      sparkle(25.4, 2.6, 0.75, cream),
      sparkle(26.6, 4, 0.32, ink),
      { t: 'rect', x: 16.6, y: 5.35, w: 2.6, h: 0.14, fill: ink },
    ],
    title: {
      x: 3.6,
      y: 5.2,
      w: 8.8,
      h: 5.4,
      align: 'center',
      valign: 'middle',
      size: 88,
      color: teal,
      sample: '1956',
    },
    body: {
      x: 16.6,
      y: 5.9,
      w: 9.4,
      h: 5,
      size: 24,
      sample: 'In diesem Jahr zog der Nierentisch in jedes zweite Wohnzimmer ein.',
    },
  },
  {
    name: 'Zitat',
    bg: orange,
    shapes: [
      boomerang({ x: -2.4, y: -2.6, w: 9, h: 8.4 }, rust, 60),
      boomerang({ x: 21.6, y: 9.6, w: 8.6, h: 8 }, mustard, 200),
      wire([-0.3, 14.3], [28.3, 10.2], cream, 0.035),
      wire([19, 16], [28.3, 4.2], cream, 0.035),
      {
        t: 'path',
        x: 2,
        y: 1,
        w: 22.6,
        h: 13.2,
        d: QUOTE_TABLE,
        vb: [1000, 1000],
        fill: cream,
        shadow: { dx: 0.25, dy: 0.3, color: rust, opacity: 0.55 },
      },
      {
        t: 'text',
        x: 5.4,
        y: 1.7,
        w: 5,
        h: 4,
        text: '“',
        font: head,
        size: 150,
        color: mustard,
        valign: 'top',
      },
      ...atom(25.4, 2.3, 1.3, cream, { rays: 12, ball: mustard }),
      sparkle(2.4, 12.6, 0.6, cream),
    ],
    body: {
      x: 6.6,
      y: 4.2,
      w: 14.4,
      h: 4.9,
      valign: 'middle',
      font: head,
      italic: true,
      bold: false,
      size: 30,
      lineHeight: 118,
      color: ink,
      sample: 'Ein Zimmer ist erst fertig, wenn man gern darin sitzen bleibt.',
    },
    subtitle: {
      x: 6.6,
      y: 9.4,
      w: 13,
      h: 1.3,
      color: orange,
      size: 18,
      sample: 'Lotte Brandt, Möbelgestalterin',
    },
  },
  {
    name: 'Bild',
    bg: cream,
    shapes: [
      { t: 'rect', x: 1.9, y: 1.9, w: 25.6, h: 10.4, fill: teal },
      ...tile({ x: 17.4, y: 12.75, w: 1.9, h: 1.9 }, mustard, cream, 1),
      ...tile({ x: 19.3, y: 12.75, w: 1.9, h: 1.9 }, orange, cream, 0),
      ...tile({ x: 21.2, y: 12.75, w: 1.9, h: 1.9 }, olive, cream, 3),
      ...tile({ x: 23.1, y: 12.75, w: 1.9, h: 1.9 }, aqua, ink, 2),
      ...tile({ x: 25, y: 12.75, w: 1.9, h: 1.9 }, ink, mustard, 0),
    ],
    pictures: [{ x: 1.2, y: 1.2, w: 25.6, h: 10.4 }],
    title: {
      x: 1.2,
      y: 12.6,
      w: 15.6,
      h: 2.2,
      valign: 'middle',
      size: 30,
      sample: 'Blick aus dem Wintergarten',
    },
  },
  {
    name: 'Schluss',
    bg: ink,
    shapes: [
      kidney({ x: 4.4, y: 1.5, w: 19.4, h: 13.6 }, '#383029', 186),
      wire([-0.3, 3.2], [28.3, 12.6], brown, 0.04),
      wire([-0.3, 12.2], [28.3, 2.7], brown, 0.04),
      ...lamp(3.6, 3.2, 2.9, mustard, 'dome', sand, cream),
      ...lamp(24.6, 4.6, 3.6, orange, 'saucer', sand, cream),
      ...atom(22.6, 12.2, 1.7, aqua, { rays: 12, ball: mustard }),
      ...atom(5.2, 11.6, 1.25, mustard, { rays: 12, ball: orange }),
      boomerang({ x: 0.4, y: 12.4, w: 4.6, h: 4.2 }, teal, 20),
      sparkle(8.4, 2.6, 0.5, cream),
      sparkle(20.2, 2.2, 0.36, mustard),
      { t: 'rect', x: 12.6, y: 9.55, w: 2.8, h: 0.14, fill: orange },
    ],
    title: {
      x: 6,
      y: 4.3,
      w: 16,
      h: 4.8,
      align: 'center',
      valign: 'bottom',
      color: cream,
      size: 64,
      sample: 'Vielen Dank',
    },
    subtitle: {
      x: 7,
      y: 10.1,
      w: 14,
      h: 1.6,
      align: 'center',
      color: '#f1d58a',
      sample: 'Nehmen Sie Platz, wir haben Zeit',
    },
  },
];

const template: Template = {
  slug: 'mid-century',
  name: 'Mid-Century',
  group: 'Kunststil',
  tags: [
    'Mid-Century',
    'Fünfziger',
    'Retro',
    'Nierentisch',
    'Bumerang',
    'Atomzeitalter',
    'warm',
    'Wohnen',
    'Design',
  ],
  description:
    'Die Moderne der Fünfziger: Nierenformen, Bumerangs, Sternstrahlen und Pendelleuchten in Senf, Petrol, Rostorange und Oliv auf Creme.',
  palette: {
    bg: cream,
    text: ink,
    bg2: sand,
    text2: brown,
    accents: [mustard, teal, orange, olive, aqua, rust],
  },
  fonts: { head, body: sans },
  text: {
    title: { font: head, size: 44, color: ink, lineHeight: 104 },
    subtitle: { font: sans, size: 20, color: brown, upper: true, spacing: 2, lineHeight: 125 },
    body: { font: sans, size: 22, color: ink, lineHeight: 125, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
