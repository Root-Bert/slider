import { halftone, paint, rng, stencil } from '../art';
import type { Color, Layout, Picture, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page, squiggle, sunburst, turned } from '../shapes';

/*
 * Konzertplakat: a gig poster pulled by hand – three inks on rough paper, a sun, bolts, rays and
 * targets cut big, dot screens, a second ink a little off its register, heavy type that nearly
 * leaves the sheet. Worn where the squeegee ran dry.
 */

const paper = '#f2e8d3';
const red = '#e5412d';
const navy = '#1a2242';
const mustard = '#f2b632';

type Point = readonly [number, number];

/** A circle cut by hand: its rim not quite round. */
function roughDisc(cx: number, cy: number, r: number, fill: Color, seed = 1): Shape {
  const random = rng(seed * 131 + 7);
  const count = 90;
  let drift = 0;
  return {
    t: 'poly',
    fill,
    pts: Array.from({ length: count }, (_, index): Point => {
      drift = drift * 0.7 + random.bell() * 0.012;
      const angle = (index / count) * Math.PI * 2;
      const radius = r * (1 + drift);
      return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    }),
  };
}

/** A target: rough discs inside each other, largest first. */
const target = (cx: number, cy: number, rings: readonly (readonly [number, Color])[]): Shape[] =>
  rings.map(([r, fill], index) => roughDisc(cx, cy, r, fill, index + Math.round(cx * 3 + cy)));

/** A lightning bolt in a box, turned if asked. */
function bolt(x: number, y: number, w: number, h: number, fill: Color, rotate = 0): Shape {
  const unit: Point[] = [
    [0.56, 0],
    [0.08, 0.55],
    [0.42, 0.55],
    [0.22, 1],
    [0.92, 0.38],
    [0.56, 0.38],
    [0.86, 0],
  ];
  const pts = unit.map(([u, v]): Point => [x + u * w, y + v * h]);
  return { t: 'poly', fill, pts: rotate ? turned(pts, rotate, x + w / 2, y + h / 2) : pts };
}

/** A band whose upper edge is a saw. */
function saw(x: number, y: number, w: number, h: number, teeth: number, fill: Color): Shape {
  const pts: Point[] = [];
  for (let i = 0; i <= teeth * 2; i += 1) {
    pts.push([x + (i / (teeth * 2)) * w, i % 2 === 0 ? y + h * 0.55 : y]);
  }
  pts.push([x + w, y + h], [x, y + h]);
  return { t: 'poly', fill, pts };
}

/** Where the ink did not take: specks and dry streaks in the paper's colour, over everything. */
function wearPicture(): Picture {
  const surface = paint(PAGE, 44);
  const { ctx, w, h } = surface;
  const random = rng(404);
  ctx.fillStyle = paper;
  for (let i = 0; i < 1700; i += 1) {
    const size = random() ** 3 * 2.6 + 0.4;
    ctx.globalAlpha = random.range(0.25, 0.85);
    ctx.beginPath();
    ctx.arc(random() * w, random() * h, size, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 46; i += 1) {
    const [x, y] = [random() * w, random() * h];
    const length = random.range(30, 220);
    ctx.globalAlpha = random.range(0.25, 0.6);
    for (let step = 0; step < length; step += 2) {
      if (random() < 0.45) continue;
      ctx.fillRect(
        x + step,
        y + Math.sin(step / 40) * 2,
        random.range(1, 3),
        random.range(0.6, 1.6),
      );
    }
  }
  return stencil(surface, paper, 4);
}
const wear: Shape = { t: 'image', ...page, src: wearPicture() };

/** A dot screen for a box of that size. */
const screen = (
  box: { x: number; y: number; w: number; h: number },
  color: Color,
  tone: (u: number, v: number) => number,
  cell = 0.3,
): Shape => ({
  t: 'image',
  ...box,
  src: halftone({ size: { w: box.w, h: box.h }, color, tone, cell, angle: 30 }),
});

/** A dot screen inside a circle, heavier towards its lower right. */
const shade = (color: Color) =>
  halftone({
    size: { w: 12, h: 12 },
    color,
    cell: 0.3,
    angle: 30,
    tone: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.485 ? (u + v - 0.75) * 0.95 : 0),
  });
const navyShade = shade(navy);
const shaded = (cx: number, cy: number, r: number, src: Picture): Shape => ({
  t: 'image',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  src,
});

const zig = (x: number, y: number, w: number, color: Color, teeth = 6): Shape =>
  squiggle(
    { x, y, w, h: 0.42 },
    teeth,
    { color, width: 0.14, join: 'miter', cap: 'butt' },
    { zigzag: true },
  );

/** A zigzag running down the page. */
const vzig = (x: number, y: number, h: number, color: Color, teeth = 9): Shape => ({
  t: 'path',
  x: x - 0.25,
  y,
  w: 0.5,
  h,
  vb: [100, 1000],
  d: Array.from(
    { length: teeth * 2 + 1 },
    (_, i) =>
      `${i === 0 ? 'M' : 'L'}${i % 2 === 0 ? 5 : 95} ${Math.round((i / (teeth * 2)) * 1000)}`,
  ).join(' '),
  fill: null,
  stroke: { color, width: 0.14, join: 'miter' },
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paper,
    shapes: [
      ...sunburst(20.2, 6.4, 30, 26, '#f6d98a', { share: 0.42 }),
      roughDisc(19.85, 6.7, 6.1, mustard, 3),
      roughDisc(20.2, 6.4, 6.1, red, 4),
      shaded(20.2, 6.4, 6.1, navyShade),
      bolt(17.4, 0.4, 6.4, 13.2, paper, 14),
      bolt(17.15, 0.2, 6.4, 13.2, navy, 14),
      saw(-0.5, 14.5, 29, 1.5, 30, navy),
      wear,
    ],
    title: {
      x: 1.5,
      y: 4.6,
      w: 16,
      h: 7.9,
      size: 92,
      sample: 'Laut &\ndeutlich',
    },
    subtitle: {
      x: 1.6,
      y: 12.7,
      w: 15,
      h: 1.2,
      size: 16,
      sample: 'Die Tour durch alle Abteilungen',
    },
  },
  {
    name: 'Abschnitt',
    bg: navy,
    shapes: [
      ...sunburst(28, 0, 15.5, 9, mustard, { from: 92, to: 178, share: 0.5 }),
      ...target(28, 0, [
        [9.2, navy],
        [8.2, red],
        [5.9, paper],
        [5.0, navy],
        [3.0, mustard],
      ]),
      shaded(28, 0, 8.2, navyShade),
      saw(-0.5, 14.3, 29, 1.7, 22, red),
      wear,
    ],
    title: {
      x: 1.6,
      y: 5.6,
      w: 19,
      h: 6.4,
      size: 84,
      color: paper,
      sample: 'Zweiter\nSatz',
    },
    subtitle: { x: 1.7, y: 12.2, w: 16, h: 1.4, color: mustard, sample: 'Jetzt mit Verstärker' },
  },
  {
    name: 'Inhalt',
    bg: paper,
    shapes: [
      roughDisc(27.6, 9.6, 6.1, navy, 8),
      ...target(27.9, 9.3, [
        [6.1, red],
        [4.7, paper],
        [3.6, mustard],
        [2.3, paper],
        [1.3, navy],
      ]),
      shaded(27.9, 9.3, 6.1, navyShade),
      zig(1.7, 3.55, 5.2, red),
      wear,
    ],
    title: { x: 1.6, y: 0.9, w: 23, h: 2.5, valign: 'middle', size: 42 },
    body: { x: 1.6, y: 4.6, w: 19.2, h: 9.7 },
  },
  {
    name: 'Text und Bild',
    bg: mustard,
    shapes: [
      screen({ x: 14, y: 6, w: 14, h: 9.75 }, '#f8d580', (u, v) => (u + v - 0.9) * 0.9, 0.34),
      { t: 'rect', x: 2.1, y: 2.1, w: 11.4, h: 12.4, fill: red, rotate: -1.2 },
      { t: 'rect', x: 1.35, y: 1.25, w: 11.5, h: 12.6, fill: navy },
      zig(14.7, 5.0, 5.2, red),
      wear,
    ],
    pictures: [{ x: 1.6, y: 1.5, w: 11, h: 12.1 }],
    title: { x: 14.6, y: 1.2, w: 11.9, h: 3.6, size: 40 },
    body: { x: 14.6, y: 6.0, w: 11.9, h: 8.3, size: 20 },
  },
  {
    name: 'Zwei Spalten',
    bg: paper,
    shapes: [
      ...sunburst(14, 20.2, 8.2, 17, red, { from: 200, to: 340, share: 0.5 }),
      roughDisc(14, 20.2, 5.6, navy, 5),
      roughDisc(14.1, 20.1, 4.9, mustard, 6),
      vzig(13.55, 4.9, 6.6, navy),
      zig(1.7, 3.55, 5.2, red),
      wear,
    ],
    title: { x: 1.6, y: 0.9, w: 24.8, h: 2.5, valign: 'middle', size: 42 },
    body: [
      { x: 1.6, y: 4.7, w: 11, h: 8.6, size: 20 },
      { x: 15.6, y: 4.7, w: 11, h: 8.6, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: red,
    shapes: [
      ...sunburst(21.2, 5.9, 30, 22, '#d5371f', { share: 0.45 }),
      roughDisc(20.85, 6.25, 5.5, navy, 11),
      roughDisc(21.2, 5.9, 5.5, mustard, 12),
      saw(-0.5, 14.5, 29, 1.5, 30, navy),
      wear,
    ],
    title: {
      x: 1.3,
      y: 3.6,
      w: 15.6,
      h: 10.6,
      size: 160,
      color: paper,
      sample: '92 %',
    },
    body: {
      x: 17.4,
      y: 3.5,
      w: 7.6,
      h: 4.8,
      align: 'center',
      valign: 'middle',
      size: 20,
      sample: 'der Karten sind weg, bevor der erste Ton fällt.',
    },
  },
  {
    name: 'Zitat',
    bg: navy,
    shapes: [
      bolt(0.2, -1.2, 8.4, 18.4, '#2a3a7a', 6),
      bolt(0.6, -0.8, 7.4, 17.4, mustard, 6),
      ...target(27.4, 15.4, [
        [5.0, red],
        [3.6, navy],
        [2.5, paper],
      ]),
      wear,
    ],
    body: {
      x: 9,
      y: 1.8,
      w: 17.4,
      h: 8.6,
      valign: 'middle',
      font: 'Anton',
      upper: true,
      bold: false,
      size: 37,
      lineHeight: 112,
      color: paper,
      sample: 'Wer leise anfängt, muss am Ende doppelt so laut aufhören.',
    },
    subtitle: { x: 9.1, y: 10.9, w: 13, h: 1.4, color: mustard, sample: 'Jo Brandt, Schlagzeug' },
  },
  {
    name: 'Bild',
    bg: paper,
    shapes: [
      ...sunburst(27.6, 6.6, 9.5, 20, mustard, { share: 0.45 }),
      roughDisc(27.3, 6.9, 4.2, navy, 21),
      roughDisc(27.6, 6.6, 4.2, red, 22),
      shaded(27.6, 6.6, 4.2, navyShade),
      { t: 'rect', x: 2.0, y: 1.9, w: 20.6, h: 11.2, fill: red, rotate: 1 },
      { t: 'rect', x: 1.25, y: 1.05, w: 20.6, h: 11.2, fill: navy },
      wear,
    ],
    pictures: [{ x: 1.5, y: 1.3, w: 20.1, h: 10.7 }],
    title: {
      x: 1.5,
      y: 13.2,
      w: 21,
      h: 1.9,
      valign: 'middle',
      size: 34,
      sample: 'Soundcheck um fünf',
    },
  },
  {
    name: 'Schluss',
    bg: mustard,
    shapes: [
      ...sunburst(23.6, 3.2, 34, 24, '#f6c95e', { share: 0.5 }),
      roughDisc(23.25, 3.55, 4.6, navy, 31),
      roughDisc(23.6, 3.2, 4.6, red, 32),
      shaded(23.6, 3.2, 4.6, navyShade),
      saw(-0.5, 14.3, 29, 1.7, 22, red),
      wear,
    ],
    title: {
      x: 1.2,
      y: 2.6,
      w: 25.6,
      h: 9.6,
      size: 180,
      sample: 'Danke!',
    },
    subtitle: { x: 1.6, y: 12.2, w: 18, h: 1.4, sample: 'Zugabe? Fragen? Beides gern.' },
  },
];

const template: Template = {
  slug: 'konzertplakat',
  name: 'Konzertplakat',
  group: 'Plakat',
  tags: ['Konzert', 'Siebdruck', 'Musik', 'laut', 'Raster', 'retro', 'Festival', 'Kampagne'],
  description:
    'Siebdruck vom Konzertabend: drei Farben auf rauem Papier, Sonne, Blitz und Rasterpunkte, dazu fette Schrift bis an den Rand.',
  palette: {
    bg: paper,
    text: navy,
    bg2: '#e7d9ba',
    text2: '#4b5070',
    accents: [red, mustard, '#2a3a7a', '#f6d98a', '#b52e1d', '#2f8f8a'],
  },
  fonts: { head: 'Anton', body: 'Karla' },
  text: {
    title: { font: 'Anton', size: 64, color: navy, upper: true, lineHeight: 84 },
    subtitle: { font: 'Karla', size: 18, color: red, bold: true, upper: true, spacing: 2.2 },
    body: {
      font: 'Karla',
      size: 22,
      color: navy,
      bold: true,
      lineHeight: 124,
      paraSpace: 0.38,
    },
  },
  layouts,
};

export default template;
