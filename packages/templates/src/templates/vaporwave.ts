import { jpeg, paint, rng } from '../art';
import type { Box, Color, Fill, Layout, Shape, Template } from '../model';
import { page, polygon, squiggle } from '../shapes';

/*
 * Vaporwave: a dusk that never ends – violet running to pink and peach, a sun cut into stripes,
 * a grid floor to the horizon; for the working slides pastel air with soft panels, checks and
 * outlined triangles.
 */

const pastel = '#fbe3f2';
const ink = '#2b0f54';
const lavender = '#d9d4ff';
const plum = '#6b4a9c';
const pink = '#ff4fa3';
const cyan = '#2fe3e8';
const violet = '#8b3dff';
const yellow = '#ffe45c';
const peach = '#ff9a5a';
const mint = '#9af5d2';
const white = '#ffffff';

interface Dusk {
  /** Where the floor begins (cm from the top); none: sky only. */
  horizon?: number;
  sun?: { x: number; y: number; r: number; from?: number };
  /** Where the floor's lines meet. */
  vp?: number;
  stars?: number;
  seed?: number;
}

/** The evening: sky, stars, the striped sun, the grid floor. */
function dusk(options: Dusk): Shape {
  const surface = paint();
  const { ctx, px } = surface;
  ctx.scale(px, px);
  const [W, H] = [28, 15.75];
  const horizon = options.horizon ?? H;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#170a45');
  sky.addColorStop(0.38, '#4a1687');
  sky.addColorStop(0.7, '#b52d9c');
  sky.addColorStop(0.9, '#ff5f9e');
  sky.addColorStop(1, '#ff9a6e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const random = rng(options.seed ?? 5);
  for (let i = 0; i < (options.stars ?? 70); i += 1) {
    const [x, y] = [random() * W, random() * random() * horizon * 0.75];
    ctx.fillStyle = `rgba(255,240,255,${random.range(0.25, 0.9)})`;
    const size = random.range(0.03, 0.075);
    ctx.fillRect(x, y, size, size);
  }

  const sun = options.sun;
  if (sun) {
    const halo = ctx.createRadialGradient(sun.x, sun.y, sun.r * 0.6, sun.x, sun.y, sun.r * 2);
    halo.addColorStop(0, 'rgba(255,170,150,0.5)');
    halo.addColorStop(1, 'rgba(255,120,180,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    // The disc, kept only between its cuts – the cuts widen towards its foot.
    ctx.save();
    ctx.beginPath();
    const [top, bottom] = [sun.y - sun.r, sun.y + sun.r];
    let y = top + sun.r * 2 * (sun.from ?? 0.5);
    ctx.rect(sun.x - sun.r, top, sun.r * 2, y - top);
    let gap = sun.r * 0.05;
    for (let k = 0; y < bottom; k += 1) {
      y += gap;
      const band = Math.max(sun.r * 0.07, sun.r * (0.2 - k * 0.022));
      ctx.rect(sun.x - sun.r, y, sun.r * 2, band);
      y += band;
      gap += sun.r * 0.022;
    }
    ctx.clip();
    const body = ctx.createLinearGradient(0, top, 0, bottom);
    body.addColorStop(0, '#fff487');
    body.addColorStop(0.45, '#ffc267');
    body.addColorStop(0.75, '#ff7a8f');
    body.addColorStop(1, '#ff3fa8');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (horizon < H) {
    const depth = H - horizon;
    const floor = ctx.createLinearGradient(0, horizon, 0, H);
    floor.addColorStop(0, '#2a0b55');
    floor.addColorStop(1, '#0f0530');
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, W, depth);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, W, depth);
    ctx.clip();
    const vp = options.vp ?? 14;
    const lines = () => {
      ctx.beginPath();
      for (let i = -22; i <= 22; i += 1) {
        ctx.moveTo(vp, horizon);
        ctx.lineTo(vp + i * 3.3 * (depth / 5), H);
      }
      for (let k = 1; k <= 9; k += 1) {
        const y = horizon + depth * (k / 9) ** 2.1;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
    };
    ctx.shadowColor = '#ff4fd8';
    ctx.shadowBlur = 0.22 * px;
    ctx.strokeStyle = 'rgba(255,90,220,0.85)';
    ctx.lineWidth = 0.07;
    lines();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(190,250,255,0.9)';
    ctx.lineWidth = 0.028;
    lines();
    ctx.stroke();
    ctx.restore();
    // Light lying on the horizon.
    const glow = ctx.createLinearGradient(0, horizon - 0.5, 0, horizon + depth * 0.45);
    glow.addColorStop(0, 'rgba(255,170,200,0)');
    glow.addColorStop(0.2, 'rgba(255,200,220,0.85)');
    glow.addColorStop(0.28, 'rgba(255,110,200,0.55)');
    glow.addColorStop(1, 'rgba(255,90,200,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizon - 0.5, W, depth * 0.45 + 0.5);
  }
  return { t: 'image', ...page, src: jpeg(surface, 80) };
}

/** Pastel air for the working slides. */
const air = (angle: number): Fill => ({
  t: 'linear',
  angle,
  stops: [
    [0, '#ffd0e8'],
    [0.5, '#ddd3ff'],
    [1, '#c2f0ff'],
  ],
});

/** A soft panel with an outline standing a little off it. */
const card = (box: Box, line: Color, fill: Color = white, opacity = 0.72, off = 0.3): Shape[] => [
  {
    t: 'rect',
    x: box.x + off,
    y: box.y + off,
    w: box.w,
    h: box.h,
    r: 0.35,
    fill: null,
    stroke: { color: line, width: 0.07 },
  },
  { t: 'rect', ...box, r: 0.35, fill: { t: 'solid', color: fill, opacity } },
];

/** Checks: a strip of squares, every second filled. */
function checks(x: number, y: number, across: number, down: number, size: number, color: Color) {
  const shapes: Shape[] = [];
  for (let row = 0; row < down; row += 1) {
    for (let column = 0; column < across; column += 1) {
      if ((row + column) % 2 === 0) {
        shapes.push({
          t: 'rect',
          x: x + column * size,
          y: y + row * size,
          w: size,
          h: size,
          fill: color,
        });
      }
    }
  }
  return shapes;
}

const tri = (cx: number, cy: number, r: number, color: Color, rotate = -90, width = 0.07): Shape =>
  polygon(cx, cy, r, 3, null, { stroke: { color, width, join: 'miter' }, rotate });

/** A tile with the sunset in small: sun over lines, all shapes. */
function tile(x: number, y: number, size: number): Shape[] {
  const sunR = size * 0.3;
  const [cx, cy] = [x + size / 2, y + size * 0.5];
  return [
    {
      t: 'rect',
      x,
      y,
      w: size,
      h: size,
      r: 0.3,
      fill: {
        t: 'linear',
        angle: 180,
        stops: [
          [0, '#2a0d6b'],
          [1, '#b52d9c'],
        ],
      },
    },
    {
      t: 'ellipse',
      x: cx - sunR,
      y: cy - sunR,
      w: sunR * 2,
      h: sunR * 2,
      fill: {
        t: 'linear',
        angle: 180,
        stops: [
          [0, '#fff487'],
          [1, '#ff5fa0'],
        ],
      },
    },
    ...[0.08, 0.36, 0.66].map((at, i): Shape => ({
      t: 'rect',
      x: cx - sunR - 0.05,
      y: cy + sunR * at,
      w: sunR * 2 + 0.1,
      h: sunR * (0.09 + i * 0.045),
      fill: '#93289a',
    })),
    {
      t: 'rect',
      x,
      y: y + size * 0.78,
      w: size,
      h: size * 0.22,
      fill: '#1b0845',
    },
    ...[0.78, 0.86].map((at): Shape => ({
      t: 'line',
      x1: x,
      y1: y + size * at,
      x2: x + size,
      y2: y + size * at,
      stroke: { color: cyan, width: 0.04 },
    })),
    { t: 'rect', x, y: y + size * 0.92, w: size, h: size * 0.08, r: 0, fill: '#1b0845' },
  ];
}

/** The floor's lines as shapes, for a foot strip on a pastel page. */
function floorLines(y: number, color: Color): Shape[] {
  const stroke = { color, width: 0.045 };
  const shapes: Shape[] = [];
  const depth = 15.75 - y;
  for (let i = -14; i <= 14; i += 1) {
    const top = 14 + i * 1.25;
    const bottom = 14 + i * 2.1;
    if (top < 0 || top > 28) continue;
    shapes.push({ t: 'line', x1: top, y1: y, x2: bottom, y2: 15.75, stroke });
  }
  for (const t of [0, 0.22, 0.55]) {
    shapes.push({ t: 'line', x1: 0, y1: y + depth * t, x2: 28, y2: y + depth * t, stroke });
  }
  return shapes;
}

const list = [
  'Der Sommer 1989 hört einfach nicht auf',
  'Musik aus dem Einkaufszentrum, halb so schnell',
  'Palmen aus Plastik, Marmor aus Pappe',
  'Erinnerung an etwas, das es nie gab',
  'Sehnsucht ist die beste Auflösung',
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: ink,
    shapes: [
      dusk({ horizon: 10.9, sun: { x: 20.6, y: 8.9, r: 4.5, from: 0.42 }, vp: 14, seed: 3 }),
      tri(24.6, 2.4, 0.9, cyan, -90),
      tri(25.8, 3.3, 0.5, yellow, 90),
    ],
    title: {
      x: 1.8,
      y: 1.4,
      w: 15.4,
      h: 5.4,
      size: 58,
      color: white,
      valign: 'middle',
      sample: 'Sommer\nohne Ende',
    },
    subtitle: {
      x: 1.8,
      y: 6.9,
      w: 14,
      h: 1.6,
      color: '#fff3a8',
      valign: 'middle',
      sample: 'Ein Mixtape in neun Folien',
    },
  },
  {
    name: 'Abschnitt',
    bg: ink,
    shapes: [
      dusk({ sun: { x: 4.2, y: 8.2, r: 6.6, from: 0.46 }, stars: 110, seed: 9 }),
      squiggle({ x: 13.2, y: 11.9, w: 6.4, h: 0.45 }, 6, { color: cyan, width: 0.09 }),
      squiggle({ x: 13.2, y: 12.6, w: 6.4, h: 0.45 }, 6, { color: yellow, width: 0.09 }),
      tri(24.6, 2.8, 1.2, cyan, -90),
      tri(24.6, 2.8, 0.55, pink, -90),
    ],
    title: {
      x: 13.2,
      y: 3.6,
      w: 13,
      h: 5.2,
      size: 48,
      color: white,
      valign: 'bottom',
      sample: 'Seite B:\nNachtfahrt',
    },
    subtitle: {
      x: 13.2,
      y: 9.3,
      w: 13,
      h: 1.6,
      color: '#fff3a8',
      valign: 'middle',
      sample: 'Langsamer, als du denkst',
    },
  },
  {
    name: 'Inhalt',
    bg: air(120),
    shapes: [
      ...checks(0, 14.55, 47, 2, 0.6, ink),
      ...card({ x: 1.6, y: 4.1, w: 20.6, h: 9.3 }, cyan),
      squiggle({ x: 1.9, y: 3.2, w: 4.2, h: 0.4 }, 5, { color: pink, width: 0.1 }),
      ...tile(23.4, 1.3, 3.2),
      tri(25, 7.2, 1.25, violet, -90),
      tri(25, 7.2, 0.55, pink, -90),
      {
        t: 'ellipse',
        x: 24.2,
        y: 10.4,
        w: 1.6,
        h: 1.6,
        fill: null,
        stroke: { color: pink, width: 0.07 },
      },
      { t: 'ellipse', x: 24.7, y: 10.9, w: 1.6, h: 1.6, fill: yellow },
    ],
    title: { x: 1.8, y: 0.9, w: 20.6, h: 2.2, valign: 'middle', sample: 'Was vom Sommer bleibt' },
    body: { x: 2.3, y: 4.6, w: 19.2, h: 8.4, sample: list },
  },
  {
    name: 'Text und Bild',
    bg: air(60),
    shapes: [
      { t: 'rect', x: 1.5, y: 1.7, w: 11, h: 11.2, r: 0.35, fill: pink },
      {
        t: 'rect',
        x: 2.9,
        y: 3.1,
        w: 11,
        h: 11.2,
        r: 0.35,
        fill: null,
        stroke: { color: cyan, width: 0.08 },
      },
      { t: 'rect', x: 2.2, y: 2.4, w: 11, h: 11.2, fill: ink },
      ...checks(22.8, 13.35, 6, 2, 0.6, ink),
      squiggle({ x: 15.6, y: 5.05, w: 4.2, h: 0.4 }, 5, { color: pink, width: 0.1 }),
      tri(25.6, 2.2, 0.8, violet, -90),
    ],
    pictures: [{ x: 2.2, y: 2.4, w: 11, h: 11.2 }],
    title: {
      x: 15.5,
      y: 1.3,
      w: 10.9,
      h: 3.5,
      size: 30,
      valign: 'bottom',
      sample: 'Postkarte von nirgendwo',
    },
    body: {
      x: 15.5,
      y: 5.9,
      w: 10.9,
      h: 7.2,
      size: 20,
      sample: ['Horizont in Rosa', 'Wasser ohne Wellen', 'Niemand hat es eilig'],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: air(180),
    shapes: [
      ...floorLines(13.9, violet),
      ...card({ x: 1.6, y: 3.9, w: 12, h: 9.2 }, pink),
      ...card({ x: 14.4, y: 3.9, w: 12, h: 9.2 }, cyan),
      { t: 'rect', x: 2.4, y: 3.72, w: 3.4, h: 0.36, r: 0.18, fill: pink },
      { t: 'rect', x: 15.2, y: 3.72, w: 3.4, h: 0.36, r: 0.18, fill: '#16c5cc' },
      tri(23.3, 2.1, 0.75, violet, -90),
      tri(24.9, 2.1, 0.75, pink, 90),
      tri(26.1, 2.1, 0.4, ink, -90),
    ],
    title: { x: 1.8, y: 0.9, w: 20, h: 2.3, valign: 'middle', sample: 'Damals und heute' },
    body: [
      {
        x: 2.3,
        y: 4.6,
        w: 10.6,
        h: 8,
        size: 20,
        sample: ['Kassette im Walkman', 'Warten auf das Lied', 'Ein Poster an der Wand'],
      },
      {
        x: 15.1,
        y: 4.6,
        w: 10.6,
        h: 8,
        size: 20,
        sample: ['Schleife im Browser', 'Alles sofort, alles gleich', 'Tausend Bilder im Feed'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: ink,
    shapes: [
      dusk({ horizon: 12.5, sun: { x: 8.9, y: 7.3, r: 5.9, from: 0.7 }, vp: 8.9, seed: 21 }),
      tri(24.9, 2.3, 0.9, cyan, -90),
      squiggle({ x: 16.9, y: 10.6, w: 5, h: 0.42 }, 6, { color: yellow, width: 0.09 }),
    ],
    title: {
      x: 3.9,
      y: 3.2,
      w: 10,
      h: 6,
      size: 100,
      color: '#3a0f78',
      align: 'center',
      valign: 'middle',
      sample: '84',
    },
    body: {
      x: 16.8,
      y: 3.6,
      w: 9.6,
      h: 6.6,
      size: 24,
      color: white,
      valign: 'bottom',
      sample: 'Schläge pro Minute: So langsam läuft ein Sommerhit, bevor er Erinnerung wird.',
    },
  },
  {
    name: 'Zitat',
    bg: ink,
    shapes: [
      dusk({ horizon: 11.9, vp: 14, stars: 120, seed: 14 }),
      ...card({ x: 3.2, y: 2.1, w: 21.6, h: 8.5 }, cyan, '#fdeaf7', 1, 0.4),
      {
        t: 'text',
        x: 3.6,
        y: 0.1,
        w: 5,
        h: 5,
        text: '“',
        font: 'Righteous',
        size: 150,
        color: pink,
        valign: 'top',
      },
      { t: 'rect', x: 14.2, y: 9.75, w: 11.6, h: 1.7, r: 0.85, fill: pink },
    ],
    body: {
      x: 4.6,
      y: 3.6,
      w: 18.8,
      h: 5.8,
      font: 'Righteous',
      size: 34,
      color: ink,
      lineHeight: 118,
      valign: 'middle',
      sample: 'Die Zukunft war früher auch schon mal schöner.',
    },
    subtitle: {
      x: 15,
      y: 9.75,
      w: 10.2,
      h: 1.7,
      color: white,
      align: 'center',
      valign: 'middle',
      sample: 'Nora, Plattensammlerin',
    },
  },
  {
    name: 'Bild',
    bg: ink,
    shapes: [
      dusk({ horizon: 10.6, vp: 20, seed: 30 }),
      {
        t: 'rect',
        x: 2.5,
        y: 1.6,
        w: 23.6,
        h: 10.6,
        fill: null,
        stroke: { color: cyan, width: 0.08 },
      },
      { t: 'rect', x: 2.1, y: 1.2, w: 23.6, h: 10.6, fill: ink },
      { t: 'rect', x: 1.4, y: 12.75, w: 14.6, h: 2, r: 1, fill: pink },
    ],
    pictures: [{ x: 2.1, y: 1.2, w: 23.6, h: 10.6 }],
    title: {
      x: 2.3,
      y: 12.75,
      w: 12.8,
      h: 2,
      size: 26,
      color: white,
      valign: 'middle',
      sample: 'Strandhotel, Zimmer 12',
    },
  },
  {
    name: 'Schluss',
    bg: ink,
    shapes: [
      dusk({
        horizon: 10.4,
        sun: { x: 14, y: 9.5, r: 4.3, from: 0.4 },
        vp: 14,
        stars: 120,
        seed: 41,
      }),
      {
        t: 'rect',
        x: 8,
        y: 12.2,
        w: 12,
        h: 1.8,
        r: 0.9,
        fill: { t: 'solid', color: ink, opacity: 0.9 },
        stroke: { color: cyan, width: 0.06 },
      },
      tri(3.2, 3.1, 0.9, cyan, -90),
      tri(24.8, 3.1, 0.9, pink, 90),
    ],
    title: {
      x: 5,
      y: 1,
      w: 18,
      h: 3.8,
      size: 60,
      color: white,
      align: 'center',
      valign: 'middle',
      sample: 'Bis bald',
    },
    subtitle: {
      x: 8.4,
      y: 12.2,
      w: 11.2,
      h: 1.8,
      color: white,
      align: 'center',
      valign: 'middle',
      sample: 'Danke fürs Zurückspulen',
    },
  },
];

const template: Template = {
  slug: 'vaporwave',
  name: 'Vaporwave',
  group: 'Designtrend',
  tags: ['Vaporwave', 'Retro', 'Achtziger', 'Sonnenuntergang', 'Pastell', 'Synthwave', 'Musik'],
  description:
    'Ewige Abenddämmerung: Violett läuft in Rosa und Pfirsich, die Sonne in Streifen, der Boden ein Gitter bis zum Horizont.',
  palette: {
    bg: pastel,
    text: ink,
    bg2: lavender,
    text2: plum,
    accents: [pink, cyan, violet, yellow, peach, mint],
  },
  fonts: { head: 'Righteous', body: 'Jost' },
  text: {
    title: { font: 'Righteous', size: 36, color: '#4a1687', lineHeight: 104 },
    subtitle: { font: 'Space Mono', size: 20, color: plum, bold: true },
    body: { font: 'Jost', size: 23, color: ink, lineHeight: 116, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
