import { Path2D, type Canvas } from '@napi-rs/canvas';
import { jpeg, noise, paint } from '../art';
import type { Box, Layout, Shape, Template } from '../model';
import { page, ring, rule, star } from '../shapes';

/*
 * Holografisch: iridescent foil – pearly pastel rainbows that shift across a surface – cut into
 * stickers with a white rim, on almost white; thin black type, hairlines, small black sparkles.
 */

const ground = '#f5f5f8';
const ink = '#121216';
const grey = '#5e5e6a';
const white = '#ffffff';
const pink = '#ffb1d8';
const lilac = '#c7b6ff';
const sky = '#a6d7ff';
const mint = '#a8efcf';
const lemon = '#fff2a0';
const peach = '#ffc8a6';

const PXCM = 1600 / 28;

/** A sheet of foil: hue bands bent by noise, washed to pastel, with a sheen running through. */
function foil(seed: number, turn = 0.9): Canvas {
  const surface = paint(page, PXCM);
  const { ctx, w, h } = surface;
  const field = noise(seed);
  const image = ctx.createImageData(w, h);
  const tau = Math.PI * 2;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [u, v] = [x / w, (y / w) * 1];
      const bend = field(u * 2.1, v * 2.1, 3);
      const ripple = field(u * 5 + 9, v * 5 + 9, 2);
      const t = (u * turn + v * (1.5 - turn)) * 1.25 + bend * 2.1 + ripple * 0.35;
      const sheen = (0.5 + 0.5 * Math.sin(tau * (t * 2.6 + ripple * 1.4))) ** 5 * 0.3;
      const wash = 0.5 + sheen;
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k += 1) {
        const pure = 0.5 + 0.5 * Math.cos(tau * (t + k / 3));
        // Pearl: never darker than a light grey.
        image.data[i + k] =
          255 * Math.min(1, 0.71 + (pure - 0.5) * 0.48 * (1 - sheen) + wash * 0.2);
      }
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return surface.canvas;
}

const circle = (cx: number, cy: number, r: number): Path2D => {
  const path = new Path2D();
  path.arc(cx, cy, r, 0, Math.PI * 2);
  return path;
};
const rounded = (box: Box, r: number): Path2D => {
  const path = new Path2D();
  const radius = Math.min(r, box.w / 2, box.h / 2);
  const [x, y, w, h] = [box.x, box.y, box.w, box.h];
  path.moveTo(x + radius, y);
  path.arcTo(x + w, y, x + w, y + h, radius);
  path.arcTo(x + w, y + h, x, y + h, radius);
  path.arcTo(x, y + h, x, y, radius);
  path.arcTo(x, y, x + w, y, radius);
  path.closePath();
  return path;
};
/** A seal: a disc with a scalloped rim. */
const seal = (cx: number, cy: number, r: number, lobes = 14, depth = 0.055): Path2D => {
  const path = new Path2D();
  for (let i = 0; i <= 360; i += 1) {
    const angle = (i / 360) * Math.PI * 2;
    const radius = r * (1 - depth + depth * Math.cos(angle * lobes));
    const [x, y] = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    if (i) path.lineTo(x, y);
    else path.moveTo(x, y);
  }
  path.closePath();
  return path;
};
/** A four-pointed sparkle with hollow sides. */
const sparkle = (cx: number, cy: number, r: number, waist = 0.16): Path2D => {
  const path = new Path2D();
  const k = r * waist;
  path.moveTo(cx, cy - r);
  path.quadraticCurveTo(cx + k, cy - k, cx + r, cy);
  path.quadraticCurveTo(cx + k, cy + k, cx, cy + r);
  path.quadraticCurveTo(cx - k, cy + k, cx - r, cy);
  path.quadraticCurveTo(cx - k, cy - k, cx, cy - r);
  path.closePath();
  return path;
};
/** A quotation mark: a disc with its tail. */
const comma = (cx: number, cy: number, r: number): Path2D => {
  const path = new Path2D();
  path.arc(cx, cy, r, Math.PI * 1.02, Math.PI * 2.75);
  path.quadraticCurveTo(cx + r * 0.2, cy - r * 1.3, cx + r * 1.0, cy - r * 2.2);
  path.quadraticCurveTo(cx - r * 1.2, cy - r * 1.7, cx - r, cy - r * 0.06);
  path.closePath();
  return path;
};

interface Sticker {
  path: Path2D;
  /** Round its centre it is turned; the foil turns with it. */
  at?: readonly [number, number];
  rotate?: number;
  /** White instead of foil. */
  plain?: boolean;
  /** No white rim and no shadow: foil lying in the page. */
  flat?: boolean;
  rim?: number;
}

function sheet(
  seed: number,
  stickers: readonly Sticker[],
  options: { full?: boolean; turn?: number } = {},
): Shape {
  const surface = paint(page, PXCM);
  const { ctx, px } = surface;
  const material = foil(seed, options.turn);
  ctx.scale(px, px);
  if (options.full) ctx.drawImage(material, 0, 0, 28, 15.75);
  else {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, 28, 15.75);
  }
  stickers.forEach((sticker, index) => {
    ctx.save();
    if (sticker.at && sticker.rotate) {
      ctx.translate(sticker.at[0], sticker.at[1]);
      ctx.rotate((sticker.rotate * Math.PI) / 180);
      ctx.translate(-sticker.at[0], -sticker.at[1]);
    }
    if (!sticker.flat) {
      ctx.save();
      ctx.shadowColor = 'rgba(40,40,80,0.26)';
      ctx.shadowBlur = 0.4 * px;
      ctx.shadowOffsetX = 0.08 * px;
      ctx.shadowOffsetY = 0.18 * px;
      ctx.fillStyle = white;
      ctx.strokeStyle = white;
      ctx.lineJoin = 'round';
      ctx.lineWidth = (sticker.rim ?? 0.16) * 2;
      ctx.stroke(sticker.path);
      ctx.restore();
      ctx.fillStyle = white;
      ctx.strokeStyle = white;
      ctx.lineJoin = 'round';
      ctx.lineWidth = (sticker.rim ?? 0.16) * 2;
      ctx.stroke(sticker.path);
      ctx.fill(sticker.path);
    }
    if (!sticker.plain) {
      ctx.clip(sticker.path);
      // Each sticker is cut from another place of the sheet.
      const shift = ((index * 5.3) % 7) - 3.5;
      ctx.drawImage(material as never, -8 + shift, -6 - shift * 0.5, 44, 24.75);
    }
    ctx.restore();
  });
  return { t: 'image', ...page, src: jpeg(surface, 86) };
}

const hair = { color: ink, width: 0.03 } as const;
const twinkle = (cx: number, cy: number, r: number): Shape => star(cx, cy, r, r * 0.22, 4, ink);
/** Thin lines of different weight, as on a label. */
const code = (x: number, y: number, h = 0.7): Shape[] =>
  [0, 0.14, 0.34, 0.44, 0.7, 0.86, 0.96, 1.2, 1.4, 1.5, 1.74, 1.9].map((offset, index) => ({
    t: 'rect',
    x: x + offset,
    y,
    w: [0.05, 0.1, 0.04, 0.14, 0.06, 0.04][index % 6]!,
    h,
    fill: ink,
  }));

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: ground,
    shapes: [
      sheet(3, [
        { path: circle(21.2, 7.7, 6.5) },
        { path: rounded({ x: 13.6, y: 11.6, w: 5.6, h: 1.8 }, 0.9), at: [16.4, 12.5], rotate: -14 },
        { path: sparkle(14.6, 3.2, 1.7), at: [14.6, 3.2], rotate: 10 },
        { path: seal(25.6, 2.5, 1.4, 12, 0.07) },
      ]),
      ring(21.2, 7.7, 7.3, { ...hair, opacity: 0.5 }),
      ...code(1.8, 1.6),
      rule(1.8, 10.95, 3.4, ink),
      twinkle(11.9, 13.4, 0.5),
      twinkle(26.3, 13.6, 0.35),
    ],
    title: {
      x: 1.8,
      y: 3.0,
      w: 12.6,
      h: 7.4,
      valign: 'bottom',
      size: 62,
      sample: 'Alles\nschimmert',
    },
    subtitle: { x: 1.8, y: 11.4, w: 11, h: 2.4, sample: 'Kollektion und Ausblick' },
  },
  {
    name: 'Abschnitt',
    bg: ground,
    shapes: [
      sheet(8, [{ path: rounded({ x: 1.8, y: 8.3, w: 15.6, h: 5.7 }, 1.0), plain: true, rim: 0 }], {
        full: true,
        turn: 0.5,
      }),
      {
        t: 'text',
        x: 1.6,
        y: 0.9,
        w: 14,
        h: 6.6,
        text: '02',
        font: 'Urbanist',
        size: 150,
        color: ink,
        valign: 'middle',
        nowrap: true,
      },
      ring(22.4, 7.9, 4.4, hair),
      ring(22.4, 7.9, 2.7, hair),
      twinkle(22.4, 7.9, 1.2),
      twinkle(25.5, 4.8, 0.4),
      ...code(24.1, 13.3),
    ],
    title: {
      x: 2.7,
      y: 8.7,
      w: 13.8,
      h: 3.2,
      valign: 'bottom',
      size: 44,
      sample: 'Material und Licht',
    },
    subtitle: { x: 2.7, y: 12.0, w: 13.8, h: 1.6, sample: 'Woher der Schimmer kommt' },
  },
  {
    name: 'Inhalt',
    bg: ground,
    shapes: [
      sheet(13, [
        { path: rounded({ x: -1, y: -1, w: 30, h: 1.45 }, 0), flat: true },
        { path: seal(24.3, 4.9, 2.1), at: [24.3, 4.9], rotate: 8 },
        { path: sparkle(24.5, 9.5, 1.8), at: [24.5, 9.5], rotate: -8 },
        { path: rounded({ x: 22.1, y: 12.3, w: 4.6, h: 1.6 }, 0.8), at: [24.4, 13.1], rotate: -10 },
      ]),
      rule(1.8, 4.0, 19.2, ink),
    ],
    title: { x: 1.8, y: 1.2, w: 19.2, h: 2.5, valign: 'bottom', size: 36 },
    body: {
      x: 1.8,
      y: 4.7,
      w: 19.2,
      h: 9.6,
      sample: [
        'Farbe, die sich mit dem Blick bewegt',
        'Viel Weiß lässt die Folie leuchten',
        'Schwarz bleibt dünn und genau',
        'Ein Aufkleber pro Gedanke',
        'Glanz ist Akzent, nicht Fläche',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: ground,
    shapes: [
      sheet(21, [
        { path: rounded({ x: 14.2, y: 1.4, w: 12.4, h: 12.95 }, 0.9) },
        { path: sparkle(14.0, 13.9, 1.2), at: [14.0, 13.9], rotate: 12 },
      ]),
      rule(1.8, 5.0, 3.4, ink),
      ...code(1.8, 13.6, 0.6),
    ],
    pictures: [{ x: 14.75, y: 1.95, w: 11.3, h: 11.85 }],
    title: { x: 1.8, y: 1.3, w: 11.4, h: 3.4, valign: 'bottom', size: 32 },
    body: { x: 1.8, y: 5.6, w: 11.4, h: 7.4, size: 20 },
  },
  {
    name: 'Zwei Spalten',
    bg: ground,
    shapes: [
      sheet(34, [
        { path: rounded({ x: 1.8, y: 4.4, w: 11.9, h: 9.9 }, 0.8), rim: 0 },
        {
          path: rounded({ x: 1.98, y: 4.58, w: 11.54, h: 9.54 }, 0.64),
          plain: true,
          flat: false,
          rim: 0,
        },
        { path: rounded({ x: 14.3, y: 4.4, w: 11.9, h: 9.9 }, 0.8), rim: 0 },
        { path: rounded({ x: 14.48, y: 4.58, w: 11.54, h: 9.54 }, 0.64), plain: true, rim: 0 },
        { path: circle(2.9, 4.5, 0.8) },
        { path: circle(15.4, 4.5, 0.8) },
        { path: sparkle(25.0, 2.3, 1.3), at: [25.0, 2.3], rotate: 10 },
      ]),
    ],
    title: { x: 1.8, y: 1.2, w: 21, h: 2.4, valign: 'bottom', size: 36 },
    body: [
      { x: 2.7, y: 5.8, w: 10.2, h: 7.9, size: 20 },
      { x: 15.2, y: 5.8, w: 10.2, h: 7.9, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: ground,
    shapes: [
      sheet(47, [
        { path: seal(8.7, 7.9, 6.0, 16, 0.04) },
        { path: sparkle(14.7, 2.9, 1.5), at: [14.7, 2.9], rotate: 8 },
        { path: rounded({ x: 19.4, y: 11.9, w: 5.6, h: 1.7 }, 0.85), at: [22.2, 12.7], rotate: 7 },
      ]),
      ring(8.7, 7.9, 6.75, { ...hair, opacity: 0.5 }),
      rule(16.4, 5.6, 9.8, ink),
      rule(16.4, 10.3, 9.8, ink),
      twinkle(2.2, 2.2, 0.45),
      twinkle(15.2, 13.6, 0.35),
    ],
    title: {
      x: 3.6,
      y: 4.6,
      w: 10.2,
      h: 6.6,
      valign: 'middle',
      align: 'center',
      size: 108,
      sample: '84 %',
    },
    body: {
      x: 16.4,
      y: 5.9,
      w: 9.8,
      h: 4.1,
      valign: 'middle',
      size: 22,
      sample: 'erinnern sich an eine Verpackung, die das Licht fängt.',
    },
  },
  {
    name: 'Zitat',
    bg: ground,
    shapes: [
      sheet(55, [
        { path: circle(27.8, 7.9, 5.6) },
        { path: comma(3.0, 3.6, 0.95) },
        { path: comma(5.5, 3.6, 0.95) },
      ]),
      ring(27.8, 7.9, 6.4, { ...hair, opacity: 0.5 }),
      rule(2.2, 11.75, 3.4, ink),
      twinkle(20.6, 13.2, 0.5),
      twinkle(21.6, 2.4, 0.3),
    ],
    body: {
      x: 2.2,
      y: 5.0,
      w: 18.6,
      h: 6.3,
      valign: 'middle',
      font: 'Urbanist',
      size: 34,
      lineHeight: 116,
      sample: 'Glanz ist nichts als Licht, das sich nicht entscheiden kann.',
    },
    subtitle: { x: 2.2, y: 12.2, w: 16, h: 1.8, sample: 'Noa Winter, Verpackungsdesign' },
  },
  {
    name: 'Bild',
    bg: ground,
    shapes: [
      sheet(62, [
        { path: rounded({ x: 1.6, y: 1.2, w: 24.8, h: 11.2 }, 0.9) },
        { path: seal(24.7, 13.5, 1.35, 12, 0.07) },
      ]),
      ...code(21.0, 13.25, 0.6),
    ],
    pictures: [{ x: 2.15, y: 1.75, w: 23.7, h: 10.1 }],
    title: {
      x: 1.8,
      y: 12.7,
      w: 18.4,
      h: 1.9,
      valign: 'middle',
      size: 28,
      sample: 'Im Licht gedreht',
    },
  },
  {
    name: 'Schluss',
    bg: ground,
    shapes: [
      sheet(71, [{ path: seal(14, 7.3, 5.5, 18, 0.035), plain: true, rim: 0 }], {
        full: true,
        turn: 1.2,
      }),
      ring(14, 7.3, 4.8, { ...hair, opacity: 0.6 }),
      twinkle(4.2, 3.6, 0.7),
      twinkle(23.8, 11.6, 0.55),
      twinkle(22.6, 3.0, 0.3),
      twinkle(5.6, 12.2, 0.3),
      ...code(1.8, 13.5, 0.6),
    ],
    title: {
      x: 9.6,
      y: 5.0,
      w: 8.8,
      h: 4.6,
      valign: 'middle',
      align: 'center',
      size: 60,
      sample: 'Danke',
    },
    subtitle: {
      x: 6,
      y: 13.2,
      w: 16,
      h: 1.5,
      valign: 'middle',
      align: 'center',
      color: ink,
      sample: 'Fragen? Wir bleiben noch im Licht.',
    },
  },
];

const template: Template = {
  slug: 'holo',
  name: 'Holografisch',
  group: 'Designtrend',
  tags: ['Holografisch', 'Folie', 'schillernd', 'Pastell', 'Sticker', 'Mode', 'Beauty', 'modern'],
  description:
    'Schillernde Folie auf fast weißem Grund: perlige Regenbogenverläufe als Aufkleber, dünne schwarze Schrift und feine Linien.',
  palette: {
    bg: ground,
    text: ink,
    bg2: white,
    text2: grey,
    accents: [pink, lilac, sky, mint, lemon, peach],
  },
  fonts: { head: 'Urbanist', body: 'Urbanist' },
  text: {
    title: { font: 'Urbanist', size: 44, color: ink, lineHeight: 100, spacing: -0.5 },
    subtitle: { font: 'Urbanist', size: 22, color: grey },
    body: { font: 'Urbanist', size: 22, color: ink, lineHeight: 124, paraSpace: 0.3 },
  },
  layouts,
};

export default template;
