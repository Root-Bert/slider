import { rng } from '../art';
import type { Box, Color, Layout, Shape, Stroke, Template } from '../model';
import { disc, dots, polygon, ring, squiggle } from '../shapes';

/*
 * Memphis: the 1980s at play – squiggles, zigzags, confetti triangles, dot grids and terrazzo
 * bits in pink, turquoise and yellow with black, thrown over white. Loud, never tidy.
 */

const white = '#fffdf8';
const ink = '#151515';
const pink = '#ff4f97';
const teal = '#17c3bd';
const yellow = '#ffd332';
const purple = '#6c4cf1';
const coral = '#ff7a4d';
const mint = '#d6f4f0';

const out: Stroke = { color: ink, width: 0.13, join: 'round' };

type Point = readonly [number, number];

const inside = (x: number, y: number, box: Box, by: number) =>
  x > box.x - by && x < box.x + box.w + by && y > box.y - by && y < box.y + box.h + by;

/** Places for `count` scattered bits: on the page, apart from each other, off the `keep` boxes. */
function scatter(seed: number, count: number, keep: readonly Box[], apart: number, area?: Box) {
  const random = rng(seed);
  const field = area ?? { x: 0.4, y: 0.4, w: 27.2, h: 14.95 };
  const places: Point[] = [];
  for (let tries = 0; places.length < count && tries < count * 60; tries += 1) {
    const [x, y] = [field.x + random() * field.w, field.y + random() * field.h];
    if (keep.some((box) => inside(x, y, box, 0.55))) continue;
    if (places.some(([px, py]) => Math.hypot(px - x, py - y) < apart)) continue;
    places.push([x, y]);
  }
  return { places, random };
}

/** Confetti: small triangles, bars, dots, rings and zigzags in the given colours. */
function confetti(
  seed: number,
  count: number,
  colors: readonly Color[],
  keep: readonly Box[],
  options: { apart?: number; area?: Box; scale?: number } = {},
): Shape[] {
  const { places, random } = scatter(seed, count, keep, options.apart ?? 1.5, options.area);
  const scale = options.scale ?? 1;
  return places.flatMap(([x, y], index): Shape[] => {
    const color = colors[index % colors.length]!;
    const turn = random.range(0, 360);
    const size = random.range(0.8, 1.25) * scale;
    switch (index % 6) {
      case 0:
        return [polygon(x, y, 0.36 * size, 3, color, { rotate: turn })];
      case 1:
        return [
          {
            t: 'rect',
            x: x - 0.42 * size,
            y: y - 0.1 * size,
            w: 0.84 * size,
            h: 0.2 * size,
            fill: color,
            rotate: turn,
          },
        ];
      case 2:
        return [disc(x, y, 0.17 * size, color)];
      case 3:
        return [ring(x, y, 0.24 * size, { color, width: 0.09 })];
      case 4:
        return [
          squiggle(
            { x: x - 0.6 * size, y: y - 0.16 * size, w: 1.2 * size, h: 0.32 * size },
            2.5,
            { color, width: 0.1 },
            { zigzag: true, rotate: turn },
          ),
        ];
      default:
        return [
          {
            t: 'rect',
            x: x - 0.3 * size,
            y: y - 0.07 * size,
            w: 0.6 * size,
            h: 0.14 * size,
            fill: color,
            rotate: turn,
          },
          {
            t: 'rect',
            x: x - 0.3 * size,
            y: y - 0.07 * size,
            w: 0.6 * size,
            h: 0.14 * size,
            fill: color,
            rotate: turn + 90,
          },
        ];
    }
  });
}

/** Terrazzo: broken bits of stone, each an uneven four- or five-sided chip. */
function terrazzo(
  seed: number,
  count: number,
  colors: readonly Color[],
  keep: readonly Box[],
): Shape[] {
  const { places, random } = scatter(seed, count, keep, 1.25);
  return places.map(([x, y], index): Shape => {
    const corners = random.int(4, 5);
    const size = random.range(0.28, 0.62);
    const turn = random.range(0, Math.PI * 2);
    return {
      t: 'poly',
      fill: colors[index % colors.length]!,
      pts: Array.from({ length: corners }, (_, corner): Point => {
        const a = turn + (corner / corners) * Math.PI * 2 + random.range(-0.3, 0.3);
        const r = size * random.range(0.6, 1.1);
        return [x + Math.cos(a) * r * 1.25, y + Math.sin(a) * r * 0.85];
      }),
    };
  });
}

/** A shape's striped double, to sit shifted behind it: slanted lines cut to a box or a circle. */
const striped = (box: Box, color: Color, round = false, step = 0.3): Shape[] => {
  const stroke: Stroke = { color, width: 0.07 };
  const lines: Shape[] = [];
  if (round) {
    const [cx, cy, r] = [box.x + box.w / 2, box.y + box.h / 2, box.w / 2];
    for (let d = -r + step / 2; d < r; d += step) {
      const half = Math.sqrt(r * r - d * d) / Math.SQRT2;
      const [px, py] = [cx + d / Math.SQRT2, cy + d / Math.SQRT2];
      lines.push({ t: 'line', x1: px - half, y1: py + half, x2: px + half, y2: py - half, stroke });
    }
    return lines;
  }
  const from = box.x + box.y;
  for (let k = from + step; k < from + box.w + box.h; k += step * Math.SQRT2) {
    const x1 = Math.max(box.x, k - (box.y + box.h));
    const x2 = Math.min(box.x + box.w, k - box.y);
    lines.push({ t: 'line', x1, y1: k - x1, x2, y2: k - x2, stroke });
  }
  return lines;
};

const circle = (
  cx: number,
  cy: number,
  r: number,
  fill: Color,
  stroke: Stroke | null = out,
): Shape => ({
  t: 'ellipse',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  fill,
  stroke,
});

const wavy = (
  x: number,
  y: number,
  w: number,
  h: number,
  waves: number,
  color: Color,
  width = 0.3,
  rotate = 0,
) => squiggle({ x, y, w, h }, waves, { color, width }, { rotate });
const zig = (
  x: number,
  y: number,
  w: number,
  h: number,
  waves: number,
  color: Color,
  width = 0.18,
  rotate = 0,
) =>
  squiggle(
    { x, y, w, h },
    waves,
    { color, width, join: 'miter', cap: 'butt' },
    { zigzag: true, rotate },
  );

const titleBox: Box = { x: 1.8, y: 3.4, w: 13.6, h: 6.4 };
const textPicture: Box = { x: 15.4, y: 3.2, w: 10.2, h: 9.2 };
const bigPicture: Box = { x: 3.6, y: 1.5, w: 20.8, h: 9.8 };

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: white,
    shapes: [
      ...striped({ x: 17.5, y: 2.7, w: 8.4, h: 8.4 }, ink, true),
      circle(21, 6.2, 4.2, pink),
      polygon(18, 10.4, 3, 3, yellow, { stroke: out, rotate: -70 }),
      wavy(19.4, 0.9, 7.4, 1.3, 3.5, teal, 0.42, -8),
      ...dots({ x: 23.2, y: 10.6, w: 3.2, h: 3.2 }, 5, 5, 0.3, ink),
      { t: 'rect', x: 13.8, y: 12.4, w: 4.4, h: 1.3, fill: purple, stroke: out, rotate: -12 },
      zig(1.8, 12.9, 7.2, 0.7, 7, pink, 0.2),
      circle(13.9, 2.2, 0.75, teal),
      ...confetti(
        11,
        12,
        [ink, teal, yellow, purple, coral],
        [
          { x: 0, y: 2.6, w: 15.4, h: 9.6 },
          { x: 0, y: 12, w: 10, h: 3 },
          { x: 15, y: 0.6, w: 12, h: 14 },
        ],
        {
          apart: 1.9,
        },
      ),
    ],
    title: { ...titleBox, valign: 'bottom', size: 66, sample: 'Total\nverspielt' },
    subtitle: {
      x: 1.8,
      y: 10.2,
      w: 13.6,
      h: 1.6,
      size: 20,
      sample: 'Ideen, die aus der Reihe tanzen',
    },
  },
  {
    name: 'Abschnitt',
    bg: teal,
    shapes: [
      ...terrazzo(
        5,
        70,
        [white, yellow, pink, ink, purple, white],
        [
          { x: 1.2, y: 4.2, w: 15.6, h: 8.4 },
          { x: 17.4, y: 1.4, w: 9.8, h: 10 },
        ],
      ),
      ...striped({ x: 18.9, y: 2.6, w: 8, h: 8 }, ink, true),
      circle(22.2, 5.9, 4, yellow),
      zig(18.6, 5.2, 7.2, 1.4, 4, ink, 0.3),
      polygon(19.2, 11.6, 1.5, 3, pink, { stroke: out, rotate: 15 }),
    ],
    title: {
      x: 1.8,
      y: 4.6,
      w: 14.6,
      h: 5.4,
      valign: 'bottom',
      size: 58,
      sample: 'Runde zwei',
    },
    subtitle: { x: 1.8, y: 10.4, w: 14, h: 1.6, color: white, sample: 'Jetzt wird es bunt' },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: [
      zig(1.8, 3.25, 6.4, 0.6, 6, pink, 0.2),
      ...striped({ x: 24.2, y: 0.2, w: 5, h: 5 }, ink, true),
      circle(26.2, 2.2, 2.5, yellow),
      polygon(25.4, 7.2, 1.35, 3, teal, { stroke: out, rotate: 20 }),
      ...dots({ x: 24.2, y: 9.4, w: 2.6, h: 2.6 }, 4, 4, 0.28, ink),
      wavy(23.6, 13.2, 3.6, 0.9, 2.5, purple, 0.34, -10),
      { t: 'rect', x: 26.6, y: 11.2, w: 0.9, h: 0.9, fill: pink, stroke: out, rotate: 18 },
    ],
    title: { x: 1.8, y: 0.8, w: 20.6, h: 2.3, valign: 'middle', size: 36 },
    body: {
      x: 1.8,
      y: 4.5,
      w: 20.6,
      h: 9.8,
      sample: [
        'Regeln kennen, dann fröhlich brechen',
        'Farben dürfen sich ruhig streiten',
        'Muster trifft Muster trifft Fläche',
        'Jede Form bekommt ihren Auftritt',
        'Am Ende gewinnt die gute Laune',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [
      ...striped(
        { x: textPicture.x + 0.9, y: textPicture.y + 0.9, w: textPicture.w, h: textPicture.h },
        ink,
      ),
      { t: 'rect', x: textPicture.x - 0.8, y: textPicture.y - 0.8, w: 6.4, h: 6.4, fill: yellow },
      circle(25.4, 12.6, 1.5, pink),
      {
        t: 'rect',
        x: textPicture.x - 0.07,
        y: textPicture.y - 0.07,
        w: textPicture.w + 0.14,
        h: textPicture.h + 0.14,
        fill: ink,
      },
      wavy(20.6, 0.9, 5.6, 1.1, 3, teal, 0.38, 6),
      polygon(14.4, 13.6, 0.9, 3, purple, { rotate: 40 }),
      zig(1.8, 4.3, 5.6, 0.6, 5, teal, 0.2),
    ],
    title: { x: 1.8, y: 0.9, w: 12.6, h: 3.2, valign: 'bottom', size: 29 },
    body: { x: 1.8, y: 5.4, w: 11.8, h: 8.9, size: 20 },
    pictures: [textPicture],
  },
  {
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      { t: 'rect', x: 1.5, y: 4.4, w: 11.8, h: 10, r: 0.9, fill: '#fff1b3' },
      { t: 'rect', x: 14.7, y: 4.4, w: 11.8, h: 10, r: 0.9, fill: mint },
      zig(12.2, 9, 3.6, 0.6, 4, ink, 0.18, 90),
      ...striped({ x: 0.9, y: 3.7, w: 2.2, h: 2.2 }, ink, true),
      circle(1.8, 4.6, 1, pink),
      polygon(26.4, 4.5, 1.25, 3, purple, { stroke: out, rotate: -20 }),
      wavy(21.4, 1.5, 4.8, 0.9, 3, yellow, 0.36),
      ...dots({ x: 24.4, y: 13.4, w: 2.6, h: 1.7 }, 4, 3, 0.26, ink),
    ],
    title: { x: 1.8, y: 0.8, w: 19, h: 2.4, valign: 'middle', size: 36 },
    body: [
      { x: 2.5, y: 5.5, w: 10, h: 8.2, size: 19 },
      { x: 15.6, y: 5.5, w: 10, h: 8.2, size: 19 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: yellow,
    shapes: [
      ...terrazzo(
        21,
        26,
        [white, ink, teal, purple],
        [
          { x: 1.2, y: 1, w: 14.6, h: 13.8 },
          { x: 15.8, y: 4.2, w: 11, h: 8.4 },
        ],
      ),
      ...striped({ x: 3.5, y: 2.9, w: 11, h: 11 }, ink, true),
      circle(8.3, 7.7, 5.5, pink),
      wavy(1.2, 1.1, 5.2, 1, 3, teal, 0.4, -12),
      polygon(13.6, 13.2, 1.3, 3, teal, { stroke: out, rotate: 10 }),
      zig(16.6, 11.3, 6.2, 0.7, 6, ink, 0.2),
    ],
    title: {
      x: 3.2,
      y: 4.5,
      w: 10.2,
      h: 6.4,
      align: 'center',
      valign: 'middle',
      size: 96,
      sample: '80 %',
    },
    body: {
      x: 16.6,
      y: 4.8,
      w: 9.8,
      h: 6,
      valign: 'bottom',
      size: 23,
      bold: true,
      sample: 'mehr Farbe als erlaubt – und trotzdem passt alles zusammen.',
    },
  },
  {
    name: 'Zitat',
    bg: pink,
    shapes: [
      ...dots({ x: 0.8, y: 0.8, w: 2.7, h: 5.4 }, 4, 7, 0.3, ink),
      {
        t: 'text',
        x: 3.6,
        y: -2.2,
        w: 6,
        h: 5.4,
        text: '“',
        font: 'Righteous',
        size: 230,
        color: yellow,
        align: 'center',
        valign: 'top',
        nowrap: true,
      },
      ...striped({ x: 22.3, y: 9.9, w: 4.6, h: 4.6 }, ink, true),
      circle(24, 11.6, 2.3, teal),
      polygon(21.4, 2.6, 1.4, 3, yellow, { stroke: out, rotate: 35 }),
      wavy(21.6, 4.6, 5, 0.9, 3, white, 0.36, 12),
      zig(4.4, 11.15, 5.2, 0.6, 5, white, 0.2),
    ],
    body: {
      x: 4.4,
      y: 3.6,
      w: 17.6,
      h: 7,
      valign: 'bottom',
      font: 'Righteous',
      size: 36,
      lineHeight: 116,
      sample: 'Guter Geschmack ist auch nur eine Regel, die man brechen darf.',
    },
    subtitle: { x: 4.4, y: 12, w: 14, h: 1.6, color: white, sample: 'Ettore Brandt, Gestalterin' },
  },
  {
    name: 'Bild',
    bg: white,
    shapes: [
      ...confetti(
        33,
        26,
        [pink, teal, yellow, purple, ink, coral],
        [{ x: 2.6, y: 0.6, w: 23.6, h: 14.6 }],
        { apart: 1.2 },
      ),
      ...striped(
        { x: bigPicture.x + 0.9, y: bigPicture.y + 0.9, w: bigPicture.w, h: bigPicture.h },
        ink,
      ),
      { t: 'rect', x: bigPicture.x - 0.8, y: bigPicture.y + 4.2, w: 7, h: 6.4, fill: teal },
      {
        t: 'rect',
        x: bigPicture.x - 0.07,
        y: bigPicture.y - 0.07,
        w: bigPicture.w + 0.14,
        h: bigPicture.h + 0.14,
        fill: ink,
      },
      polygon(24.6, 1.6, 1.3, 3, yellow, { stroke: out, rotate: 12 }),
      zig(18.6, 13.25, 5.6, 0.7, 5, pink, 0.22),
    ],
    pictures: [bigPicture],
    title: {
      x: 3.6,
      y: 12.5,
      w: 14.4,
      h: 2.1,
      valign: 'middle',
      size: 28,
      sample: 'Wohnzimmer, aber wild',
    },
  },
  {
    name: 'Schluss',
    bg: ink,
    shapes: [
      ...confetti(
        8,
        60,
        [pink, teal, yellow, purple, white, coral],
        [{ x: 5.6, y: 4.2, w: 16.8, h: 7.6 }],
        { apart: 1.55, scale: 1.25 },
      ),
      circle(1.6, 1.4, 3.4, pink, null),
      polygon(25.2, 13.4, 2.6, 3, yellow, { rotate: 25 }),
      wavy(19.6, 1.6, 6.6, 1.2, 3.5, teal, 0.42, 8),
      zig(10.4, 10.7, 7.2, 0.7, 7, pink, 0.22),
    ],
    title: {
      x: 6,
      y: 4.4,
      w: 16,
      h: 4.2,
      align: 'center',
      valign: 'bottom',
      size: 84,
      color: white,
      sample: 'Danke!',
    },
    subtitle: {
      x: 6,
      y: 8.8,
      w: 16,
      h: 1.6,
      align: 'center',
      color: yellow,
      sample: 'Bleibt schön schräg',
    },
  },
];

const template: Template = {
  slug: 'memphis',
  name: 'Memphis',
  group: 'Kunststil',
  tags: ['Memphis', 'Achtziger', 'verspielt', 'bunt', 'Muster', 'Konfetti', 'Workshop'],
  description:
    'Achtzigerjahre zum Anfassen: Schlangenlinien, Zickzack, Konfetti und Punkte in Pink, Türkis und Gelb.',
  palette: {
    bg: white,
    text: ink,
    bg2: mint,
    text2: '#3f3d46',
    accents: [pink, teal, yellow, purple, coral, '#fff1b3'],
  },
  fonts: { head: 'Righteous', body: 'Poppins' },
  text: {
    title: { font: 'Righteous', size: 44, color: ink, lineHeight: 100 },
    subtitle: { font: 'Poppins', size: 22, color: ink, bold: true },
    body: { font: 'Poppins', size: 21, color: ink, lineHeight: 124, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
