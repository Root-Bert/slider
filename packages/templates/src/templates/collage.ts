import { darken, grain, jpeg, lighten, noise, paint, rng, stencil } from '../art';
import type { Box, Color, Fill, Layout, Picture, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page, turned } from '../shapes';

/*
 * Collage: a scrapbook page – kraft paper, and on it what was torn out, cut and stuck down:
 * sheets with ragged white edges, graph and lined paper, coloured scraps, strips of masking
 * tape, prints with a white border. Handwriting, a typewriter for the labels.
 */

const kraft = '#c2a078';
const cream = '#f7f1e3';
const sheetWhite = '#fdfbf5';
const ink = '#2a2521';
const soft = '#6b5d4f';
const coral = '#e0603f';
const mustard = '#e9b233';
const teal = '#2e8c86';
const pink = '#eaa9a2';
const navy = '#2f4468';
const olive = '#8a9440';
const tapeColor = '#f3e3a8';

/** Kraft paper: brown, clouded, with its fibres. */
function kraftPaper(): Picture {
  const surface = paint(PAGE, 1400 / PAGE.w);
  const { ctx, w, h } = surface;
  const field = noise(51);
  const image = ctx.createImageData(w, h);
  const [r, g, b] = [0xc2, 0xa0, 0x78];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const shade =
        1 + (field(x / 240, y / 240, 4) - 0.5) * 0.14 + (field(x / 3, y / 40, 1) - 0.5) * 0.03;
      const i = (y * w + x) * 4;
      image.data[i] = r * shade;
      image.data[i + 1] = g * shade;
      image.data[i + 2] = b * shade;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const random = rng(52);
  ctx.lineCap = 'round';
  for (let i = 0; i < 2600; i += 1) {
    const [x, y, a, reach] = [random() * w, random() * h, random() * Math.PI, random.range(4, 16)];
    ctx.strokeStyle = random() < 0.5 ? 'rgba(255,240,215,0.16)' : 'rgba(90,60,30,0.14)';
    ctx.lineWidth = random.range(0.6, 1.3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
    ctx.stroke();
  }
  grain(surface, 0.04, 53);
  return jpeg(surface, 76);
}

/** The tooth of paper over everything stuck down: faint darker clouds and specks. */
function tooth(): Picture {
  const surface = paint(PAGE, 800 / PAGE.w);
  const { ctx, w, h } = surface;
  const field = noise(54);
  const random = rng(55);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const cloud = Math.max(0, field(x / 60, y / 60, 4) - 0.42) * 0.24;
      image.data[(y * w + x) * 4 + 3] = 255 * Math.min(0.2, cloud + random() * 0.07);
    }
  }
  ctx.putImageData(image, 0, 0);
  return stencil(surface, '#5b4630', 16);
}

const ground: Shape = { t: 'image', ...page, src: kraftPaper() };
const overlay: Shape = { t: 'image', ...page, src: tooth() };

type Pt = readonly [number, number];
type Side = 't' | 'r' | 'b' | 'l';

/** The outline of a torn piece: a box whose sides wander, except those cut `straight`. */
function tornOutline(box: Box, seed: number, straight: string, rough: number): Pt[] {
  const random = rng(seed);
  const field = noise(seed + 5);
  const pts: Pt[] = [];
  const sides: readonly [Side, Pt, Pt, Pt][] = [
    ['t', [box.x, box.y], [1, 0], [0, 1]],
    ['r', [box.x + box.w, box.y], [0, 1], [-1, 0]],
    ['b', [box.x + box.w, box.y + box.h], [-1, 0], [0, -1]],
    ['l', [box.x, box.y + box.h], [0, -1], [1, 0]],
  ];
  sides.forEach(([side, from, along, inward], index) => {
    const length = along[0] !== 0 ? box.w : box.h;
    const count = Math.max(2, Math.ceil(length / 0.17));
    for (let i = 0; i < count; i += 1) {
      const d = straight.includes(side)
        ? 0
        : rough *
          ((field(i * 0.21 + index * 31, 3, 3) - 0.5) * 0.42 +
            (random() - 0.5) * 0.09 +
            (random() < 0.06 ? random.range(0.04, 0.14) : 0));
      const t = (i / count) * length;
      pts.push([from[0] + along[0] * t + inward[0] * d, from[1] + along[1] * t + inward[1] * d]);
    }
  });
  return pts;
}

interface Torn {
  rotate?: number;
  /** Sides cut with scissors, e.g. 'tb'. */
  straight?: string;
  rough?: number;
  /** The white fibre edge a tear leaves. */
  rim?: boolean;
  shadow?: number;
}

const paperFill = (color: Color): Fill => ({
  t: 'linear',
  angle: 160,
  stops: [
    [0, lighten(color, 0.07)],
    [0.5, color],
    [1, darken(color, 0.05)],
  ],
});

/** A piece of paper torn (or cut) to about a box, lying on the page. */
function torn(box: Box, seed: number, color: Color, options: Torn = {}): Shape[] {
  const { rotate = 0, straight = '', rough = 1, rim = true, shadow = 0.3 } = options;
  const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2];
  const lie = { dx: 0.05, dy: 0.1, blur: 0.28, opacity: shadow, color: '#3a2610' };
  const piece = turned(tornOutline(box, seed, straight, rough), rotate, cx, cy);
  if (!rim) return [{ t: 'poly', pts: piece, fill: paperFill(color), shadow: lie }];
  const grow = (side: Side) => (straight.includes(side) ? 0 : 0.07);
  const outer: Box = {
    x: box.x - grow('l'),
    y: box.y - grow('t'),
    w: box.w + grow('l') + grow('r'),
    h: box.h + grow('t') + grow('b'),
  };
  return [
    {
      t: 'poly',
      pts: turned(tornOutline(outer, seed + 1, straight, rough * 1.1), rotate, cx, cy),
      fill: '#fffdf8',
      shadow: lie,
    },
    { t: 'poly', pts: piece, fill: paperFill(color) },
  ];
}

/** The lines of lined or graph paper inside a box, turned with its sheet. */
function ruled(
  box: Box,
  rotate: number,
  options: { step?: number; grid?: boolean; color?: Color; top?: number } = {},
): Shape[] {
  const { step = 0.5, grid = false, color = '#8fb4d6', top = 0 } = options;
  const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2];
  const stroke = { color, width: 0.02, opacity: 0.75 };
  const shapes: Shape[] = [];
  const add = (a: Pt, b: Pt) => {
    const [p, q] = turned([a, b], rotate, cx, cy);
    shapes.push({ t: 'line', x1: p![0], y1: p![1], x2: q![0], y2: q![1], stroke });
  };
  const m = 0.24;
  for (let y = box.y + m + top + step / 2; y < box.y + box.h - m; y += step)
    add([box.x + m, y], [box.x + box.w - m, y]);
  if (grid)
    for (let x = box.x + m + step / 2; x < box.x + box.w - m; x += step)
      add([x, box.y + m], [x, box.y + box.h - m]);
  return shapes;
}

/** A strip of masking tape: see-through, its ends torn off the roll. */
function tape(
  cx: number,
  cy: number,
  length: number,
  rotate: number,
  color: Color = tapeColor,
  width = 0.95,
): Shape {
  const random = rng(Math.round(cx * 31 + cy * 17));
  const [l, t] = [cx - length / 2, cy - width / 2];
  const end = (x: number, down: boolean): Pt[] =>
    Array.from({ length: 7 }, (_, i): Pt => {
      const v = down ? i / 6 : 1 - i / 6;
      return [x + (i % 2 === 0 ? 0 : random.range(-0.11, 0.11)), t + v * width];
    });
  return {
    t: 'poly',
    pts: turned([...end(l + length, true), ...end(l, false)], rotate, cx, cy),
    fill: { t: 'solid', color, opacity: 0.8 },
    shadow: { dx: 0.02, dy: 0.04, blur: 0.1, opacity: 0.2, color: '#3a2610' },
  };
}

/** A round sticker. */
const sticker = (cx: number, cy: number, r: number, color: Color): Shape => ({
  t: 'ellipse',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  fill: paperFill(color),
  shadow: { dx: 0.03, dy: 0.06, blur: 0.14, opacity: 0.28, color: '#3a2610' },
});

/** A print with its white border. */
const print = (box: Box, rotate = 0, color: Color = '#fffefb'): Shape => ({
  t: 'rect',
  ...box,
  rotate,
  fill: paperFill(color),
  shadow: { dx: 0.06, dy: 0.12, blur: 0.32, opacity: 0.36, color: '#3a2610' },
});

const typed = { font: 'Space Mono', color: ink, size: 17 } as const;

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: cream,
    shapes: [
      ground,
      ...torn({ x: 0.8, y: 1.4, w: 9.6, h: 7.2 }, 1, teal, { rotate: -7 }),
      ...torn({ x: 17.4, y: 0.9, w: 8.8, h: 6.6 }, 2, sheetWhite, { rotate: 5, straight: 'tr' }),
      ...ruled({ x: 17.4, y: 0.9, w: 8.8, h: 6.6 }, 5, { grid: true }),
      ...torn({ x: 16.2, y: 7.6, w: 10.2, h: 6.4 }, 3, coral, { rotate: 4 }),
      ...torn({ x: 1.6, y: 9.6, w: 7.4, h: 4.6 }, 4, mustard, { rotate: 6, straight: 'b' }),
      ...torn({ x: 3.2, y: 2.7, w: 19.2, h: 8.8 }, 5, cream, { rotate: -1.5, shadow: 0.4 }),
      tape(4.2, 3, 3.6, -38),
      tape(21.6, 2.6, 3.6, 32),
      sticker(23.6, 9.4, 1.05, navy),
      sticker(25.2, 11, 0.6, mustard),
      ...torn({ x: 9.2, y: 12, w: 13.6, h: 1.7 }, 6, sheetWhite, {
        rotate: 1.5,
        straight: 'tb',
        rim: false,
      }),
      overlay,
    ],
    title: {
      x: 4.6,
      y: 3.6,
      w: 16.6,
      h: 7,
      valign: 'middle',
      size: 70,
      sample: 'Ein Jahr\nin Schnipseln',
    },
    subtitle: {
      x: 9.9,
      y: 12.15,
      w: 12.4,
      h: 1.4,
      valign: 'middle',
      sample: 'Reisetagebuch, Band drei',
    },
  },
  {
    name: 'Abschnitt',
    bg: cream,
    shapes: [
      ground,
      ...torn({ x: 18.6, y: 1.6, w: 7.6, h: 5.8 }, 11, sheetWhite, { rotate: 6, straight: 'tl' }),
      ...ruled({ x: 18.6, y: 1.6, w: 7.6, h: 5.8 }, 6, { grid: true }),
      ...torn({ x: 19.6, y: 7.4, w: 6.6, h: 6.4 }, 12, pink, { rotate: -6 }),
      ...torn({ x: 17.2, y: 9.6, w: 5.2, h: 3.4 }, 13, mustard, { rotate: 9, straight: 'lb' }),
      ...torn({ x: -1, y: -1, w: 17.6, h: 17.75 }, 14, teal, {
        straight: 'tlb',
        rough: 1.5,
        shadow: 0.42,
      }),
      tape(22.4, 1.7, 3.4, 4),
      sticker(18.3, 7.6, 1.15, coral),
      ...torn({ x: 1.9, y: 10.5, w: 11.6, h: 1.7 }, 15, sheetWhite, {
        rotate: -2,
        straight: 'tb',
        rim: false,
      }),
      overlay,
    ],
    title: { x: 2.2, y: 4, w: 13.4, h: 5.8, color: cream, size: 76, sample: 'Zweiter Teil' },
    subtitle: { x: 2.5, y: 10.65, w: 10.6, h: 1.4, valign: 'middle', sample: 'Unterwegs im Süden' },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      ground,
      ...torn({ x: 22.6, y: 1.4, w: 5, h: 6 }, 21, sheetWhite, { rotate: -7, straight: 'r' }),
      ...ruled({ x: 22.6, y: 1.4, w: 5, h: 6 }, -7, { grid: true }),
      ...torn({ x: 22.2, y: 9.4, w: 5.4, h: 5.4 }, 22, coral, { rotate: 8 }),
      ...torn({ x: 1.3, y: 3.5, w: 21.6, h: 11.2 }, 23, sheetWhite, { rotate: -0.6, shadow: 0.36 }),
      ...torn({ x: 1, y: 0.9, w: 19.6, h: 2.5 }, 24, mustard, { rotate: -1, straight: 'tb' }),
      tape(1.6, 2.1, 2.6, -80),
      tape(21.9, 4, 3.2, 40),
      sticker(24.4, 8.8, 0.8, navy),
      overlay,
    ],
    title: {
      x: 2.6,
      y: 1.05,
      w: 17.4,
      h: 2.2,
      valign: 'middle',
      size: 38,
      sample: 'Was in den Koffer kam',
    },
    body: {
      x: 2.8,
      y: 4.7,
      w: 18.6,
      h: 9.2,
      sample: [
        'Ein Notizbuch, das überall aufgeht',
        'Klebestift und eine kleine Schere',
        'Die alte Kamera mit zwei Filmen',
        'Briefmarken für zwölf Karten',
        'Viel zu viele Socken',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: cream,
    shapes: [
      ground,
      ...torn({ x: 19.4, y: 9.2, w: 8, h: 5.6 }, 31, pink, { rotate: 7 }),
      ...torn({ x: 1.2, y: 3.7, w: 12.4, h: 11 }, 32, sheetWhite, {
        rotate: 0.8,
        straight: 'l',
        shadow: 0.36,
      }),
      ...ruled({ x: 1.2, y: 3.7, w: 12.4, h: 11 }, 0.8, { step: 0.62, top: 0.5 }),
      ...torn({ x: 1, y: 0.9, w: 12.6, h: 2.5 }, 33, teal, { rotate: 1, straight: 'tb' }),
      print({ x: 14.4, y: 2.2, w: 12, h: 11.4 }, -3, '#efe9dc'),
      print({ x: 14.6, y: 2.2, w: 11.8, h: 11.2 }),
      tape(20.5, 2.15, 3.8, -3),
      tape(12.9, 4, 2.6, 50),
      overlay,
    ],
    title: {
      x: 2,
      y: 1.05,
      w: 11,
      h: 2.2,
      valign: 'middle',
      size: 38,
      color: cream,
      sample: 'Der Hafen',
    },
    body: {
      x: 2.4,
      y: 4.9,
      w: 10.2,
      h: 8.8,
      sample: [
        'Morgens riecht es nach Teer',
        'Die Boote heißen wie Tanten',
        'Kaffee gibt es am Kiosk',
      ],
    },
    pictures: [{ x: 15.3, y: 3, w: 10.4, h: 8.2 }],
  },
  {
    name: 'Zwei Spalten',
    bg: cream,
    shapes: [
      ground,
      ...torn({ x: 23.4, y: 0.4, w: 4.4, h: 3.4 }, 41, coral, { rotate: 10 }),
      ...torn({ x: 1.4, y: 4.2, w: 12.3, h: 10.5 }, 42, sheetWhite, { rotate: -1.2, shadow: 0.36 }),
      ...torn({ x: 14.4, y: 4, w: 12.3, h: 10.7 }, 43, sheetWhite, {
        rotate: 1,
        straight: 'tr',
        shadow: 0.36,
      }),
      ...ruled({ x: 14.4, y: 4, w: 12.3, h: 10.7 }, 1, { grid: true }),
      ...torn({ x: 1, y: 0.9, w: 17, h: 2.5 }, 44, pink, { rotate: 0.8, straight: 'tb' }),
      tape(7.4, 4.2, 3.6, -4, tapeColor),
      tape(20.6, 4, 3.6, 5, '#bfe0d8'),
      sticker(14, 3.9, 0.7, mustard),
      overlay,
    ],
    title: { x: 2, y: 1.05, w: 15, h: 2.2, valign: 'middle', size: 38, sample: 'Stadt oder Küste' },
    body: [
      {
        x: 2.6,
        y: 5.5,
        w: 10,
        h: 8.2,
        sample: ['Märkte bis in die Nacht', 'Zu Fuß durch jede Gasse', 'Laut, eng und herrlich'],
      },
      {
        x: 15.6,
        y: 5.5,
        w: 10,
        h: 8.2,
        sample: ['Wind, der alles aufräumt', 'Ein Weg, kein Plan', 'Abends Fisch vom Grill'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: cream,
    shapes: [
      ground,
      ...torn({ x: 10.4, y: 1.2, w: 7.6, h: 5.4 }, 51, sheetWhite, { rotate: 8, straight: 'tr' }),
      ...ruled({ x: 10.4, y: 1.2, w: 7.6, h: 5.4 }, 8, { grid: true }),
      ...torn({ x: 1.2, y: 9.6, w: 6, h: 4.8 }, 52, teal, { rotate: -9 }),
      ...torn({ x: 2, y: 2.6, w: 13.8, h: 10.4 }, 53, coral, {
        rotate: -3,
        rough: 1.3,
        shadow: 0.42,
      }),
      ...torn({ x: 16.6, y: 4.6, w: 9.8, h: 7.4 }, 54, sheetWhite, {
        rotate: 2.5,
        straight: 'l',
        shadow: 0.36,
      }),
      ...ruled({ x: 16.6, y: 4.6, w: 9.8, h: 7.4 }, 2.5, { step: 0.62, top: 0.4 }),
      tape(21.4, 4.5, 3.6, 3),
      tape(3.2, 3.4, 3.4, -42),
      sticker(15.6, 12.2, 1, mustard),
      sticker(24.6, 13.2, 0.55, navy),
      overlay,
    ],
    title: {
      x: 2.6,
      y: 4.2,
      w: 12.6,
      h: 7.2,
      valign: 'middle',
      align: 'center',
      font: 'Space Mono',
      bold: true,
      size: 128,
      color: cream,
      sample: '365',
    },
    body: {
      x: 17.5,
      y: 5.5,
      w: 8.2,
      h: 5.8,
      valign: 'middle',
      font: 'Indie Flower',
      size: 27,
      lineHeight: 112,
      sample: 'Tage unterwegs, 41 Orte und ein einziger Rucksack.',
    },
  },
  {
    name: 'Zitat',
    bg: cream,
    shapes: [
      ground,
      ...torn({ x: 0.8, y: 9, w: 7, h: 5.6 }, 61, teal, { rotate: -8 }),
      ...torn({ x: 20.6, y: 0.6, w: 6.6, h: 5 }, 62, mustard, { rotate: 9 }),
      ...torn({ x: 3.2, y: 1.6, w: 21.6, h: 10.4 }, 63, sheetWhite, {
        rotate: -1,
        straight: 'tb',
        rough: 1.3,
        shadow: 0.4,
      }),
      ...ruled({ x: 3.2, y: 1.6, w: 21.6, h: 10.4 }, -1, { step: 0.7, top: 0.6 }),
      {
        t: 'text',
        x: 3.6,
        y: 1.5,
        w: 4,
        h: 4,
        text: '“',
        font: 'Bitter',
        bold: true,
        size: 150,
        color: coral,
      },
      tape(18.6, 13.1, 12.6, -2, tapeColor, 1.7),
      sticker(24.4, 10.6, 0.8, pink),
      overlay,
    ],
    body: {
      x: 6.6,
      y: 2.6,
      w: 16.8,
      h: 8.4,
      valign: 'middle',
      font: 'Indie Flower',
      size: 38,
      lineHeight: 112,
      sample: '„Man reist nicht, um anzukommen, sondern um unterwegs etwas aufzuheben.“',
    },
    subtitle: {
      x: 13,
      y: 12.4,
      w: 11.2,
      h: 1.4,
      valign: 'middle',
      align: 'center',
      sample: 'Mara, kurz vor Porto',
    },
  },
  {
    name: 'Bild',
    bg: cream,
    shapes: [
      ground,
      ...torn({ x: 0.6, y: 8.6, w: 6.4, h: 6 }, 71, teal, { rotate: -6 }),
      ...torn({ x: 21.6, y: 0.8, w: 6, h: 6.4 }, 72, mustard, { rotate: 7 }),
      ...torn({ x: 22, y: 9.6, w: 5.4, h: 4.6 }, 73, pink, { rotate: -9 }),
      print({ x: 3, y: 1.1, w: 21.8, h: 13.2 }, 2.2, '#efe9dc'),
      print({ x: 3.1, y: 0.9, w: 21.8, h: 13.5 }),
      tape(3.6, 1.5, 3.6, -40),
      tape(24.4, 1.5, 3.6, 40),
      overlay,
    ],
    pictures: [{ x: 3.8, y: 1.6, w: 20.4, h: 9.9 }],
    title: {
      x: 4.4,
      y: 11.75,
      w: 19.2,
      h: 2.4,
      valign: 'middle',
      align: 'center',
      size: 38,
      sample: 'Der Markt am Samstagmorgen',
    },
  },
  {
    name: 'Schluss',
    bg: cream,
    shapes: [
      ground,
      ...torn({ x: 2.4, y: 3.4, w: 9, h: 7.4 }, 81, coral, { rotate: -12 }),
      ...torn({ x: 17, y: 2, w: 9, h: 7 }, 82, teal, { rotate: 9 }),
      ...torn({ x: 9.6, y: 0.8, w: 8.6, h: 5 }, 83, sheetWhite, { rotate: -4, straight: 't' }),
      ...ruled({ x: 9.6, y: 0.8, w: 8.6, h: 5 }, -4, { grid: true }),
      ...torn({ x: 15.6, y: 8.6, w: 9.4, h: 5.2 }, 84, pink, { rotate: -5 }),
      ...torn({ x: 3.4, y: 9.4, w: 7, h: 4.6 }, 85, mustard, { rotate: 7, straight: 'l' }),
      ...torn({ x: 5.6, y: 3.3, w: 16.8, h: 7.6 }, 86, cream, { rotate: 1.5, shadow: 0.42 }),
      tape(6.6, 3.5, 3.6, -36),
      tape(21.6, 3.9, 3.6, 38),
      sticker(4.4, 2.4, 0.8, navy),
      ...torn({ x: 8, y: 11.6, w: 12, h: 1.7 }, 87, sheetWhite, {
        rotate: -1.5,
        straight: 'tb',
        rim: false,
      }),
      overlay,
    ],
    title: {
      x: 6.4,
      y: 3.9,
      w: 15.2,
      h: 6.4,
      valign: 'middle',
      align: 'center',
      size: 84,
      sample: 'Bis bald!',
    },
    subtitle: {
      x: 8.5,
      y: 11.75,
      w: 11,
      h: 1.4,
      valign: 'middle',
      align: 'center',
      sample: 'Fragen und Fundstücke',
    },
  },
];

const template: Template = {
  slug: 'collage',
  name: 'Collage',
  group: 'Kunststil',
  tags: [
    'Collage',
    'Scrapbook',
    'Papier',
    'gerissen',
    'Klebeband',
    'handgemacht',
    'Reise',
    'persönlich',
  ],
  description:
    'Eine Seite aus dem Klebebuch: Packpapier, gerissene Blätter mit weißem Rand, Kästchenpapier, bunte Schnipsel, Klebestreifen und Abzüge mit Rand.',
  palette: {
    bg: cream,
    text: ink,
    bg2: kraft,
    text2: soft,
    accents: [coral, mustard, teal, pink, navy, olive],
  },
  fonts: { head: 'Indie Flower', body: 'Bitter' },
  text: {
    title: { font: 'Indie Flower', size: 60, color: ink, lineHeight: 96 },
    subtitle: { ...typed },
    body: { font: 'Bitter', size: 20, color: ink, lineHeight: 126, paraSpace: 0.36 },
  },
  layouts,
};

export default template;
