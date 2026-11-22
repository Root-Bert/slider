import { grain, jpeg, noise, paint, png, rgb } from '../art';
import type { Box, Color, Layout, Picture, Shape, Template } from '../model';
import { page } from '../shapes';

/*
 * Aurora: a night sky over a tech keynote – curtains of violet, teal and magenta light on near
 * black, grainy as a long exposure; thin white type, hairlines, small glowing points.
 */

const night = '#070814';
const white = '#f5f7ff';
const mist = '#aab2d8';
const violet = '#8b6cff';
const teal = '#2fe6c8';
const magenta = '#ff4fa8';
const blue = '#4f8cff';
const mint = '#a4ffc9';
const amber = '#ffc978';

const SCALE = 0.62;

interface Ribbon {
  /** Where its lower edge runs (0 … 1 down the page) and how it swings. */
  y: number;
  swing: number;
  waves: number;
  phase: number;
  /** How far the light reaches up. */
  reach: number;
  color: Color;
  power: number;
  /** Where along the page it shines: centre and width (0 … 1). */
  at: number;
  wide: number;
  /** Leaning of its rays. */
  lean?: number;
}

/** Light added pixel by pixel on the night ground, then grain. */
function sky(
  light: (u: number, v: number, add: (color: Color, amount: number) => void) => void,
  seed: number,
): Picture {
  const surface = paint(page, (1920 / 28) * SCALE);
  const { ctx, w, h } = surface;
  const image = ctx.createImageData(w, h);
  const [br, bg, bb] = rgb(night);
  const cache = new Map<Color, [number, number, number]>();
  let [r, g, b] = [0, 0, 0];
  const add = (color: Color, amount: number) => {
    let c = cache.get(color);
    if (!c) cache.set(color, (c = rgb(color)));
    r += c[0] * amount;
    g += c[1] * amount;
    b += c[2] * amount;
  };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      [r, g, b] = [br, bg, bb];
      light(x / w, y / h, add);
      const i = (y * w + x) * 4;
      // Bright light burns out softly.
      image.data[i] = 255 * (1 - Math.exp(-r / 210));
      image.data[i + 1] = 255 * (1 - Math.exp(-g / 210));
      image.data[i + 2] = 255 * (1 - Math.exp(-b / 210));
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  grain(surface, 0.075, seed);
  return jpeg(surface, 80);
}

/** Curtains of light. */
function curtains(ribbons: readonly Ribbon[], seed: number): Picture {
  const field = noise(seed);
  return sky((u, v, add) => {
    ribbons.forEach((ribbon, k) => {
      const lean = u + (ribbon.lean ?? 0.25) * (v - 0.5);
      const edge =
        ribbon.y +
        ribbon.swing * Math.sin((ribbon.waves * lean + ribbon.phase) * Math.PI * 2) +
        (field(lean * 3 + k * 7, k * 3, 2) - 0.5) * 0.16;
      const up = edge - v;
      const fall = up > 0 ? Math.exp(-up / ribbon.reach) : Math.exp(up / (ribbon.reach * 0.1));
      const rays = 0.35 + 0.65 * field(lean * 46 + k * 11, v * 1.3 + k, 3) ** 1.5 * 1.7;
      const window = Math.exp(-(((u - ribbon.at) / ribbon.wide) ** 2));
      add(ribbon.color, fall * rays * window * ribbon.power);
    });
  }, seed + 1);
}

/** A dark world's rim, lit from behind. */
function horizon(seed: number): Picture {
  const field = noise(seed);
  const aspect = 28 / 15.75;
  return sky((u, v, add) => {
    const [dx, dy] = [(u - 0.5) * aspect, v - 2.02];
    const d = Math.hypot(dx, dy) - 1.42;
    const hue = u + (field(u * 2.2, v * 2.2, 3) - 0.5) * 0.5;
    const rays = 0.55 + 0.45 * field(Math.atan2(dx, -dy) * 30, d * 3, 3);
    const out = d > 0 ? Math.exp(-d / 0.16) * rays : Math.exp(d / 0.012);
    const mid = Math.exp(-(((u - 0.5) / 0.42) ** 2));
    add(teal, out * mid * 1.5 * Math.max(0, 1 - Math.abs(hue - 0.3) * 2.6));
    add(violet, out * mid * 1.7 * Math.max(0, 1 - Math.abs(hue - 0.55) * 2.4));
    add(magenta, out * mid * 1.5 * Math.max(0, 1 - Math.abs(hue - 0.8) * 2.6));
    // The rim itself.
    add('#ffffff', Math.exp(-Math.abs(d) / 0.004) * mid * 1.4);
    if (d < 0) add(violet, Math.exp(d / 0.09) * 0.16 * mid);
  }, seed + 1);
}

/** A point of light with its halo. */
function glow(core: Color, halo: Color): Picture {
  const surface = paint({ w: 2, h: 2 }, 64);
  const { ctx, w } = surface;
  const [hr, hg, hb] = rgb(halo);
  const gradient = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gradient.addColorStop(0, core);
  gradient.addColorStop(0.1, core);
  gradient.addColorStop(0.2, `rgba(${hr},${hg},${hb},0.6)`);
  gradient.addColorStop(0.5, `rgba(${hr},${hg},${hb},0.16)`);
  gradient.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, w);
  return png(surface);
}

const skyA = curtains(
  [
    {
      y: 0.62,
      swing: 0.1,
      waves: 0.9,
      phase: 0.1,
      reach: 0.36,
      color: violet,
      power: 1.5,
      at: 0.86,
      wide: 0.34,
    },
    {
      y: 0.8,
      swing: 0.08,
      waves: 1.3,
      phase: 0.45,
      reach: 0.3,
      color: teal,
      power: 1.35,
      at: 0.76,
      wide: 0.2,
    },
    {
      y: 0.42,
      swing: 0.07,
      waves: 1.1,
      phase: 0.8,
      reach: 0.22,
      color: magenta,
      power: 1.15,
      at: 1.0,
      wide: 0.22,
    },
  ],
  21,
);
const skyB = curtains(
  [
    {
      y: 1.08,
      swing: 0.04,
      waves: 1.2,
      phase: 0.2,
      reach: 0.13,
      color: teal,
      power: 1.1,
      at: 0.25,
      wide: 0.5,
    },
    {
      y: 1.1,
      swing: 0.04,
      waves: 0.8,
      phase: 0.6,
      reach: 0.15,
      color: violet,
      power: 1.3,
      at: 0.75,
      wide: 0.45,
    },
    {
      y: 0.2,
      swing: 0.05,
      waves: 0.7,
      phase: 0.3,
      reach: 0.2,
      color: magenta,
      power: 0.55,
      at: 1.02,
      wide: 0.16,
    },
  ],
  34,
);
const skyC = horizon(55);
const skyD = curtains(
  [
    {
      y: 0.92,
      swing: 0.1,
      waves: 0.8,
      phase: 0.05,
      reach: 0.5,
      color: teal,
      power: 1.4,
      at: 0.1,
      wide: 0.2,
      lean: 0.4,
    },
    {
      y: 0.78,
      swing: 0.1,
      waves: 1.0,
      phase: 0.5,
      reach: 0.42,
      color: violet,
      power: 1.3,
      at: 0.24,
      wide: 0.17,
      lean: 0.4,
    },
    {
      y: 0.6,
      swing: 0.06,
      waves: 1.4,
      phase: 0.2,
      reach: 0.3,
      color: magenta,
      power: 0.9,
      at: 0.0,
      wide: 0.16,
      lean: 0.4,
    },
  ],
  72,
);

const spark = glow('#ffffff', teal);
const ember = glow('#ffffff', magenta);

const ground = (src: Picture, box: Box = page, rotate = 0): Shape => ({
  t: 'image',
  ...box,
  src,
  rotate,
});
const point = (cx: number, cy: number, size = 0.9, src = spark): Shape => ({
  t: 'image',
  x: cx - size / 2,
  y: cy - size / 2,
  w: size,
  h: size,
  src,
});
const hair = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opacity = 0.4,
  width = 0.03,
): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: { color: '#ffffff', width, opacity },
});
const frame = (box: Box, opacity = 0.35, r = 0): Shape => ({
  t: 'rect',
  ...box,
  r,
  fill: null,
  stroke: { color: '#ffffff', width: 0.03, opacity },
});
const glass = (box: Box, r = 0.5): Shape => ({
  t: 'rect',
  ...box,
  r,
  fill: { t: 'solid', color: '#0b0d22', opacity: 0.62 },
  stroke: { color: '#ffffff', width: 0.03, opacity: 0.3 },
});
const orbit = (cx: number, cy: number, r: number, opacity = 0.3): Shape => ({
  t: 'ellipse',
  x: cx - r,
  y: cy - r,
  w: 2 * r,
  h: 2 * r,
  fill: null,
  stroke: { color: '#ffffff', width: 0.03, opacity },
});
/** Corner marks of a page frame. */
const corners = (inset = 0.9, arm = 0.7, opacity = 0.55): Shape[] => {
  const [l, t, r, b] = [inset, inset, 28 - inset, 15.75 - inset];
  return [
    hair(l, t, l + arm, t, opacity),
    hair(l, t, l, t + arm, opacity),
    hair(r - arm, t, r, t, opacity),
    hair(r, t, r, t + arm, opacity),
    hair(l, b, l + arm, b, opacity),
    hair(l, b - arm, l, b, opacity),
    hair(r - arm, b, r, b, opacity),
    hair(r, b - arm, r, b, opacity),
  ];
};
/** A row of short ticks, as on a scale. */
const ticks = (x: number, y: number, count: number, step: number, opacity = 0.5): Shape[] =>
  Array.from({ length: count }, (_, index) =>
    hair(x + index * step, y, x + index * step, y + (index % 5 === 0 ? 0.42 : 0.22), opacity),
  );

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: night,
    shapes: [
      ground(skyA),
      ...corners(),
      ...ticks(2.4, 2.3, 21, 0.24),
      hair(2.4, 11.05, 15.4, 11.05, 0.5),
      point(2.4, 11.05, 1.1),
      orbit(21.6, 6.2, 3.3, 0.28),
      orbit(21.6, 6.2, 5.1, 0.16),
      point(24.9, 6.2, 0.9, ember),
      point(19.27, 3.87, 0.6),
    ],
    title: {
      x: 2.3,
      y: 3.6,
      w: 16.5,
      h: 6.9,
      valign: 'bottom',
      size: 60,
      sample: 'Licht in\nden Daten',
    },
    subtitle: { x: 2.4, y: 11.6, w: 14, h: 1.8, sample: 'Keynote zur Plattform, Ausgabe vier' },
  },
  {
    name: 'Abschnitt',
    bg: night,
    shapes: [
      ground(skyA, page, 180),
      ...corners(),
      {
        t: 'text',
        x: 14.0,
        y: 2.4,
        w: 4,
        h: 1.4,
        text: '02',
        font: 'Sora',
        size: 26,
        color: teal,
        valign: 'middle',
        nowrap: true,
      },
      hair(15.6, 3.1, 26.2, 3.1, 0.3),
      hair(13.2, 4.2, 13.2, 11.6, 0.45),
      point(13.2, 4.2, 1.0, ember),
      ...ticks(14.0, 12.9, 26, 0.24, 0.4),
    ],
    title: {
      x: 14.0,
      y: 4.2,
      w: 12.2,
      h: 4.9,
      valign: 'bottom',
      size: 46,
      sample: 'Was wir sehen',
    },
    subtitle: { x: 14.0, y: 9.5, w: 12.2, h: 2.2, sample: 'Signale aus dem ersten Halbjahr' },
  },
  {
    name: 'Inhalt',
    bg: night,
    shapes: [
      ground(skyB),
      hair(2.0, 3.9, 26.0, 3.9, 0.4),
      point(2.0, 3.9, 0.9),
      orbit(24.0, 9.3, 1.5, 0.3),
      orbit(24.0, 9.3, 2.6, 0.2),
      orbit(24.0, 9.3, 3.7, 0.12),
      point(24.0, 9.3, 0.8, ember),
      point(25.84, 7.46, 0.55),
      point(21.4, 9.3, 0.45),
    ],
    title: { x: 2.0, y: 1.2, w: 22, h: 2.4, valign: 'bottom', size: 34 },
    body: {
      x: 2.0,
      y: 4.7,
      w: 18.2,
      h: 9.4,
      sample: [
        'Ein Signal schlägt hundert Meinungen',
        'Was leuchtet, wird zuerst gelesen',
        'Dunkel ist Ruhe, kein Mangel',
        'Jede Folie trägt genau ein Licht',
        'Zahlen brauchen Raum um sich',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: night,
    shapes: [
      ground(skyB, { x: -14, y: -7.875, w: 42, h: 23.625 }),
      frame({ x: 15.2, y: 1.7, w: 11.4, h: 12.35 }, 0.4),
      point(15.2, 1.7, 0.9),
      point(26.6, 14.05, 0.7, ember),
      hair(2.0, 4.6, 5.2, 4.6, 0.5),
    ],
    pictures: [{ x: 15.55, y: 2.05, w: 10.7, h: 11.65 }],
    title: { x: 2.0, y: 1.3, w: 12, h: 3.0, valign: 'bottom', size: 30 },
    body: { x: 2.0, y: 5.3, w: 12, h: 8.8, size: 20 },
  },
  {
    name: 'Zwei Spalten',
    bg: night,
    shapes: [
      ground(skyB, page, 180),
      glass({ x: 2.0, y: 4.5, w: 11.6, h: 9.6 }),
      glass({ x: 14.4, y: 4.5, w: 11.6, h: 9.6 }),
      point(2.9, 4.5, 0.9),
      point(15.3, 4.5, 0.9, ember),
    ],
    title: { x: 2.0, y: 1.3, w: 24, h: 2.4, valign: 'bottom', size: 34 },
    body: [
      { x: 2.8, y: 5.4, w: 10.1, h: 8.0, size: 20 },
      { x: 15.2, y: 5.4, w: 10.1, h: 8.0, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: night,
    shapes: [
      ground(skyC),
      ...corners(),
      ...ticks(11.6, 1.6, 21, 0.24, 0.45),
      point(14, 9.22, 1.3),
      hair(12.4, 11.3, 15.6, 11.3, 0.4),
    ],
    title: {
      x: 3,
      y: 2.3,
      w: 22,
      h: 6.2,
      valign: 'middle',
      align: 'center',
      size: 150,
      spacing: -2,
      sample: '99,98 %',
    },
    body: {
      x: 7.5,
      y: 11.7,
      w: 13,
      h: 2.8,
      align: 'center',
      size: 20,
      color: mist,
      sample: 'Verfügbarkeit über zwölf Monate, gemessen an jedem Knoten.',
    },
  },
  {
    name: 'Zitat',
    bg: night,
    shapes: [
      ground(skyD),
      hair(10.6, 3.2, 10.6, 12.4, 0.45),
      point(10.6, 3.2, 1.0),
      {
        t: 'text',
        x: 11.4,
        y: 1.6,
        w: 4,
        h: 3.4,
        text: '“',
        font: 'Sora',
        size: 110,
        color: teal,
        valign: 'top',
        nowrap: true,
      },
      hair(11.6, 11.0, 13.6, 11.0, 0.5),
    ],
    body: {
      x: 11.6,
      y: 4.2,
      w: 14.4,
      h: 6.3,
      valign: 'bottom',
      font: 'Sora',
      size: 30,
      color: white,
      lineHeight: 122,
      sample: 'Wir bauen keine Werkzeuge für Daten. Wir bauen Fenster.',
    },
    subtitle: { x: 11.6, y: 11.4, w: 14.4, h: 1.6, sample: 'Ilka Brandt, Technikvorstand' },
  },
  {
    name: 'Bild',
    bg: night,
    shapes: [
      ground(skyB, { x: -7, y: -7.875, w: 42, h: 23.625 }),
      frame({ x: 1.6, y: 1.3, w: 24.8, h: 10.9 }, 0.4),
      point(1.6, 12.2, 0.9, ember),
      point(26.4, 1.3, 0.9),
      ...ticks(21.1, 13.25, 21, 0.24, 0.45),
    ],
    pictures: [{ x: 1.95, y: 1.65, w: 24.1, h: 10.2 }],
    title: {
      x: 1.9,
      y: 12.5,
      w: 18,
      h: 2.0,
      valign: 'middle',
      size: 26,
      sample: 'Die Nacht über dem Rechenzentrum',
    },
  },
  {
    name: 'Schluss',
    bg: night,
    shapes: [
      ground(skyC, page, 180),
      ...corners(),
      orbit(14, 9.4, 5.6, 0.14),
      point(14, 6.53, 1.3, ember),
      hair(12.4, 12.0, 15.6, 12.0, 0.45),
    ],
    title: {
      x: 4,
      y: 7.2,
      w: 20,
      h: 4.4,
      valign: 'middle',
      align: 'center',
      size: 72,
      sample: 'Danke',
    },
    subtitle: {
      x: 6,
      y: 12.4,
      w: 16,
      h: 1.8,
      align: 'center',
      sample: 'Fragen, solange das Licht an ist',
    },
  },
];

const template: Template = {
  slug: 'aurora',
  name: 'Aurora',
  group: 'Designtrend',
  tags: ['Aurora', 'Nordlicht', 'dunkel', 'Technik', 'Keynote', 'Verlauf', 'leuchtend', 'modern'],
  description:
    'Nachthimmel mit Polarlicht: leuchtende Schleier in Violett, Türkis und Magenta, feine weiße Schrift und Haarlinien.',
  palette: {
    bg: night,
    text: white,
    bg2: '#15183a',
    text2: mist,
    accents: [violet, teal, magenta, blue, mint, amber],
  },
  fonts: { head: 'Sora', body: 'Inter' },
  text: {
    title: { font: 'Sora', size: 44, color: white, lineHeight: 106, spacing: -0.5 },
    subtitle: { font: 'Inter', size: 20, color: mist },
    body: { font: 'Inter', size: 22, color: '#e7eaf8', lineHeight: 126, paraSpace: 0.3 },
  },
  layouts,
};

export default template;
