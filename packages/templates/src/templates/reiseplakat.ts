import { paint, rng, stencil } from '../art';
import type { Box, Color, FillLike, Layout, Picture, Shape, Template } from '../model';
import { PAGE } from '../model';
import { disc, page, smoothPath, star, sunburst } from '../shapes';

/*
 * Reiseplakat: the lithographed poster of a railway or a shipping line – flat landscapes in
 * receding tints (mountains, sea, dunes, a night coast), a large sun with its rays, a cream
 * border with a keyline round every sheet, spaced capitals and a bookish serif.
 */

const cream = '#f5e9d0';
const ink = '#17404a';
const orange = '#ef8a2b';
const coral = '#e2553a';
const sand = '#e8c58a';
const yellow = '#f7cf6b';
const sea = '#2b8a92';
const pale = '#fdf0c4';
const far = '#9fb0c9';
const mid = '#5f7fa6';
const near = '#2f5673';
const pine = '#12333a';

type Point = readonly [number, number];

/** A range of peaks filling a box from its bottom: angular, as cut from paper. */
function peaks(
  box: Box,
  seed: number,
  fill: FillLike,
  options: { count?: number; top?: number; valley?: number } = {},
): Shape {
  const random = rng(seed * 97 + 3);
  const count = options.count ?? 5;
  const top = options.top ?? 0;
  const valley = options.valley ?? 0.62;
  const pts: Point[] = [[0, Math.round(random.range(valley - 0.1, valley + 0.15) * 1000)]];
  for (let i = 0; i < count; i += 1) {
    const x = ((i + 0.5 + random.bell() * 0.22) / count) * 1000;
    const y = (top + random() * 0.34) * 1000;
    pts.push([Math.round(x), Math.round(y)]);
    // A shoulder on the way down, then the valley.
    const next = ((i + 1) / count) * 1000;
    pts.push([
      Math.round(x + (next - x) * 0.45),
      Math.round(y + (valley * 1000 - y) * random.range(0.4, 0.6)),
    ]);
    pts.push([Math.round(next), Math.round(random.range(valley - 0.08, valley + 0.2) * 1000)]);
  }
  // One peak always reaches the box's top, so the range stands where the box says.
  const highest = pts.reduce((best, point) => (point[1] < best[1] ? point : best), pts[1]!);
  const d = pts
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y === highest[1] ? 0 : y}`)
    .join(' ');
  return { t: 'path', ...box, vb: [1000, 1000], d: `${d} L1000 1000 L0 1000 Z`, fill };
}

/** Rolling hills or dunes filling a box from its bottom. */
function hills(box: Box, seed: number, fill: FillLike, bumps = 4, depth = 0.6): Shape {
  const random = rng(seed * 53 + 11);
  const count = bumps * 2;
  const pts: Point[] = Array.from({ length: count + 1 }, (_, index) => [
    (index / count) * 1000,
    (index % 2 === 0 ? random.range(depth * 0.6, depth) : random.range(0.04, depth * 0.45)) * 1000,
  ]);
  const lowest = Math.min(...pts.map((point) => point[1]));
  const lifted = pts.map(([x, y]): Point => [x, y - lowest]);
  return {
    t: 'path',
    ...box,
    vb: [1000, 1000],
    d: `${smoothPath(lifted, false)} L1000 1000 L0 1000 Z`,
    fill,
  };
}

/** A fir: three tiers and a trunk, standing on `base`. */
function fir(x: number, base: number, height: number, fill: Color): Shape[] {
  const w = height * 0.42;
  const tier = (top: number, bottom: number, width: number): Shape => ({
    t: 'poly',
    fill,
    pts: [
      [x, base - height * top],
      [x + width / 2, base - height * bottom],
      [x - width / 2, base - height * bottom],
    ],
  });
  return [
    {
      t: 'rect',
      x: x - height * 0.03,
      y: base - height * 0.2,
      w: height * 0.06,
      h: height * 0.2,
      fill,
    },
    tier(0.62, 0.12, w),
    tier(0.82, 0.38, w * 0.78),
    tier(1, 0.62, w * 0.54),
  ];
}

/** Light lying on water: short bars, wider towards the viewer. */
function glitter(cx: number, top: number, bottom: number, fill: FillLike, seed = 1): Shape[] {
  const random = rng(seed * 17 + 5);
  const shapes: Shape[] = [];
  const rows = Math.max(4, Math.round((bottom - top) / 0.34));
  for (let i = 0; i < rows; i += 1) {
    const t = i / (rows - 1);
    const w = (0.9 + t * 3.6) * random.range(0.6, 1.1);
    shapes.push({
      t: 'rect',
      x: cx - w / 2 + random.bell() * (0.3 + t * 1.2),
      y: top + (bottom - top) * t,
      w,
      h: 0.07 + t * 0.07,
      r: 0.04,
      fill,
    });
  }
  return shapes;
}

/** The stone's grain: fine specks of paper over the flat colours. */
function speckPicture(): Picture {
  const surface = paint(PAGE, 44);
  const { ctx, w, h } = surface;
  const random = rng(909);
  ctx.fillStyle = cream;
  for (let i = 0; i < 5200; i += 1) {
    ctx.globalAlpha = random.range(0.2, 0.6);
    ctx.fillRect(random() * w, random() * h, random.range(0.6, 1.8), random.range(0.6, 1.8));
  }
  return stencil(surface, cream, 4);
}
const specks: Shape = { t: 'image', ...page, src: speckPicture() };

const F = 0.8;
/** The poster's border: cream round the picture, a keyline at its edge, a fine line in it. */
const border = (bottom = F): Shape[] => [
  { t: 'rect', x: -0.2, y: -0.2, w: 28.4, h: F + 0.2, fill: cream },
  { t: 'rect', x: -0.2, y: PAGE.h - bottom, w: 28.4, h: bottom + 0.2, fill: cream },
  { t: 'rect', x: -0.2, y: -0.2, w: F + 0.2, h: 16.2, fill: cream },
  { t: 'rect', x: 28 - F, y: -0.2, w: F + 0.2, h: 16.2, fill: cream },
  {
    t: 'rect',
    x: F,
    y: F,
    w: 28 - 2 * F,
    h: PAGE.h - F - bottom,
    fill: null,
    stroke: { color: ink, width: 0.07 },
  },
  {
    t: 'rect',
    x: 0.4,
    y: 0.4,
    w: 27.2,
    h: PAGE.h - 0.8,
    fill: null,
    stroke: { color: coral, width: 0.035 },
  },
];

/** On a cream page there is nothing to cover: only the lines. */
const lines: Shape[] = [
  {
    t: 'rect',
    x: F,
    y: F,
    w: 28 - 2 * F,
    h: PAGE.h - 2 * F,
    fill: null,
    stroke: { color: ink, width: 0.07 },
  },
  {
    t: 'rect',
    x: 0.4,
    y: 0.4,
    w: 27.2,
    h: PAGE.h - 0.8,
    fill: null,
    stroke: { color: coral, width: 0.035 },
  },
];

const skyFill = (top: Color, bottom: Color): FillLike => ({
  t: 'linear',
  angle: 180,
  stops: [
    [0, top],
    [1, bottom],
  ],
});

/** A rule with a small sun in its middle. */
const sunRule = (cx: number, y: number, w: number, color: Color = ink): Shape[] => [
  { t: 'rect', x: cx - w / 2, y: y - 0.02, w: w / 2 - 0.42, h: 0.045, fill: color },
  { t: 'rect', x: cx + 0.42, y: y - 0.02, w: w / 2 - 0.42, h: 0.045, fill: color },
  star(cx, y, 0.3, 0.17, 10, orange),
  disc(cx, y, 0.12, cream),
];

/** A rule that starts with a small sun, for flush-left titles. */
const leadRule = (x: number, y: number, w: number): Shape[] => [
  star(x + 0.3, y, 0.3, 0.17, 10, orange),
  disc(x + 0.3, y, 0.12, cream),
  { t: 'rect', x: x + 0.78, y: y - 0.02, w: w - 0.78, h: 0.045, fill: ink },
];

/** The window of Inhalt: a view under a round arch. */
function archView(x: number, y: number, w: number, h: number): Shape[] {
  const r = w / 2;
  const corner = (flip: boolean): Shape => ({
    t: 'path',
    x: flip ? x + r : x - 0.05,
    y: y - 0.05,
    w: r + 0.05,
    h: r + 0.05,
    vb: [1000, 1000],
    d: flip
      ? 'M0 0 L1000 0 L1000 1000 C1000 448 552 0 0 0 Z'
      : 'M0 0 L1000 0 C448 0 0 448 0 1000 Z',
    fill: cream,
  });
  const k = 0.5523;
  const [W, H, R] = [Math.round(w * 100), Math.round(h * 100), Math.round(r * 100)];
  return [
    { t: 'rect', x, y, w, h, fill: skyFill(yellow, '#f6a65b') },
    ...sunburst(
      x + r,
      y + h * 0.5,
      w * 0.72,
      16,
      { t: 'solid', color: pale, opacity: 0.5 },
      {
        from: 180,
        to: 360,
        share: 0.5,
      },
    ),
    disc(x + r, y + h * 0.5, w * 0.19, pale),
    peaks({ x, y: y + h * 0.42, w, h: h * 0.3 }, 4, far, { count: 3 }),
    peaks({ x, y: y + h * 0.52, w, h: h * 0.24 }, 9, mid, { count: 4 }),
    { t: 'rect', x, y: y + h * 0.7, w, h: h * 0.3, fill: sea },
    ...glitter(x + r, y + h * 0.73, y + h * 0.9, { t: 'solid', color: pale, opacity: 0.85 }, 3).map(
      (shape) =>
        shape.t === 'rect' ? { ...shape, w: shape.w * 0.5, x: x + r - shape.w * 0.25 } : shape,
    ),
    hills({ x, y: y + h * 0.86, w, h: h * 0.14 }, 6, pine, 2, 0.7),
    ...fir(x + w * 0.2, y + h * 0.93, h * 0.22, pine),
    ...fir(x + w * 0.33, y + h * 0.95, h * 0.15, pine),
    // The sun's rays leave the window's sides: cover them, then the arch's corners.
    { t: 'rect', x: x - w * 0.3, y: y - 0.1, w: w * 0.3, h: h + 0.2, fill: cream },
    { t: 'rect', x: x + w, y: y - 0.1, w: w * 0.3, h: h + 0.2, fill: cream },
    corner(false),
    corner(true),
    {
      t: 'path',
      x,
      y,
      w,
      h,
      vb: [W, H],
      d: `M0 ${H} L0 ${R} C0 ${Math.round(R - R * k)} ${Math.round(R - R * k)} 0 ${R} 0 C${Math.round(R + R * k)} 0 ${W} ${Math.round(R - R * k)} ${W} ${R} L${W} ${H} Z`,
      fill: null,
      stroke: { color: ink, width: 0.09 },
    },
  ];
}

const nightStars: Shape[] = (() => {
  const random = rng(31);
  return Array.from({ length: 26 }, (): Shape => {
    const r = random.range(0.05, 0.14);
    return star(random.range(15.5, 26.6), random.range(1.3, 8.2), r, r * 0.38, 4, pale);
  });
})();

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: yellow,
    shapes: [
      { t: 'rect', ...page, fill: skyFill('#f7b867', '#f9dc8c') },
      ...sunburst(14, 7.3, 30, 30, { t: 'solid', color: pale, opacity: 0.45 }, { share: 0.5 }),
      disc(14, 7.3, 2.7, pale),
      peaks({ x: -1, y: 3.9, w: 13, h: 5.6 }, 1, far, { count: 3 }),
      peaks({ x: 17, y: 4.5, w: 12, h: 5 }, 2, far, { count: 3 }),
      peaks({ x: -1, y: 5.6, w: 30, h: 3.9 }, 3, mid, { count: 7, valley: 0.75 }),
      peaks({ x: -1, y: 7.2, w: 11, h: 2.6 }, 5, near, { count: 3, valley: 0.8 }),
      peaks({ x: 19.5, y: 6.9, w: 10, h: 2.9 }, 6, near, { count: 3, valley: 0.8 }),
      { t: 'rect', x: 0, y: 8.9, w: 28, h: 2.4, fill: sea },
      ...glitter(14, 9.05, 10.6, { t: 'solid', color: pale, opacity: 0.9 }, 2),
      hills({ x: -1, y: 9.7, w: 12, h: 1.6 }, 2, pine, 2, 0.8),
      ...fir(2.6, 10.3, 3.4, pine),
      ...fir(4.2, 10.5, 2.5, pine),
      ...fir(5.5, 10.7, 1.7, pine),
      ...fir(24.9, 10.9, 2.2, pine),
      ...fir(26.1, 11.1, 3.0, pine),
      hills({ x: 21, y: 10.3, w: 8, h: 1 }, 7, pine, 1, 0.8),
      specks,
      ...border(4.6),
      ...sunRule(14, 13.62, 7),
    ],
    title: {
      x: 2,
      y: 11.45,
      w: 24,
      h: 1.85,
      align: 'center',
      valign: 'middle',
      size: 40,
      spacing: 6,
      sample: 'Auf zu neuen Ufern',
    },
    subtitle: {
      x: 4,
      y: 13.95,
      w: 20,
      h: 1.1,
      align: 'center',
      sample: 'Eine Reise durch das kommende Jahr',
    },
  },
  {
    name: 'Abschnitt',
    bg: pale,
    shapes: [
      { t: 'rect', ...page, fill: skyFill('#fbe6ad', '#f8c873') },
      disc(20.6, 7.4, 4.3, coral),
      // The sun sinks into haze: bands of sky across its lower half.
      ...[0, 1, 2, 3].map((i): Shape => ({
        t: 'rect',
        x: 15.5,
        y: 7.9 + i * 0.62,
        w: 10.2,
        h: 0.14 + i * 0.07,
        fill: '#f9cf80',
      })),
      hills({ x: -1, y: 9.2, w: 30, h: 3 }, 1, '#f0b565', 3, 0.5),
      hills({ x: -1, y: 10.3, w: 30, h: 3 }, 2, '#e3954a', 2, 0.6),
      hills({ x: -1, y: 11.5, w: 30, h: 4.4 }, 3, '#c96f36', 3, 0.5),
      hills({ x: -1, y: 12.9, w: 30, h: 3 }, 4, '#8f4326', 2, 0.6),
      specks,
      ...border(),
      ...leadRule(2.3, 7.05, 6.5),
    ],
    title: {
      x: 2.3,
      y: 2.2,
      w: 14.6,
      h: 4.4,
      size: 46,
      spacing: 5,
      sample: 'Zweite\nEtappe',
    },
    subtitle: { x: 2.3, y: 7.5, w: 12, h: 1.2, sample: 'Durch die Dünen ans Meer' },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [...archView(19.3, 2.2, 6.5, 11.4), specks, ...lines, ...leadRule(2.2, 4.6, 6.5)],
    title: { x: 2.2, y: 1.5, w: 16.2, h: 2.6, size: 26, spacing: 3 },
    body: { x: 2.2, y: 5.1, w: 16.2, h: 9.1 },
  },
  {
    name: 'Text und Bild',
    bg: cream,
    shapes: [
      {
        t: 'rect',
        x: 1.75,
        y: 1.75,
        w: 10.3,
        h: 12.25,
        fill: null,
        stroke: { color: ink, width: 0.07 },
      },
      ...sunburst(23.6, 14.95, 3.1, 11, yellow, { from: 184, to: 356, share: 0.5 }),
      { t: 'ellipse', x: 22.1, y: 13.45, w: 3, h: 3, fill: orange },
      { t: 'rect', x: 20, y: 14.95, w: 7.2, h: 0.8, fill: cream },
      ...lines,
      ...leadRule(13.3, 4.9, 6.5),
    ],
    pictures: [{ x: 1.95, y: 1.95, w: 9.9, h: 11.85 }],
    title: { x: 13.3, y: 1.6, w: 13, h: 2.8, size: 25, spacing: 3 },
    body: { x: 13.3, y: 5.5, w: 12.9, h: 7.2, size: 20 },
  },
  {
    name: 'Zwei Spalten',
    bg: cream,
    shapes: [
      { t: 'rect', x: F, y: 12.3, w: 28 - 2 * F, h: 3, fill: skyFill('#f9dc8c', '#f7b867') },
      { t: 'ellipse', x: 12.2, y: 11.9, w: 3.6, h: 3.6, fill: coral },
      { t: 'rect', x: 5, y: 10.9, w: 18, h: 1.4, fill: cream },
      peaks({ x: 0, y: 12.65, w: 9, h: 1.3 }, 12, mid, { count: 3, valley: 0.8 }),
      peaks({ x: 20, y: 12.8, w: 8.5, h: 1.2 }, 13, mid, { count: 3, valley: 0.8 }),
      { t: 'rect', x: 0, y: 13.7, w: 28, h: 2.1, fill: sea },
      ...glitter(14, 13.85, 14.7, { t: 'solid', color: pale, opacity: 0.9 }, 5),
      specks,
      ...border(),
      { t: 'rect', x: F, y: 12.3, w: 28 - 2 * F, h: 0.07, fill: ink },
      ...sunRule(14, 3.55, 9),
      { t: 'rect', x: 13.98, y: 4.6, w: 0.045, h: 6.9, fill: ink },
    ],
    title: { x: 3, y: 1.3, w: 22, h: 2, align: 'center', valign: 'middle', size: 28 },
    body: [
      { x: 2.4, y: 4.5, w: 10.8, h: 7.3, size: 20 },
      { x: 14.9, y: 4.5, w: 10.8, h: 7.3, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: orange,
    shapes: [
      { t: 'rect', ...page, fill: skyFill('#f08a3a', '#f7c266') },
      ...sunburst(14, 6.1, 30, 32, { t: 'solid', color: pale, opacity: 0.4 }, { share: 0.5 }),
      disc(14, 6.1, 4.75, coral),
      disc(14, 6.1, 4.45, pale),
      peaks({ x: -1, y: 6.6, w: 9.5, h: 5 }, 21, far, { count: 2, valley: 0.7 }),
      peaks({ x: 19.5, y: 7.1, w: 9.5, h: 4.5 }, 22, far, { count: 2, valley: 0.7 }),
      peaks({ x: -1, y: 8.6, w: 30, h: 3.4 }, 23, mid, { count: 6, valley: 0.72 }),
      hills({ x: -1, y: 10.6, w: 30, h: 2.4 }, 24, near, 3, 0.5),
      hills({ x: -1, y: 11.4, w: 30, h: 4.6 }, 25, ink, 2, 0.16),
      specks,
      ...border(),
    ],
    title: {
      x: 9.8,
      y: 3.2,
      w: 8.4,
      h: 5.4,
      align: 'center',
      valign: 'middle',
      size: 84,
      spacing: 0,
      sample: '68 %',
    },
    body: {
      x: 4,
      y: 12.1,
      w: 20,
      h: 2.5,
      align: 'center',
      size: 20,
      color: cream,
      sample: 'der Gäste kommen wieder, weil der erste Morgen am Wasser so still war.',
    },
  },
  {
    name: 'Zitat',
    bg: ink,
    shapes: [
      { t: 'rect', ...page, fill: skyFill('#0f2f38', '#2a6672') },
      ...nightStars,
      disc(21.6, 4.6, 3.1, { t: 'solid', color: pale, opacity: 0.1 }),
      disc(21.6, 4.6, 2.5, { t: 'solid', color: pale, opacity: 0.14 }),
      disc(21.6, 4.6, 1.9, pale),
      peaks({ x: 13, y: 8.4, w: 16, h: 3.6 }, 31, '#1f5560', { count: 4, valley: 0.7 }),
      peaks({ x: -1, y: 9.6, w: 30, h: 2.6 }, 32, '#18454f', { count: 7, valley: 0.7 }),
      { t: 'rect', x: 0, y: 11.7, w: 28, h: 4.1, fill: '#123a44' },
      ...glitter(21.6, 11.9, 14.3, { t: 'solid', color: pale, opacity: 0.75 }, 8),
      hills({ x: -1, y: 12.6, w: 13, h: 3.4 }, 33, '#0b2329', 2, 0.5),
      ...fir(2.6, 13.6, 3.6, '#0b2329'),
      ...fir(4.3, 13.9, 2.6, '#0b2329'),
      ...fir(6.6, 14.1, 1.9, '#0b2329'),
      specks,
      ...border(),
    ],
    body: {
      x: 2.6,
      y: 1.9,
      w: 15.6,
      h: 6.4,
      valign: 'middle',
      italic: true,
      size: 26,
      lineHeight: 122,
      color: cream,
      sample: '„Man reist nicht, um anzukommen, sondern um unterwegs die Augen aufzumachen.“',
    },
    subtitle: {
      x: 2.6,
      y: 8.8,
      w: 12,
      h: 1.1,
      font: 'Josefin Sans',
      italic: false,
      bold: true,
      upper: true,
      spacing: 3,
      size: 15,
      color: yellow,
      sample: 'Aus einem Reisetagebuch',
    },
  },
  {
    name: 'Bild',
    bg: cream,
    shapes: [
      {
        t: 'rect',
        x: 1.75,
        y: 1.75,
        w: 24.5,
        h: 10.3,
        fill: null,
        stroke: { color: ink, width: 0.07 },
      },
      ...lines,
      ...sunRule(14, 14.45, 9),
    ],
    pictures: [{ x: 1.95, y: 1.95, w: 24.1, h: 9.9 }],
    title: {
      x: 3,
      y: 12.3,
      w: 22,
      h: 1.9,
      align: 'center',
      valign: 'middle',
      size: 28,
      spacing: 5,
      sample: 'Blick von der Passhöhe',
    },
  },
  {
    name: 'Schluss',
    bg: orange,
    shapes: [
      { t: 'rect', ...page, fill: skyFill('#ee7f3c', '#f9d27c') },
      ...sunburst(
        14,
        9.7,
        30,
        26,
        { t: 'solid', color: pale, opacity: 0.35 },
        {
          from: 180,
          to: 360,
          share: 0.5,
        },
      ),
      disc(14, 9.7, 3.3, pale),
      peaks({ x: -1, y: 7.6, w: 8, h: 2.2 }, 41, near, { count: 2, valley: 0.8 }),
      peaks({ x: 22, y: 8.1, w: 7, h: 1.7 }, 42, near, { count: 2, valley: 0.8 }),
      { t: 'rect', x: 0, y: 9.7, w: 28, h: 6.1, fill: skyFill(sea, '#1d5e68') },
      ...glitter(14, 9.9, 14.4, { t: 'solid', color: pale, opacity: 0.85 }, 4),
      // A boat going out: two sails and a hull.
      {
        t: 'poly',
        fill: cream,
        pts: [
          [7.3, 8.5],
          [7.3, 10.5],
          [6.1, 10.5],
        ],
      },
      {
        t: 'poly',
        fill: cream,
        pts: [
          [7.45, 8.9],
          [8.5, 10.5],
          [7.45, 10.5],
        ],
      },
      {
        t: 'poly',
        fill: pine,
        pts: [
          [5.9, 10.62],
          [8.8, 10.62],
          [8.4, 11.0],
          [6.3, 11.0],
        ],
      },
      specks,
      ...border(),
    ],
    title: {
      x: 3,
      y: 1.9,
      w: 22,
      h: 3.2,
      align: 'center',
      valign: 'middle',
      size: 60,
      spacing: 8,
      sample: 'Gute Reise',
    },
    subtitle: {
      x: 5,
      y: 5.1,
      w: 18,
      h: 1.3,
      align: 'center',
      color: ink,
      size: 20,
      sample: 'Fragen nehmen wir gern mit auf den Weg',
    },
  },
];

const template: Template = {
  slug: 'reiseplakat',
  name: 'Reiseplakat',
  group: 'Plakat',
  tags: ['Reise', 'Vintage', 'Landschaft', 'Sonne', 'Berge', 'Meer', 'warm', 'Tourismus'],
  description:
    'Reiseplakat alter Schule: flächige Landschaften in gestaffelten Tönen, eine große Sonne, cremefarbener Rahmen und gesperrte Versalien.',
  palette: {
    bg: cream,
    text: ink,
    bg2: sand,
    text2: '#4d6a70',
    accents: [orange, coral, sea, yellow, mid, pine],
  },
  fonts: { head: 'Josefin Sans', body: 'Lora' },
  text: {
    title: {
      font: 'Josefin Sans',
      size: 36,
      color: ink,
      bold: true,
      upper: true,
      spacing: 4,
      lineHeight: 112,
    },
    subtitle: { font: 'Lora', size: 18, color: coral, italic: true },
    body: { font: 'Lora', size: 21, color: ink, lineHeight: 128, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
