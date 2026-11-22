import { jpeg, noise, paint, rgb, rng, stencil } from '../art';
import type { Color, Layout, Picture, Shape, Template } from '../model';
import { disc, page } from '../shapes';

/*
 * Tusche: ink wash on rice paper – a few loaded brush strokes running dry, mountains dissolving
 * into mist, a brush circle, and one small red seal as the only colour. Most of the page stays
 * empty on purpose.
 */

const paperColor = '#f3eee2';
const ink = '#191817';
const soot = '#3b3936';
const stone = '#77736b';
const mist = '#aaa497';
const sand = '#e4dccb';
const seal = '#b3261a';
const night = '#1d1c1b';

type Size = { w: number; h: number };
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A one-colour picture from how much ink lies at each pixel (0 … 1). */
function inked(
  size: Size,
  px: number,
  color: Color,
  at: (x: number, y: number, w: number, h: number) => number,
  levels = 48,
): Picture {
  const surface = paint(size, px);
  const { ctx, w, h } = surface;
  const [r, g, b] = rgb(color);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255 * clamp(at(x, y, w, h));
    }
  }
  ctx.putImageData(image, 0, 0);
  return stencil(surface, color, levels);
}

/**
 * The ink a brush leaves at a place of its stroke: `s` pixels along it, `v` across it (−1 … 1),
 * `t` how far the stroke has come (0 … 1). Bristles draw long streaks; the brush runs dry.
 */
function bristles(seed: number, dry: number, px: number) {
  const field = noise(seed);
  return (s: number, v: number, t: number, half: number) => {
    const edge = 1 - Math.abs(v) + (field(s / (px * 0.5), v * 3 + 7, 2) - 0.5) * 0.3;
    if (edge <= 0) return 0;
    const hair = (v * half) / (px * 0.03);
    const streak = field(s / (px * 2.4), hair * 0.55 + 50, 3);
    const fine = field(s / (px * 0.5), hair * 1.6 + 90, 1);
    const load = streak * 0.75 + fine * 0.25 + 0.66 - dry * t ** 1.4 - Math.max(0, t - 0.9) * 3;
    const wet = t < 0.035 ? 1 : clamp((load - 0.5) * 7);
    const pool = 0.8 + 0.2 * field(s / (px * 1.5), v * 2 + 20, 2);
    return wet * clamp(edge * 7) * pool;
  };
}

/** A brush stroke from left to right, a little bent, fat where it sets down, dry where it lifts. */
function stroke(
  size: Size,
  seed: number,
  options: { dry?: number; alpha?: number; bend?: number; color?: Color } = {},
): Picture {
  const px = 64;
  const brush = bristles(seed, options.dry ?? 0.5, px);
  const field = noise(seed + 3);
  const [alpha, bend] = [options.alpha ?? 0.94, options.bend ?? 0.08];
  return inked(size, px, options.color ?? ink, (x, y, w, h) => {
    const t = x / w;
    const lead = clamp(t / 0.03) ** 0.5;
    const tail = 1 - clamp((t - 0.72) / 0.28) ** 2 * 0.55;
    const half = h * 0.36 * lead * tail * (0.88 + 0.24 * field(t * 3, 1.5, 2));
    const centre = h / 2 + Math.sin(t * Math.PI * 1.15 + 0.4) * bend * h;
    const v = (y - centre) / Math.max(1, half);
    if (Math.abs(v) > 1.2) return 0;
    return brush(x, v, t, half) * alpha;
  });
}

/** A circle drawn in one go, not quite closed. */
function circle(side: number, seed: number, color: Color = ink): Picture {
  const px = 56;
  const brush = bristles(seed, 0.62, px);
  const field = noise(seed + 5);
  return inked({ w: side, h: side }, px, color, (x, y, w) => {
    const [dx, dy] = [x - w / 2, y - w / 2];
    const radius = w * 0.385;
    // Set down at the lower left, drawn clockwise.
    let turn = Math.atan2(dy, dx) - Math.PI * 0.72;
    if (turn < 0) turn += Math.PI * 2;
    const t = turn / (Math.PI * 2 * 0.93);
    if (t > 1) return 0;
    const lead = clamp(t / 0.025) ** 0.5;
    const half = w * 0.058 * lead * (1.05 - 0.45 * t) * (0.85 + 0.3 * field(t * 4, 2.5, 2));
    const wander = (field(t * 2.2, 9.5, 2) - 0.5) * w * 0.035;
    const v = (Math.hypot(dx, dy) - radius - wander) / Math.max(1, half);
    if (Math.abs(v) > 1.2) return 0;
    return brush(turn * radius, v, t, half) * 0.95;
  });
}

/** Ridges one behind the other, each darkest at its crest and lost in mist below. */
function ridges(seed: number) {
  const field = noise(seed);
  const layers = [
    { base: 0.42, height: 0.36, ink: 0.16, wave: 1.3, depth: 0.2 },
    { base: 0.56, height: 0.34, ink: 0.3, wave: 1.9, depth: 0.17 },
    { base: 0.72, height: 0.3, ink: 0.52, wave: 2.6, depth: 0.15 },
    { base: 0.9, height: 0.26, ink: 0.86, wave: 3.4, depth: 0.16 },
  ];
  return (w: number, h: number) => {
    const crests = layers.map((layer, index) =>
      Float32Array.from({ length: w }, (_, x) => {
        const u = x / w;
        const rough = field(u * layer.wave + index * 11, index * 5.3, 5);
        const peaks = 1 - Math.abs(2 * field(u * layer.wave * 0.8 + index * 3, 40 + index, 3) - 1);
        // Higher towards the right, where the range stands.
        const rise = 0.3 + 0.7 * clamp((u - 0.15) / 0.6) ** 1.2 - 0.25 * clamp((u - 0.86) / 0.14);
        return h * (layer.base - (rough * 0.6 + peaks * 0.5) * layer.height * rise);
      }),
    );
    return (x: number, y: number) => {
      let clear = 1;
      for (const [index, layer] of layers.entries()) {
        const below = y - crests[index]![x]!;
        if (below < 0) continue;
        const stain = 0.72 + 0.56 * field(x / 70 + index * 9, y / 45, 3);
        const amount =
          layer.ink * Math.exp(-below / (h * layer.depth)) * stain * clamp(below / 1.5 + 0.2);
        clear *= 1 - clamp(amount);
      }
      return 1 - clear;
    };
  };
}

function mountains(size: Size, seed: number): Picture {
  const px = 44;
  const [w, h] = [Math.round(size.w * px), Math.round(size.h * px)];
  const at = ridges(seed)(w, h);
  return inked(size, px, ink, (x, y) => at(x, y), 40);
}

/** A stain of thinned ink with a soft, uneven rim. */
function stain(size: Size, seed: number, alpha: number, color: Color = soot, ragged = 0.5) {
  const field = noise(seed);
  return inked(
    size,
    40,
    color,
    (x, y, w, h) => {
      const [u, v] = [(x / w) * 2 - 1, (y / h) * 2 - 1];
      const rim = 1 - Math.hypot(u, v) - (field(x / 60, y / 60, 4) - 0.5) * ragged;
      const pool = 0.6 + 0.5 * field(x / 130 + 9, y / 130 + 9, 3) + (rim < 0.1 ? 0.2 : 0);
      return clamp(rim * 6) * Math.min(1, pool) * alpha;
    },
    32,
  );
}

/** The seal: a small stamped square, worn at its rim, with a carved frame – no sign in it. */
function stamp(): Picture {
  const field = noise(77);
  return inked(
    { w: 1, h: 1 },
    150,
    seal,
    (x, y, w, h) => {
      const [u, v] = [x / w - 0.5, y / h - 0.5];
      const out = Math.max(Math.abs(u), Math.abs(v));
      const worn = field(x / 9, y / 9, 3);
      const rim = 0.47 - out - (worn - 0.5) * 0.06;
      if (rim <= 0) return 0;
      const frame = Math.abs(out - 0.36) < 0.016 && field(x / 22, y / 22 + 5, 2) > 0.3;
      if (frame) return 0;
      return clamp(rim * 60) * (worn > 0.27 ? 0.96 : 0.35);
    },
    16,
  );
}

/** The ground: paper with clouds, short fibres and a little grain. */
function ground(color: Color, seed: number, fibres: number, light: boolean): Picture {
  const surface = paint(page, 46);
  const { ctx, w, h } = surface;
  const field = noise(seed);
  const random = rng(seed + 1);
  const [r, g, b] = rgb(color);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const shade =
        1 + (field(x / 210, y / 210, 4) - 0.5) * (light ? 0.07 : 0.3) + (random() - 0.5) * 0.025;
      const i = (y * w + x) * 4;
      image.data[i] = r * shade;
      image.data[i + 1] = g * shade;
      image.data[i + 2] = b * shade;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  ctx.lineCap = 'round';
  for (let i = 0; i < fibres; i += 1) {
    const [x, y, angle] = [random() * w, random() * h, random() * Math.PI];
    const length = random.range(8, 34);
    ctx.strokeStyle = light
      ? random() < 0.5
        ? 'rgba(255,255,255,0.5)'
        : 'rgba(120,105,80,0.13)'
      : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = random.range(0.5, 1.1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * length * 0.5 + random.bell() * 5,
      y + Math.sin(angle) * length * 0.5 + random.bell() * 5,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
    );
    ctx.stroke();
  }
  return jpeg(surface, 80);
}

/** A stand-in picture for the preview: the mountains on paper. */
function landscape(size: Size, seed: number): Picture {
  const surface = paint(size, 60);
  const { ctx, w, h } = surface;
  const at = ridges(seed)(w, h);
  const [r, g, b] = rgb('#ebe5d6');
  const [ir, ig, ib] = rgb(ink);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = at(x, y);
      const i = (y * w + x) * 4;
      image.data[i] = r + (ir - r) * a;
      image.data[i + 1] = g + (ig - g) * a;
      image.data[i + 2] = b + (ib - b) * a;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  ctx.fillStyle = 'rgba(60,58,54,0.22)';
  ctx.beginPath();
  ctx.arc(w * 0.3, h * 0.24, Math.min(w, h) * 0.09, 0, Math.PI * 2);
  ctx.fill();
  return jpeg(surface, 82);
}

const PAPER = ground(paperColor, 21, 900, true);
const NIGHT = ground(night, 33, 500, false);
const RANGE = mountains({ w: 29, h: 9.6 }, 5);
const LONG = stroke({ w: 22, h: 3 }, 8, { dry: 0.62 });
const SHORT = stroke({ w: 7, h: 0.6 }, 14, { dry: 0.45, bend: 0.05 });
const UPRIGHT = stroke({ w: 8.4, h: 0.7 }, 19, { dry: 0.6, bend: 0.06 });
const BROAD = stroke({ w: 28.6, h: 4.2 }, 27, { dry: 0.35, alpha: 0.5, bend: 0.05, color: soot });
const PALE = stroke({ w: 12, h: 0.8 }, 31, { dry: 0.55, alpha: 0.75, color: paperColor });
const CIRCLE = circle(13, 4);
const MOON = stain({ w: 4.4, h: 4.4 }, 12, 0.22, soot, 0.12);
const MOON_LIGHT = stain({ w: 11, h: 11 }, 16, 0.2, paperColor, 0.1);
const BLEED = stain({ w: 8, h: 9 }, 23, 0.2, soot, 0.6);
const SEAL = stamp();

const paper: Shape = { t: 'image', ...page, src: PAPER };
const sealAt = (x: number, y: number, side = 0.85, rotate = -2): Shape => ({
  t: 'image',
  x,
  y,
  w: side,
  h: side,
  src: SEAL,
  rotate,
});
/** Drops the brush lost on its way. */
const drops = (
  spots: readonly (readonly [number, number, number])[],
  color: Color = ink,
): Shape[] => spots.map(([x, y, radius]) => disc(x, y, radius, color));

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paperColor,
    shapes: [
      paper,
      { t: 'image', x: 19.6, y: 1.5, w: 4.4, h: 4.4, src: MOON },
      { t: 'image', x: -0.5, y: 6.5, w: 29, h: 9.6, src: RANGE },
      sealAt(2.35, 10.2),
    ],
    title: {
      x: 2.2,
      y: 2.4,
      w: 16.4,
      h: 4.8,
      valign: 'bottom',
      sample: 'Die Stille\nzwischen den Zeilen',
    },
    subtitle: { x: 2.2, y: 7.7, w: 14, h: 1.6, sample: 'Über das Weglassen als Handwerk' },
  },
  {
    name: 'Abschnitt',
    bg: paperColor,
    shapes: [
      paper,
      { t: 'image', x: 1.4, y: 8.3, w: 22, h: 3, src: LONG },
      ...drops([
        [24.3, 10.2, 0.09],
        [25.1, 9.7, 0.05],
        [24.8, 10.9, 0.04],
      ]),
      sealAt(24.6, 12.3),
    ],
    title: {
      x: 2.2,
      y: 3.2,
      w: 21,
      h: 4.8,
      valign: 'bottom',
      size: 48,
      sample: 'Zweiter Teil:\nDer leere Raum',
    },
    subtitle: { x: 2.2, y: 12.1, w: 18, h: 1.6, sample: 'Was fehlt, spricht mit' },
  },
  {
    name: 'Inhalt',
    bg: paperColor,
    shapes: [
      paper,
      { t: 'image', x: 21.6, y: 8.2, w: 8, h: 9, src: BLEED },
      { t: 'image', x: 2, y: 3.55, w: 7, h: 0.6, src: SHORT },
      sealAt(24.9, 1.6),
    ],
    title: {
      x: 2.2,
      y: 1.2,
      w: 21,
      h: 2.3,
      valign: 'bottom',
      size: 34,
      sample: 'Was ein Strich sagen kann',
    },
    body: {
      x: 2.2,
      y: 4.8,
      w: 19.6,
      h: 9.5,
      sample: [
        'Ein Strich sagt mehr als zehn Erklärungen',
        'Leere ist kein Mangel, sondern Absicht',
        'Jede Folie trägt genau einen Gedanken',
        'Grau in Stufen ersetzt die bunte Palette',
        'Das Siegel setzt den einzigen Akzent',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: paperColor,
    shapes: [
      paper,
      { t: 'image', x: 2, y: 4.75, w: 7, h: 0.6, src: SHORT },
      // The picture hangs as a scroll: its mount, a rod above and below.
      {
        t: 'rect',
        x: 17,
        y: 1.5,
        w: 8.6,
        h: 12.6,
        fill: sand,
        shadow: { dx: 0.12, dy: 0.2, blur: 0.5, color: '#3b3020', opacity: 0.28 },
      },
      { t: 'rect', x: 16.6, y: 1.32, w: 9.4, h: 0.2, r: 0.1, fill: ink },
      { t: 'rect', x: 16.45, y: 14.02, w: 9.7, h: 0.3, r: 0.15, fill: ink },
      sealAt(24.35, 12.85, 0.75),
    ],
    title: {
      x: 2.2,
      y: 1.4,
      w: 13.6,
      h: 3.3,
      valign: 'bottom',
      size: 32,
      sample: 'Ein Bild hängt wie eine Rolle',
    },
    body: {
      x: 2.2,
      y: 5.9,
      w: 13.4,
      h: 8.4,
      size: 20,
      sample: [
        'Das Hochformat lässt dem Text die Breite',
        'Ein schmaler Rand rahmt, ohne zu drängen',
        'Motive mit viel Himmel wirken am besten',
      ],
    },
    pictures: [{ x: 17.6, y: 2.2, w: 7.4, h: 10.4 }],
  },
  {
    name: 'Zwei Spalten',
    bg: paperColor,
    shapes: [
      paper,
      { t: 'image', x: 9.8, y: 8.55, w: 8.4, h: 0.7, src: UPRIGHT, rotate: 90 },
      ...drops([
        [14.1, 13.5, 0.06],
        [13.85, 13.85, 0.035],
      ]),
      sealAt(24.9, 1.6),
    ],
    title: {
      x: 2.2,
      y: 1.2,
      w: 21,
      h: 2.3,
      valign: 'bottom',
      size: 34,
      sample: 'Zwei Seiten eines Gedankens',
    },
    body: [
      {
        x: 2.2,
        y: 4.7,
        w: 10.6,
        h: 9.6,
        size: 20,
        sample: [
          'Fülle: alles zeigen, was man weiß',
          'Viele Farben, viele Stimmen',
          'Der Blick sucht einen Halt',
        ],
      },
      {
        x: 15.3,
        y: 4.7,
        w: 10.6,
        h: 9.6,
        size: 20,
        sample: [
          'Leere: nur zeigen, was zählt',
          'Ein Ton in vielen Stufen',
          'Der Blick kommt zur Ruhe',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: paperColor,
    shapes: [
      paper,
      { t: 'image', x: 1.3, y: 1.35, w: 13, h: 13, src: CIRCLE },
      ...drops([
        [3.1, 13.2, 0.08],
        [2.5, 12.6, 0.045],
      ]),
      sealAt(16.6, 11.1),
    ],
    title: {
      x: 3.6,
      y: 5.1,
      w: 8.4,
      h: 5.4,
      valign: 'middle',
      align: 'center',
      size: 84,
      sample: '72 %',
    },
    body: {
      x: 16.5,
      y: 4.6,
      w: 9.6,
      h: 6,
      valign: 'bottom',
      size: 24,
      lineHeight: 130,
      sample: 'der Fläche bleiben frei.\nGenau deshalb hat der Rest Gewicht.',
    },
  },
  {
    name: 'Zitat',
    bg: night,
    shapes: [
      { t: 'image', ...page, src: NIGHT },
      { t: 'image', x: 17.2, y: -3.2, w: 11, h: 11, src: MOON_LIGHT },
      { t: 'image', x: 2.9, y: 10.5, w: 12, h: 0.8, src: PALE },
      sealAt(3.05, 12.25),
    ],
    body: {
      x: 3,
      y: 2.2,
      w: 19.5,
      h: 7.9,
      valign: 'bottom',
      font: 'Noto Serif',
      italic: true,
      size: 34,
      lineHeight: 128,
      color: paperColor,
      sample: 'Erst wenn nichts mehr wegzunehmen ist, beginnt das Bild zu sprechen.',
    },
    subtitle: {
      x: 4.4,
      y: 11.9,
      w: 18,
      h: 1.6,
      valign: 'middle',
      color: '#cfc8b8',
      sample: 'Aus einem Werkstattgespräch',
    },
  },
  {
    name: 'Bild',
    bg: paperColor,
    shapes: [
      paper,
      { t: 'image', x: -0.3, y: 4.4, w: 28.6, h: 4.2, src: BROAD },
      {
        t: 'rect',
        x: 2.5,
        y: 1.3,
        w: 23,
        h: 10.7,
        fill: sand,
        shadow: { dx: 0.1, dy: 0.2, blur: 0.5, color: '#3b3020', opacity: 0.28 },
      },
      sealAt(24.65, 12.75),
    ],
    pictures: [{ x: 2.85, y: 1.65, w: 22.3, h: 10 }],
    title: {
      x: 2.5,
      y: 12.4,
      w: 20,
      h: 1.9,
      valign: 'middle',
      size: 26,
      sample: 'Nebel über dem Tal, früh am Morgen',
    },
  },
  {
    name: 'Schluss',
    bg: paperColor,
    shapes: [
      paper,
      { t: 'image', x: 11.8, y: 0.9, w: 4.4, h: 4.4, src: MOON },
      { t: 'image', x: -9, y: 9.4, w: 38, h: 9.6, src: RANGE },
      sealAt(13.55, 9.9, 0.9),
    ],
    title: {
      x: 4,
      y: 4.9,
      w: 20,
      h: 2.8,
      valign: 'middle',
      align: 'center',
      size: 50,
      sample: 'Vielen Dank',
    },
    subtitle: {
      x: 5,
      y: 7.8,
      w: 18,
      h: 1.5,
      align: 'center',
      sample: 'Der Rest ist Stille – und Ihre Fragen',
    },
  },
];

const template: Template = {
  slug: 'tusche',
  name: 'Tusche',
  group: 'Schwarzweiß',
  tags: ['Tusche', 'Tuschemalerei', 'ruhig', 'minimal', 'Reispapier', 'Pinsel', 'Zen', 'Kultur'],
  description:
    'Tuschemalerei auf Reispapier: trockene Pinselstriche, Berge im Nebel, viel Leere und ein kleines rotes Siegel.',
  palette: {
    bg: paperColor,
    text: ink,
    bg2: sand,
    text2: '#5a5751',
    accents: [seal, soot, stone, mist, '#c2a878', '#4d5f56'],
  },
  fonts: { head: 'Noto Serif', body: 'Noto Sans' },
  text: {
    title: { font: 'Noto Serif', size: 46, color: ink, lineHeight: 112 },
    subtitle: { font: 'Noto Sans', size: 20, color: '#5a5751', spacing: 0.6 },
    body: { font: 'Noto Sans', size: 22, color: ink, lineHeight: 128, paraSpace: 0.4 },
  },
  layouts,
  samplePictures: [landscape({ w: 12, h: 12 }, 9), landscape({ w: 22, h: 10 }, 15)],
};

export default template;
