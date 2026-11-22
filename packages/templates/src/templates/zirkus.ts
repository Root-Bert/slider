import { grain, jpeg, noise, paint, rgb, rng, stencil } from '../art';
import type { Color, Layout, Picture, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page, star, sunburst } from '../shapes';

/*
 * Zirkus: the show bill from the letterpress – cream paper, red and deep blue ink, the tent's
 * stripes and scalloped valance, stars, ribbons, pointers and ornamental rules, and a fat face,
 * a slab and an old-style italic all on one centred sheet.
 */

const paper = '#f3e6c8';
const red = '#c5281c';
const blue = '#1d2f5f';
const gold = '#d9a441';
const deepRed = '#a81f15';

type Point = readonly [number, number];

/** The sheet itself: cream, clouded, with the grain of cheap paper. */
function paperPicture(): Picture {
  const surface = paint(PAGE, 46);
  const { ctx, w, h } = surface;
  const field = noise(12);
  const [r, g, b] = rgb(paper);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const edge = Math.min(x, y, w - x, h - y) / (h * 0.5);
      const shade = 1 + (field(x / 170, y / 170, 5) - 0.5) * 0.11 - Math.max(0, 0.22 - edge) * 0.2;
      const i = (y * w + x) * 4;
      image.data[i] = r * shade;
      image.data[i + 1] = g * shade;
      image.data[i + 2] = b * shade * 0.985;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  grain(surface, 0.045, 5);
  return jpeg(surface, 76);
}
const sheet: Shape = { t: 'image', ...page, src: paperPicture() };

/** Where the type did not ink: specks of paper over the solid grounds. */
function wearPicture(): Picture {
  const surface = paint(PAGE, 44);
  const { ctx, w, h } = surface;
  const random = rng(77);
  ctx.fillStyle = paper;
  for (let i = 0; i < 3800; i += 1) {
    ctx.globalAlpha = random.range(0.15, 0.55);
    const size = random() ** 3 * 2.2 + 0.5;
    ctx.fillRect(random() * w, random() * h, size, size * random.range(0.6, 1.4));
  }
  return stencil(surface, paper, 4);
}
const wear: Shape = { t: 'image', ...page, src: wearPicture() };

/** The tent's valance: stripes hanging from the top, each ending in a scallop. */
function valance(height: number, count = 16, first: Color = red, second: Color = paper): Shape[] {
  const w = PAGE.w / count;
  const shapes: Shape[] = [];
  for (let i = 0; i < count; i += 1) {
    const fill = i % 2 === 0 ? first : second;
    shapes.push({ t: 'rect', x: i * w - 0.01, y: -0.1, w: w + 0.02, h: height + 0.1, fill });
    shapes.push({ t: 'ellipse', x: i * w, y: height - w / 2, w, h: w, fill });
  }
  shapes.push({ t: 'rect', x: -0.1, y: height - 0.16, w: 28.2, h: 0.09, fill: blue });
  return shapes;
}

/** A string of pennants along the bottom. */
function bunting(y: number, count = 18): Shape[] {
  const w = PAGE.w / count;
  return [
    { t: 'rect', x: -0.1, y: y - 0.05, w: 28.2, h: 0.07, fill: blue },
    ...Array.from({ length: count }, (_, i): Shape => ({
      t: 'poly',
      fill: i % 2 === 0 ? red : blue,
      pts: [
        [i * w + 0.12, y],
        [(i + 1) * w - 0.12, y],
        [(i + 0.5) * w, y + 1.15],
      ],
    })),
  ];
}

/** A ribbon with swallow tails folded behind it. */
function ribbon(cx: number, y: number, w: number, h: number, fill: Color, dark: Color): Shape[] {
  const [x0, x1] = [cx - w / 2, cx + w / 2];
  const [tail, drop, fold] = [1.5, 0.32, 0.7];
  const side = (edge: number, dir: 1 | -1): Shape[] => [
    {
      t: 'poly',
      fill,
      pts: [
        [edge - dir * tail, y + drop],
        [edge + dir * fold, y + drop],
        [edge + dir * fold, y + h + drop],
        [edge - dir * tail, y + h + drop],
        [edge - dir * (tail - 0.6), y + h / 2 + drop],
      ],
    },
    {
      t: 'poly',
      fill: dark,
      pts: [
        [edge, y + h],
        [edge + dir * fold, y + h],
        [edge + dir * fold, y + h + drop],
      ],
    },
  ];
  return [
    ...side(x0, 1),
    ...side(x1, -1),
    { t: 'rect', x: x0, y, w, h, fill },
    { t: 'rect', x: x0 + 0.25, y: y + 0.14, w: w - 0.5, h: 0.035, fill: paper },
    { t: 'rect', x: x0 + 0.25, y: y + h - 0.175, w: w - 0.5, h: 0.035, fill: paper },
  ];
}

/** A pointer: a notched pennant showing the way, to the right or to the left. */
function pointer(x: number, y: number, w: number, h: number, fill: Color, left = false): Shape {
  const unit: Point[] = [
    [0, 0],
    [0.66, 0],
    [1, 0.5],
    [0.66, 1],
    [0, 1],
    [0.16, 0.5],
  ];
  return {
    t: 'poly',
    fill,
    pts: unit.map(([u, v]): Point => [x + (left ? 1 - u : u) * w, y + v * h]),
  };
}

/** A thick and a thin rule with a star where they meet in the middle. */
function ornRule(
  cx: number,
  y: number,
  w: number,
  color: Color = red,
  starFill: Color = blue,
): Shape[] {
  const half = w / 2 - 0.55;
  return [
    { t: 'rect', x: cx - w / 2, y: y - 0.06, w: half, h: 0.12, fill: color },
    { t: 'rect', x: cx + 0.55, y: y - 0.06, w: half, h: 0.12, fill: color },
    { t: 'rect', x: cx - w / 2, y: y + 0.14, w: half, h: 0.03, fill: color },
    { t: 'rect', x: cx + 0.55, y: y + 0.14, w: half, h: 0.03, fill: color },
    star(cx, y + 0.04, 0.4, 0.17, 5, starFill),
  ];
}

/** Stars in a row, the middle one largest. */
const starRow = (
  cx: number,
  y: number,
  count: number,
  gap: number,
  r: number,
  fill: Color,
): Shape[] =>
  Array.from({ length: count }, (_, i) => {
    const off = i - (count - 1) / 2;
    const size = r * (1 - Math.abs(off) * 0.16);
    return star(cx + off * gap, y, size, size * 0.42, 5, fill);
  });

/** The bill's border: a heavy and a fine line, a star in each corner. */
const frame = (heavy: Color = red, fine: Color = blue): Shape[] => [
  {
    t: 'rect',
    x: 0.6,
    y: 0.6,
    w: 26.8,
    h: 14.55,
    fill: null,
    stroke: { color: heavy, width: 0.13 },
  },
  {
    t: 'rect',
    x: 0.9,
    y: 0.9,
    w: 26.2,
    h: 13.95,
    fill: null,
    stroke: { color: fine, width: 0.04 },
  },
  ...(
    [
      [1.55, 1.55],
      [26.45, 1.55],
      [1.55, 14.2],
      [26.45, 14.2],
    ] as const
  ).map(([x, y]) => star(x, y, 0.36, 0.15, 5, fine)),
];

/** A medallion with a pinked edge and rings inside. */
const medallion = (cx: number, cy: number, r: number, ring: Color): Shape[] => [
  star(cx, cy, r, r * 0.93, 36, paper),
  {
    t: 'ellipse',
    x: cx - r * 0.84,
    y: cy - r * 0.84,
    w: r * 1.68,
    h: r * 1.68,
    fill: null,
    stroke: { color: ring, width: 0.14 },
  },
  {
    t: 'ellipse',
    x: cx - r * 0.78,
    y: cy - r * 0.78,
    w: r * 1.56,
    h: r * 1.56,
    fill: null,
    stroke: { color: ring, width: 0.035 },
  },
];

/** Stars down both sides of the sheet, the same left and right. */
const skyStars: Shape[] = (() => {
  const random = rng(18);
  const shapes: Shape[] = [];
  for (let i = 0; i < 11; i += 1) {
    const [x, y] = [random.range(1.1, 4.3), 3.3 + i * 1.05 + random.range(-0.25, 0.25)];
    const r = random.range(0.16, 0.42);
    const fill = i % 3 === 1 ? gold : paper;
    shapes.push(star(x, y, r, r * 0.42, 5, fill), star(28 - x, y, r, r * 0.42, 5, fill));
  }
  return shapes;
})();

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paper,
    shapes: [
      sheet,
      ...valance(1.75, 16, red, '#ead9b0'),
      ...starRow(14, 4.15, 5, 1.15, 0.5, blue),
      pointer(7.2, 3.85, 2.6, 0.6, red),
      pointer(18.2, 3.85, 2.6, 0.6, red, true),
      ...ribbon(14, 10.75, 17, 1.5, blue, '#111c3c'),
      ...bunting(13.75),
    ],
    title: {
      x: 2.5,
      y: 4.9,
      w: 23,
      h: 5.6,
      valign: 'middle',
      size: 58,
      sample: 'Die große\nJahresschau',
    },
    subtitle: {
      x: 5.9,
      y: 10.75,
      w: 16.2,
      h: 1.5,
      valign: 'middle',
      sample: 'Nur heute und nur in diesem Saal',
    },
  },
  {
    name: 'Abschnitt',
    bg: blue,
    shapes: [
      ...sunburst(14, 7.3, 32, 22, '#263c75'),
      ...medallion(14, 7.0, 5.7, red),
      ...Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2 - Math.PI / 2;
        return star(
          14 + Math.cos(angle) * 6.75,
          7.0 + Math.sin(angle) * 6.75,
          0.34,
          0.14,
          5,
          gold,
          {
            rotate: (angle * 180) / Math.PI,
          },
        );
      }),
      pointer(2.2, 6.45, 3.6, 1.1, paper),
      pointer(22.2, 6.45, 3.6, 1.1, paper, true),
      ...ribbon(14, 11.25, 11.5, 1.45, red, '#7c160f'),
      wear,
    ],
    title: {
      x: 9.9,
      y: 3.7,
      w: 8.2,
      h: 6.2,
      valign: 'middle',
      size: 46,
      sample: 'Zweite\nNummer',
    },
    subtitle: {
      x: 8.6,
      y: 11.25,
      w: 10.8,
      h: 1.45,
      valign: 'middle',
      size: 16,
      sample: 'Jetzt wird jongliert',
    },
  },
  {
    name: 'Inhalt',
    bg: paper,
    shapes: [sheet, ...frame(), ...ornRule(14, 3.75, 13)],
    title: { x: 3, y: 1.35, w: 22, h: 2.1, valign: 'middle', size: 34 },
    body: { x: 3.2, y: 4.7, w: 21.6, h: 9.3 },
  },
  {
    name: 'Text und Bild',
    bg: paper,
    shapes: [
      sheet,
      ...frame(),
      ...ornRule(14, 3.75, 13),
      {
        t: 'rect',
        x: 15.25,
        y: 4.75,
        w: 10.3,
        h: 8.4,
        fill: null,
        stroke: { color: red, width: 0.16 },
      },
      {
        t: 'rect',
        x: 15.0,
        y: 4.5,
        w: 10.8,
        h: 8.9,
        fill: null,
        stroke: { color: blue, width: 0.04 },
      },
      ...(
        [
          [15.0, 4.5],
          [25.8, 4.5],
          [15.0, 13.4],
          [25.8, 13.4],
        ] as const
      ).flatMap(([x, y]): Shape[] => [
        { t: 'rect', x: x - 0.32, y: y - 0.32, w: 0.64, h: 0.64, fill: blue },
        star(x, y, 0.24, 0.1, 5, paper),
      ]),
      pointer(12.6, 8.55, 1.9, 0.75, red),
    ],
    pictures: [{ x: 15.45, y: 4.95, w: 9.9, h: 8.0 }],
    title: { x: 3, y: 1.35, w: 22, h: 2.1, valign: 'middle', size: 34 },
    body: { x: 2.6, y: 4.7, w: 9.8, h: 9.3, size: 20 },
  },
  {
    name: 'Zwei Spalten',
    bg: paper,
    shapes: [
      sheet,
      {
        t: 'rect',
        x: 0.6,
        y: 0.6,
        w: 26.8,
        h: 14.55,
        fill: null,
        stroke: { color: blue, width: 0.13 },
      },
      ...ribbon(14, 1.45, 20.4, 1.9, red, '#7c160f'),
      { t: 'rect', x: 13.94, y: 5.0, w: 0.035, h: 3.5, fill: blue },
      { t: 'rect', x: 14.03, y: 5.0, w: 0.035, h: 3.5, fill: blue },
      { t: 'rect', x: 13.94, y: 9.9, w: 0.035, h: 3.5, fill: blue },
      { t: 'rect', x: 14.03, y: 9.9, w: 0.035, h: 3.5, fill: blue },
      star(14, 9.2, 0.5, 0.21, 5, red),
      star(14, 4.7, 0.22, 0.09, 5, blue),
      star(14, 13.7, 0.22, 0.09, 5, blue),
    ],
    title: {
      x: 4.2,
      y: 1.45,
      w: 19.6,
      h: 1.9,
      valign: 'middle',
      font: 'Zilla Slab',
      bold: true,
      upper: true,
      spacing: 1.5,
      size: 25,
      color: paper,
    },
    body: [
      { x: 2.4, y: 4.7, w: 10.6, h: 9.3, size: 20 },
      { x: 15.0, y: 4.7, w: 10.6, h: 9.3, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: red,
    shapes: [
      ...sunburst(14, -3.2, 34, 15, deepRed, { from: 4, to: 176, share: 0.5 }),
      ...medallion(14, 6.3, 4.9, blue),
      ...starRow(14, 0.95, 3, 0.9, 0.34, paper),
      pointer(2.4, 5.75, 4.6, 1.1, paper),
      pointer(21, 5.75, 4.6, 1.1, paper, true),
      star(4.7, 3.6, 0.5, 0.21, 5, gold),
      star(23.3, 3.6, 0.5, 0.21, 5, gold),
      star(4.7, 9.0, 0.5, 0.21, 5, gold),
      star(23.3, 9.0, 0.5, 0.21, 5, gold),
      ...ornRule(14, 11.75, 12, paper, gold),
      wear,
    ],
    title: {
      x: 10.2,
      y: 3.6,
      w: 7.6,
      h: 5.4,
      valign: 'middle',
      size: 70,
      color: blue,
      sample: '98 %',
    },
    body: {
      x: 4.5,
      y: 12.25,
      w: 19,
      h: 2.4,
      align: 'center',
      size: 21,
      bold: true,
      color: paper,
      sample: 'des Publikums halten beim großen Finale den Atem an. Der Rest klatscht schon.',
    },
  },
  {
    name: 'Zitat',
    bg: paper,
    shapes: [
      sheet,
      ...sunburst(14, 7.4, 30, 20, { t: 'solid', color: '#e3cf9f', opacity: 0.5 }),
      ...frame(),
      {
        t: 'text',
        x: 11,
        y: 0.95,
        w: 6,
        h: 3.4,
        text: '“',
        font: 'Abril Fatface',
        size: 150,
        color: red,
        align: 'center',
        valign: 'top',
        nowrap: true,
      },
      ...ornRule(14, 10.85, 11),
      pointer(5.6, 11.72, 2.2, 0.62, red),
      pointer(20.2, 11.72, 2.2, 0.62, red, true),
    ],
    body: {
      x: 4,
      y: 3.9,
      w: 20,
      h: 6.4,
      align: 'center',
      valign: 'middle',
      italic: true,
      size: 31,
      lineHeight: 116,
      sample: 'Das Publikum verzeiht alles, nur keine Langeweile. Also Trommelwirbel, bitte!',
    },
    subtitle: {
      x: 8,
      y: 11.4,
      w: 12,
      h: 1.3,
      valign: 'middle',
      color: blue,
      sample: 'Die Direktorin',
    },
  },
  {
    name: 'Bild',
    bg: paper,
    shapes: [
      sheet,
      ...valance(1.5, 16, red, '#ead9b0'),
      {
        t: 'rect',
        x: 3.05,
        y: 2.95,
        w: 21.9,
        h: 9.3,
        fill: null,
        stroke: { color: red, width: 0.16 },
      },
      {
        t: 'rect',
        x: 2.8,
        y: 2.7,
        w: 22.4,
        h: 9.8,
        fill: null,
        stroke: { color: blue, width: 0.04 },
      },
      ...ribbon(14, 12.95, 15.5, 1.6, blue, '#111c3c'),
      star(3.6, 13.75, 0.45, 0.19, 5, red),
      star(24.4, 13.75, 0.45, 0.19, 5, red),
    ],
    pictures: [{ x: 3.25, y: 3.15, w: 21.5, h: 8.9 }],
    title: {
      x: 6.6,
      y: 12.95,
      w: 14.8,
      h: 1.6,
      valign: 'middle',
      font: 'Zilla Slab',
      bold: true,
      upper: true,
      spacing: 1.5,
      size: 21,
      color: paper,
      sample: 'Manege frei für das Team',
    },
  },
  {
    name: 'Schluss',
    bg: blue,
    shapes: [
      ...skyStars,
      ...valance(1.75),
      ...starRow(14, 4.0, 5, 1.15, 0.5, gold),
      ...ribbon(14, 10.4, 16, 1.5, red, '#7c160f'),
      ...ornRule(14, 13.2, 9, paper, gold),
      wear,
    ],
    title: {
      x: 3,
      y: 4.7,
      w: 22,
      h: 5.2,
      valign: 'middle',
      size: 92,
      color: paper,
      sample: 'Applaus!',
    },
    subtitle: {
      x: 6.4,
      y: 10.4,
      w: 15.2,
      h: 1.5,
      valign: 'middle',
      sample: 'Zugaben und Fragen nach der Pause',
    },
  },
];

const template: Template = {
  slug: 'zirkus',
  name: 'Zirkus',
  group: 'Plakat',
  tags: ['Zirkus', 'Buchdruck', 'Jahrmarkt', 'nostalgisch', 'Sterne', 'festlich', 'Show', 'Feier'],
  description:
    'Schauplakat aus dem Buchdruck: Cremepapier, Rot und Tiefblau, Zeltstreifen, Sterne, Banderolen und viele Schriften auf Mitte.',
  palette: {
    bg: paper,
    text: blue,
    bg2: '#e6d3a8',
    text2: '#5b6078',
    accents: [red, gold, '#2f4f93', deepRed, '#f0c9a0', '#2e6b5e'],
  },
  fonts: { head: 'Abril Fatface', body: 'Alegreya' },
  text: {
    title: { font: 'Abril Fatface', size: 40, color: red, align: 'center', lineHeight: 96 },
    subtitle: {
      font: 'Zilla Slab',
      size: 17,
      color: paper,
      bold: true,
      upper: true,
      spacing: 2,
      align: 'center',
    },
    body: { font: 'Alegreya', size: 22, color: blue, lineHeight: 120, paraSpace: 0.34 },
  },
  layouts,
};

export default template;
