import { grain, jpeg, noise, paint, rgb, rng } from '../art';
import type { Box, Color, Fill, Layout, Picture, Shape, Stroke, Template } from '../model';
import { PAGE } from '../model';
import { page, rule } from '../shapes';

/*
 * Extrablatt: a newspaper of around 1900 – yellowed paper with grain and stains, swelled rules,
 * scrolls in the corners, fat display letters beside slab serifs, everything on the middle axis,
 * shades engraved as hatching, sepia ink.
 */

const old = '#e6d4a9';
const label = '#f1e5c5';
const sepia = '#3a2816';
const oxblood = '#7a2a1b';
const umber = '#6c5233';
const brass = '#a98a4f';

const fat = 'Abril Fatface';
const slab = 'Zilla Slab';
const egyptian = 'Arvo';

const fine: Stroke = { color: sepia, width: 0.035 };
const stout: Stroke = { color: sepia, width: 0.11, join: 'miter' };
const scrollLine: Stroke = { color: sepia, width: 0.055, cap: 'round', join: 'round' };

const engraved = (distance = 0.085, angle = 45, color: Color = sepia): Fill => ({
  t: 'hatch',
  color,
  distance,
  angle,
});

/** The sheet itself: yellowed, clouded, foxed at places, darker towards its edges. */
function sheet(): Picture {
  const surface = paint(PAGE, 1600 / PAGE.w);
  const { ctx, w, h } = surface;
  const [clouds, stains] = [noise(51), noise(77)];
  const [r, g, b] = rgb(old);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [u, v] = [x / w, y / h];
      const edge = Math.min(u, 1 - u, v, 1 - v);
      const border = Math.max(0, 1 - edge / 0.09) ** 2 * 0.2;
      const cloud = (clouds(x / 210, y / 210, 5) - 0.5) * 0.16;
      const fox = Math.max(0, stains(x / 150 + 4, y / 150 + 4, 3) - 0.7) * 0.75;
      const shade = 1 + cloud - border - fox;
      const i = (y * w + x) * 4;
      image.data[i] = r * shade;
      image.data[i + 1] = g * (shade - fox * 0.25);
      image.data[i + 2] = b * (shade - fox * 0.5 - border * 0.4);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  grain(surface, 0.085, 9);
  return jpeg(surface, 78);
}

const ground: Shape = { t: 'image', ...page, src: sheet() };

/** A scroll for the upper left corner of a box of `size`; `turn` brings it to the others. */
const scroll = (x: number, y: number, size: number, turn = 0, stroke = scrollLine): Shape => ({
  t: 'path',
  x,
  y,
  w: size,
  h: size,
  vb: [100, 100],
  d:
    'M6 96 C6 52 20 22 50 13 C67 8 82 15 81 28 C80 38 69 43 62 38 C56 34 57 26 63 26 ' +
    'M96 6 C52 6 22 20 13 50 C8 67 15 82 28 81 C38 80 43 69 38 62 C34 56 26 57 26 63 ' +
    'M6 6 L30 6 M6 6 L6 30',
  fill: null,
  stroke,
  rotate: turn,
});

/** Scrolls in the four corners of a box. */
const corners = (box: Box, size: number, stroke = scrollLine): Shape[] => [
  scroll(box.x, box.y, size, 0, stroke),
  scroll(box.x + box.w - size, box.y, size, 90, stroke),
  scroll(box.x + box.w - size, box.y + box.h - size, size, 180, stroke),
  scroll(box.x, box.y + box.h - size, size, 270, stroke),
];

/** A swelled rule: fat in the middle of each half, a lozenge where they meet. */
const swelled = (cx: number, y: number, w: number, color: Color = sepia): Shape => ({
  t: 'path',
  x: cx - w / 2,
  y: y - 0.22,
  w,
  h: 0.44,
  vb: [1000, 100],
  d:
    'M0 50 Q240 26 462 46 L500 4 L538 46 Q760 26 1000 50 Q760 74 538 54 L500 96 L462 54 ' +
    'Q240 74 0 50 Z',
  fill: color,
});

/** A tail that curls twice, growing out of a point to the right; `turn` 180 for the left. */
const tail = (x: number, y: number, w: number, turn = 0): Shape => ({
  t: 'path',
  x,
  y: y - w * 0.16,
  w,
  h: w * 0.32,
  vb: [200, 64],
  d:
    'M2 32 C50 32 62 6 104 6 C128 6 138 24 126 35 C117 43 104 39 107 30 ' +
    'M2 32 C50 32 62 58 104 58 C128 58 138 40 126 29 ' +
    'M120 32 L198 32',
  fill: null,
  stroke: scrollLine,
  rotate: turn,
});

/** The double line round a page or a picture: stout outside, fine inside. */
const border = (box: Box, gap = 0.2): Shape[] => [
  { t: 'rect', ...box, fill: null, stroke: stout },
  {
    t: 'rect',
    x: box.x + gap,
    y: box.y + gap,
    w: box.w - gap * 2,
    h: box.h - gap * 2,
    fill: null,
    stroke: fine,
  },
];

/** A band of hatching between two fine rules. */
const band = (x: number, y: number, w: number, h = 0.42): Shape[] => [
  { t: 'rect', x, y, w, h, fill: engraved(0.07) },
  rule(x, y, w, sepia, 0.035),
  rule(x, y + h, w, sepia, 0.035),
];

const lozenge = (cx: number, cy: number, r: number, fill: Color = sepia): Shape => ({
  t: 'poly',
  fill,
  pts: [
    [cx, cy - r],
    [cx + r * 0.7, cy],
    [cx, cy + r],
    [cx - r * 0.7, cy],
  ],
});

const dingbat = (text: string, cx: number, cy: number, size: number, color: Color): Shape => ({
  t: 'text',
  x: cx - 3,
  y: cy - 1.5,
  w: 6,
  h: 3,
  text,
  font: 'DejaVu Sans',
  size,
  color,
  align: 'center',
  valign: 'middle',
  nowrap: true,
});

/** Rays round an oval, as a seal is engraved. */
function glory(cx: number, cy: number, a: number, b: number, reach: number, count: number) {
  return Array.from({ length: count }, (_, index): Shape => {
    const angle = (index / count) * Math.PI * 2;
    const half = (Math.PI / count) * 0.42;
    const long = index % 2 === 0 ? reach : reach * 0.62;
    const at = (t: number, grow: number): [number, number] => [
      cx + Math.cos(t) * (a + grow),
      cy + Math.sin(t) * (b + grow),
    ];
    return {
      t: 'poly',
      fill: sepia,
      pts: [at(angle - half, 0), at(angle, long), at(angle + half, 0)],
    };
  });
}

/**
 * A view for the preview, as a wood engraver would cut it: hills, a sun and its rays, all tone
 * made of lines that swell where it is dark.
 */
function engraving(seed: number): Picture {
  const size = { w: 16, h: 11 };
  const tone = paint(size, 24);
  const random = rng(seed * 13 + 1);
  const field = noise(seed + 90);
  {
    const { ctx, w, h } = tone;
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, '#6a6a6a');
    sky.addColorStop(1, '#eeeeee');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const [sx, sy] = [w * random.range(0.3, 0.7), h * 0.36];
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 24; i += 2) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(
        sx + Math.cos((i / 24) * Math.PI * 2) * w,
        sy + Math.sin((i / 24) * Math.PI * 2) * w,
      );
      ctx.lineTo(
        sx + Math.cos(((i + 1) / 24) * Math.PI * 2) * w,
        sy + Math.sin(((i + 1) / 24) * Math.PI * 2) * w,
      );
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, sy, h * 0.13, 0, Math.PI * 2);
    ctx.fill();
    [150, 100, 45].forEach((value, layer) => {
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 2) {
        ctx.lineTo(
          x,
          h * (0.56 + layer * 0.14) - field(x / (w * 0.4) + layer * 5, layer, 4) * h * 0.2,
        );
      }
      ctx.lineTo(w, h);
      ctx.fill();
    });
  }
  const data = tone.ctx.getImageData(0, 0, tone.w, tone.h).data;
  const print = paint(size, 80);
  const { ctx, w, h } = print;
  ctx.fillStyle = '#eadbb6';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = sepia;
  const pitch = 7;
  for (let y = pitch / 2; y < h; y += pitch) {
    for (let x = 0; x < w; x += 2) {
      const tx = Math.min(tone.w - 1, Math.round((x / w) * tone.w));
      const ty = Math.min(tone.h - 1, Math.round((y / h) * tone.h));
      const dark = 1 - data[(ty * tone.w + tx) * 4]! / 255;
      const wave = Math.sin(x / 46 + y / 30) * 1.4;
      const thick = dark * pitch * 0.95;
      if (thick > 0.5) ctx.fillRect(x, y + wave - thick / 2, 2, thick);
    }
  }
  return jpeg(print, 84);
}

const FRAME: Box = { x: 0.9, y: 0.9, w: 26.2, h: 13.95 };

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: old,
    shapes: [
      ground,
      ...border(FRAME),
      ...corners({ x: 1.35, y: 1.35, w: 25.3, h: 13.05 }, 2.5),
      dingbat('✦', 14, 2.25, 20, oxblood),
      dingbat('✦', 12.6, 2.25, 12, sepia),
      dingbat('✦', 15.4, 2.25, 12, sepia),
      swelled(14, 3.25, 15),
      ...band(6.5, 10.15, 15),
      swelled(14, 13.05, 9),
    ],
    title: {
      x: 4.2,
      y: 3.7,
      w: 19.6,
      h: 6.1,
      valign: 'middle',
      sample: 'Die Welt wird\nelektrisch',
    },
    subtitle: {
      x: 4.5,
      y: 10.95,
      w: 19,
      h: 1.5,
      valign: 'middle',
      sample: 'Sonderausgabe zum neuen Jahrhundert',
    },
  },
  {
    name: 'Abschnitt',
    bg: old,
    shapes: [
      ground,
      { t: 'rect', x: 0.9, y: 0.9, w: 26.2, h: 0.11, fill: sepia },
      rule(0.9, 1.22, 26.2, sepia, 0.035),
      { t: 'ellipse', x: 4.4, y: 2.2, w: 19.2, h: 9.6, fill: engraved(0.08), stroke: stout },
      { t: 'ellipse', x: 5.2, y: 2.85, w: 17.6, h: 8.3, fill: label, stroke: fine },
      { t: 'ellipse', x: 5.45, y: 3.1, w: 17.1, h: 7.8, fill: null, stroke: fine },
      tail(0.9, 7, 3.2, 180),
      tail(23.9, 7, 3.2),
      lozenge(14, 12.45, 0.24, oxblood),
      rule(9, 12.45, 4.4, sepia, 0.035),
      rule(14.6, 12.45, 4.4, sepia, 0.035),
      rule(0.9, 14.53, 26.2, sepia, 0.035),
      { t: 'rect', x: 0.9, y: 14.74, w: 26.2, h: 0.11, fill: sepia },
    ],
    title: {
      x: 7.6,
      y: 4.1,
      w: 12.8,
      h: 5.8,
      valign: 'middle',
      size: 42,
      sample: 'Zweites Blatt:\nDie Erfinder',
    },
    subtitle: { x: 5, y: 12.85, w: 18, h: 1.3, sample: 'Von Drähten und Träumen' },
  },
  {
    name: 'Inhalt',
    bg: old,
    shapes: [
      ground,
      ...corners({ x: 0.9, y: 0.9, w: 26.2, h: 13.95 }, 2),
      swelled(14, 4.05, 13),
      rule(3.6, 5, 9, sepia, 0.035, true),
      rule(3.8, 5, 9, sepia, 0.035, true),
      rule(24.2, 5, 9, sepia, 0.035, true),
      rule(24.4, 5, 9, sepia, 0.035, true),
      lozenge(3.7, 4.7, 0.2),
      lozenge(3.7, 14.3, 0.2),
      lozenge(24.3, 4.7, 0.2),
      lozenge(24.3, 14.3, 0.2),
    ],
    title: {
      x: 3.6,
      y: 1.3,
      w: 20.8,
      h: 2.4,
      valign: 'middle',
      size: 36,
      sample: 'Was der Fortschritt verspricht',
    },
    body: {
      x: 5,
      y: 5,
      w: 18,
      h: 9,
      sample: [
        'Licht in jeder Stube, auch im Winter',
        'Nachrichten in Minuten statt in Tagen',
        'Wagen, die ohne Pferde fahren',
        'Maschinen, die das Schwere heben',
        'Reisen über das Meer in einer Woche',
        'Und Zeit, die dem Menschen bleibt',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: old,
    shapes: [
      ground,
      { t: 'rect', x: 0.9, y: 0.9, w: 26.2, h: 0.11, fill: sepia },
      rule(0.9, 1.22, 26.2, sepia, 0.035),
      swelled(14, 4.05, 13),
      { t: 'rect', x: 2.55, y: 5.35, w: 11.3, h: 8.9, fill: engraved(0.07) },
      { t: 'rect', x: 1.9, y: 4.7, w: 11.3, h: 8.9, fill: label, stroke: stout },
      { t: 'rect', x: 2.1, y: 4.9, w: 10.9, h: 8.5, fill: null, stroke: fine },
      rule(14.7, 4.9, 9.1, sepia, 0.035, true),
      lozenge(14.7, 4.7, 0.2, oxblood),
      lozenge(14.7, 14.2, 0.2, oxblood),
      rule(0.9, 14.53, 26.2, sepia, 0.035),
      { t: 'rect', x: 0.9, y: 14.74, w: 26.2, h: 0.11, fill: sepia },
    ],
    pictures: [{ x: 2.3, y: 5.1, w: 10.5, h: 8.1 }],
    title: {
      x: 3.6,
      y: 1.5,
      w: 20.8,
      h: 2.2,
      valign: 'middle',
      size: 34,
      sample: 'Ein Morgen über dem Tal',
    },
    body: {
      x: 15.5,
      y: 4.9,
      w: 10.9,
      h: 9.2,
      size: 21,
      sample: [
        'Der erste Zug fährt um sechs',
        'Die Brücke trägt zwölf Wagen',
        'Gebaut in nur zwei Sommern',
        'Der Fahrpreis: drei Groschen',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: old,
    shapes: [
      ground,
      { t: 'rect', x: 0.9, y: 0.9, w: 26.2, h: 0.11, fill: sepia },
      rule(0.9, 1.22, 26.2, sepia, 0.035),
      swelled(14, 4.05, 13),
      ...band(2.4, 5, 10.6, 0.36),
      ...band(15, 5, 10.6, 0.36),
      rule(14, 5.4, 3.6, sepia, 0.035, true),
      lozenge(14, 5.1, 0.2),
      { t: 'ellipse', x: 13.45, y: 9.05, w: 1.1, h: 1.1, fill: label, stroke: fine },
      dingbat('✦', 14, 9.6, 13, oxblood),
      rule(14, 10.2, 3.6, sepia, 0.035, true),
      lozenge(14, 14.05, 0.2),
      rule(0.9, 14.53, 26.2, sepia, 0.035),
      { t: 'rect', x: 0.9, y: 14.74, w: 26.2, h: 0.11, fill: sepia },
    ],
    title: {
      x: 3.6,
      y: 1.5,
      w: 20.8,
      h: 2.2,
      valign: 'middle',
      size: 34,
      sample: 'Gestern und Morgen',
    },
    body: [
      {
        x: 2.4,
        y: 5.9,
        w: 10.6,
        h: 8.2,
        size: 21,
        sample: ['Die Kerze und die Lampe', 'Der Bote zu Pferd', 'Das Handwerk am Ort'],
      },
      {
        x: 15,
        y: 5.9,
        w: 10.6,
        h: 8.2,
        size: 21,
        sample: ['Das Licht aus dem Draht', 'Die Depesche über das Meer', 'Die Fabrik am Fluss'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: old,
    shapes: [
      ground,
      ...border(FRAME),
      ...glory(14, 6.1, 7.6, 3.6, 1.15, 96),
      { t: 'ellipse', x: 6.4, y: 2.5, w: 15.2, h: 7.2, fill: engraved(0.07), stroke: stout },
      { t: 'ellipse', x: 7, y: 3, w: 14, h: 6.2, fill: label, stroke: fine },
      tail(1.6, 6.1, 3, 180),
      tail(23.4, 6.1, 3),
      swelled(14, 10.85, 9, oxblood),
    ],
    title: {
      x: 7.6,
      y: 3.3,
      w: 12.8,
      h: 5.6,
      valign: 'middle',
      size: 96,
      color: oxblood,
      sample: '1900',
    },
    body: {
      x: 4.6,
      y: 11.4,
      w: 18.8,
      h: 2.9,
      align: 'center',
      valign: 'middle',
      size: 22,
      sample: 'Lampen brennen heute Nacht zum ersten Mal in allen Straßen der Stadt.',
    },
  },
  {
    name: 'Zitat',
    bg: old,
    shapes: [
      ground,
      ...border({ x: 2.6, y: 2.3, w: 22.8, h: 11.4 }, 0.18),
      ...corners({ x: 0.7, y: 0.7, w: 26.6, h: 14.35 }, 1.7),
      { t: 'ellipse', x: 12.3, y: 0.75, w: 3.4, h: 3.4, fill: engraved(0.07), stroke: stout },
      { t: 'ellipse', x: 12.65, y: 1.1, w: 2.7, h: 2.7, fill: label, stroke: fine },
      {
        t: 'text',
        x: 12.3,
        y: 1.52,
        w: 3.4,
        h: 3,
        text: '“',
        font: fat,
        size: 70,
        color: oxblood,
        align: 'center',
        nowrap: true,
        lineHeight: 100,
      },
      swelled(14, 11.25, 8),
    ],
    body: {
      x: 4.4,
      y: 4.5,
      w: 19.2,
      h: 6.3,
      align: 'center',
      valign: 'middle',
      italic: true,
      size: 30,
      lineHeight: 124,
      sample: 'Was heute ein Wunder heißt, wird morgen jedes Kind für selbstverständlich halten.',
    },
    subtitle: { x: 4.4, y: 11.75, w: 19.2, h: 1.3, sample: 'Aus dem Brief eines Ingenieurs' },
  },
  {
    name: 'Bild',
    bg: old,
    shapes: [
      ground,
      { t: 'rect', x: 4.55, y: 1.75, w: 20, h: 10.2, fill: engraved(0.07) },
      { t: 'rect', x: 4, y: 1.2, w: 20, h: 10.2, fill: label, stroke: stout },
      { t: 'rect', x: 4.2, y: 1.4, w: 19.6, h: 9.8, fill: null, stroke: fine },
      tail(0.6, 6.3, 2.9, 180),
      tail(24.9, 6.3, 2.9),
      // The ribbon: its folded ends behind, the strip before.
      {
        t: 'poly',
        fill: engraved(0.06),
        stroke: fine,
        pts: [
          [4.2, 12.65],
          [6.6, 12.65],
          [6.6, 14.75],
          [4.2, 14.75],
          [5, 13.7],
        ],
      },
      {
        t: 'poly',
        fill: engraved(0.06),
        stroke: fine,
        pts: [
          [23.8, 12.65],
          [21.4, 12.65],
          [21.4, 14.75],
          [23.8, 14.75],
          [23, 13.7],
        ],
      },
      { t: 'rect', x: 5.8, y: 12.2, w: 16.4, h: 2.1, fill: label, stroke: stout },
    ],
    pictures: [{ x: 4.4, y: 1.6, w: 19.2, h: 9.4 }],
    title: {
      x: 6.2,
      y: 12.2,
      w: 15.6,
      h: 2.1,
      valign: 'middle',
      size: 26,
      sample: 'Die Sonne über dem neuen Werk',
    },
  },
  {
    name: 'Schluss',
    bg: old,
    shapes: [
      ground,
      ...border(FRAME),
      ...band(1.5, 1.5, 25, 0.6),
      ...band(1.5, 13.65, 25, 0.6),
      ...corners({ x: 1.6, y: 2.5, w: 24.8, h: 10.75 }, 2.3),
      swelled(14, 3.6, 11),
      swelled(14, 9.75, 15, oxblood),
      dingbat('☞', 4.4, 11.2, 40, sepia),
      dingbat('☜', 23.6, 11.2, 40, sepia),
    ],
    title: {
      x: 4.2,
      y: 4,
      w: 19.6,
      h: 5.4,
      valign: 'middle',
      size: 78,
      sample: 'Habt Dank!',
    },
    subtitle: {
      x: 5.8,
      y: 10.5,
      w: 16.4,
      h: 1.5,
      valign: 'middle',
      sample: 'Fragen nimmt die Redaktion an',
    },
  },
];

const template: Template = {
  slug: 'extrablatt',
  name: 'Extrablatt',
  group: 'Zeitung',
  tags: [
    'Extrablatt',
    'historisch',
    '1900',
    'Zeitung',
    'Sepia',
    'Ornament',
    'Jubiläum',
    'nostalgisch',
  ],
  description:
    'Wie eine Zeitung um 1900: vergilbtes Papier, Zierlinien, fette Lettern und Schraffuren in Sepia.',
  palette: {
    bg: old,
    text: sepia,
    bg2: label,
    text2: umber,
    accents: [oxblood, brass, '#4b5a44', '#2f4156', '#c7ad74', '#8f6f44'],
  },
  fonts: { head: fat, body: slab },
  text: {
    title: { font: fat, size: 60, color: sepia, align: 'center', lineHeight: 104 },
    subtitle: {
      font: egyptian,
      size: 16,
      color: oxblood,
      bold: true,
      upper: true,
      spacing: 3,
      align: 'center',
    },
    body: { font: slab, size: 23, color: sepia, lineHeight: 120, paraSpace: 0.34 },
  },
  layouts,
  samplePictures: [engraving(1), engraving(2)],
};

export default template;
