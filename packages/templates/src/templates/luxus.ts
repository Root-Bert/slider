import { jpeg, noise, paint, type Paint } from '../art';
import type { Color, Fill, Layout, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page } from '../shapes';

/*
 * Luxus: black marble and gold leaf. Deep black grounds with a vein of gold running through
 * the stone or the sheen of dark silk, gold leaf laid on in one large piece per showpiece,
 * foil-thin rules, a light old-style serif and tiny, widely spaced capitals. Much is left empty.
 */

const black = '#0c0b0a';
const coal = '#1c1916';
const cream = '#f2e9d6';
const sand = '#b5a688';
const gold = '#c9a45c';
const pale = '#ecd9a0';
const bronze = '#8c6a3a';
const blush = '#d9b9a8';
const wine = '#6a2230';
const pine = '#24493f';

const PXL = 1600 / PAGE.w;

type Tone = (u: number, v: number) => number;

/** Fills a canvas pixel by pixel: `at` gives red, green, blue (0 … 255) for a place. */
function fillPixels(
  surface: Paint,
  at: (x: number, y: number, out: [number, number, number]) => void,
) {
  const { ctx, w, h } = surface;
  const image = ctx.createImageData(w, h);
  const out: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      at(x, y, out);
      const i = (y * w + x) * 4;
      image.data[i] = out[0];
      image.data[i + 1] = out[1];
      image.data[i + 2] = out[2];
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

const ridge = (n: number, sharp: number) => Math.pow(1 - Math.abs(2 * n - 1), sharp);

/** Black marble: veins of gold and grey where `where` lets them, soft clouds in the stone. */
function marble(seed: number, where: Tone): Paint {
  const surface = paint(PAGE, PXL);
  const { w, h } = surface;
  const [warpX, warpY, main, fine, cloud] = [
    noise(seed),
    noise(seed + 1),
    noise(seed + 2),
    noise(seed + 3),
    noise(seed + 4),
  ];
  fillPixels(surface, (x, y, out) => {
    const wx = x + (warpX(x / 260, y / 260, 3) - 0.5) * 420;
    const wy = y + (warpY(x / 260, y / 260, 3) - 0.5) * 420;
    const mask = Math.min(1, Math.max(0, where(x / w, y / h)));
    const veinMain = main(wx / 520, wy / 520, 5);
    const thick = ridge(veinMain, 90) * 0.85 + ridge(veinMain, 16) * 0.16;
    const thin = ridge(fine(wx / 210 + 9, wy / 210, 4), 110);
    const fog = Math.max(0, cloud(wx / 380, wy / 380, 4) - 0.45);
    const goldLight = (thick * 0.95 + thin * 0.35) * mask;
    const grey = (fog * 0.22 + thin * 0.12) * (0.35 + mask * 0.65);
    out[0] = 12 + goldLight * 225 + grey * 120;
    out[1] = 11 + goldLight * 178 + grey * 112;
    out[2] = 10 + goldLight * 92 + grey * 104;
  });
  return surface;
}

/** Dark silk: broad folds that catch a little light. */
function silk(seed: number): Paint {
  const surface = paint(PAGE, PXL);
  const [bend, cloud] = [noise(seed), noise(seed + 1)];
  const { w, h } = surface;
  fillPixels(surface, (x, y, out) => {
    const fold = Math.sin((x * 0.55 + y) / 150 + bend(x / 420, y / 420, 3) * 7);
    const far = Math.hypot(x / w - 0.5, y / h - 0.5);
    const light =
      Math.pow(Math.max(0, fold), 3) * 0.075 + cloud(x / 300, y / 300, 3) * 0.03 - far * 0.03;
    out[0] = 13 + light * 255;
    out[1] = 12 + light * 232;
    out[2] = 11 + light * 196;
  });
  return surface;
}

/** Gold leaf laid inside a path: crinkled, with creases and a slow sheen. */
function leaf(surface: Paint, seed: number, path: (ctx: Paint['ctx'], px: number) => void) {
  const sheet = paint(PAGE, PXL);
  const [body, facet, crease] = [noise(seed), noise(seed + 1), noise(seed + 2)];
  const stops: readonly [number, readonly [number, number, number]][] = [
    [0, [96, 68, 24]],
    [0.35, [176, 132, 54]],
    [0.62, [224, 190, 108]],
    [0.85, [246, 228, 168]],
    [1, [255, 248, 216]],
  ];
  fillPixels(sheet, (x, y, out) => {
    const sheen = Math.sin((x * 0.8 + y) / 330 + 0.6) * 0.16;
    const light = Math.min(
      1,
      Math.max(
        0,
        0.2 +
          body(x / 110, y / 110, 4) * 0.55 +
          (facet(x / 9, y / 9, 2) - 0.5) * 0.2 +
          ridge(crease(x / 70, y / 70, 3), 14) * 0.3 +
          sheen,
      ),
    );
    let i = 1;
    while (i < stops.length - 1 && stops[i]![0] < light) i += 1;
    const [a, b] = [stops[i - 1]!, stops[i]!];
    const t = (light - a[0]) / (b[0] - a[0]);
    out[0] = a[1][0] + (b[1][0] - a[1][0]) * t;
    out[1] = a[1][1] + (b[1][1] - a[1][1]) * t;
    out[2] = a[1][2] + (b[1][2] - a[1][2]) * t;
  });
  const { ctx, px } = surface;
  ctx.save();
  ctx.beginPath();
  path(ctx, px);
  ctx.clip();
  ctx.drawImage(sheet.canvas, 0, 0);
  ctx.restore();
}

const smooth = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

const image = (surface: Paint, rotate?: number): Shape => ({
  t: 'image',
  ...page,
  src: jpeg(surface, 80),
  rotate,
});

// Veins to the right and above, the left calm for the words.
const stone = marble(11, (u, v) => smooth(0.38, 0.85, u + (0.5 - v) * 0.25));
const stoneGround = image(stone);
const stoneTurned = image(stone, 180);
const silkPaint = silk(21);
const silkGround = image(silkPaint);
const silkTurned = image(silkPaint, 180);

// A slab of gold leaf standing in faintly veined stone.
const slab = marble(31, (u) => 0.3 + smooth(0.5, 1, u) * 0.4);
leaf(slab, 41, (ctx, px) => ctx.rect(19.2 * px, 2.2 * px, 5.6 * px, 11.35 * px));
const slabGround = image(slab);

// A disc of gold leaf on silk.
const coin = silk(22);
leaf(coin, 42, (ctx, px) => ctx.arc(14 * px, 6.5 * px, 4.55 * px, 0, Math.PI * 2));
const coinGround = image(coin);

// Veins round the rim, the middle left dark.
const rim = marble(51, (u, v) => smooth(0.34, 0.6, Math.hypot((u - 0.5) * 1.05, v - 0.5)) * 0.8);
const rimGround = image(rim);

const foil: Fill = {
  t: 'linear',
  angle: 90,
  stops: [
    [0, '#8f6b2e'],
    [0.3, '#ecd591'],
    [0.55, '#b88f48'],
    [0.8, '#f5e6b4'],
    [1, '#9a7435'],
  ],
};

/** A foil-thin rule, horizontal or vertical. */
const bar = (x: number, y: number, length: number, thick = 0.06, vertical = false): Shape => ({
  t: 'rect',
  x,
  y,
  w: vertical ? thick : length,
  h: vertical ? length : thick,
  fill: vertical ? { ...foil, angle: 180 } : foil,
});

const hair = (x1: number, y1: number, x2: number, y2: number, opacity = 0.75): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: { color: gold, width: 0.025, opacity },
});

/** The house mark: a small lozenge, a smaller one filled inside. */
const lozenge = (cx: number, cy: number, r = 0.34): Shape[] => [
  {
    t: 'poly',
    fill: null,
    stroke: { color: gold, width: 0.03 },
    pts: [
      [cx, cy - r],
      [cx + r * 0.72, cy],
      [cx, cy + r],
      [cx - r * 0.72, cy],
    ],
  },
  {
    t: 'poly',
    fill: pale,
    pts: [
      [cx, cy - r * 0.38],
      [cx + r * 0.27, cy],
      [cx, cy + r * 0.38],
      [cx - r * 0.27, cy],
    ],
  },
];

const caps = {
  font: 'Montserrat',
  upper: true,
  spacing: 4.5,
  size: 13.5,
  color: gold,
  bold: false,
} as const;
const ring = (
  cx: number,
  cy: number,
  r: number,
  width: number,
  color: Color = gold,
  opacity = 1,
): Shape => ({
  t: 'ellipse',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  fill: null,
  stroke: { color, width, opacity },
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: black,
    shapes: [
      stoneGround,
      hair(1.4, 0, 1.4, 15.75, 0.5),
      ...lozenge(2.76, 2.4),
      bar(2.5, 10.75, 3.4),
    ],
    title: { x: 2.4, y: 3.6, w: 15.6, h: 6.6, size: 72, sample: 'Das Haus\nam See' },
    subtitle: { x: 2.5, y: 11.5, w: 15, h: 1.3, sample: 'Kollektion Herbst und Winter' },
  },
  {
    name: 'Abschnitt',
    bg: black,
    shapes: [
      slabGround,
      {
        t: 'rect',
        x: 18.9,
        y: 1.9,
        w: 6.2,
        h: 11.95,
        fill: null,
        stroke: { color: gold, width: 0.025, opacity: 0.8 },
      },
      hair(2.5, 9.55, 18.9, 9.55, 0.55),
      ...lozenge(2.76, 2.4),
    ],
    title: {
      x: 2.4,
      y: 3.6,
      w: 15.4,
      h: 5.5,
      size: 66,
      italic: true,
      sample: 'Stein, Holz,\nMessing',
    },
    subtitle: { x: 2.5, y: 10.2, w: 15, h: 1.3, sample: 'Zweites Kapitel' },
  },
  {
    name: 'Inhalt',
    bg: black,
    shapes: [
      silkGround,
      bar(2.5, 1.55, 1.5),
      hair(2.5, 3.95, 25.5, 3.95, 0.45),
      ...lozenge(25.16, 13.6, 0.3),
    ],
    title: {
      x: 2.4,
      y: 1.8,
      w: 21,
      h: 1.9,
      valign: 'middle',
      size: 40,
      sample: 'Woran man das Haus erkennt',
    },
    body: {
      x: 2.5,
      y: 4.8,
      w: 19.5,
      h: 9.4,
      sample: [
        'Naturstein aus einem einzigen Bruch',
        'Beschläge aus massivem Messing',
        'Leinen, das mit den Jahren weicher wird',
        'Licht, das man nicht sieht',
        'Ruhe in jedem Raum',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: black,
    shapes: [
      silkTurned,
      bar(11.5, 0, 15.75, 0.07, true),
      bar(13.7, 1.55, 1.5),
      hair(13.7, 3.95, 25.5, 3.95, 0.45),
    ],
    title: { x: 13.6, y: 1.8, w: 12, h: 1.9, valign: 'middle', size: 40, sample: 'Die Suite' },
    body: {
      x: 13.7,
      y: 4.8,
      w: 11.8,
      h: 9.4,
      sample: [
        'Achtzig Quadratmeter über dem Wasser',
        'Kamin und eigene Terrasse',
        'Frühstück, wann Sie mögen',
      ],
    },
    pictures: [{ x: 0, y: 0, w: 11.5, h: 15.75 }],
  },
  {
    name: 'Zwei Spalten',
    bg: black,
    shapes: [
      silkGround,
      bar(13.25, 1.4, 1.5),
      hair(14, 5.1, 14, 8.75, 0.6),
      hair(14, 9.85, 14, 13.9, 0.6),
      ...lozenge(14, 9.3, 0.32),
      hair(2.5, 4.6, 12.3, 4.6, 0.45),
      hair(15.7, 4.6, 25.5, 4.6, 0.45),
    ],
    title: {
      x: 3,
      y: 1.7,
      w: 22,
      h: 1.9,
      valign: 'middle',
      align: 'center',
      size: 40,
      sample: 'Sommer und Winter',
    },
    body: [
      {
        x: 2.5,
        y: 5.4,
        w: 9.9,
        h: 8.6,
        sample: ['Bootssteg und Badehaus', 'Abendessen im Garten', 'Fenster, die offen stehen'],
      },
      {
        x: 15.7,
        y: 5.4,
        w: 9.9,
        h: 8.6,
        sample: ['Sauna mit Blick aufs Eis', 'Feuer in der Bibliothek', 'Decken aus Kaschmir'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: black,
    shapes: [
      coinGround,
      ring(14, 6.5, 4.95, 0.03),
      ring(14, 6.5, 5.3, 0.02, gold, 0.5),
      hair(2.5, 6.5, 8.1, 6.5, 0.5),
      hair(19.9, 6.5, 25.5, 6.5, 0.5),
    ],
    title: {
      x: 9.7,
      y: 3.6,
      w: 8.6,
      h: 5.8,
      valign: 'middle',
      align: 'center',
      size: 96,
      bold: true,
      color: '#1a140a',
      sample: '1898',
    },
    body: {
      x: 3.5,
      y: 12.2,
      w: 21,
      h: 2.4,
      align: 'center',
      italic: true,
      size: 23,
      sample: 'Seit diesem Jahr entsteht jedes Stück in einer einzigen Werkstatt.',
    },
  },
  {
    name: 'Zitat',
    bg: black,
    shapes: [
      rimGround,
      {
        t: 'text',
        x: 12,
        y: 1.5,
        w: 4,
        h: 3,
        text: '“',
        font: 'Cormorant Garamond',
        size: 120,
        color: gold,
        align: 'center',
      },
      bar(13, 10.75, 2),
    ],
    body: {
      x: 5.2,
      y: 4.2,
      w: 17.6,
      h: 6,
      valign: 'middle',
      align: 'center',
      italic: true,
      size: 36,
      lineHeight: 112,
      sample: '„Luxus ist, was bleibt, wenn man alles Laute weggelassen hat.“',
    },
    subtitle: { x: 6, y: 11.4, w: 16, h: 1.3, align: 'center', sample: 'Helene Aurin, Gründerin' },
  },
  {
    name: 'Bild',
    bg: black,
    shapes: [
      silkTurned,
      {
        t: 'rect',
        x: 2.25,
        y: 1.25,
        w: 23.5,
        h: 11.1,
        fill: null,
        stroke: { color: gold, width: 0.025, opacity: 0.8 },
      },
      hair(2.25, 13.65, 7.4, 13.65, 0.5),
      hair(20.6, 13.65, 25.75, 13.65, 0.5),
    ],
    pictures: [{ x: 2.5, y: 1.5, w: 23, h: 10.6 }],
    title: {
      x: 7.8,
      y: 12.8,
      w: 12.4,
      h: 1.7,
      valign: 'middle',
      align: 'center',
      italic: true,
      size: 26,
      sample: 'Die Bibliothek am Abend',
    },
  },
  {
    name: 'Schluss',
    bg: black,
    shapes: [
      stoneTurned,
      hair(26.6, 0, 26.6, 15.75, 0.5),
      ...lozenge(25.24, 13.35),
      bar(22.1, 9.05, 3.4),
    ],
    title: {
      x: 10,
      y: 3.4,
      w: 15.6,
      h: 5.2,
      align: 'right',
      italic: true,
      size: 72,
      sample: 'Seien Sie\nunser Gast',
    },
    subtitle: {
      x: 10.5,
      y: 9.8,
      w: 15,
      h: 1.3,
      align: 'right',
      sample: 'Wir freuen uns auf Ihre Fragen',
    },
  },
];

const template: Template = {
  slug: 'luxus',
  name: 'Luxus',
  group: 'Bereich',
  tags: ['Luxus', 'Gold', 'Schwarz', 'Marmor', 'edel', 'Hotel', 'Schmuck', 'Mode', 'Premium'],
  description:
    'Schwarzer Marmor und Blattgold: tiefe dunkle Flächen mit goldener Ader, hauchdünne Linien, feine Serifenschrift und viel Raum.',
  palette: {
    bg: black,
    text: cream,
    bg2: coal,
    text2: sand,
    accents: [gold, pale, bronze, blush, wine, pine],
  },
  fonts: { head: 'Cormorant Garamond', body: 'Cormorant Garamond' },
  text: {
    title: { font: 'Cormorant Garamond', size: 64, color: cream, lineHeight: 100 },
    subtitle: { ...caps },
    body: { font: 'Cormorant Garamond', size: 25, color: cream, lineHeight: 120, paraSpace: 0.34 },
  },
  layouts,
};

export default template;
