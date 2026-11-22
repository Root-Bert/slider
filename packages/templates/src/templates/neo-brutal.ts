import type { Box, Color, FillLike, Layout, Shape, Template } from '../model';
import { gridLines, page, star, turned } from '../shapes';

/*
 * Neo-Brutalismus: a product page taken apart – flat candy fills, every piece outlined in black
 * with a hard black shadow, windows, pills, toggles, cursors. A little clumsy on purpose.
 */

const lilac = '#b9a6ff';
const lime = '#c6f060';
const peach = '#ffb48a';
const sky = '#8ed4ff';
const yellow = '#ffe14f';
const pink = '#ff8fc6';
const ink = '#111111';
const cream = '#fff7e8';
const white = '#ffffff';

const line = { color: ink, width: 0.11, join: 'round' } as const;
const hard = (drop = 0.3) => ({ dx: drop, dy: drop, color: ink, opacity: 1 });

/** A card: outlined, with its hard shadow. */
const card = (box: Box, fill: FillLike, r = 0.45, drop = 0.3, rotate = 0): Shape => ({
  t: 'rect',
  ...box,
  r,
  fill,
  stroke: line,
  shadow: drop ? hard(drop) : undefined,
  rotate,
});

const pill = (box: Box, fill: FillLike, drop = 0.22, rotate = 0): Shape =>
  card(box, fill, box.h / 2, drop, rotate);

const dot = (cx: number, cy: number, r: number, fill: FillLike, drop = 0): Shape => ({
  t: 'ellipse',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  fill,
  stroke: line,
  shadow: drop ? hard(drop) : undefined,
});

/** A sticker with one glyph on it. */
const glyph = (
  box: Box,
  text: string,
  fill: FillLike,
  options: { r?: number; size?: number; rotate?: number; color?: Color; font?: string } = {},
): Shape[] => [
  card(box, fill, options.r ?? 0.5, 0.22, options.rotate),
  {
    t: 'text',
    ...box,
    text,
    rotate: options.rotate,
    font: options.font ?? 'Lexend',
    bold: true,
    size: options.size ?? 28,
    color: options.color ?? ink,
    align: 'center',
    valign: 'middle',
    nowrap: true,
  },
];

/** A window's head: the rule under it and its three buttons. */
const windowHead = (box: Box, head = 1.15): Shape[] => [
  {
    t: 'line',
    x1: box.x,
    y1: box.y + head,
    x2: box.x + box.w,
    y2: box.y + head,
    stroke: line,
  },
  dot(box.x + 0.75, box.y + head / 2, 0.2, peach),
  dot(box.x + 1.4, box.y + head / 2, 0.2, yellow),
  dot(box.x + 2.05, box.y + head / 2, 0.2, lime),
];

/** A thick arrow from its tail, `length` long, turned `angle`. */
const arrow = (x: number, y: number, length: number, angle: number, fill: FillLike): Shape => {
  const [t, head] = [length * 0.11, length * 0.3];
  return {
    t: 'poly',
    fill,
    stroke: line,
    shadow: hard(0.16),
    pts: turned(
      [
        [x, y - t],
        [x + length - head, y - t],
        [x + length - head, y - head * 0.75],
        [x + length, y],
        [x + length - head, y + head * 0.75],
        [x + length - head, y + t],
        [x, y + t],
      ],
      angle,
      x,
      y,
    ),
  };
};

/** The mouse pointer, its tip at x, y. */
const cursor = (x: number, y: number, size: number, fill: FillLike = white): Shape => ({
  t: 'poly',
  fill,
  stroke: line,
  shadow: hard(0.16),
  pts: (
    [
      [0, 0],
      [0, 1],
      [0.27, 0.76],
      [0.45, 1.18],
      [0.62, 1.1],
      [0.44, 0.7],
      [0.78, 0.7],
    ] as const
  ).map(([u, v]) => [x + u * size, y + v * size] as const),
});

const sparkle = (cx: number, cy: number, r: number, fill: FillLike): Shape =>
  star(cx, cy, r, r * 0.36, 4, fill, { stroke: line });

/** A switch, on. */
const toggle = (box: Box, fill: FillLike, rotate = 0): Shape[] => {
  const r = box.h / 2 - 0.22;
  const [kx, ky] = turned(
    [[box.x + box.w - box.h / 2, box.y + box.h / 2]],
    rotate,
    box.x + box.w / 2,
    box.y + box.h / 2,
  )[0]!;
  return [pill(box, fill, 0.22, rotate), dot(kx, ky, r, white)];
};

const grid = (opacity = 0.1): Shape[] =>
  gridLines(page, 1.75, { color: ink, width: 0.03, opacity });

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: lilac,
    shapes: [
      ...grid(0.13),
      card({ x: 20.6, y: 1.5, w: 5.4, h: 5.4 }, peach, 0.9, 0.3, 7),
      sparkle(23.3, 4.2, 1.75, white),
      dot(22.4, 10.4, 2.1, sky, 0.3),
      arrow(21.2, 11.5, 2.9, -45, yellow),
      ...toggle({ x: 22.9, y: 12.9, w: 3.5, h: 1.6 }, lime, -8),
      card({ x: 1.6, y: 1.9, w: 17.4, h: 8.9 }, white, 0.5, 0.4),
      ...windowHead({ x: 1.6, y: 1.9, w: 17.4, h: 8.9 }),
      pill({ x: 5.4, y: 2.2, w: 9.6, h: 0.56 }, cream, 0),
      pill({ x: 2.9, y: 11.7, w: 13.6, h: 1.9 }, yellow, 0.26),
      cursor(17.6, 9.6, 1.9),
    ],
    title: {
      x: 2.5,
      y: 3.3,
      w: 15.8,
      h: 7.2,
      valign: 'middle',
      size: 58,
      sample: 'Mutig bauen,\nklar sagen.',
    },
    subtitle: {
      x: 3.6,
      y: 11.8,
      w: 12.4,
      h: 1.7,
      valign: 'middle',
      sample: 'Produkt-Update, Frühjahr',
    },
  },
  {
    name: 'Abschnitt',
    bg: lime,
    shapes: [
      ...grid(),
      card({ x: 1.9, y: 3.3, w: 8.4, h: 8.4 }, peach, 1.1, 0.42, -5),
      {
        t: 'text',
        x: 1.9,
        y: 3.3,
        w: 8.4,
        h: 8.4,
        text: '02',
        font: 'Lexend',
        bold: true,
        size: 150,
        color: ink,
        align: 'center',
        valign: 'middle',
        rotate: -5,
        nowrap: true,
      },
      ...glyph({ x: 8.3, y: 1.9, w: 2.5, h: 2.5 }, '★', yellow, {
        r: 1.25,
        font: 'DejaVu Sans',
        size: 34,
        rotate: 10,
      }),
      pill({ x: 12.3, y: 10.6, w: 12.6, h: 1.8 }, ink, 0),
      arrow(7.6, 13.6, 3.2, -14, white),
      ...toggle({ x: 22.6, y: 1.7, w: 3.6, h: 1.6 }, lilac, 6),
    ],
    title: {
      x: 12.3,
      y: 3.6,
      w: 14,
      h: 6.4,
      valign: 'bottom',
      size: 50,
      sample: 'Was sich ändert',
    },
    subtitle: {
      x: 13,
      y: 10.7,
      w: 11.4,
      h: 1.6,
      valign: 'middle',
      color: white,
      sample: 'Drei Dinge, keine Ausreden',
    },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      ...grid(0.07),
      pill({ x: 1.6, y: 1.55, w: 1.9, h: 1.0 }, lime, 0.16),
      dot(2.95, 2.05, 0.3, white),
      card({ x: 1.6, y: 4.1, w: 20.6, h: 10.1 }, white, 0.5, 0.36),
      ...glyph({ x: 23.6, y: 4.1, w: 2.9, h: 2.9 }, '→', lilac, { font: 'DejaVu Sans', size: 34 }),
      card({ x: 23.6, y: 7.7, w: 2.9, h: 2.9 }, peach, 1.45, 0.22),
      sparkle(25.05, 9.15, 0.95, white),
      card({ x: 23.6, y: 11.3, w: 2.9, h: 2.9 }, sky, 0.5, 0.22),
      { t: 'rect', x: 24.2, y: 12.9, w: 0.45, h: 0.75, fill: ink },
      { t: 'rect', x: 24.85, y: 12.3, w: 0.45, h: 1.35, fill: ink },
      { t: 'rect', x: 25.5, y: 11.85, w: 0.45, h: 1.8, fill: ink },
    ],
    title: { x: 4, y: 1.0, w: 22.4, h: 2.3, valign: 'middle', size: 36 },
    body: {
      x: 2.3,
      y: 4.7,
      w: 19.2,
      h: 8.9,
      sample: [
        'Ein Knopf sieht aus wie ein Knopf',
        'Farbe zeigt, wohin es geht',
        'Jede Karte sagt genau eine Sache',
        'Schatten sind hart, Worte sind kurz',
        'Was nicht hilft, fliegt raus',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: sky,
    shapes: [
      ...grid(),
      card({ x: 1.6, y: 1.5, w: 11.8, h: 12.6 }, white, 0.5, 0.4),
      ...windowHead({ x: 1.6, y: 1.5, w: 11.8, h: 12.6 }),
      ...glyph({ x: 11.6, y: 11.9, w: 3, h: 3 }, '★', yellow, {
        r: 1.5,
        font: 'DejaVu Sans',
        size: 38,
        rotate: -12,
      }),
      card({ x: 15.6, y: 5.3, w: 10.9, h: 8.8 }, cream, 0.5, 0.3),
    ],
    pictures: [{ x: 2.15, y: 3.2, w: 10.7, h: 10.35 }],
    title: { x: 15.6, y: 1.3, w: 11, h: 3.6, valign: 'middle', size: 32 },
    body: { x: 16.2, y: 5.8, w: 9.8, h: 7.8, size: 20 },
  },
  {
    name: 'Zwei Spalten',
    bg: cream,
    shapes: [
      ...grid(0.07),
      card({ x: 1.6, y: 4.5, w: 11.9, h: 9.7 }, lilac, 0.5, 0.36),
      card({ x: 14.7, y: 4.5, w: 11.9, h: 9.7 }, lime, 0.5, 0.36),
      ...glyph({ x: 2.2, y: 3.6, w: 1.9, h: 1.9 }, '1', white, { r: 0.95, size: 26 }),
      ...glyph({ x: 15.3, y: 3.6, w: 1.9, h: 1.9 }, '2', white, { r: 0.95, size: 26 }),
      ...toggle({ x: 22.9, y: 1.4, w: 3.4, h: 1.5 }, peach, -5),
    ],
    title: { x: 1.6, y: 0.9, w: 20.6, h: 2.4, valign: 'middle', size: 36 },
    body: [
      { x: 2.3, y: 5.9, w: 10.2, h: 7.8, size: 20 },
      { x: 15.9, y: 5.9, w: 10.2, h: 7.8, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: yellow,
    shapes: [
      ...grid(),
      card({ x: 1.8, y: 2.6, w: 15.4, h: 8.4 }, white, 1.2, 0.5, -2.5),
      card({ x: 15.4, y: 8.6, w: 10.8, h: 5.4 }, sky, 0.5, 0.3),
      // A small chart going up.
      card({ x: 19.2, y: 1.6, w: 6.6, h: 5.6 }, lilac, 0.5, 0.3, 4),
      { t: 'rect', x: 20.2, y: 5.0, w: 0.95, h: 1.2, fill: white, stroke: line },
      { t: 'rect', x: 21.5, y: 4.2, w: 0.95, h: 2.0, fill: white, stroke: line },
      { t: 'rect', x: 22.8, y: 3.3, w: 0.95, h: 2.9, fill: white, stroke: line },
      { t: 'rect', x: 24.1, y: 2.5, w: 0.95, h: 3.7, fill: lime, stroke: line },
      arrow(2.6, 13.4, 3.4, -35, pink),
    ],
    title: {
      x: 2.2,
      y: 3.0,
      w: 14.6,
      h: 7.6,
      valign: 'middle',
      align: 'center',
      size: 120,
      sample: '4,8×',
    },
    body: {
      x: 16.1,
      y: 9.0,
      w: 9.5,
      h: 4.6,
      valign: 'middle',
      size: 21,
      sample: 'so oft wird geklickt, was aussieht wie ein Knopf.',
    },
  },
  {
    name: 'Zitat',
    bg: peach,
    shapes: [
      ...grid(),
      card({ x: 3.4, y: 2.6, w: 22.2, h: 8.6 }, white, 0.6, 0.45),
      {
        t: 'poly',
        fill: white,
        stroke: line,
        shadow: hard(0.3),
        pts: [
          [6.0, 11.15],
          [8.6, 11.15],
          [5.6, 13.2],
        ],
      },
      { t: 'rect', x: 5.9, y: 10.9, w: 2.75, h: 0.3, fill: white },
      ...glyph({ x: 1.7, y: 1.3, w: 3.4, h: 3.4 }, '“', lime, { r: 1.7, size: 80, rotate: -8 }),
      dot(10.7, 13.1, 0.95, lilac, 0.2),
      dot(10.45, 12.95, 0.1, ink),
      dot(10.95, 12.95, 0.1, ink),
      {
        t: 'ellipse',
        x: 10.3,
        y: 12.85,
        w: 0.8,
        h: 0.7,
        kind: 'arc',
        start: 200,
        end: 340,
        fill: null,
        stroke: { ...line, width: 0.08, cap: 'round' },
      },
      sparkle(24.9, 2.2, 1.3, yellow),
    ],
    body: {
      x: 4.6,
      y: 3.2,
      w: 19.8,
      h: 7.4,
      valign: 'middle',
      font: 'Lexend',
      bold: true,
      size: 32,
      lineHeight: 118,
      sample: 'Wenn alles gleich leise aussieht, findet niemand den Knopf.',
    },
    subtitle: {
      x: 12.2,
      y: 12.2,
      w: 13.4,
      h: 1.8,
      valign: 'middle',
      sample: 'Mara Lindt, Produktdesign',
    },
  },
  {
    name: 'Bild',
    bg: lilac,
    shapes: [
      ...grid(0.13),
      card({ x: 1.6, y: 1.3, w: 24.6, h: 11.6 }, white, 0.5, 0.4),
      ...windowHead({ x: 1.6, y: 1.3, w: 24.6, h: 11.6 }, 1.0),
      pill({ x: 0.9, y: 11.9, w: 14.6, h: 2.5 }, yellow, 0.3, -2),
      cursor(24.4, 11.6, 2.2),
    ],
    pictures: [{ x: 2.1, y: 2.75, w: 23.6, h: 9.65 }],
    title: {
      x: 2.0,
      y: 12.05,
      w: 12.6,
      h: 2.2,
      valign: 'middle',
      size: 28,
      sample: 'So sieht es live aus',
    },
  },
  {
    name: 'Schluss',
    bg: pink,
    shapes: [
      ...grid(),
      card({ x: 1.5, y: 1.4, w: 4.2, h: 4.2 }, sky, 0.7, 0.3, -9),
      sparkle(3.6, 3.5, 1.4, white),
      ...toggle({ x: 22.2, y: 1.9, w: 4, h: 1.8 }, lime, 7),
      dot(24.2, 12.2, 1.7, yellow, 0.3),
      ...glyph({ x: 2.0, y: 11.2, w: 3.4, h: 2.4 }, '→', lilac, {
        font: 'DejaVu Sans',
        size: 34,
        rotate: 6,
      }),
      pill({ x: 4.6, y: 4.2, w: 18.8, h: 6.2 }, white, 0.55),
      pill({ x: 7.4, y: 11.6, w: 13.2, h: 1.9 }, ink, 0),
      cursor(20.6, 8.6, 2.6, yellow),
    ],
    title: {
      x: 6,
      y: 4.5,
      w: 16,
      h: 5.6,
      valign: 'middle',
      align: 'center',
      size: 66,
      sample: 'Los geht’s!',
    },
    subtitle: {
      x: 8,
      y: 11.7,
      w: 12,
      h: 1.7,
      valign: 'middle',
      align: 'center',
      color: white,
      sample: 'Fragen? Jetzt ist der Moment.',
    },
  },
];

const template: Template = {
  slug: 'neo-brutal',
  name: 'Neo-Brutalismus',
  group: 'Designtrend',
  tags: ['Neo-Brutalismus', 'Produkt', 'Start-up', 'flach', 'Sticker', 'bunt', 'frech', 'Web'],
  description:
    'Wie eine freche Produktseite: flache Bonbonfarben, schwarze Rahmen, harte Schatten, Karten und Pillen.',
  palette: {
    bg: cream,
    text: ink,
    bg2: white,
    text2: '#45424e',
    accents: [lilac, lime, peach, sky, yellow, pink],
  },
  fonts: { head: 'Lexend', body: 'DM Sans' },
  text: {
    title: { font: 'Lexend', size: 44, color: ink, bold: true, lineHeight: 104 },
    subtitle: { font: 'DM Sans', size: 22, color: ink, bold: true },
    body: { font: 'DM Sans', size: 22, color: ink, lineHeight: 122, paraSpace: 0.32 },
  },
  layouts,
};

export default template;
