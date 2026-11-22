import { darken, lighten, paint, png, rgba, rng } from '../art';
import type { Box, Color, Layout, Picture, Shape, Template } from '../model';
import { disc } from '../shapes';

/*
 * Bonbon: a sweet shop in pastel. Mint, peach, lilac, lemon and baby blue grounds, everything
 * round – pills, scalloped edges, biscuit-shaped plates for the big words – with sugar sprinkles
 * strewn about and a few glossy drops lying on top.
 */

const mint = '#c6f1df';
const peach = '#ffd8c2';
const lilac = '#ddd0ff';
const lemon = '#fff2ad';
const sky = '#cde8ff';
const rose = '#ffd0e2';
const cream = '#fffaf3';
const white = '#ffffff';
const plum = '#4b2a63';
const berry = '#e84a8a';

/** The stronger sugar colours: sprinkles and drops. */
const candy = ['#ff7fb0', '#5cbcff', '#3fd0a4', '#ffc83d', '#a78bfa', '#ff9a6b'] as const;

const soft = { dx: 0, dy: 0.14, blur: 0.55, color: '#7b5a9c', opacity: 0.16 } as const;

/** A glossy drop: a boiled sweet lit from the upper left, see-through round it. */
function drop(color: Color): Picture {
  const surface = paint({ w: 4, h: 4 }, 60);
  const { ctx, w } = surface;
  const [c, r] = [w / 2, w * 0.4];
  // Its shadow on the table.
  const shade = ctx.createRadialGradient(c, c + r * 0.98, 0, c, c + r * 0.98, r * 0.95);
  shade.addColorStop(0, rgba(darken(color, 0.55), 0.3));
  shade.addColorStop(1, rgba(darken(color, 0.55), 0));
  ctx.fillStyle = shade;
  ctx.save();
  ctx.translate(0, c + r * 0.98);
  ctx.scale(1, 0.28);
  ctx.translate(0, -(c + r * 0.98));
  ctx.beginPath();
  ctx.arc(c, c + r * 0.98, r * 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // The body.
  const body = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.05, c, c, r);
  body.addColorStop(0, lighten(color, 0.55));
  body.addColorStop(0.5, color);
  body.addColorStop(1, darken(color, 0.22));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  // Light coming through at the lower right.
  const glow = ctx.createRadialGradient(c + r * 0.4, c + r * 0.5, 0, c + r * 0.4, c + r * 0.5, r);
  glow.addColorStop(0, rgba(lighten(color, 0.7), 0.6));
  glow.addColorStop(0.6, rgba(lighten(color, 0.7), 0));
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, w);
  ctx.restore();
  // The window in it.
  ctx.save();
  ctx.translate(c - r * 0.36, c - r * 0.46);
  ctx.rotate(-0.7);
  const shine = ctx.createLinearGradient(0, -r * 0.2, 0, r * 0.22);
  shine.addColorStop(0, 'rgba(255,255,255,0.95)');
  shine.addColorStop(1, 'rgba(255,255,255,0.25)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.36, r * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(c + r * 0.16, c - r * 0.62, r * 0.06, 0, Math.PI * 2);
  ctx.fill();
  return png(surface);
}

const drops = {
  pink: drop(candy[0]),
  blue: drop(candy[1]),
  mint: drop(candy[2]),
  sun: drop(candy[3]),
  violet: drop(candy[4]),
};

/** A drop lying at a place, `size` across. */
const sweet = (kind: keyof typeof drops, cx: number, cy: number, size: number): Shape => ({
  t: 'image',
  x: cx - size * 0.625,
  y: cy - size * 0.625,
  w: size * 1.25,
  h: size * 1.25,
  src: drops[kind],
});

const within = (x: number, y: number, box: Box, margin: number) =>
  x > box.x - margin &&
  x < box.x + box.w + margin &&
  y > box.y - margin &&
  y < box.y + box.h + margin;

/** Sugar sprinkles strewn over a box, keeping off the boxes in `off`. */
function sprinkles(seed: number, box: Box, count: number, off: readonly Box[] = []): Shape[] {
  const random = rng(seed);
  const shapes: Shape[] = [];
  const placed: [number, number][] = [];
  for (let tries = 0; shapes.length < count && tries < count * 30; tries += 1) {
    const [x, y] = [box.x + random() * box.w, box.y + random() * box.h];
    if (off.some((keep) => within(x, y, keep, 0.5))) continue;
    if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 1.1)) continue;
    placed.push([x, y]);
    const length = random.range(0.5, 0.72);
    shapes.push({
      t: 'rect',
      x: x - length / 2,
      y: y - 0.1,
      w: length,
      h: 0.2,
      r: 0.1,
      fill: random.pick(candy),
      rotate: random.range(0, 180),
    });
  }
  return shapes;
}

/** A biscuit: a round plate with a scalloped rim. */
function biscuit(cx: number, cy: number, radius: number, bumps: number, fill: Color): Shape[] {
  const bump = radius * Math.sin(Math.PI / bumps) * 1.18;
  return [
    ...Array.from({ length: bumps }, (_, index) => {
      const angle = (index / bumps) * Math.PI * 2;
      return disc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, bump, fill);
    }),
    disc(cx, cy, radius, fill),
  ];
}

/** A band along the bottom whose upper edge is scalloped. */
function scallops(y: number, count: number, fill: Color): Shape[] {
  const r = 28 / count / 2;
  return [
    { t: 'rect', x: -0.2, y, w: 28.4, h: 16 - y, fill },
    ...Array.from({ length: count }, (_, index) => disc(r + index * r * 2, y, r, fill)),
  ];
}

/** A band down the right edge whose left edge is scalloped. */
function scallopsRight(x: number, count: number, fill: Color): Shape[] {
  const r = 15.75 / count / 2;
  return [
    { t: 'rect', x, y: -0.2, w: 28.2 - x, h: 16.15, fill },
    ...Array.from({ length: count }, (_, index) => disc(x, r + index * r * 2, r, fill)),
  ];
}

const pill = (x: number, y: number, w: number, h: number, fill: Color, shadow = false): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  r: h / 2,
  fill,
  ...(shadow ? { shadow: soft } : {}),
});

const card = (x: number, y: number, w: number, h: number, r = 1.3): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  r,
  fill: white,
  shadow: soft,
});

/** An opening quotation mark as two sugar commas. */
const quote = (x: number, y: number, s: number, fill: Color): Shape[] =>
  [0, s * 2.5].flatMap((dx): Shape[] => [
    disc(x + dx, y, s, fill),
    {
      t: 'path',
      x: 0,
      y: 0,
      w: 28,
      h: 15.75,
      vb: [2800, 1575],
      fill,
      d: `M${(x + dx - s) * 100} ${(y - s * 0.1) * 100} Q${(x + dx - s * 1.05) * 100} ${(y - s * 1.9) * 100} ${(x + dx + s * 0.95) * 100} ${(y - s * 2.5) * 100} Q${(x + dx + s * 0.05) * 100} ${(y - s * 1.6) * 100} ${(x + dx + s * 0.6) * 100} ${(y - s * 0.7) * 100} Z`,
    },
  ]);

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: peach,
    shapes: [
      disc(23.6, 3.4, 7.6, lilac),
      disc(26.6, 12.2, 4.2, lemon),
      ...scallops(13.5, 14, mint),
      ...sprinkles(11, { x: 15.6, y: 0.8, w: 11.6, h: 11 }, 30),
      sweet('pink', 21.2, 7.2, 4.6),
      sweet('blue', 25.1, 10.6, 2.6),
      sweet('sun', 17.4, 10.4, 1.9),
      sweet('mint', 18.1, 3.2, 1.5),
      pill(1.8, 9.9, 11.4, 1.75, white, true),
    ],
    title: {
      x: 1.8,
      y: 2.4,
      w: 14,
      h: 6.9,
      size: 62,
      sample: 'Süße\nAussichten',
    },
    subtitle: {
      x: 2.6,
      y: 9.9,
      w: 9.8,
      h: 1.75,
      valign: 'middle',
      sample: 'Ein Vortrag zum Vernaschen',
    },
  },
  {
    name: 'Abschnitt',
    bg: mint,
    shapes: [
      disc(1.4, 1.6, 3.4, lilac),
      disc(27, 14.2, 4, peach),
      ...sprinkles(23, { x: 0.8, y: 5.6, w: 5, h: 9.4 }, 12),
      ...sprinkles(29, { x: 22.4, y: 0.8, w: 4.8, h: 9 }, 12),
      ...biscuit(14, 7.6, 6.1, 12, white),
      sweet('sun', 5.4, 12.2, 2.8),
      sweet('pink', 23.2, 3.4, 3.2),
      sweet('violet', 21.4, 12.6, 1.6),
    ],
    title: {
      x: 8.6,
      y: 3.6,
      w: 10.8,
      h: 5.6,
      valign: 'bottom',
      align: 'center',
      size: 50,
      sample: 'Zweiter Gang',
    },
    subtitle: {
      x: 9.2,
      y: 9.6,
      w: 9.6,
      h: 2.4,
      align: 'center',
      color: berry,
      sample: 'Jetzt wird genascht',
    },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      ...scallopsRight(23.4, 8, lemon),
      ...sprinkles(31, { x: 24, y: 0.6, w: 3.6, h: 14.6 }, 12),
      sweet('pink', 25.9, 3.3, 2.5),
      sweet('mint', 25.3, 8.3, 1.8),
      sweet('blue', 26.1, 12.5, 2.7),
      pill(1.8, 3.75, 1.5, 0.34, candy[0]),
      pill(3.6, 3.75, 1.5, 0.34, candy[2]),
      pill(5.4, 3.75, 1.5, 0.34, candy[4]),
    ],
    title: { x: 1.8, y: 1.1, w: 19.6, h: 2.4, valign: 'middle', size: 38 },
    body: {
      x: 1.8,
      y: 4.7,
      w: 19.8,
      h: 9.6,
      sample: [
        'Erst das Auge, dann der Gaumen',
        'Fünf Sorten reichen für jede Laune',
        'Pastell beruhigt, Glanz macht Appetit',
        'Runde Formen wirken freundlich',
        'Zum Schluss bleibt ein süßer Rest',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: '#ebe2ff',
    shapes: [
      disc(27.2, 0.8, 4.6, peach),
      disc(13.2, 15.4, 3, mint),
      ...sprinkles(41, { x: 15.4, y: 14.2, w: 11.4, h: 1.1 }, 8),
      card(14.4, 1.7, 11.8, 11.8),
      sweet('sun', 14.5, 13.3, 2.5),
      sweet('pink', 26.3, 2.2, 1.7),
    ],
    title: { x: 1.8, y: 1.3, w: 11.4, h: 3.8, size: 34 },
    body: { x: 1.8, y: 5.6, w: 11.4, h: 8.6, size: 20 },
    pictures: [{ x: 15.1, y: 2.4, w: 10.4, h: 10.4 }],
  },
  {
    name: 'Zwei Spalten',
    bg: sky,
    shapes: [
      ...scallops(14.9, 20, white),
      ...sprinkles(53, { x: 19.6, y: 0.8, w: 7.2, h: 2.6 }, 9),
      pill(3, 3.95, 3.6, 1, candy[0]),
      pill(15.6, 3.95, 3.6, 1, candy[3]),
      card(1.8, 4.4, 11.8, 9.5),
      card(14.4, 4.4, 11.8, 9.5),
      sweet('violet', 25.7, 4.5, 2.1),
      sweet('mint', 13.4, 13.6, 1.5),
    ],
    title: { x: 1.8, y: 0.9, w: 17.4, h: 2.6, valign: 'middle', size: 36 },
    body: [
      { x: 2.6, y: 5.4, w: 10.4, h: 7.8, size: 18 },
      { x: 15.2, y: 5.4, w: 10.4, h: 7.8, size: 18 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: rose,
    shapes: [
      ...sprinkles(67, { x: 0.8, y: 0.8, w: 26.4, h: 14.2 }, 46, [
        { x: 2, y: 1.4, w: 13.2, h: 13 },
        { x: 16, y: 4.6, w: 10.4, h: 6.6 },
      ]),
      ...biscuit(8.6, 7.9, 5.3, 14, lemon),
      disc(8.6, 7.9, 4.5, '#fffbe0'),
      { t: 'rect', x: 15.9, y: 4.9, w: 10.4, h: 6, r: 2.2, fill: white, shadow: soft },
      sweet('blue', 16.2, 4.4, 2.3),
      sweet('mint', 13.4, 12.9, 1.8),
      sweet('violet', 25.4, 11.6, 1.5),
    ],
    title: {
      x: 4.2,
      y: 5,
      w: 8.8,
      h: 5.8,
      valign: 'middle',
      align: 'center',
      size: 92,
      color: berry,
      sample: '87 %',
    },
    body: {
      x: 17.3,
      y: 5.5,
      w: 7.8,
      h: 4.8,
      valign: 'middle',
      size: 22,
      sample: 'greifen zuerst zur rosa Sorte. Der Rest nimmt Zitrone.',
    },
  },
  {
    name: 'Zitat',
    bg: lemon,
    shapes: [
      ...scallops(13.1, 12, peach),
      ...sprinkles(71, { x: 0.6, y: 1, w: 2, h: 11 }, 6),
      ...sprinkles(73, { x: 25.4, y: 4.6, w: 2, h: 7.4 }, 5),
      card(3, 1.5, 22, 9.9, 2.2),
      ...quote(5, 2.5, 0.72, candy[4]),
      pill(8.2, 10.55, 11.6, 1.7, mint, true),
      sweet('pink', 24.7, 2, 2.6),
      sweet('sun', 3.4, 11.2, 1.7),
    ],
    body: {
      x: 5,
      y: 3.1,
      w: 18,
      h: 7,
      valign: 'middle',
      align: 'center',
      font: 'Fredoka',
      size: 32,
      lineHeight: 118,
      sample: 'Ein gutes Bonbon erklärt sich nicht. Es zergeht einfach auf der Zunge.',
    },
    subtitle: {
      x: 8.8,
      y: 10.55,
      w: 10.4,
      h: 1.7,
      valign: 'middle',
      align: 'center',
      size: 18,
      sample: 'Lotte Zucker, Konditorin',
    },
  },
  {
    name: 'Bild',
    bg: mint,
    shapes: [
      disc(0.6, 14.6, 4.4, lilac),
      disc(27.6, 1.2, 3.8, peach),
      ...sprinkles(83, { x: 0.6, y: 12.4, w: 4.6, h: 2.8 }, 6),
      ...sprinkles(89, { x: 23, y: 12.6, w: 4.2, h: 2.6 }, 6),
      card(2.6, 0.9, 22.8, 11.3, 1.2),
      pill(6.4, 12.8, 15.2, 1.9, white, true),
      sweet('sun', 25.5, 11.9, 2.3),
      sweet('pink', 2.5, 1.3, 1.6),
    ],
    pictures: [{ x: 3.25, y: 1.55, w: 21.5, h: 10 }],
    title: {
      x: 7.2,
      y: 12.8,
      w: 13.6,
      h: 1.9,
      valign: 'middle',
      align: 'center',
      size: 26,
      sample: 'Frisch aus dem Glas',
    },
  },
  {
    name: 'Schluss',
    bg: lilac,
    shapes: [
      disc(4.6, 2.6, 6.2, peach),
      disc(24.4, 13.6, 6.6, mint),
      disc(25, 1.4, 3.4, lemon),
      disc(3, 14.4, 3.2, rose),
      ...sprinkles(97, { x: 0.8, y: 0.8, w: 26.4, h: 14.2 }, 40, [
        { x: 6.6, y: 0, w: 14.8, h: 15.75 },
      ]),
      ...biscuit(14, 7.6, 5.9, 12, white),
      sweet('pink', 21, 3.2, 2.8),
      sweet('blue', 6.6, 12, 3.2),
      sweet('sun', 22.4, 9.6, 1.6),
    ],
    title: {
      x: 8.8,
      y: 3.6,
      w: 10.4,
      h: 5,
      valign: 'bottom',
      align: 'center',
      size: 62,
      sample: 'Danke!',
    },
    subtitle: {
      x: 9.2,
      y: 8.9,
      w: 9.6,
      h: 2.6,
      align: 'center',
      color: berry,
      sample: 'Greift zu, es ist genug da',
    },
  },
];

const template: Template = {
  slug: 'bonbon',
  name: 'Bonbon',
  group: 'Farbenfroh',
  tags: ['Pastell', 'süß', 'verspielt', 'rund', 'freundlich', 'Kinder', 'Feier', 'Café'],
  description:
    'Pastell wie im Süßwarenladen: Minze, Pfirsich und Flieder, runde Formen, Streusel und glänzende Drops.',
  palette: {
    bg: cream,
    text: plum,
    bg2: lilac,
    text2: '#7a5a92',
    accents: [candy[0], candy[1], candy[2], candy[3], candy[4], candy[5]],
  },
  fonts: { head: 'Fredoka', body: 'Quicksand' },
  text: {
    title: { font: 'Fredoka', size: 60, color: plum, bold: true, lineHeight: 96 },
    subtitle: { font: 'Quicksand', size: 20, color: plum, bold: true },
    body: {
      font: 'Quicksand',
      size: 22,
      color: plum,
      bold: true,
      lineHeight: 120,
      paraSpace: 0.38,
    },
  },
  layouts,
};

export default template;
