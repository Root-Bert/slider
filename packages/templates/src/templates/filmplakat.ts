import { grain, jpeg, noise, paint, rgb, rgba, rng, type Paint } from '../art';
import type { Layout, Picture, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page } from '../shapes';

/*
 * Filmplakat: the sheet in the cinema's showcase – night grounds painted with light (a beam
 * through haze, a glow on the horizon, a spot on a stage, a curtain), the letterbox bars of the
 * wide screen, the title wide and letter-spaced at the bottom, the small print narrow like a
 * billing block.
 */

const night = '#0a0f14';
const bone = '#efe6d2';
const amber = '#e9a13b';
const ember = '#c2452b';
const teal = '#1d4553';
const steel = '#a7b6bd';
const black = '#000000';

/** The grounds are drawn smaller than the page's full 1920 px: they are soft anyway. */
const PXG = 1440 / PAGE.w;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function sky(surface: Paint, stops: readonly (readonly [number, string])[]): void {
  const { ctx, w, h } = surface;
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Light falling from a point to a place, soft at its edges. Worked out pixel by pixel: thin
 * see-through layers would show their steps.
 */
function cone(
  surface: Paint,
  from: readonly [number, number],
  to: readonly [number, number],
  halfWidth: number,
  color: string,
  alpha: number,
): void {
  const { ctx, w, h } = surface;
  const [ax, ay, tx, ty] = [from[0] * w, from[1] * h, to[0] * w, to[1] * h];
  const length = Math.hypot(tx - ax, ty - ay);
  const [dx, dy] = [(tx - ax) / length, (ty - ay) / length];
  const [r, g, b] = rgb(color);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const along = ((x - ax) * dx + (y - ay) * dy) / length;
      if (along <= 0 || along > 1.25) continue;
      const across = Math.abs((x - ax) * dy - (y - ay) * dx);
      const reach = halfWidth * w * (0.05 + 0.95 * along);
      const side = 1 - across / reach;
      if (side <= 0) continue;
      const soft = side * side * (3 - 2 * side);
      const end = along > 1 ? 1 - (along - 1) / 0.25 : 1;
      const a = alpha * soft * (1 - along * 0.6) * end;
      const i = (y * w + x) * 4;
      data[i] = data[i]! + r * a;
      data[i + 1] = data[i + 1]! + g * a;
      data[i + 2] = data[i + 2]! + b * a;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** A soft glow: an ellipse of light fading out. */
function glow(
  surface: Paint,
  at: readonly [number, number],
  rx: number,
  ry: number,
  color: string,
  alpha: number,
): void {
  const { ctx, w, h } = surface;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(at[0] * w, at[1] * h);
  ctx.scale(1, (ry * h) / (rx * w));
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * w);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(0.4, rgba(color, alpha * 0.42));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, rx * w, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Haze drifting through the picture: `amount` says how thick it is at a place. */
function haze(
  surface: Paint,
  seed: number,
  color: string,
  amount: (u: number, v: number) => number,
): void {
  const { ctx, w, h } = surface;
  const field = noise(seed);
  const [r, g, b] = rgb(color);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const thick = amount(x / w, y / h);
      if (thick <= 0) continue;
      const a = clamp((field(x / 380, y / 150, 4) - 0.32) * 1.7) * thick;
      const i = (y * w + x) * 4;
      data[i] = data[i]! + (r - data[i]!) * a;
      data[i + 1] = data[i + 1]! + (g - data[i + 1]!) * a;
      data[i + 2] = data[i + 2]! + (b - data[i + 2]!) * a;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** A dark ridge across the picture; gives its height at a place for what stands on it. */
function ridge(surface: Paint, seed: number, base: number, height: number, color: string) {
  const { ctx, w, h } = surface;
  const field = noise(seed);
  const at = (x: number) => (base - field(x / (w * 0.22), seed, 4) * height) * h;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) ctx.lineTo(x, at(x));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  return at;
}

function finish(surface: Paint, seed: number, dark = 0.7): Picture {
  const { ctx, w, h } = surface;
  const edge = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.72);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, `rgba(0,0,0,${dark})`);
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  grain(surface, 0.05, seed);
  return jpeg(surface, 78);
}

/** A beam from above through haze onto a ridge where someone stands. */
function beamGround(): Picture {
  const surface = paint(PAGE, PXG);
  const { ctx, w, h } = surface;
  sky(surface, [
    [0, '#05090d'],
    [0.5, '#0e2630'],
    [0.75, '#16343d'],
    [1, '#070c10'],
  ]);
  glow(surface, [0.5, 0.6], 0.5, 0.2, teal, 0.55);
  cone(surface, [0.7, -0.12], [0.5, 0.6], 0.15, '#cfe3e2', 0.5);
  cone(surface, [0.7, -0.12], [0.5, 0.6], 0.06, '#fff3d6', 0.4);
  haze(surface, 21, '#7fa3a8', (u, v) => 0.34 * clamp(1 - Math.abs(v - 0.5) * 2.4));
  glow(surface, [0.5, 0.56], 0.2, 0.05, '#fff0cf', 0.55);
  const top = ridge(surface, 5, 0.615, 0.1, '#04070a');
  // Someone small in the light: a coat and a head.
  const x = w * 0.5;
  const foot = top(x) + 2;
  const tall = h * 0.085;
  ctx.fillStyle = '#04070a';
  ctx.beginPath();
  ctx.moveTo(x - tall * 0.17, foot);
  ctx.lineTo(x - tall * 0.1, foot - tall * 0.8);
  ctx.lineTo(x + tall * 0.1, foot - tall * 0.8);
  ctx.lineTo(x + tall * 0.19, foot);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, foot - tall * 0.9, tall * 0.09, 0, Math.PI * 2);
  ctx.fill();
  return finish(surface, 2);
}

/** The last light on a horizon over a plain that mirrors it. */
function horizonGround(): Picture {
  const surface = paint(PAGE, PXG);
  const { ctx, w, h } = surface;
  const line = 0.6;
  sky(surface, [
    [0, '#04070b'],
    [0.38, '#0b1b25'],
    [line, '#1c3640'],
    [1, '#1c3640'],
  ]);
  glow(surface, [0.66, line], 0.62, 0.2, ember, 0.75);
  glow(surface, [0.66, line], 0.34, 0.1, amber, 0.9);
  glow(surface, [0.66, line], 0.1, 0.045, '#fff1cc', 0.95);
  haze(surface, 33, '#d98a4a', (u, v) => 0.3 * clamp(1 - Math.abs(v - (line - 0.09)) * 7));
  ridge(surface, 9, line + 0.004, 0.05, '#081017');
  const plain = ctx.createLinearGradient(0, line * h, 0, h);
  plain.addColorStop(0, '#0c181f');
  plain.addColorStop(1, '#030506');
  ctx.fillStyle = plain;
  ctx.fillRect(0, line * h, w, h);
  const random = rng(77);
  for (let i = 0; i < 150; i += 1) {
    const depth = random() ** 1.6;
    const y = (line + 0.006 + depth * 0.36) * h;
    const reach = w * (0.03 + depth * 0.2) * random.range(0.3, 1);
    const x = w * 0.66 + random.bell() * w * (0.05 + depth * 0.16);
    ctx.fillStyle = rgba(depth < 0.25 ? '#ffd9a0' : amber, (1 - depth) * 0.34 * random());
    ctx.fillRect(x - reach / 2, y, reach, Math.max(1, h * 0.0022 * (1 + depth * 2)));
  }
  return finish(surface, 4);
}

/** A quiet night ground for pages that carry text. */
function quietGround(): Picture {
  const surface = paint(PAGE, PXG);
  sky(surface, [
    [0, '#0b1319'],
    [0.55, '#0f1d25'],
    [1, '#080d12'],
  ]);
  glow(surface, [0.88, 0.05], 0.7, 0.75, '#2c5a68', 0.5);
  cone(surface, [1.02, -0.1], [0.5, 1.1], 0.24, '#bcd6d6', 0.09);
  haze(surface, 51, '#5f8088', (u, v) => 0.16 * clamp(u * 1.2 - 0.1) * clamp(1.2 - v));
  return finish(surface, 6, 0.55);
}

/** A spot from above onto a stage. */
function spotGround(): Picture {
  const surface = paint(PAGE, PXG);
  sky(surface, [
    [0, '#06090d'],
    [0.66, '#0e1e26'],
    [0.67, '#0a1419'],
    [1, '#04070a'],
  ]);
  cone(surface, [0.5, -0.2], [0.5, 0.66], 0.3, '#c9dedd', 0.3);
  cone(surface, [0.5, -0.2], [0.5, 0.66], 0.12, '#fff1d2', 0.12);
  haze(
    surface,
    61,
    '#86a7ab',
    (u, v) => 0.26 * clamp(1 - Math.abs(u - 0.5) * 3.2) * clamp(1.5 - v * 2),
  );
  glow(surface, [0.5, 0.665], 0.3, 0.035, '#fff0cf', 0.8);
  glow(surface, [0.5, 0.67], 0.42, 0.09, amber, 0.22);
  return finish(surface, 8, 0.8);
}

/** The curtain before the film: heavy folds, lit from below. */
function curtainGround(): Picture {
  const surface = paint(PAGE, PXG);
  const { ctx, w, h } = surface;
  for (let x = 0; x < w; x += 1) {
    const u = x / w;
    const fold = Math.sin(u * Math.PI * 2 * 13 + Math.sin(u * Math.PI * 2 * 2.5) * 1.8);
    const light = ((fold + 1) / 2) ** 1.7;
    const [r, g, b] = [22 + light * 78, 5 + light * 12, 8 + light * 14];
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, `rgb(${r * 0.35},${g * 0.35},${b * 0.35})`);
    gradient.addColorStop(0.75, `rgb(${r * 0.8},${g * 0.8},${b * 0.8})`);
    gradient.addColorStop(1, `rgb(${r},${g},${b})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, 1, h);
  }
  glow(surface, [0.5, 1.02], 0.6, 0.3, '#ff9a5a', 0.22);
  return finish(surface, 10, 0.85);
}

const beam = beamGround();
const horizon = horizonGround();
const quiet = quietGround();
const spot = spotGround();
const curtain = curtainGround();

const ground = (src: Picture): Shape => ({ t: 'image', ...page, src });

/** The wide screen's bars. */
const BAR = 1.15;
const bars: Shape[] = [
  { t: 'rect', x: -0.1, y: -0.1, w: 28.2, h: BAR + 0.1, fill: black },
  { t: 'rect', x: -0.1, y: PAGE.h - BAR, w: 28.2, h: BAR + 0.1, fill: black },
];

/** A row or column of a film strip's holes. */
const holes = (x: number, y: number, count: number, vertical = false, color = '#1a252c'): Shape[] =>
  Array.from({ length: count }, (_, index): Shape =>
    vertical
      ? { t: 'rect', x, y: y + index * 1.02, w: 0.72, h: 0.5, r: 0.1, fill: color }
      : { t: 'rect', x: x + index * 1.02, y, w: 0.5, h: 0.5, r: 0.1, fill: color },
  );

const hair = (x: number, y: number, w: number, color = amber): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h: 0.06,
  fill: color,
});

const diamond = (cx: number, cy: number, r: number, color = amber): Shape => ({
  t: 'poly',
  fill: color,
  pts: [
    [cx, cy - r],
    [cx + r, cy],
    [cx, cy + r],
    [cx - r, cy],
  ],
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: night,
    shapes: [ground(beam), ...bars, hair(12.7, 12.45, 2.6)],
    title: {
      x: 1.6,
      y: 9.5,
      w: 24.8,
      h: 2.8,
      size: 66,
      spacing: 10,
      sample: 'Das letzte Quartal',
    },
    subtitle: {
      x: 4,
      y: 12.75,
      w: 20,
      h: 1.6,
      sample: 'Nach einer wahren Jahresplanung\nMit dem gesamten Team in allen Hauptrollen',
    },
  },
  {
    name: 'Abschnitt',
    bg: night,
    shapes: [ground(horizon), ...bars, { t: 'rect', x: 2, y: 10.2, w: 0.08, h: 3.5, fill: amber }],
    title: {
      x: 2.6,
      y: 9.9,
      w: 16,
      h: 2.6,
      align: 'left',
      size: 66,
      spacing: 8,
      sample: 'Zweiter Akt',
    },
    subtitle: {
      x: 2.65,
      y: 12.6,
      w: 14,
      h: 1.2,
      align: 'left',
      size: 17,
      color: amber,
      sample: 'Die Zahlen schlagen zurück',
    },
  },
  {
    name: 'Inhalt',
    bg: night,
    shapes: [
      ground(quiet),
      ...bars,
      {
        t: 'rect',
        x: 24.85,
        y: BAR,
        w: 1.5,
        h: PAGE.h - 2 * BAR,
        fill: { t: 'solid', color: black, opacity: 0.55 },
      },
      ...holes(25.24, 1.5, 13, true),
      hair(2, 3.85, 2.6),
    ],
    title: { x: 2, y: 1.6, w: 21.6, h: 2, align: 'left', size: 40, spacing: 4 },
    body: { x: 2, y: 4.6, w: 21.4, h: 9.6 },
  },
  {
    name: 'Text und Bild',
    bg: night,
    shapes: [
      ground(quiet),
      ...bars,
      { t: 'rect', x: 12.6, y: BAR, w: 0.08, h: PAGE.h - 2 * BAR, fill: amber },
      hair(14.2, 5.05, 2.6),
    ],
    pictures: [{ x: 0, y: BAR, w: 12.6, h: PAGE.h - 2 * BAR }],
    title: { x: 14.2, y: 1.6, w: 12.2, h: 3.2, align: 'left', size: 36, spacing: 3.5 },
    body: { x: 14.2, y: 5.8, w: 12.2, h: 8.4, size: 20 },
  },
  {
    name: 'Zwei Spalten',
    bg: night,
    shapes: [
      { t: 'image', x: -8, y: -3, w: 39.2, h: 22.05, src: quiet },
      ...bars,
      hair(2, 2.65, 3.4),
      hair(22.6, 2.65, 3.4),
      {
        t: 'rect',
        x: 13.97,
        y: 4.7,
        w: 0.06,
        h: 9.2,
        fill: { t: 'solid', color: amber, opacity: 0.7 },
      },
      diamond(14, 4.5, 0.24),
      diamond(14, 14.1, 0.24),
    ],
    title: {
      x: 5.8,
      y: 1.65,
      w: 16.4,
      h: 2,
      valign: 'middle',
      size: 34,
      spacing: 4,
      sample: 'Held und Gegenspieler',
    },
    body: [
      { x: 2, y: 4.7, w: 11, h: 9.4, size: 20 },
      { x: 15, y: 4.7, w: 11, h: 9.4, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: night,
    shapes: [ground(spot), ...bars],
    title: {
      x: 3,
      y: 1.6,
      w: 22,
      h: 8.6,
      valign: 'bottom',
      size: 220,
      spacing: 6,
      lineHeight: 90,
      sample: '94 %',
    },
    body: {
      x: 4,
      y: 11.2,
      w: 20,
      h: 3.2,
      align: 'center',
      size: 21,
      lineHeight: 108,
      sample: 'des Publikums bleiben bis zum Abspann,\nwenn die erste Minute sitzt.',
    },
  },
  {
    name: 'Zitat',
    bg: night,
    shapes: [
      ground(curtain),
      ...bars,
      {
        t: 'text',
        x: 8,
        y: 1.75,
        w: 12,
        h: 1.5,
        text: '★★★★★',
        font: 'DejaVu Sans',
        size: 24,
        spacing: 9,
        color: amber,
        align: 'center',
        valign: 'middle',
      },
      hair(12.7, 11.45, 2.6),
    ],
    body: {
      x: 3.4,
      y: 3.5,
      w: 21.2,
      h: 7.5,
      align: 'center',
      valign: 'middle',
      font: 'Playfair Display',
      italic: true,
      size: 33,
      lineHeight: 122,
      sample: '„Zwei Stunden, in denen niemand auf die Uhr schaut. Ein Ereignis.“',
    },
    subtitle: {
      x: 5,
      y: 11.9,
      w: 18,
      h: 1.4,
      size: 17,
      color: bone,
      sample: 'Mara Lindt, Filmkritik',
    },
  },
  {
    name: 'Bild',
    bg: black,
    shapes: [...holes(0.5, 0.33, 27), ...holes(0.5, 14.95, 27), hair(12.7, 14.2, 2.6)],
    pictures: [{ x: 0, y: BAR, w: 28, h: 10.55 }],
    title: {
      x: 2,
      y: 12.05,
      w: 24,
      h: 1.9,
      valign: 'middle',
      size: 34,
      spacing: 9,
      sample: 'Drehort bei Sonnenaufgang',
    },
  },
  {
    name: 'Schluss',
    bg: night,
    shapes: [ground(horizon), ...bars, hair(12.7, 7.95, 2.6)],
    title: {
      x: 2,
      y: 3.0,
      w: 24,
      h: 4.6,
      size: 120,
      spacing: 34,
      lineHeight: 90,
      sample: 'Ende',
    },
    subtitle: {
      x: 4,
      y: 12.3,
      w: 20,
      h: 1.9,
      sample: 'Buch und Regie: das ganze Team\nFragen aus dem Saal sind ausdrücklich erwünscht',
    },
  },
];

const template: Template = {
  slug: 'filmplakat',
  name: 'Filmplakat',
  group: 'Plakat',
  tags: ['Film', 'Kino', 'dunkel', 'dramatisch', 'Breitbild', 'Premiere', 'Keynote', 'Trailer'],
  description:
    'Großes Kino im Breitbild: Nachtgründe aus Licht und Dunst, ein weit gesperrter Titel und Kleingedrucktes wie im Abspann.',
  palette: {
    bg: night,
    text: bone,
    bg2: '#16252d',
    text2: steel,
    accents: [amber, ember, teal, '#6d8f99', '#f4d9a0', '#7a1a1d'],
  },
  fonts: { head: 'Bebas Neue', body: 'Oswald' },
  text: {
    title: {
      font: 'Bebas Neue',
      size: 60,
      color: bone,
      align: 'center',
      spacing: 8,
      lineHeight: 100,
    },
    subtitle: {
      font: 'Oswald',
      size: 14,
      color: steel,
      align: 'center',
      upper: true,
      spacing: 3,
      lineHeight: 140,
    },
    body: { font: 'Oswald', size: 22, color: bone, lineHeight: 135, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
