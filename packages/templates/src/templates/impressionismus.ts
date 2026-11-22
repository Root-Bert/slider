import { jpeg, mix, noise, paint, rgb, rng, type Paint, type Rng } from '../art';
import type { Color, Layout, Shape, Template } from '../model';
import { page } from '../shapes';

/*
 * Impressionismus: every ground is painted – thousands of short, loaded brush strokes that only
 * at a distance become a lake in the morning, a garden, a pond, a field at dusk. Text sits where
 * the painting is calm, or on cream paper the picture dissolves into.
 */

const cream = '#fbf6ea';
const sand = '#f1e8d3';
const indigo = '#2b3158';
const slate = '#555c82';
const water = '#6f9ed2';
const leaf = '#7fae7b';
const poppy = '#dd5f48';
const lilac = '#a98fcb';
const sun = '#f2b25c';
const rose = '#eaa5b5';

/** One going-over with the brush: strokes of a size, each asking the motif for its colour. */
interface Pass {
  count: number;
  /** Centimetres. */
  length: number;
  width: number;
  seed: number;
  jitter?: number;
  alpha?: number;
  wobble?: number;
  /** The colour at a place – or none, where the paper stays bare. */
  colorAt: (u: number, v: number, random: Rng) => Color | null;
  flow?: (u: number, v: number) => number;
}

const clamp = (value: number) => Math.round(Math.min(255, Math.max(0, value)));

/** Lays strokes on what is there: the body of each, then two bristle lines lighter and darker. */
function lay(surface: Paint, pass: Pass): void {
  const { ctx, w, h, px } = surface;
  const random = rng(pass.seed);
  const jitter = pass.jitter ?? 0.1;
  const alpha = pass.alpha ?? 0.92;
  ctx.lineCap = 'round';
  for (let i = 0; i < pass.count; i += 1) {
    const [u, v] = [random(), random()];
    const color = pass.colorAt(u, v, random);
    if (!color) continue;
    const [r, g, b] = rgb(color);
    const shade = (random() - 0.5) * 255 * jitter;
    const tint = (lift: number, a: number) =>
      `rgba(${clamp(r + shade + lift)},${clamp(g + shade + lift)},${clamp(b + shade + lift * 0.8)},${a})`;
    const angle = (pass.flow?.(u, v) ?? 0) + random.bell() * (pass.wobble ?? 0.3);
    const reach = pass.length * px * random.range(0.6, 1.3);
    const width = pass.width * px * random.range(0.65, 1.3);
    const bend = random.bell() * reach * 0.22;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const [x, y] = [u * w, v * h];
    const stroke = (offset: number, lineWidth: number, style: string) => {
      const [ox, oy] = [-sin * offset, cos * offset];
      ctx.strokeStyle = style;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(x - (cos * reach) / 2 + ox, y - (sin * reach) / 2 + oy);
      ctx.quadraticCurveTo(
        x - sin * bend + ox,
        y + cos * bend + oy,
        x + (cos * reach) / 2 + ox,
        y + (sin * reach) / 2 + oy,
      );
      ctx.stroke();
    };
    stroke(0, width, tint(0, alpha));
    stroke(-width * 0.27, width * 0.2, tint(26, alpha * 0.55));
    stroke(width * 0.3, width * 0.18, tint(-24, alpha * 0.45));
  }
}

const smooth = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** A painting: its paper, then the passes from broad to fine. */
function painting(
  size: { w: number; h: number },
  px: number,
  passes: readonly Pass[],
  quality = 80,
) {
  const surface = paint(size, px);
  surface.ctx.fillStyle = cream;
  surface.ctx.fillRect(0, 0, surface.w, surface.h);
  for (const pass of passes) lay(surface, pass);
  return jpeg(surface, quality);
}

const FULL = { w: 28, h: 15.75 };
const FULL_PX = 54;

/** A lake in the morning: a wide pale sky, far hills, light lying on the water. */
function lake() {
  const field = noise(21);
  const horizon = 0.63;
  const colorAt = (u: number, v: number, random: Rng): Color => {
    if (v < horizon) {
      const hill = horizon - 0.03 - field(u * 2.6 + 3, 1.5, 3) * 0.075;
      if (v > hill) return mix('#a3b3d8', '#bba9d4', field(u * 7, v * 9));
      let color = mix('#dbe4f3', '#fdf0d6', (v / horizon) ** 1.4);
      const cloud = field(u * 2.4, v * 7 + 4, 4);
      if (cloud > 0.54) color = mix(color, '#f8d3c4', Math.min(0.75, (cloud - 0.54) * 3));
      const glow = Math.max(0, 1 - Math.hypot((u - 0.8) * 1.3, v - 0.44) * 2.4);
      return mix(color, '#fff2c2', glow * 0.85);
    }
    const depth = (v - horizon) / (1 - horizon);
    const glitter = Math.max(0, 1 - Math.abs(u - 0.8) / (0.05 + depth * 0.2));
    if (random() < glitter * 0.62) return random() < 0.6 ? '#fff0bd' : '#f8c488';
    if (depth > 0.55) {
      const pads = field(u * 5 + 8, v * 9, 3);
      if (pads > 0.6)
        return random() < 0.12
          ? random() < 0.5
            ? '#f3a9bd'
            : '#fffaf0'
          : mix('#6ea582', '#a9cd8c', random());
    }
    const base = mix('#efe4d2', '#7da2d4', depth ** 0.6);
    const pick = random();
    if (pick < 0.22) return mix(base, '#4c7cb6', 0.7);
    if (pick < 0.36) return mix(base, '#86b7a2', 0.6);
    if (pick < 0.46) return mix(base, '#b9a5d6', 0.6);
    return base;
  };
  const flow = (u: number, v: number) => (v < horizon ? (field(u * 3, v * 3) - 0.5) * 0.5 : 0);
  return painting(FULL, FULL_PX, [
    { count: 5200, length: 1.9, width: 0.6, seed: 1, colorAt, flow, jitter: 0.04, wobble: 0.15 },
    { count: 15000, length: 1, width: 0.26, seed: 2, colorAt, flow, jitter: 0.06, wobble: 0.2 },
    {
      count: 9000,
      length: 0.7,
      width: 0.16,
      seed: 3,
      jitter: 0.08,
      wobble: 0.2,
      colorAt: (u, v, random) => (v > horizon - 0.14 ? colorAt(u, v, random) : null),
    },
  ]);
}

/** A garden in June, painted on the right and running out into bare paper on the left. */
function garden() {
  const field = noise(34);
  const present = (u: number, v: number) =>
    smooth(0.45, 0.7, u + (field(u * 5, v * 5) - 0.5) * 0.3);
  const line = (u: number) => 0.33 + (field(u * 4.5, 2.2, 3) - 0.5) * 0.16;
  const colorAt = (u: number, v: number, random: Rng): Color | null => {
    if (u < 0.4 || random() > present(u, v)) return null;
    const trees = line(u);
    if (v < trees - 0.13) {
      const cloud = field(u * 3, v * 8 + 2, 4);
      const sky = mix('#c3daf2', '#f2eede', v / 0.3);
      return cloud > 0.55 ? mix(sky, '#fffdf6', 0.8) : sky;
    }
    if (v < trees + 0.02) {
      return random.pick(['#5f9079', '#4d7888', '#86b27c', '#3f6b74', '#6f86b4', '#a9c77a']);
    }
    const depth = (v - trees) / (1 - trees);
    const bloom = Math.exp(-(((depth - 0.42) / 0.3) ** 2));
    const pick = random();
    if (pick < bloom * 0.3 * (0.4 + field(u * 6 + 5, v * 6)))
      return random() < 0.7 ? '#e0523c' : '#f08060';
    if (pick > 0.95) return '#fff8ea';
    if (pick > 0.9 && depth > 0.5) return '#9c86cc';
    const lit = field(u * 5 + 2, v * 7 + 1, 3);
    if (lit > 0.6) return mix('#e4dd8c', '#c3d587', random());
    return mix('#b4cd86', '#4f925e', smooth(0.25, 0.7, lit + (random() - 0.5) * 0.3));
  };
  const flow = (u: number, v: number) => {
    const trees = line(u);
    if (v < trees - 0.13) return 0;
    if (v < trees + 0.02) return 1.2;
    return (v - trees) / (1 - trees) > 0.25 ? -Math.PI / 2 + (field(u * 8, v * 8) - 0.5) * 1.4 : 0;
  };
  return painting(FULL, FULL_PX, [
    { count: 5200, length: 1.6, width: 0.55, seed: 4, colorAt, flow, jitter: 0.06 },
    { count: 17000, length: 0.75, width: 0.24, seed: 5, colorAt, flow, jitter: 0.1, wobble: 0.45 },
    { count: 9000, length: 0.45, width: 0.2, seed: 6, colorAt, flow, jitter: 0.1, wobble: 0.6 },
  ]);
}

const BAND = { w: 7.6, h: 15.75 };

/** Poplars by a meadow – the narrow picture at the side of a page of text. */
function poplars() {
  const field = noise(55);
  const trees = [
    { at: 0.16, top: 0.1, wide: 0.13 },
    { at: 0.43, top: 0.2, wide: 0.115 },
    { at: 0.68, top: 0.31, wide: 0.1 },
  ];
  const ground = 0.8;
  const present = (u: number, v: number) =>
    1 - smooth(0.6, 0.98, u + (field(u * 2.5, v * 5) - 0.5) * 0.35);
  const tree = (u: number, v: number) =>
    trees.find(
      (it) =>
        v > it.top &&
        v < ground + 0.03 &&
        Math.abs(u - it.at) <
          it.wide * Math.sqrt(Math.sin((Math.PI * (v - it.top)) / (ground + 0.2 - it.top))),
    );
  const colorAt = (u: number, v: number, random: Rng): Color | null => {
    if (random() > present(u, v)) return null;
    const it = tree(u, v);
    if (it) {
      const side = (u - it.at) / it.wide + (random() - 0.5) * 0.7;
      if (side < -0.15) return random.pick(['#dcd67c', '#b5cc74', '#c9d98f']);
      if (side > 0.35) return random.pick(['#4d8572', '#56789f', '#3f6f78']);
      return random.pick(['#7fae6c', '#93bb74', '#6a9f6f']);
    }
    if (v > ground) {
      const pick = random();
      if (pick < 0.16) return random() < 0.7 ? '#e0523c' : '#f08060';
      if (pick > 0.94) return '#fff8ea';
      return mix(
        '#c6d786',
        '#5c9a62',
        smooth(0.3, 0.7, field(u * 4, v * 14) + (random() - 0.5) * 0.3),
      );
    }
    const cloud = field(u * 1.6, v * 6 + 3, 4);
    const sky = mix('#bcd6f2', '#f6eedc', (v / ground) ** 1.2);
    return cloud > 0.56 ? mix(sky, '#fffdf6', 0.85) : sky;
  };
  const flow = (u: number, v: number) => (tree(u, v) || v > ground ? -Math.PI / 2 : 0);
  return painting(BAND, 62, [
    { count: 2600, length: 1.5, width: 0.5, seed: 7, colorAt, flow, jitter: 0.05 },
    { count: 8000, length: 0.7, width: 0.22, seed: 8, colorAt, flow, jitter: 0.09, wobble: 0.4 },
    { count: 4000, length: 0.42, width: 0.18, seed: 9, colorAt, flow, jitter: 0.1, wobble: 0.6 },
  ]);
}

/** A field at dusk: the sky burning down to the horizon, the land already blue. */
function dusk() {
  const field = noise(89);
  const horizon = 0.66;
  const colorAt = (u: number, v: number, random: Rng): Color => {
    if (v < horizon) {
      const hedge = horizon - 0.02 - Math.max(0, field(u * 6 + 1, 4, 3) - 0.45) * 0.16;
      if (v > hedge) return random.pick(['#252b52', '#2f3460', '#3a2f5c']);
      const t = v / horizon;
      let color =
        t < 0.55
          ? mix('#2c3466', '#6a5a9e', t / 0.55)
          : t < 0.85
            ? mix('#6a5a9e', '#e98f6c', (t - 0.55) / 0.3)
            : mix('#e98f6c', '#f9d088', (t - 0.85) / 0.15);
      const cloud = field(u * 2 + 5, v * 9, 4);
      if (cloud > 0.56)
        color = mix(color, t > 0.5 ? '#c96f8e' : '#4a4684', Math.min(0.8, (cloud - 0.56) * 4));
      return color;
    }
    const depth = (v - horizon) / (1 - horizon);
    const pick = random();
    if (pick < 0.1 * (1 - depth)) return '#d98f5c';
    if (pick > 0.93) return '#8a6fae';
    return mix('#4a4a7c', '#272d52', depth * 0.8 + field(u * 6, v * 12) * 0.4);
  };
  const flow = (u: number, v: number) =>
    v < horizon ? (field(u * 2.5, v * 4) - 0.5) * 0.45 : (u - 0.5) * -1.1 * ((v - horizon) * 3);
  return painting(FULL, FULL_PX, [
    { count: 5200, length: 1.9, width: 0.6, seed: 10, colorAt, flow, jitter: 0.04, wobble: 0.15 },
    { count: 15000, length: 1, width: 0.26, seed: 11, colorAt, flow, jitter: 0.06, wobble: 0.22 },
    { count: 7000, length: 0.6, width: 0.16, seed: 12, colorAt, flow, jitter: 0.07, wobble: 0.3 },
  ]);
}

/** A pond seen from its bank: sky and willows mirrored, islands of lily pads, a few blossoms. */
function pond() {
  const field = noise(144);
  const random = rng(5);
  const islands = Array.from({ length: 13 }, () => ({
    x: random(),
    y: random(),
    rx: random.range(0.07, 0.15),
    ry: random.range(0.025, 0.06),
  }));
  const island = (u: number, v: number) =>
    islands.some((it) => ((u - it.x) / it.rx) ** 2 + ((v - it.y) / it.ry) ** 2 < 1);
  const mirror = (u: number, v: number, pick: Rng): Color => {
    const willow = field(u * 5 + 2, v * 0.8, 3);
    const sky = field(u * 1.6 + 7, v * 2.2, 3);
    if (willow > 0.58) return pick.pick(['#3f7372', '#4d8a76', '#44648e', '#5b9a7c']);
    if (sky > 0.56) return pick.pick(['#c9dcf0', '#e9e2ee', '#b9cfee']);
    return pick.pick(['#6f9ed2', '#7fb0cc', '#8f8ccc', '#6a93c4', '#86b7a8']);
  };
  return painting(FULL, FULL_PX, [
    {
      count: 5200,
      length: 1.9,
      width: 0.6,
      seed: 13,
      jitter: 0.05,
      wobble: 0.2,
      colorAt: mirror,
      flow: () => Math.PI / 2,
    },
    {
      count: 13000,
      length: 0.9,
      width: 0.24,
      seed: 14,
      jitter: 0.07,
      wobble: 0.25,
      colorAt: (u, v, pick) => (pick() < 0.55 ? mirror(u, v, pick) : null),
      flow: (u, v) => (field(u * 5 + 2, v * 0.8, 3) > 0.58 ? Math.PI / 2 : 0),
    },
    {
      count: 15000,
      length: 0.7,
      width: 0.24,
      seed: 15,
      jitter: 0.08,
      wobble: 0.25,
      colorAt: (u, v, pick) =>
        island(u, v + (field(u * 20, v * 20) - 0.5) * 0.03)
          ? pick() < 0.05
            ? pick.pick(['#f3a3bb', '#fff6ec', '#f7c5cf'])
            : pick.pick(['#7fb37a', '#a9cf8a', '#4f8f6a', '#93c08a', '#c9dc93'])
          : null,
    },
  ]);
}

/** The sun through haze, low over water – the ground of a number. */
function haze() {
  const field = noise(233);
  const [cx, cy, radius] = [0.31, 0.47, 0.34];
  const far = (u: number, v: number) => Math.hypot((u - cx) * (FULL.w / FULL.h), v - cy);
  const shore = 0.83;
  const colorAt = (u: number, v: number, random: Rng): Color => {
    const d = far(u, v);
    if (v > shore) {
      const lane = Math.max(0, 1 - Math.abs(u - cx) / 0.2);
      if (random() < lane * 0.7) return random.pick(['#f6b877', '#fbd58c', '#f29c66']);
      return random.pick(['#cfd8ee', '#dcd9ee', '#e6e3ea', '#c3d3ea']);
    }
    if (d < radius) {
      const t = d / radius + (random() - 0.5) * 0.25;
      return t < 0.45
        ? mix('#fde08e', '#f9c170', t / 0.45)
        : mix('#f9c170', '#ee8f5c', (t - 0.45) / 0.55);
    }
    const halo = Math.max(0, 1 - (d - radius) / 0.3);
    const air = mix('#f6ecdc', '#e9e4ee', field(u * 2.2, v * 3.2, 3));
    return mix(air, '#f8c9a2', halo ** 1.6 * 0.85);
  };
  const flow = (u: number, v: number) =>
    v > shore ? 0 : Math.atan2(v - cy, (u - cx) * (FULL.w / FULL.h)) + Math.PI / 2;
  return painting(FULL, FULL_PX, [
    { count: 5200, length: 1.9, width: 0.6, seed: 16, colorAt, flow, jitter: 0.03, wobble: 0.15 },
    { count: 15000, length: 1, width: 0.26, seed: 17, colorAt, flow, jitter: 0.05, wobble: 0.22 },
  ]);
}

const pictures = {
  lake: lake(),
  garden: garden(),
  poplars: poplars(),
  dusk: dusk(),
  pond: pond(),
  haze: haze(),
};

const whole = (src: (typeof pictures)[keyof typeof pictures]): Shape => ({
  t: 'image',
  ...page,
  src,
});

/** Three dabs off the palette knife – the template's small mark. */
const dabs = (x: number, y: number, colors: readonly Color[] = [poppy, sun, water]): Shape[] =>
  colors.map((fill, index) => ({
    t: 'ellipse',
    x: x + index * 0.62,
    y: y + (index % 2) * 0.07,
    w: 0.5,
    h: 0.26,
    fill,
    rotate: -18 + index * 9,
  }));

/** Cream paper laid on a painting, with the hairline of a mount. */
const sheet = (x: number, y: number, w: number, h: number, opacity = 0.93): Shape[] => [
  {
    t: 'rect',
    x,
    y,
    w,
    h,
    r: 0.12,
    fill: { t: 'solid', color: cream, opacity },
    shadow: { dx: 0, dy: 0.12, blur: 0.5, color: indigo, opacity: 0.28 },
  },
  {
    t: 'rect',
    x: x + 0.28,
    y: y + 0.28,
    w: w - 0.56,
    h: h - 0.56,
    fill: null,
    stroke: { color: mix(indigo, cream, 0.55), width: 0.025 },
  },
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: cream,
    shapes: [whole(pictures.lake), ...dabs(2, 6.35)],
    title: {
      x: 1.8,
      y: 0.9,
      w: 18,
      h: 5.1,
      valign: 'bottom',
      sample: 'Licht über\ndem Wasser',
    },
    subtitle: { x: 1.9, y: 6.85, w: 15, h: 1.2, sample: 'Ein Sommer in neun Bildern' },
  },
  {
    name: 'Abschnitt',
    bg: cream,
    shapes: [whole(pictures.garden), ...dabs(1.95, 5.1)],
    title: {
      x: 1.8,
      y: 5.7,
      w: 10.6,
      h: 4.2,
      size: 48,
      valign: 'top',
      sample: 'Im Garten,\ngegen Mittag',
    },
    subtitle: { x: 1.9, y: 10.2, w: 9.6, h: 1.6, sample: 'Zweiter Teil' },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      { t: 'image', x: 0, y: 0, ...BAND, src: pictures.poplars },
      {
        t: 'line',
        x1: 8.9,
        y1: 4.05,
        x2: 26.2,
        y2: 4.05,
        stroke: { color: mix(indigo, cream, 0.6), width: 0.025 },
      },
      ...dabs(24.4, 3.55),
    ],
    title: {
      x: 8.8,
      y: 1.2,
      w: 17.4,
      h: 2.6,
      size: 38,
      valign: 'bottom',
      sample: 'Was das Licht verändert',
    },
    body: {
      x: 8.8,
      y: 4.6,
      w: 17.4,
      h: 9.7,
      sample: [
        'Farbe entsteht im Auge, nicht auf der Palette',
        'Schatten sind blau und violett, nie schwarz',
        'Der Moment zählt mehr als das Motiv',
        'Kurze Striche lassen das Bild flimmern',
        'Aus der Nähe Farbe, aus der Ferne Form',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: cream,
    shapes: [
      { t: 'image', x: 3.4, y: 0, w: 28, h: 15.75, src: pictures.garden },
      ...sheet(15.6, 2.3, 10.9, 11.15, 1),
    ],
    title: {
      x: 1.8,
      y: 1.2,
      w: 12.6,
      h: 3.2,
      size: 36,
      valign: 'bottom',
      sample: 'Malen unter freiem Himmel',
    },
    body: {
      x: 1.8,
      y: 4.9,
      w: 12.4,
      h: 9.4,
      sample: [
        'Die Staffelei steht im Gras',
        'Zwanzig Minuten, dann ist das Licht ein anderes',
        'Also wird schnell gemalt',
      ],
    },
    pictures: [{ x: 16.2, y: 2.9, w: 9.7, h: 9.95 }],
  },
  {
    name: 'Zwei Spalten',
    bg: cream,
    shapes: [
      whole(pictures.lake),
      ...sheet(1.6, 4.5, 12.1, 9.9, 0.92),
      ...sheet(14.3, 4.5, 12.1, 9.9, 0.92),
    ],
    title: {
      x: 1.8,
      y: 1,
      w: 24.4,
      h: 2.9,
      size: 38,
      valign: 'middle',
      sample: 'Morgens und abends',
    },
    body: [
      {
        x: 2.4,
        y: 5.2,
        w: 10.5,
        h: 8.5,
        size: 18,
        sample: ['Kühles, klares Licht', 'Nebel über dem Wasser', 'Blau, Rosa, helles Gelb'],
      },
      {
        x: 15.1,
        y: 5.2,
        w: 10.5,
        h: 8.5,
        size: 18,
        sample: ['Warmes, tiefes Licht', 'Lange violette Schatten', 'Orange, Purpur, Gold'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: cream,
    shapes: [whole(pictures.haze), ...dabs(16.6, 4.75)],
    title: {
      x: 2.4,
      y: 3.9,
      w: 12.6,
      h: 7,
      size: 118,
      align: 'center',
      valign: 'middle',
      sample: '86',
    },
    body: {
      x: 16.5,
      y: 5.4,
      w: 9.6,
      h: 6,
      size: 22,
      sample: 'Bilder in einem einzigen Sommer – jedes vor dem Motiv begonnen und dort beendet.',
    },
  },
  {
    name: 'Zitat',
    bg: cream,
    shapes: [
      whole(pictures.pond),
      ...sheet(4.2, 2.5, 19.6, 10.75, 0.94),
      {
        t: 'text',
        x: 11.5,
        y: 2.75,
        w: 5,
        h: 2.6,
        text: '“',
        font: 'Cormorant Garamond',
        bold: true,
        size: 110,
        color: poppy,
        align: 'center',
        valign: 'top',
      },
    ],
    body: {
      x: 6,
      y: 5,
      w: 16,
      h: 5.3,
      font: 'Cormorant Garamond',
      italic: true,
      size: 34,
      lineHeight: 108,
      align: 'center',
      valign: 'middle',
      sample: 'Ich male nicht den Teich. Ich male, was das Licht mit ihm macht.',
    },
    subtitle: {
      x: 6,
      y: 10.7,
      w: 16,
      h: 1.4,
      align: 'center',
      valign: 'middle',
      size: 18,
      sample: 'Aus einem Brief vom Ufer',
    },
  },
  {
    name: 'Bild',
    bg: cream,
    shapes: [
      { t: 'image', x: -7, y: -5, w: 42, h: 23.625, src: pictures.pond },
      ...sheet(2.3, 1.1, 23.4, 13.55, 1),
    ],
    pictures: [{ x: 3.1, y: 1.9, w: 21.8, h: 10.2 }],
    title: {
      x: 3.1,
      y: 12.3,
      w: 21.8,
      h: 1.8,
      size: 28,
      italic: true,
      bold: false,
      align: 'center',
      valign: 'middle',
      sample: 'Seerosen, früher Nachmittag',
    },
  },
  {
    name: 'Schluss',
    bg: indigo,
    shapes: [whole(pictures.dusk), ...dabs(13.2, 7.3, ['#f9d088', '#f3a9bd', '#fbf6ea'])],
    title: {
      x: 4,
      y: 2.4,
      w: 20,
      h: 4.6,
      size: 72,
      color: cream,
      align: 'center',
      valign: 'bottom',
      sample: 'Vielen Dank',
    },
    subtitle: {
      x: 5,
      y: 7.9,
      w: 18,
      h: 1.3,
      color: '#fbe9cf',
      align: 'center',
      sample: 'Bleiben Sie, bis das Licht geht',
    },
  },
];

const template: Template = {
  slug: 'impressionismus',
  name: 'Impressionismus',
  group: 'Kunststil',
  tags: [
    'Impressionismus',
    'Malerei',
    'Pinselstrich',
    'Licht',
    'Natur',
    'Garten',
    'hell',
    'elegant',
    'Kultur',
  ],
  description:
    'Gemalte Gründe aus tausenden kurzen Pinselstrichen: See am Morgen, Garten, Teich und Feld in der Dämmerung.',
  palette: {
    bg: cream,
    text: indigo,
    bg2: sand,
    text2: slate,
    accents: [water, leaf, poppy, lilac, sun, rose],
  },
  fonts: { head: 'Cormorant Garamond', body: 'Lora' },
  text: {
    title: { font: 'Cormorant Garamond', size: 62, color: indigo, bold: true, lineHeight: 96 },
    subtitle: { font: 'Lora', size: 20, color: '#414873', italic: true },
    body: { font: 'Lora', size: 20, color: indigo, lineHeight: 128, paraSpace: 0.32 },
  },
  layouts,
  samplePictures: [pictures.lake, pictures.dusk],
};

export default template;
