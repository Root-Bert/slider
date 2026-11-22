import { grain, jpeg, mix, noise, paint, rgba, rng, type Paint } from '../art';
import type { Color, Layout, Picture, Shape, Stroke, Template } from '../model';
import { page, smoothPath } from '../shapes';

/*
 * Landschaft: the land in layers – ridge behind ridge, each paler in the haze, fir lines in
 * front, a lake that mirrors the sky. Every layout is another hour of the day, painted by rule;
 * contour lines of a map are the only ornament. Text stands in the calm sky or on paper.
 */

const paperColor = '#f5f0e6';
const ink = '#1d2940';
const mist = '#dfe7e4';
const slate = '#566477';
const dawn = '#e5a092';
const gold = '#eeb055';
const forest = '#3c6a5c';
const lake = '#4e8ca3';
const plum = '#764f73';
const night = '#22355a';
const cream = '#fbf2de';

/** One ridge of the land: where its foot lies, how high it rises, how it sinks into the haze. */
interface Ridge {
  /** Its foot and its height, as shares of the picture's height. */
  y: number;
  amp: number;
  color: Color;
  /** What it fades to towards its foot. */
  haze: Color;
  /** 0 rolling hills … 1 sharp peaks. */
  rough?: number;
  /** How many rises across the picture. */
  scale?: number;
  /** Firs along it, as high as this share of the picture. */
  trees?: number;
  /** How much of its height it has at a place across (0 … 1). */
  env?: (u: number) => number;
  seed: number;
}

interface Scene {
  sky: readonly (readonly [number, Color, number?])[];
  sun?: {
    x: number;
    y: number;
    r: number;
    color: Color;
    glow: Color;
    reach: number;
    moon?: boolean;
  };
  stars?: number;
  clouds?: { count: number; color: Color; from: number; to: number; alpha: number };
  ridges: readonly Ridge[];
  lake?: { y: number; color: Color; shine: Color };
  /** What stands before the lake. */
  front?: readonly Ridge[];
  seed: number;
}

/** A paper ground: clouded a little; the grain comes last, over everything. */
function paperOn(surface: Paint): void {
  const { ctx, w, h } = surface;
  ctx.fillStyle = paperColor;
  ctx.fillRect(0, 0, w, h);
  const field = noise(5);
  for (let i = 0; i < 60; i += 1) {
    const [x, y] = [
      field(i * 1.7, 3, 1) * w * 1.2 - w * 0.1,
      field(9, i * 1.3, 1) * h * 1.2 - h * 0.1,
    ];
    const r = w * (0.08 + field(i, i, 1) * 0.14);
    const cloud = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = i % 2 === 0 ? '#e9dfcd' : '#fffaf0';
    cloud.addColorStop(0, rgba(tone, 0.22));
    cloud.addColorStop(1, rgba(tone, 0));
    ctx.fillStyle = cloud;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Paints a scene into a picture, from `top` (share of its height) down. */
function drawScene(surface: Paint, scene: Scene, top = 0): void {
  const { ctx, w, h } = surface;
  const y0 = top * h;
  const H = h - y0;
  const Y = (v: number) => y0 + v * H;
  const random = rng(scene.seed);

  const air = ctx.createLinearGradient(0, y0, 0, h);
  for (const [offset, color, alpha] of scene.sky) air.addColorStop(offset, rgba(color, alpha ?? 1));
  ctx.fillStyle = air;
  ctx.fillRect(0, y0, w, H);

  for (let i = 0; i < (scene.stars ?? 0); i += 1) {
    const [x, y] = [random() * w, Y(random() ** 1.5 * 0.62)];
    ctx.fillStyle = rgba('#fff8e6', random.range(0.25, 0.9) * (1 - (y - y0) / H / 0.7));
    ctx.beginPath();
    ctx.arc(x, y, random.range(0.6, 1.9) * (random() > 0.94 ? 1.6 : 1), 0, Math.PI * 2);
    ctx.fill();
  }

  if (scene.sun) {
    const sun = scene.sun;
    const [x, y, r] = [sun.x * w, Y(sun.y), sun.r * w];
    const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, sun.reach * w);
    glow.addColorStop(0, rgba(sun.glow, 0.8));
    glow.addColorStop(0.3, rgba(sun.glow, 0.28));
    glow.addColorStop(1, rgba(sun.glow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, y0, w, H);
    ctx.fillStyle = sun.color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (sun.moon) {
      // Its seas: a few soft shadows, kept inside the disc.
      ctx.save();
      ctx.clip();
      for (let i = 0; i < 9; i += 1) {
        const [mx, my] = [x + random.range(-0.8, 0.8) * r, y + random.range(-0.8, 0.8) * r];
        const mr = r * random.range(0.18, 0.5);
        const sea = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
        sea.addColorStop(0, rgba('#8f9bb0', 0.2));
        sea.addColorStop(1, rgba('#8f9bb0', 0));
        ctx.fillStyle = sea;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      const shade = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
      shade.addColorStop(0, 'rgba(255,255,255,0.25)');
      shade.addColorStop(1, rgba('#7f8dab', 0.28));
      ctx.fillStyle = shade;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();
    }
  }

  if (scene.clouds) {
    const clouds = scene.clouds;
    for (let i = 0; i < clouds.count; i += 1) {
      const [x, y] = [random() * w, Y(random.range(clouds.from, clouds.to))];
      const rx = w * random.range(0.07, 0.24);
      const flat = random.range(0.035, 0.075);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, flat);
      const cloud = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      cloud.addColorStop(0, rgba(clouds.color, clouds.alpha));
      cloud.addColorStop(0.6, rgba(clouds.color, clouds.alpha * 0.5));
      cloud.addColorStop(1, rgba(clouds.color, 0));
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const ridge = (spec: Ridge) => {
    const field = noise(spec.seed);
    const rough = spec.rough ?? 0.5;
    const crest = (x: number) => {
      const u = x / w;
      const n = field(u * (spec.scale ?? 3) + 5, (spec.seed * 0.37) % 40, 5);
      const peaks = 1 - Math.abs(2 * n - 1);
      const value = n + (peaks - n) * rough;
      return Y(spec.y) - value * spec.amp * H * (spec.env ? Math.max(0, spec.env(u)) : 1);
    };
    const fill = ctx.createLinearGradient(0, Y(spec.y - spec.amp), 0, Y(spec.y + 0.05));
    fill.addColorStop(0, spec.color);
    fill.addColorStop(1, spec.haze);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, h + 2);
    for (let x = 0; x <= w + 3; x += 3) ctx.lineTo(x, crest(x));
    ctx.lineTo(w, h + 2);
    ctx.closePath();
    ctx.fill();
    if (!spec.trees) return;
    // Firs: tiers widening downwards, standing on the crest.
    ctx.fillStyle = spec.color;
    const tall = spec.trees * H;
    for (let x = -tall; x < w + tall; x += tall * random.range(0.14, 0.42)) {
      const foot = crest(x) + tall * 0.12;
      if (foot > h + tall) continue;
      const height = tall * random.range(0.45, 1);
      const width = height * random.range(0.3, 0.4);
      const tiers = 4;
      for (let tier = 0; tier < tiers; tier += 1) {
        const tip = foot - height + (tier * height * 0.82) / tiers;
        const half = (width / 2) * (0.3 + (0.7 * (tier + 1)) / tiers);
        ctx.beginPath();
        ctx.moveTo(x, tip);
        ctx.lineTo(x + half, tip + height * 0.42);
        ctx.lineTo(x - half, tip + height * 0.42);
        ctx.closePath();
        ctx.fill();
      }
    }
  };

  scene.ridges.forEach(ridge);

  if (scene.lake) {
    const shore = Math.round(Y(scene.lake.y));
    const depth = h - shore;
    const reach = Math.min(shore - Math.round(y0), depth);
    const mirror = paint({ w: 1, h: 1 }, 1);
    mirror.canvas.width = w;
    mirror.canvas.height = reach;
    mirror.ctx.drawImage(surface.canvas, 0, shore - reach, w, reach, 0, 0, w, reach);
    ctx.fillStyle = scene.lake.color;
    ctx.fillRect(0, shore, w, depth);
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.translate(0, shore + reach);
    ctx.scale(1, -1);
    ctx.drawImage(mirror.canvas, 0, 0);
    ctx.restore();
    const deep = ctx.createLinearGradient(0, shore, 0, h);
    deep.addColorStop(0, rgba(scene.lake.color, 0.05));
    deep.addColorStop(1, rgba(scene.lake.color, 0.7));
    ctx.fillStyle = deep;
    ctx.fillRect(0, shore, w, depth);
    for (let i = 0; i < 220; i += 1) {
      const y = shore + random() ** 1.4 * depth;
      const length = w * random.range(0.02, 0.16);
      ctx.fillStyle = rgba(scene.lake.shine, random.range(0.05, 0.2));
      ctx.fillRect(random() * w - length / 2, y, length, random.range(1, 2.6));
    }
    const band = ctx.createLinearGradient(0, shore - H * 0.03, 0, shore + H * 0.03);
    band.addColorStop(0, rgba(scene.lake.shine, 0));
    band.addColorStop(0.5, rgba(scene.lake.shine, 0.6));
    band.addColorStop(1, rgba(scene.lake.shine, 0));
    ctx.fillStyle = band;
    ctx.fillRect(0, shore - H * 0.03, w, H * 0.06);
  }

  (scene.front ?? []).forEach(ridge);
}

const picture = (scene: Scene, quality = 80): Picture => {
  const surface = paint();
  drawScene(surface, scene);
  grain(surface, 0.028, scene.seed);
  return jpeg(surface, quality);
};

// The hours of the day.

const dawnScene: Scene = {
  seed: 10,
  sky: [
    [0, '#b4c0dc'],
    [0.3, '#e3cdd6'],
    [0.5, '#f7d6bf'],
    [0.64, '#fde9ca'],
  ],
  sun: { x: 0.76, y: 0.47, r: 0.026, color: '#fff6dc', glow: '#ffdca6', reach: 0.36 },
  clouds: { count: 7, color: '#fbe3d2', from: 0.36, to: 0.5, alpha: 0.5 },
  ridges: [
    {
      y: 0.64,
      amp: 0.36,
      color: '#bfb0cf',
      haze: '#f6ddd0',
      rough: 0.9,
      scale: 2.2,
      env: (u) => 0.35 + 0.65 * u,
      seed: 11,
    },
    {
      y: 0.72,
      amp: 0.27,
      color: '#9d92be',
      haze: '#f1d3cb',
      rough: 0.8,
      scale: 3,
      env: (u) => 0.55 + 0.45 * u,
      seed: 12,
    },
    { y: 0.8, amp: 0.2, color: '#716d9f', haze: '#dcbfc8', rough: 0.6, scale: 3.6, seed: 13 },
    {
      y: 0.9,
      amp: 0.16,
      color: '#474d7b',
      haze: '#a391b0',
      rough: 0.3,
      scale: 4,
      trees: 0.03,
      seed: 14,
    },
    {
      y: 1.02,
      amp: 0.16,
      color: '#232a4a',
      haze: '#343a62',
      rough: 0.15,
      scale: 3,
      trees: 0.07,
      seed: 15,
    },
  ],
};

const noonScene: Scene = {
  seed: 20,
  sky: [
    [0, '#8fc5e0'],
    [0.42, '#cbe5ee'],
    [0.64, '#eef6ee'],
  ],
  clouds: { count: 6, color: '#ffffff', from: 0.4, to: 0.5, alpha: 0.55 },
  ridges: [
    { y: 0.66, amp: 0.24, color: '#93b7ce', haze: '#e3f0ee', rough: 0.92, scale: 2.4, seed: 21 },
    { y: 0.68, amp: 0.15, color: '#6798b0', haze: '#cde2e2', rough: 0.7, scale: 3.6, seed: 22 },
    {
      y: 0.7,
      amp: 0.07,
      color: '#3b7672',
      haze: '#8db6ab',
      rough: 0.3,
      scale: 5,
      trees: 0.022,
      seed: 23,
    },
  ],
  lake: { y: 0.7, color: '#5697b2', shine: '#f6fcf6' },
  front: [
    {
      y: 1.04,
      amp: 0.3,
      color: '#1c4640',
      haze: '#285a50',
      rough: 0.2,
      scale: 2.4,
      trees: 0.1,
      env: (u) => 1 - u * 2.6,
      seed: 24,
    },
    {
      y: 1.04,
      amp: 0.22,
      color: '#1c4640',
      haze: '#285a50',
      rough: 0.2,
      scale: 2.4,
      trees: 0.08,
      env: (u) => (u - 0.72) * 3.4,
      seed: 25,
    },
  ],
};

const morningStrip: Scene = {
  seed: 30,
  sky: [
    [0, paperColor, 0],
    [0.5, '#eaeee6', 0.9],
    [0.75, '#f4e8d2', 1],
  ],
  ridges: [
    { y: 0.74, amp: 0.5, color: '#b9cac8', haze: '#eef0e6', rough: 0.88, scale: 2.6, seed: 31 },
    { y: 0.84, amp: 0.38, color: '#90adab', haze: '#e0e9df', rough: 0.6, scale: 3.4, seed: 32 },
    {
      y: 0.96,
      amp: 0.3,
      color: '#5d8785',
      haze: '#bbd0c8',
      rough: 0.3,
      scale: 4,
      trees: 0.1,
      seed: 33,
    },
    {
      y: 1.12,
      amp: 0.3,
      color: '#2e5858',
      haze: '#3d6a68',
      rough: 0.2,
      scale: 3,
      trees: 0.2,
      seed: 34,
    },
  ],
};

const duskScene: Scene = {
  seed: 50,
  sky: [
    [0, '#2b2a58'],
    [0.3, '#684378'],
    [0.56, '#c0607a'],
    [0.74, '#f09a6a'],
    [0.84, '#f9c98a'],
  ],
  sun: { x: 0.5, y: 0.85, r: 0.022, color: '#fff1cf', glow: '#ffc98a', reach: 0.3 },
  clouds: { count: 8, color: '#f3a184', from: 0.05, to: 0.24, alpha: 0.22 },
  ridges: [
    { y: 0.9, amp: 0.16, color: '#94506f', haze: '#e58d70', rough: 0.9, scale: 2.4, seed: 51 },
    { y: 0.95, amp: 0.13, color: '#5b3562', haze: '#a3537a', rough: 0.6, scale: 3.4, seed: 52 },
    {
      y: 1.04,
      amp: 0.12,
      color: '#261c3e',
      haze: '#3a2852',
      rough: 0.2,
      scale: 3,
      trees: 0.05,
      seed: 53,
    },
  ],
};

const nightScene: Scene = {
  seed: 60,
  sky: [
    [0, '#0b1630'],
    [0.5, '#1b2e54'],
    [0.76, '#39547f'],
    [0.86, '#6c84a6'],
  ],
  stars: 300,
  sun: { x: 0.3, y: 0.4, r: 0.152, color: '#f4eeda', glow: '#9db5d8', reach: 0.42, moon: true },
  ridges: [
    { y: 0.76, amp: 0.16, color: '#3d5881', haze: '#8ca2be', rough: 0.9, scale: 2.4, seed: 61 },
    { y: 0.84, amp: 0.13, color: '#29416a', haze: '#5e7a9f', rough: 0.7, scale: 3.2, seed: 62 },
    {
      y: 0.93,
      amp: 0.1,
      color: '#162949',
      haze: '#2e4972',
      rough: 0.3,
      scale: 4,
      trees: 0.035,
      seed: 63,
    },
    {
      y: 1.04,
      amp: 0.1,
      color: '#091327',
      haze: '#0f1c37',
      rough: 0.2,
      scale: 3,
      trees: 0.085,
      seed: 64,
    },
  ],
};

const goldenScene: Scene = {
  seed: 70,
  sky: [
    [0, '#faeecd'],
    [0.4, '#f9dba4'],
    [0.62, '#f5b572'],
    [0.74, '#ee8f5c'],
  ],
  sun: { x: 0.5, y: 0.68, r: 0.034, color: '#fff7e0', glow: '#ffe6ae', reach: 0.4 },
  clouds: { count: 7, color: '#ee9872', from: 0.56, to: 0.66, alpha: 0.3 },
  ridges: [
    { y: 0.78, amp: 0.15, color: '#d98566', haze: '#f7c48c', rough: 0.88, scale: 2.5, seed: 71 },
    { y: 0.85, amp: 0.13, color: '#a7585c', haze: '#e79c72', rough: 0.6, scale: 3.2, seed: 72 },
    {
      y: 0.94,
      amp: 0.12,
      color: '#6c3a51',
      haze: '#b7666b',
      rough: 0.3,
      scale: 4,
      trees: 0.03,
      seed: 73,
    },
    {
      y: 1.04,
      amp: 0.12,
      color: '#382036',
      haze: '#552f49',
      rough: 0.2,
      scale: 3,
      trees: 0.08,
      seed: 74,
    },
  ],
};

const blueScene: Scene = {
  seed: 90,
  sky: [
    [0, '#182750'],
    [0.32, '#364d82'],
    [0.54, '#8982a8'],
    [0.66, '#e6a892'],
    [0.71, '#f7d0a8'],
  ],
  stars: 110,
  ridges: [
    { y: 0.7, amp: 0.17, color: '#4a5a8b', haze: '#bb9ca8', rough: 0.9, scale: 2.4, seed: 91 },
    {
      y: 0.715,
      amp: 0.1,
      color: '#2a3964',
      haze: '#6b6a90',
      rough: 0.6,
      scale: 3.6,
      trees: 0.014,
      seed: 92,
    },
  ],
  lake: { y: 0.715, color: '#2f4476', shine: '#f8d9bc' },
  front: [
    {
      y: 1.05,
      amp: 0.34,
      color: '#0d1730',
      haze: '#15213f',
      rough: 0.2,
      scale: 2.4,
      trees: 0.12,
      env: (u) => 1 - u * 3.2,
      seed: 93,
    },
    {
      y: 1.05,
      amp: 0.34,
      color: '#0d1730',
      haze: '#15213f',
      rough: 0.2,
      scale: 2.4,
      trees: 0.12,
      env: (u) => (u - 0.69) * 3.2,
      seed: 94,
    },
  ],
};

const dawnPicture = picture(dawnScene);
const noonPicture = picture(noonScene);
const duskPicture = picture(duskScene);
const nightPicture = picture(nightScene);
const goldenPicture = picture(goldenScene);
const bluePicture = picture(blueScene);

/** Plain paper, and paper with the morning's forest along its foot. */
const paperPicture = (() => {
  const surface = paint();
  paperOn(surface);
  grain(surface, 0.03, 3);
  return jpeg(surface, 78);
})();
const morningPicture = (() => {
  const surface = paint();
  paperOn(surface);
  drawScene(surface, morningStrip, 0.66);
  grain(surface, 0.03, 4);
  return jpeg(surface, 80);
})();

const ground = (src: Picture): Shape => ({ t: 'image', ...page, src });

/** Contour lines of a hill as on a map: rings round its top, each wandering a little. */
function contours(
  cx: number,
  cy: number,
  radius: number,
  count: number,
  stroke: Stroke,
  seed: number,
  squash = 0.78,
): Shape[] {
  const field = noise(seed);
  return Array.from({ length: count }, (_, ringIndex): Shape => {
    const base = (radius * (ringIndex + 0.6)) / count;
    const points = Array.from({ length: 44 }, (_, index): [number, number] => {
      const angle = (index / 44) * Math.PI * 2;
      const drift = ringIndex * 0.1;
      const wander =
        field(Math.cos(angle) * 1.2 + 7 + drift, Math.sin(angle) * 1.2 + 7 + drift, 3) - 0.5;
      const reach = base * (1 + wander * 0.95);
      return [(cx + Math.cos(angle) * reach) * 100, (cy + Math.sin(angle) * reach * squash) * 100];
    });
    return {
      t: 'path',
      ...page,
      vb: [2800, 1575],
      d: smoothPath(points),
      fill: null,
      stroke: ringIndex % 4 === 3 ? { ...stroke, width: stroke.width * 2 } : stroke,
    };
  });
}

const mapLine = (color: Color, width = 0.025): Stroke => ({ color, width, join: 'round' });
const onPaper = mapLine(mix(paperColor, slate, 0.34));

/** A summit as a map marks it: a small triangle with its dot. */
const summit = (x: number, y: number, size: number, color: Color): Shape[] => [
  {
    t: 'poly',
    fill: null,
    stroke: { color, width: 0.045, join: 'round' },
    pts: [
      [x, y - size],
      [x + size * 0.9, y + size * 0.6],
      [x - size * 0.9, y + size * 0.6],
    ],
  },
  { t: 'ellipse', x: x - 0.06, y: y - 0.02, w: 0.12, h: 0.12, fill: color },
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: '#f7d6bf',
    shapes: [
      ground(dawnPicture),
      { t: 'line', x1: 2.1, y1: 1.9, x2: 4.3, y2: 1.9, stroke: { color: ink, width: 0.05 } },
      ...summit(4.85, 1.9, 0.26, ink),
    ],
    title: {
      x: 2,
      y: 2.2,
      w: 16.5,
      h: 5.2,
      size: 52,
      lineHeight: 96,
      valign: 'top',
      sample: 'Über den\nNebeln',
    },
    subtitle: { x: 2.1, y: 7.5, w: 13, h: 1.3, sample: 'Eine Wanderung in neun Etappen' },
  },
  {
    name: 'Abschnitt',
    bg: '#cbe5ee',
    shapes: [
      ground(noonPicture),
      { t: 'line', x1: 12.6, y1: 5.55, x2: 15.4, y2: 5.55, stroke: { color: ink, width: 0.05 } },
      ...summit(14, 1.75, 0.26, ink),
    ],
    title: {
      x: 4,
      y: 2.3,
      w: 20,
      h: 3,
      size: 54,
      align: 'center',
      valign: 'middle',
      sample: 'Am See',
    },
    subtitle: {
      x: 5,
      y: 5.75,
      w: 18,
      h: 1.2,
      align: 'center',
      sample: 'Mittag, Windstille, klare Sicht',
    },
  },
  {
    name: 'Inhalt',
    bg: paperColor,
    shapes: [ground(morningPicture), ...contours(27.2, 0.6, 7.4, 12, onPaper, 3)],
    title: { x: 1.8, y: 1.1, w: 19.5, h: 2.3, valign: 'middle', size: 38 },
    body: { x: 1.8, y: 3.8, w: 20.5, h: 7.4 },
  },
  {
    name: 'Text und Bild',
    bg: paperColor,
    shapes: [
      ground(paperPicture),
      ...contours(1.2, 15.6, 8.6, 13, onPaper, 8),
      { t: 'line', x1: 1.9, y1: 1.55, x2: 4.1, y2: 1.55, stroke: { color: forest, width: 0.05 } },
      ...summit(4.65, 1.55, 0.24, forest),
    ],
    title: { x: 1.8, y: 1.9, w: 12.2, h: 3.2, valign: 'middle', size: 34 },
    body: { x: 1.8, y: 5.4, w: 12.2, h: 8.6, size: 20 },
    pictures: [{ x: 15.2, y: 0, w: 12.8, h: 15.75 }],
  },
  {
    name: 'Zwei Spalten',
    // A light page under the dusk picture: bullets take their colour from the page ground.
    bg: paperColor,
    shapes: [
      ground(duskPicture),
      {
        t: 'rect',
        x: 1.8,
        y: 4.1,
        w: 11.8,
        h: 8.5,
        r: 0.18,
        fill: { t: 'solid', color: paperColor, opacity: 0.95 },
        shadow: { dx: 0, dy: 0.14, blur: 0.5, color: '#1c1433', opacity: 0.3 },
      },
      {
        t: 'rect',
        x: 14.4,
        y: 4.1,
        w: 11.8,
        h: 8.5,
        r: 0.18,
        fill: { t: 'solid', color: paperColor, opacity: 0.95 },
        shadow: { dx: 0, dy: 0.14, blur: 0.5, color: '#1c1433', opacity: 0.3 },
      },
    ],
    title: { x: 1.8, y: 0.9, w: 24.4, h: 2.5, valign: 'middle', size: 38, color: cream },
    body: [
      { x: 2.5, y: 4.7, w: 10.4, h: 7.3, size: 19 },
      { x: 15.1, y: 4.7, w: 10.4, h: 7.3, size: 19 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: '#1b2e54',
    shapes: [
      ground(nightPicture),
      ...contours(27.4, 0.4, 7, 11, mapLine('#5a76a3', 0.022), 17),
      { t: 'line', x1: 15.6, y1: 3.75, x2: 17.8, y2: 3.75, stroke: { color: gold, width: 0.05 } },
      ...summit(18.35, 3.75, 0.24, gold),
    ],
    title: {
      x: 4.1,
      y: 3.9,
      w: 8.6,
      h: 4.8,
      size: 84,
      color: night,
      align: 'center',
      valign: 'middle',
      sample: '83 %',
    },
    body: {
      x: 15.5,
      y: 4.2,
      w: 10.6,
      h: 4.8,
      size: 24,
      color: cream,
      valign: 'top',
      sample: 'der Sterne sieht nur,\nwer die Stadt hinter sich lässt.',
    },
  },
  {
    name: 'Zitat',
    bg: '#f9dba4',
    shapes: [
      ground(goldenPicture),
      {
        t: 'text',
        x: 12,
        y: 0.55,
        w: 4,
        h: 2.6,
        text: '“',
        font: 'DM Serif Display',
        size: 110,
        color: '#d9744f',
        align: 'center',
        valign: 'top',
      },
    ],
    body: {
      x: 4,
      y: 2.9,
      w: 20,
      h: 4.7,
      font: 'DM Serif Display',
      italic: true,
      size: 32,
      lineHeight: 118,
      color: '#3a2236',
      align: 'center',
      valign: 'middle',
      sample: 'Wer langsam geht, sieht, wie der Berg das Licht wechselt.',
    },
    subtitle: {
      x: 6,
      y: 7.75,
      w: 16,
      h: 1.1,
      color: '#5a3348',
      align: 'center',
      sample: 'Hanna Brandl, Bergführerin',
    },
  },
  {
    name: 'Bild',
    bg: paperColor,
    shapes: [
      ground(paperPicture),
      ...contours(26.6, 15.4, 6.4, 11, onPaper, 23),
      {
        t: 'rect',
        x: 1.9,
        y: 1.1,
        w: 24.2,
        h: 11.2,
        fill: '#fffdf8',
        shadow: { dx: 0, dy: 0.12, blur: 0.5, color: '#3a2e1c', opacity: 0.22 },
      },
      { t: 'line', x1: 2.3, y1: 13.05, x2: 4.5, y2: 13.05, stroke: { color: forest, width: 0.05 } },
      ...summit(5.05, 13.05, 0.24, forest),
    ],
    pictures: [{ x: 2.2, y: 1.4, w: 23.6, h: 10.6 }],
    title: {
      x: 2.2,
      y: 13.2,
      w: 18,
      h: 1.6,
      valign: 'middle',
      size: 28,
      sample: 'Blick vom Grat nach Süden',
    },
  },
  {
    name: 'Schluss',
    bg: '#364d82',
    shapes: [
      ground(bluePicture),
      { t: 'line', x1: 12.6, y1: 6.0, x2: 15.4, y2: 6.0, stroke: { color: cream, width: 0.05 } },
      ...summit(14, 1.75, 0.26, cream),
    ],
    title: {
      x: 4,
      y: 2.4,
      w: 20,
      h: 3.3,
      size: 60,
      color: cream,
      align: 'center',
      valign: 'middle',
      sample: 'Gute Heimkehr',
    },
    subtitle: {
      x: 5,
      y: 6.2,
      w: 18,
      h: 1.2,
      color: cream,
      align: 'center',
      sample: 'Danke fürs Mitgehen',
    },
  },
];

const template: Template = {
  slug: 'landschaft',
  name: 'Landschaft',
  group: 'Kunststil',
  tags: [
    'Landschaft',
    'Berge',
    'Natur',
    'Nebel',
    'See',
    'Höhenlinien',
    'ruhig',
    'Reise',
    'Outdoor',
  ],
  description:
    'Gemalte Bergketten im Dunst, Tannenlinien und Seen – jede Folie eine andere Tageszeit, dazu Höhenlinien wie auf einer Karte.',
  palette: {
    bg: paperColor,
    text: ink,
    bg2: mist,
    text2: slate,
    accents: [forest, lake, gold, dawn, plum, night],
  },
  fonts: { head: 'DM Serif Display', body: 'DM Sans' },
  text: {
    title: { font: 'DM Serif Display', size: 44, color: ink, lineHeight: 104 },
    subtitle: { font: 'DM Sans', size: 20, color: ink, spacing: 0.6 },
    body: { font: 'DM Sans', size: 22, color: ink, lineHeight: 125, paraSpace: 0.35 },
  },
  layouts,
  samplePictures: [noonPicture, goldenPicture],
};

export default template;
