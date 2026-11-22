import { paint, png, rng } from '../art';
import type { Color, Layout, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page } from '../shapes';

/*
 * Pixel: an 8-bit game – the page is a grid of 80 × 45 square blocks and everything keeps to it:
 * clouds, hills, coins, hearts, stars, stepped frames and the dialogue box. Own sprites, a few
 * bright colours on sky blue by day and dark blue by night.
 */

const sky = '#6fd0ff';
const night = '#1a1c4b';
const deep = '#10112e';
const white = '#ffffff';
const yellow = '#ffd23f';
const red = '#ff4d5e';
const green = '#3ecf6e';
const forest = '#1f9d57';
const orange = '#ff8a3c';
const purple = '#7a4dff';
const brown = '#8a4b2a';
const dusk = '#4a4f8a';

/** One block of the grid in cm; the page is 80 × 45 of them. */
const U = 0.35;
const u = (cells: number) => Number((cells * U).toFixed(3));

interface Pix {
  /** A block of cells in one colour. */
  rect(x: number, y: number, w: number, h: number, color: Color): void;
  /** A sprite from rows of letters; `.` is nothing. */
  map(
    rows: readonly string[],
    colors: Record<string, Color>,
    x: number,
    y: number,
    scale?: number,
  ): void;
}

/** A screen of the game, drawn block by block. */
function scene(ground: Color, draw: (p: Pix) => void): Shape {
  const size = 12;
  const surface = paint(PAGE, size / U);
  const { ctx, w, h } = surface;
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);
  const p: Pix = {
    rect(x, y, cw, ch, color) {
      ctx.fillStyle = color;
      ctx.fillRect(
        Math.round(x * size),
        Math.round(y * size),
        Math.round(cw * size),
        Math.round(ch * size),
      );
    },
    map(rows, colors, x, y, scale = 1) {
      rows.forEach((row, ry) => {
        [...row].forEach((key, rx) => {
          const color = colors[key];
          if (color) p.rect(x + rx * scale, y + ry * scale, scale, scale, color);
        });
      });
    },
  };
  draw(p);
  return { t: 'image', ...page, src: png(surface) };
}

const HEART = ['.kk.kk.', 'kowkrrk', 'krrrrrk', '.krrrk.', '..krk..', '...k...'];
const heart = (p: Pix, x: number, y: number, scale = 1, full = true) =>
  p.map(
    HEART,
    { k: deep, r: full ? red : dusk, o: full ? red : dusk, w: full ? white : dusk },
    x,
    y,
    scale,
  );

const COIN = ['.kkkk.', 'kywwyk', 'kywoyk', 'kywoyk', 'kyooyk', '.kkkk.'];
const coin = (p: Pix, x: number, y: number, scale = 1) =>
  p.map(COIN, { k: '#a85a00', y: yellow, w: '#fff3b0', o: orange }, x, y, scale);

const STAR = ['...k...', '..kyk..', 'kkkykkk', 'kyyyyyk', '.kyyyk.', 'kyykyyk', 'kkk.kkk'];
const starSprite = (p: Pix, x: number, y: number, scale = 1) =>
  p.map(STAR, { k: '#a85a00', y: yellow }, x, y, scale);

const GEM = ['.kkkkk.', 'kwwccdk', 'kwcccdk', '.kccdk.', '..kdk..', '...k...'];
const gem = (p: Pix, x: number, y: number, scale = 1) =>
  p.map(GEM, { k: deep, w: white, c: '#7df0ff', d: '#2aa7e0' }, x, y, scale);

const CLOUD = ['...www.....', '.wwwwwww...', 'wwwwwwwwww.', 'wwwwwwwwwww', 'sssssssssss'];
const cloud = (p: Pix, x: number, y: number, scale = 1, tint: Color = '#c9ecff') =>
  p.map(CLOUD, { w: white, s: tint }, x, y, scale);

const SPARK = ['..w..', '..w..', 'ww.ww', '..w..', '..w..'];

function hill(
  p: Pix,
  cx: number,
  base: number,
  half: number,
  height: number,
  color = green,
  dark = forest,
) {
  for (let dx = -half; dx <= half; dx += 1) {
    const rise = Math.round(height * Math.sqrt(1 - (dx / (half + 0.5)) ** 2));
    if (rise <= 0) continue;
    p.rect(cx + dx, base - rise, 1, rise, color);
    p.rect(cx + dx, base - rise, 1, 1, '#8ff0a4');
  }
  const random = rng(cx * 31 + half);
  for (let i = 0; i < half; i += 1) {
    const dx = random.int(-half + 3, half - 3);
    const rise = Math.round(height * Math.sqrt(1 - (dx / (half + 0.5)) ** 2));
    const dy = random.int(2, Math.max(2, rise - 1));
    if (dy < rise - 1) p.rect(cx + dx, base - dy, 2, 1, dark);
  }
}

/** The floor: grass on earth. */
function floor(p: Pix, top: number, grass: Color = green, earth: Color = brown) {
  p.rect(0, top, 80, 45 - top, earth);
  for (let y = top + 2; y < 45; y += 1) {
    for (let x = 0; x < 80; x += 1) {
      if ((x * 3 + y * 5) % 11 === 0) p.rect(x, y, 2, 1, '#6d3518');
      if ((x * 7 + y * 3) % 23 === 0) p.rect(x, y, 1, 1, '#b56a3f');
    }
  }
  p.rect(0, top, 80, 2, grass);
  p.rect(0, top, 80, 1, '#8ff0a4');
  for (let x = 0; x < 80; x += 1) if (x % 4 < 2) p.rect(x, top + 2, 1, 1, grass);
}

/** A building block, lit from up left. */
function block(p: Pix, x: number, y: number, size = 4, color: Color = orange) {
  p.rect(x, y, size, size, deep);
  p.rect(x, y, size - 1, size - 1, '#ffc48a');
  p.rect(x + 1, y + 1, size - 1, size - 1, '#b5531a');
  p.rect(x + 1, y + 1, size - 2, size - 2, color);
}

type Cells = readonly [x: number, y: number, w: number, h: number];

/** Stars over the night, none where `keep` says text stands. */
function stars(p: Pix, seed: number, count: number, rows = 40, keep: readonly Cells[] = []) {
  const random = rng(seed);
  for (let i = 0; i < count; i += 1) {
    const [x, y] = [random.int(0, 79), random.int(0, rows)];
    const big = random() < 0.16;
    const color = random() < 0.25 ? yellow : random() < 0.5 ? '#9fb0ff' : white;
    if (
      keep.some(
        ([kx, ky, kw, kh]) => x >= kx - 2 && x <= kx + kw + 1 && y >= ky - 2 && y <= ky + kh + 1,
      )
    )
      continue;
    p.rect(x, y, 1, 1, color);
    if (big) {
      p.rect(x - 1, y, 3, 1, color);
      p.rect(x, y - 1, 1, 3, color);
    }
  }
}

function disc(p: Pix, cx: number, cy: number, r: number, color: Color) {
  for (let dy = -r; dy <= r; dy += 1) {
    const half = Math.round(Math.sqrt(r * r - dy * dy + r * 0.8));
    p.rect(cx - half, cy + dy, half * 2 + 1, 1, color);
  }
}

/** A frame with stepped corners: an edge of one block, its ground, a hard shadow. */
function frame(
  p: Pix,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: Color,
  edge: Color,
  shadow: Color | null = null,
) {
  const stepped = (ox: number, oy: number, ow: number, oh: number, color: Color) => {
    p.rect(ox + 1, oy, ow - 2, oh, color);
    p.rect(ox, oy + 1, ow, oh - 2, color);
  };
  if (shadow) stepped(x + 1, y + 1, w, h, shadow);
  stepped(x, y, w, h, edge);
  stepped(x + 1, y + 1, w - 2, h - 2, fill);
}

const list = [
  'Drei Leben, kein Speicherpunkt',
  'Jede Münze zählt für den Rekord',
  'Sprünge wollen geübt sein',
  'Am Ende wartet immer ein Gegner',
  'Wer verliert, fängt vorne an',
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: sky,
    shapes: [
      scene(sky, (p) => {
        disc(p, 66, 8, 5, '#fff3b0');
        disc(p, 66, 8, 4, yellow);
        cloud(p, 44, 3);
        cloud(p, 70, 20);
        hill(p, 64, 39, 17, 11);
        hill(p, 41, 39, 9, 5, forest, '#147a42');
        floor(p, 39);
        [0, 1, 2].forEach((i) => heart(p, 5 + i * 8, 2, 1, i < 2 || true));
        for (let i = 0; i < 4; i += 1) block(p, 55 + i * 4, 23);
        [0, 1, 2].forEach((i) => coin(p, 56 + i * 5, 16));
        frame(p, 5, 9, 46, 19, night, white, deep);
        // The arrow before „Start“.
        p.map(['k...', 'kk..', 'kkk.', 'kkkk', 'kkk.', 'kk..', 'k...'], { k: night }, 6, 30);
      }),
    ],
    title: {
      x: u(8),
      y: u(10.5),
      w: u(41),
      h: u(16),
      size: 44,
      color: white,
      valign: 'middle',
      sample: 'Spiel,\nSatz, Sieg',
    },
    subtitle: {
      x: u(12),
      y: u(29),
      w: u(38),
      h: u(9),
      valign: 'top',
      pad: [0.42, 0, 0, 0],
      sample: 'Start drücken',
    },
  },
  {
    name: 'Abschnitt',
    bg: night,
    shapes: [
      scene(night, (p) => {
        stars(p, 7, 90, 40, [
          [5, 10, 42, 25],
          [48, 8, 32, 33],
        ]);
        // Stairs up to the gem.
        for (let step = 0; step < 5; step += 1) {
          for (let row = 0; row <= step; row += 1) {
            block(p, 50 + step * 6, 37 - row * 4, 4, purple);
            block(p, 52 + step * 6, 37 - row * 4, 4, purple);
          }
        }
        p.rect(0, 41, 80, 4, deep);
        p.rect(0, 41, 80, 1, dusk);
        gem(p, 73, 12, 1);
        p.map(SPARK, { w: white }, 68, 8);
        p.map(SPARK, { w: yellow }, 62, 15);
        [0, 1, 2].forEach((i) => coin(p, 50 + i * 6, 30 - i * 4));
        p.rect(5, 11, 12, 1, yellow);
      }),
    ],
    title: {
      x: u(5),
      y: u(13),
      w: u(40),
      h: u(15),
      size: 48,
      color: yellow,
      valign: 'middle',
      sample: 'Level 2:\nDie Höhle',
    },
    subtitle: {
      x: u(5),
      y: u(29),
      w: u(38),
      h: u(5),
      color: white,
      valign: 'middle',
      sample: 'Hier wird es dunkel',
    },
  },
  {
    name: 'Inhalt',
    bg: sky,
    shapes: [
      scene(sky, (p) => {
        cloud(p, 62, 2);
        cloud(p, 50, 5, 1);
        p.rect(0, 42, 80, 3, forest);
        p.rect(0, 42, 80, 1, green);
        for (let x = 0; x < 80; x += 1) if (x % 4 < 2) p.rect(x, 41, 1, 1, green);
        frame(p, 4, 10, 63, 30, white, night, '#3a9fd6');
        coin(p, 71, 13);
        heart(p, 70, 22);
        starSprite(p, 70, 31);
      }),
    ],
    title: {
      x: u(5),
      y: u(2),
      w: u(54),
      h: u(7),
      valign: 'middle',
      sample: 'So gewinnt man das Spiel',
    },
    body: { x: u(7), y: u(12.5), w: u(57), h: u(25.5), sample: list },
  },
  {
    name: 'Text und Bild',
    bg: night,
    shapes: [
      scene(night, (p) => {
        stars(p, 19, 80, 44, [
          [2, 3, 38, 40],
          [42, 3, 36, 42],
        ]);
        frame(p, 4, 5, 34, 36, deep, yellow, deep);
        p.rect(44, 17, 10, 1, yellow);
        [0, 1, 2].forEach((i) => coin(p, 44 + i * 7, 37));
      }),
    ],
    pictures: [{ x: u(6), y: u(7), w: u(30), h: u(32) }],
    title: {
      x: u(44),
      y: u(4),
      w: u(32),
      h: u(12),
      size: 28,
      color: yellow,
      valign: 'bottom',
      sample: 'Die Karte der Welt',
    },
    body: {
      x: u(44),
      y: u(19.5),
      w: u(32),
      h: u(16.5),
      size: 20,
      color: white,
      sample: ['Acht Länder', 'Zwei geheime Wege', 'Ein Schloss am Ende'],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: sky,
    shapes: [
      scene(sky, (p) => {
        cloud(p, 64, 2);
        floor(p, 42);
        frame(p, 4, 12, 35, 28, white, night, '#3a9fd6');
        frame(p, 41, 12, 35, 28, white, night, '#3a9fd6');
        frame(p, 6, 9, 11, 8, night, night);
        heart(p, 8, 10);
        frame(p, 43, 9, 11, 8, night, night);
        starSprite(p, 45, 10);
      }),
    ],
    title: {
      x: u(5),
      y: u(1.5),
      w: u(56),
      h: u(7),
      valign: 'middle',
      sample: 'Spielerin 1 gegen Spieler 2',
    },
    body: [
      {
        x: u(7),
        y: u(17.5),
        w: u(30),
        h: u(21),
        size: 20,
        sample: ['Springt weit', 'Sammelt alles ein', 'Kennt jede Abkürzung'],
      },
      {
        x: u(44),
        y: u(17.5),
        w: u(30),
        h: u(21),
        size: 20,
        sample: ['Rennt schnell', 'Lässt nichts liegen', 'Sucht noch den Ausgang'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: night,
    shapes: [
      scene(night, (p) => {
        stars(p, 31, 70, 25, [
          [4, 3, 46, 22],
          [50, 2, 28, 24],
        ]);
        // A pile of coins.
        [3, 2, 1].forEach((count, row) => {
          for (let i = 0; i < count; i += 1)
            coin(p, 53 + row * 3.5 + i * 7 + (row === 1 ? 0 : 0), 18 - row * 7, 1);
        });
        p.map(SPARK, { w: white }, 51, 4);
        p.map(SPARK, { w: yellow }, 74, 8);
        p.rect(5, 23, 40, 1, yellow);
        frame(p, 4, 27, 72, 15, deep, white);
        p.map(['kkkkk', '.kkk.', '..k..'], { k: white }, 69, 36);
      }),
    ],
    title: {
      x: u(5),
      y: u(4),
      w: u(44),
      h: u(18),
      size: 112,
      color: yellow,
      valign: 'middle',
      sample: '9 999',
    },
    body: {
      x: u(7),
      y: u(28.5),
      w: u(62),
      h: u(12),
      size: 22,
      color: white,
      valign: 'middle',
      sample: 'Münzen im ersten Durchlauf – mehr passen nicht auf die Anzeige.',
    },
  },
  {
    name: 'Zitat',
    bg: sky,
    shapes: [
      scene(sky, (p) => {
        disc(p, 12, 6, 4, yellow);
        cloud(p, 30, 3);
        cloud(p, 62, 7);
        hill(p, 60, 20, 20, 9);
        hill(p, 22, 20, 12, 5, forest, '#147a42');
        floor(p, 20);
        frame(p, 4, 17, 72, 24, night, white, deep);
        frame(p, 7, 14, 32, 6, yellow, night);
        p.map(['kkkkk', '.kkk.', '..k..'], { k: white }, 69, 35);
      }),
    ],
    body: {
      x: u(8),
      y: u(21),
      w: u(64),
      h: u(16),
      font: 'Space Mono',
      bold: true,
      size: 27,
      color: white,
      lineHeight: 118,
      valign: 'middle',
      sample: 'Wer jede Kiste öffnet, kommt später an. Aber reicher.',
    },
    subtitle: {
      x: u(9),
      y: u(14),
      w: u(28),
      h: u(6),
      size: 17,
      valign: 'middle',
      sample: 'Der alte Händler',
    },
  },
  {
    name: 'Bild',
    bg: sky,
    shapes: [
      scene(sky, (p) => {
        cloud(p, 68, 0);
        floor(p, 39);
        frame(p, 5, 2, 70, 32, white, night, '#3a9fd6');
        p.rect(7, 4, 66, 28, night);
        frame(p, 5, 36, 48, 7, white, night, deep);
        coin(p, 58, 33);
        coin(p, 65, 33);
        heart(p, 72, 33);
      }),
    ],
    pictures: [{ x: u(7), y: u(4), w: u(66), h: u(28) }],
    title: {
      x: u(7),
      y: u(36),
      w: u(44),
      h: u(7),
      size: 24,
      valign: 'middle',
      sample: 'Welt 1, kurz vor dem Ziel',
    },
  },
  {
    name: 'Schluss',
    bg: night,
    shapes: [
      scene(night, (p) => {
        stars(p, 53, 110, 39, [
          [10, 15, 60, 18],
          [28, 2, 26, 13],
          [26, 33, 30, 7],
        ]);
        gem(p, 33, 3, 2);
        p.map(SPARK, { w: white }, 27, 4);
        p.map(SPARK, { w: yellow }, 49, 9);
        for (let i = 0; i < 20; i += 1) block(p, i * 4, 41, 4, purple);
        [0, 1, 2].forEach((i) => heart(p, 28 + i * 9, 34));
      }),
    ],
    title: {
      x: u(8),
      y: u(16),
      w: u(64),
      h: u(11),
      size: 58,
      color: yellow,
      align: 'center',
      valign: 'middle',
      sample: 'Geschafft!',
    },
    subtitle: {
      x: u(14),
      y: u(27),
      w: u(52),
      h: u(5),
      color: white,
      align: 'center',
      valign: 'middle',
      sample: 'Danke fürs Mitspielen',
    },
  },
];

const template: Template = {
  slug: 'pixel',
  name: 'Pixel',
  group: 'Designtrend',
  tags: ['Pixel', '8-Bit', 'Spiel', 'Retro', 'Gaming', 'bunt', 'Schule', 'Workshop'],
  description:
    'Ein 8-Bit-Spiel: alles aus Klötzchen – Wolken, Hügel, Münzen, Herzen und Rahmen mit Treppenkanten, bei Tag und bei Nacht.',
  palette: {
    bg: sky,
    text: night,
    bg2: white,
    text2: dusk,
    accents: [yellow, red, green, orange, purple, brown],
  },
  fonts: { head: 'Space Mono', body: 'Space Grotesk' },
  text: {
    title: { font: 'Space Mono', size: 30, color: night, bold: true, lineHeight: 104 },
    subtitle: { font: 'Space Mono', size: 22, color: night, bold: true },
    body: { font: 'Space Grotesk', size: 23, color: night, lineHeight: 116, paraSpace: 0.36 },
  },
  layouts,
};

export default template;
