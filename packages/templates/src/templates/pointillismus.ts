import { jpeg, noise, paint, rgb, rng, type Paint, type Rng } from '../art';
import type { Color, Layout, Picture, Shape, Template } from '../model';
import { page } from '../shapes';

/*
 * Pointillismus: pictures set dab by dab in pure colours, each beside its complement – orange in
 * the blue of the sea, violet in the yellow of the sand – so that the eye mixes them. The dabs
 * thin out into bare paper, and there the text stands.
 */

const paper = '#fbf7ee';
const sandPaper = '#f3ead2';
const night = '#27245a';
const dusk = '#5a5788';
const ultramarine = '#2f55c0';
const orange = '#f08a24';
const emerald = '#2f9e62';
const vermilion = '#e2452c';
const yellow = '#f6c928';
const violet = '#7a4fb0';

const RATIO = 28 / 15.75;

const smooth = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
const clamp = (value: number) => Math.round(Math.min(255, Math.max(0, value)));

type Motif = (u: number, v: number, random: Rng) => Color | null;

/** One of `colors`, the earlier ones more often: the local colour and what is set beside it. */
const among = (random: Rng, colors: readonly Color[], lead = 0.5): Color =>
  random() < lead ? colors[0]! : colors[1 + Math.floor(random() * (colors.length - 1))]!;

/** Dabs on a loose grid, twice over, the paper showing between them. */
function stipple(
  size: { w: number; h: number },
  motif: Motif,
  options: { seed: number; cell?: number; px?: number; quality?: number },
): Picture {
  const surface: Paint = paint(size, options.px ?? 56);
  const { ctx, w, h, px } = surface;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  const cell = (options.cell ?? 0.19) * px;
  for (const [layer, radius] of [0.47, 0.4, 0.34].entries()) {
    const random = rng(options.seed * 31 + layer);
    const shift = layer * 0.37 * cell;
    for (let gy = -1; gy * cell < h + cell; gy += 1) {
      for (let gx = -1; gx * cell < w + cell; gx += 1) {
        const x = gx * cell + shift + (random() - 0.5) * cell * 0.9;
        const y = gy * cell + shift * 0.6 + (random() - 0.5) * cell * 0.9;
        const color = motif(x / w, y / h, random);
        if (!color) continue;
        const [r, g, b] = rgb(color);
        const shade = (random() - 0.5) * 22;
        ctx.fillStyle = `rgb(${clamp(r + shade)},${clamp(g + shade)},${clamp(b + shade)})`;
        ctx.beginPath();
        ctx.ellipse(
          x,
          y,
          cell * radius * random.range(0.85, 1.12),
          cell * radius * random.range(0.7, 1),
          random() * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }
  return jpeg(surface, options.quality ?? 78);
}

const SKY_COOL = ['#8fb7ee', '#bcd6f6', '#f6c9cf', '#d9e6f8'] as const;
const SKY_WARM = ['#fbe28a', '#f9bf7c', '#fdf0c0', '#f6c9cf'] as const;
const SEA = ['#2f55c0', '#3f86d8', '#2f9e7a', '#7a4fb0', '#f08a24', '#8fc7ea'] as const;
const SEA_FAR = ['#6fa6e6', '#a9d3f0', '#5f7fd6', '#f9bf7c', '#8fd0c0'] as const;
const SAND = ['#f9d77a', '#fbe9a8', '#f4b56a', '#b99be0', '#f6c928'] as const;
const LEAF_LIT = ['#8fcb5c', '#f6d83a', '#5fb85c', '#f0a23a'] as const;
const LEAF_DARK = ['#2f7f6a', '#2f55c0', '#7a4fb0', '#2f9e62', '#e2452c'] as const;

interface Sail {
  x: number;
  y: number;
  h: number;
  w: number;
}

/** A boat's colour at a place, if a boat is there. */
function boat(sails: readonly Sail[], u: number, v: number, random: Rng): Color | null {
  for (const sail of sails) {
    const up = (sail.y - v) / sail.h;
    if (up >= 0 && up <= 1) {
      const across = u - sail.x;
      if (across >= 0 && across <= sail.w * (1 - up)) {
        return among(random, ['#fffaf0', '#fdeec0', '#f9d9c9'], 0.6);
      }
      if (across < -0.004 && across >= -sail.w * 0.7 * (1 - up * 1.25)) {
        return among(random, ['#cfc6f0', '#aebaf0', '#f6c9cf'], 0.5);
      }
    } else if (
      up < 0 &&
      up > -0.022 / sail.h &&
      Math.abs(u - sail.x - sail.w * 0.1) < sail.w * 1.1
    ) {
      return among(random, [vermilion, night, orange], 0.55);
    }
  }
  return null;
}

/** Sea under an evening sun; `sun` its place, `horizon` where the water begins. */
function seaAt(
  u: number,
  v: number,
  random: Rng,
  sun: { x: number; y: number; r: number },
  horizon: number,
): Color {
  if (v < horizon) {
    const d = Math.hypot((u - sun.x) * RATIO, v - sun.y);
    if (d < sun.r) return among(random, ['#f6a12a', '#f9c62f', '#f0702c', '#fbe28a'], 0.45);
    if (d < sun.r * 2.2 && random() < 1 - (d - sun.r) / (sun.r * 1.2)) {
      return among(random, ['#fbd45a', '#f9bf7c', '#fdf0c0'], 0.5);
    }
    const warm = (v / horizon) ** 1.6;
    return random() < warm ? among(random, SKY_WARM, 0.45) : among(random, SKY_COOL, 0.45);
  }
  const depth = (v - horizon) / (1 - horizon);
  const lane = Math.max(0, 1 - Math.abs(u - sun.x) / (0.03 + depth * 0.13));
  if (random() < lane * 0.6) return among(random, ['#f9c62f', '#f6a12a', '#fdf0c0'], 0.5);
  return random() > depth * 2.2 + 0.1 ? among(random, SEA_FAR, 0.4) : among(random, SEA, 0.42);
}

/** A bay with two sails, running out into paper towards the upper left. */
function bay(): Picture {
  const field = noise(12);
  const sun = { x: 0.82, y: 0.37, r: 0.085 };
  const horizon = 0.6;
  const sails = [
    { x: 0.63, y: 0.63, h: 0.2, w: 0.05 },
    { x: 0.935, y: 0.6, h: 0.1, w: 0.024 },
  ];
  return stipple(
    page,
    (u, v, random) => {
      const edge = 0.66 - 0.6 * smooth(0.28, 1, u) + (field(u * 3, v * 3) - 0.5) * 0.14;
      if (random() > smooth(edge - 0.03, edge + 0.11, v)) return null;
      const sail = boat(sails, u, v, random);
      if (sail) return sail;
      const shore = 0.93 - 0.2 * smooth(0.45, 1, u) + (field(u * 4, 3) - 0.5) * 0.05;
      if (v > shore) {
        return v > shore + 0.09 && field(u * 9, v * 9) > 0.56
          ? among(random, LEAF_LIT, 0.4)
          : among(random, SAND, 0.42);
      }
      const head = horizon - 0.13 * smooth(0.0, 0.2, 0.2 - u) - 0.02;
      if (u < 0.22 && v > head && v < horizon + 0.01) {
        return among(random, u + v * 0.5 < 0.42 ? LEAF_LIT : LEAF_DARK, 0.4);
      }
      return seaAt(u, v, random, sun, horizon);
    },
    { seed: 1 },
  );
}

/** A park on a Sunday inside a round picture: trees, their blue shadows, a red parasol. */
function park(): Picture {
  const field = noise(47);
  const [cx, cy, radius] = [0.27, 0.5, 0.415];
  const trees = [
    { x: -0.2, y: -0.07, r: 0.15 },
    { x: 0.03, y: -0.13, r: 0.12 },
    { x: 0.25, y: -0.03, r: 0.14 },
  ];
  return stipple(
    page,
    (u, v, random) => {
      // In units of the page's height, from the picture's centre.
      const [x, y] = [(u - cx) * RATIO, v - cy];
      const d = Math.hypot(x, y) + (field(u * 6, v * 6) - 0.5) * 0.03;
      if (random() > 1 - smooth(radius - 0.05, radius + 0.03, d)) return null;
      for (const tree of trees) {
        const [tx, ty] = [x - tree.x, y - tree.y];
        if (Math.hypot(tx, ty * 1.15) < tree.r) {
          return among(
            random,
            random() < smooth(0.55, -0.75, (tx + ty) / tree.r) ? LEAF_LIT : LEAF_DARK,
            0.4,
          );
        }
        if (Math.abs(tx) < 0.012 && ty > 0 && ty < tree.r + 0.13) {
          return among(random, ['#5a3f8a', '#27245a', '#e2452c'], 0.5);
        }
        // Its shadow lies long across the lawn.
        const [sx, sy] = [tx - 0.13, ty - tree.r - 0.135];
        if ((sx / (tree.r * 0.95)) ** 2 + (sy / 0.02) ** 2 < 1) {
          return among(random, ['#3f6fc8', '#7a4fb0', '#2f9e7a', '#5fb85c'], 0.4);
        }
      }
      // The parasol and who sits under it.
      const [px, py] = [x - 0.04, y - 0.21];
      if (py < 0 && Math.hypot(px, py * 1.3) < 0.055) {
        return among(random, [vermilion, '#f08a24', '#fbe28a', '#c2306a'], 0.55);
      }
      if (py >= 0 && py < 0.07 && Math.abs(px) < 0.018) {
        return among(random, ['#fffaf0', '#c9c3ee', '#27245a'], 0.45);
      }
      if (y < -0.12) {
        const far = -0.14 - field(u * 8, 2) * 0.06;
        if (y > far - 0.03) return among(random, ['#8fa6e0', '#a9b6ea', '#7fc0a0', '#b99be0'], 0.4);
        return random() < (y + radius) / 0.3
          ? among(random, SKY_WARM, 0.45)
          : among(random, SKY_COOL, 0.45);
      }
      if (y > 0.3) return among(random, SEA, 0.4);
      if (y > 0.27) return among(random, SAND, 0.45);
      return among(random, ['#cfe07a', '#f6e27a', '#9fd06c', '#f9bf7c', '#b99be0'], 0.42);
    },
    { seed: 2 },
  );
}

const PARASOL = { w: 13.4, h: 13.4 };

/** A beach parasol from above, its gores in orange and blue, its shadow on the sand. */
function parasol(): Picture {
  const field = noise(81);
  return stipple(
    PARASOL,
    (u, v, random) => {
      const [x, y] = [u - 0.47, v - 0.46];
      const d = Math.hypot(x, y);
      const angle = Math.atan2(y, x);
      const gore = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 12 + 0.5);
      const rim = 0.39 + Math.abs(Math.sin(angle * 6)) * 0.014;
      if (d < rim) {
        const lit = x + y < -0.05;
        if (gore % 2 === 0) {
          return among(
            random,
            lit ? [orange, yellow, '#f9bf7c', vermilion] : [orange, vermilion, '#c2306a', violet],
            0.5,
          );
        }
        return among(
          random,
          lit
            ? ['#3f86d8', '#8fc7ea', ultramarine, emerald]
            : [ultramarine, violet, '#27245a', '#2f9e7a'],
          0.5,
        );
      }
      const shadow = Math.hypot(x - 0.075, y - 0.085);
      if (shadow < 0.39) return among(random, ['#8f7fd6', '#5f7fd6', '#b99be0', '#f4b56a'], 0.4);
      const far = d + (field(u * 5, v * 5) - 0.5) * 0.08;
      if (random() > 1 - smooth(0.41, 0.52, far)) return null;
      return among(random, SAND, 0.45);
    },
    { seed: 3 },
  );
}

/** The sea towards evening, to the edges – the ground a sheet of paper is laid on. */
function evening(): Picture {
  const sun = { x: 0.5, y: 0.2, r: 0.0 };
  const sails = [
    { x: 0.08, y: 0.5, h: 0.13, w: 0.03 },
    { x: 0.9, y: 0.47, h: 0.09, w: 0.022 },
  ];
  return stipple(
    page,
    (u, v, random) => boat(sails, u, v, random) ?? seaAt(u, v, random, { ...sun, x: 0.9 }, 0.44),
    { seed: 4, quality: 74 },
  );
}

const FRIEZE = { w: 28, h: 3.6 };

/** A strip of shore along the foot of a page. */
function frieze(): Picture {
  const field = noise(5);
  return stipple(
    FRIEZE,
    (u, v, random) => {
      const top = 0.38 + Math.sin(u * 30) * 0.05 + (field(u * 9, 1) - 0.5) * 0.3;
      if (random() > smooth(top - 0.12, top + 0.25, v)) return null;
      const shore = 0.82 + Math.sin(u * 9 + 1) * 0.07;
      if (v > shore) return among(random, SAND, 0.42);
      if (v > shore - 0.07) return among(random, ['#fffaf0', '#bfe0f0', '#8fc7ea'], 0.5);
      return v < top + 0.3 ? among(random, SEA_FAR, 0.4) : among(random, SEA, 0.42);
    },
    { seed: 5 },
  );
}

/** A painted border as the pointillists set round their pictures: dark dabs, warm ones among. */
function border(size: { w: number; h: number }, band: number, seed: number): Picture {
  return stipple(
    size,
    (u, v, random) => {
      const near = Math.min(u * size.w, (1 - u) * size.w, v * size.h, (1 - v) * size.h);
      if (near > band) return null;
      const inner = near / band;
      return inner > 0.5
        ? among(random, [ultramarine, violet, '#27245a', orange, emerald], 0.4)
        : among(random, [orange, yellow, vermilion, '#3f86d8', violet], 0.4);
    },
    { seed },
  );
}

const SQUARE = { w: 11.6, h: 11.2 };
const WIDE = { w: 24.6, h: 11.9 };

const pictures = {
  bay: bay(),
  park: park(),
  parasol: parasol(),
  evening: evening(),
  frieze: frieze(),
  square: border(SQUARE, 0.75, 6),
  wide: border(WIDE, 0.75, 7),
};

const whole = (src: Picture): Shape => ({ t: 'image', ...page, src });

/** A row of dabs as a rule: the palette, dab by dab. */
const row = (x: number, y: number, count: number, step = 0.42, size = 0.2): Shape[] =>
  Array.from({ length: count }, (_, index): Shape => ({
    t: 'ellipse',
    x: x + index * step,
    y,
    w: size,
    h: size,
    fill: [ultramarine, orange, emerald, vermilion, yellow, violet][index % 6]!,
  }));

/** The same downwards. */
const column = (x: number, y: number, count: number, step = 0.42, size = 0.2): Shape[] =>
  Array.from({ length: count }, (_, index): Shape => ({
    t: 'ellipse',
    x,
    y: y + index * step,
    w: size,
    h: size,
    fill: [ultramarine, orange, emerald, vermilion, yellow, violet][index % 6]!,
  }));

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paper,
    shapes: [whole(pictures.bay), ...row(1.95, 7.15, 9)],
    title: {
      x: 1.8,
      y: 1.6,
      w: 16,
      h: 5.2,
      size: 56,
      valign: 'bottom',
      sample: 'Sonntag\nam Meer',
    },
    subtitle: { x: 1.8, y: 7.6, w: 9.5, h: 1.4, sample: 'Farbe, Punkt für Punkt' },
  },
  {
    name: 'Abschnitt',
    bg: paper,
    shapes: [whole(pictures.park), ...row(16.15, 5.0, 9)],
    title: {
      x: 16,
      y: 5.6,
      w: 10.4,
      h: 4.4,
      size: 46,
      valign: 'top',
      sample: 'Im Park,\nnachmittags',
    },
    subtitle: { x: 16, y: 10.7, w: 10.4, h: 1.4, sample: 'Zweites Kapitel' },
  },
  {
    name: 'Inhalt',
    bg: paper,
    shapes: [
      { t: 'image', x: 19.6, y: 7.6, ...PARASOL, src: pictures.parasol },
      ...row(1.95, 3.75, 44),
    ],
    title: {
      x: 1.8,
      y: 1.1,
      w: 24.4,
      h: 2.4,
      size: 38,
      valign: 'bottom',
      sample: 'Wie das Auge mischt',
    },
    body: {
      x: 1.8,
      y: 4.5,
      w: 19.4,
      h: 9.8,
      sample: [
        'Reine Farben, ungemischt nebeneinander',
        'Orange neben Blau: beide leuchten stärker',
        'Aus zwei Schritten Abstand wird daraus Licht',
        'Jeder Punkt hat seinen Platz',
        'Geduld ersetzt den großen Pinsel',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: paper,
    shapes: [
      { t: 'image', x: 1.6, y: 2.3, ...SQUARE, src: pictures.square },
      ...row(14.75, 4.45, 27),
    ],
    pictures: [{ x: 2.35, y: 3.05, w: 10.1, h: 9.7 }],
    title: {
      x: 14.6,
      y: 1.5,
      w: 11.6,
      h: 2.8,
      size: 34,
      valign: 'bottom',
      sample: 'Ein Bild aus Punkten',
    },
    body: {
      x: 14.6,
      y: 5.1,
      w: 11.6,
      h: 9.2,
      sample: [
        'Auch der Rahmen ist gemalt',
        'Dunkel am Bild, warm nach außen',
        'So leuchtet, was er fasst',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: paper,
    shapes: [
      { t: 'image', x: 0, y: 12.15, ...FRIEZE, src: pictures.frieze },
      ...row(1.95, 3.75, 58),
      ...column(13.9, 4.7, 17),
    ],
    title: { x: 1.8, y: 1.1, w: 24.4, h: 2.4, size: 38, valign: 'bottom', sample: 'Warm und kalt' },
    body: [
      {
        x: 1.8,
        y: 4.5,
        w: 11.3,
        h: 7.6,
        size: 19,
        sample: ['Gelb, Orange, Zinnober', 'Sand, Haut, Abendsonne', 'Kommt dem Auge entgegen'],
      },
      {
        x: 14.9,
        y: 4.5,
        w: 11.3,
        h: 7.6,
        size: 19,
        sample: ['Blau, Violett, Smaragd', 'Wasser, Schatten, Ferne', 'Weicht vor dem Auge zurück'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: paper,
    shapes: [
      { t: 'image', x: 1.1, y: 1.2, ...PARASOL, src: pictures.parasol },
      { t: 'ellipse', x: 3.55, y: 3.5, w: 7.7, h: 7.7, fill: paper },
      ...row(16.15, 5.1, 9),
    ],
    title: {
      x: 3.6,
      y: 5.2,
      w: 7.6,
      h: 4.3,
      size: 84,
      align: 'center',
      valign: 'middle',
      sample: '11',
    },
    body: {
      x: 16,
      y: 5.7,
      w: 10.2,
      h: 6,
      size: 22,
      sample: 'reine Farben auf der Palette. Alle anderen entstehen erst im Auge.',
    },
  },
  {
    name: 'Zitat',
    bg: paper,
    shapes: [
      whole(pictures.evening),
      {
        t: 'rect',
        x: 3,
        y: 2.9,
        w: 22,
        h: 9.95,
        r: 4.97,
        fill: paper,
        shadow: { dx: 0, dy: 0.1, blur: 0.4, color: night, opacity: 0.3 },
      },
      ...row(12.05, 10.25, 10),
    ],
    body: {
      x: 5.6,
      y: 4.1,
      w: 16.8,
      h: 5.7,
      font: 'Spectral',
      italic: true,
      size: 30,
      lineHeight: 112,
      align: 'center',
      valign: 'middle',
      sample: 'Manche sehen Poesie in meinen Bildern. Ich sehe darin nur Methode.',
    },
    subtitle: {
      x: 7,
      y: 10.7,
      w: 14,
      h: 1.3,
      align: 'center',
      valign: 'middle',
      sample: 'Ein Maler am Ufer',
    },
  },
  {
    name: 'Bild',
    bg: paper,
    shapes: [{ t: 'image', x: 1.7, y: 1.1, ...WIDE, src: pictures.wide }],
    pictures: [{ x: 2.45, y: 1.85, w: 23.1, h: 10.4 }],
    title: {
      x: 4,
      y: 13.3,
      w: 20,
      h: 1.5,
      size: 26,
      bold: false,
      italic: true,
      align: 'center',
      valign: 'middle',
      sample: 'Die Bucht bei ablaufendem Wasser',
    },
  },
  {
    name: 'Schluss',
    bg: paper,
    shapes: [
      { t: 'image', x: -9, y: -3.4, w: 39.2, h: 22.05, src: pictures.evening },
      {
        t: 'ellipse',
        x: 7.6,
        y: 1.475,
        w: 12.8,
        h: 12.8,
        fill: paper,
        shadow: { dx: 0, dy: 0.1, blur: 0.4, color: night, opacity: 0.3 },
      },
      ...row(12.05, 8.6, 10),
    ],
    title: {
      x: 8.4,
      y: 4.6,
      w: 11.2,
      h: 3.7,
      size: 50,
      align: 'center',
      valign: 'bottom',
      sample: 'Vielen\nDank',
    },
    subtitle: {
      x: 9.2,
      y: 9.2,
      w: 9.6,
      h: 2.2,
      align: 'center',
      valign: 'top',
      sample: 'Treten Sie ruhig zwei Schritte zurück',
    },
  },
];

const template: Template = {
  slug: 'pointillismus',
  name: 'Pointillismus',
  group: 'Kunststil',
  tags: [
    'Pointillismus',
    'Punkte',
    'Malerei',
    'Komplementärfarben',
    'Meer',
    'Park',
    'sonnig',
    'Sommer',
    'Kultur',
  ],
  description:
    'Bilder aus reinen Farbtupfen, Komplementärfarben nebeneinander: Bucht, Park und Sonnenschirm auf hellem Papier.',
  palette: {
    bg: paper,
    text: night,
    bg2: sandPaper,
    text2: dusk,
    accents: [ultramarine, orange, emerald, vermilion, yellow, violet],
  },
  fonts: { head: 'Spectral', body: 'Karla' },
  text: {
    title: { font: 'Spectral', size: 60, color: night, bold: true, lineHeight: 98 },
    subtitle: { font: 'Karla', size: 20, color: dusk, bold: true },
    body: { font: 'Karla', size: 21, color: night, lineHeight: 125, paraSpace: 0.32 },
  },
  layouts,
  samplePictures: [pictures.bay, pictures.evening],
};

export default template;
