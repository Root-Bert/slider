import { jpeg, paint } from '../art';
import type { Box, Color, Layout, Picture, Shape, Stroke, Template } from '../model';
import { gridLines, page } from '../shapes';

/*
 * Brutalismus: a web page before anyone styled it. Raw white, a grid you can see, boxes with a
 * one-pixel border and nothing else, numerals far too large, a grotesque and a mono – and the
 * blue of a link that has not been clicked yet.
 */

const black = '#000000';
const white = '#ffffff';
const blue = '#0000ee';
const pale = '#e4e4e4';

/** The grid's unit: the page is 16 by 9 of these. */
const G = 1.75;
const g = (n: number) => n * G;

const border: Stroke = { color: black, width: 0.04, join: 'miter' };
const grid: Shape[] = gridLines(page, G, { color: '#d6d6d6', width: 0.02 });

/** A box as a browser draws a table cell: white, a thin black border. */
const cell = (x: number, y: number, w: number, h: number, fill: Color | null = white): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  fill,
  stroke: border,
});

/** A box with its diagonals: where a picture would be if anyone had made one. */
const crossed = (x: number, y: number, w: number, h: number): Shape[] => [
  cell(x, y, w, h),
  { t: 'line', x1: x, y1: y, x2: x + w, y2: y + h, stroke: border },
  { t: 'line', x1: x + w, y1: y, x2: x, y2: y + h, stroke: border },
];

/** A single glyph set into a box. */
const glyph = (
  box: Box,
  text: string,
  size: number,
  color: Color = black,
  font = 'Space Grotesk',
  bold = true,
): Shape => ({
  t: 'text',
  ...box,
  text,
  font,
  size,
  color,
  bold,
  align: 'center',
  valign: 'middle',
  pad: 0,
  nowrap: true,
});

/** A sphere on a plane, reduced to black and white dots – a stand-in for a photo. */
function dithered(seed: number): Picture {
  const surface = paint({ w: 28, h: 17.5 }, 56);
  const { ctx, w, h } = surface;
  const dot = 4;
  const [cols, rows] = [Math.ceil(w / dot), Math.ceil(h / dot)];
  const bayer = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  const [cx, cy, r] = [cols * (seed % 2 ? 0.38 : 0.62), rows * 0.46, rows * 0.3];
  const horizon = rows * 0.62;
  ctx.fillStyle = white;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = black;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const [dx, dy] = [(x - cx) / r, (y - cy) / r];
      const d2 = dx * dx + dy * dy;
      let tone: number;
      if (d2 < 1) {
        // Lit from the upper left.
        const dz = Math.sqrt(1 - d2);
        tone = Math.max(0.04, -dx * 0.5 - dy * 0.55 + dz * 0.67) ** 0.9;
      } else if (y > horizon) {
        const fall = Math.hypot((x - cx - r * 0.7) / (r * 1.6), (y - cy - r * 0.95) / (r * 0.35));
        tone = 0.55 + ((y - horizon) / (rows - horizon)) * 0.3 - Math.max(0, 1 - fall) * 0.6;
      } else {
        tone = 0.92 - (y / horizon) * 0.3;
      }
      if (tone < (bayer[y % 4]![x % 4]! + 0.5) / 16) ctx.fillRect(x * dot, y * dot, dot, dot);
    }
  }
  return jpeg(surface, 90);
}

const layouts: Layout[] = [
  {
    // One big box for the title; under it a row of three: the link, a crossed box, a black one.
    name: 'Titel',
    bg: white,
    shapes: [
      ...grid,
      cell(g(1), g(1), g(14), g(5)),
      cell(g(1), g(6), g(8), g(2)),
      ...crossed(g(9), g(6), g(4), g(2)),
      cell(g(13), g(6), g(2), g(2), black),
      glyph({ x: g(13), y: g(6), w: g(2), h: g(2) }, '*', 96, white),
      glyph({ x: g(12), y: g(1), w: g(3), h: g(2) }, '01', 64, pale, 'JetBrains Mono'),
    ],
    title: {
      x: g(1) + 0.6,
      y: g(1) + 0.3,
      w: g(11),
      h: g(5) - 0.7,
      valign: 'bottom',
      size: 92,
      lineHeight: 92,
      sample: 'Roh.\nDirekt.',
    },
    subtitle: {
      x: g(1) + 0.6,
      y: g(6),
      w: g(8) - 1,
      h: g(2),
      valign: 'middle',
      sample: 'eine_seite_ohne_schminke.html',
    },
  },
  {
    // A hash far too large on the left, the heading in its box on the right.
    name: 'Abschnitt',
    bg: white,
    shapes: [
      ...grid,
      cell(g(1), g(1), g(5), g(7)),
      glyph({ x: g(1), y: g(1), w: g(5), h: g(7) }, '#', 300),
      cell(g(6), g(3), g(9), g(3)),
      cell(g(6), g(6), g(9), g(1)),
    ],
    title: {
      x: g(6) + 0.6,
      y: g(3),
      w: g(9) - 1,
      h: g(3),
      valign: 'middle',
      size: 54,
      sample: 'Teil 2: Inhalt',
    },
    subtitle: {
      x: g(6) + 0.6,
      y: g(6),
      w: g(9) - 1,
      h: g(1),
      valign: 'middle',
      sample: 'weiter_zu_teil_2',
    },
  },
  {
    // A head row and a body row, as a table; an arrow in the head's last cell.
    name: 'Inhalt',
    bg: white,
    shapes: [
      ...grid,
      cell(g(1), g(1), g(12.5), g(1.5)),
      cell(g(13.5), g(1), g(1.5), g(1.5), black),
      glyph({ x: g(13.5), y: g(1), w: g(1.5), h: g(1.5) }, '↓', 44, white, 'DejaVu Sans', false),
      cell(g(1), g(2.5), g(14), g(5.5)),
    ],
    title: {
      x: g(1) + 0.6,
      y: g(1),
      w: g(12.5) - 1,
      h: g(1.5),
      valign: 'middle',
      size: 32,
    },
    body: {
      x: g(1) + 0.7,
      y: g(2.5) + 0.6,
      w: g(14) - 1.4,
      h: g(5.5) - 1,
      sample: [
        'Standardschrift, Standardabstand',
        'Rahmen: 1 px, schwarz, durchgezogen',
        'Kein Schatten, kein Verlauf, keine Rundung',
        'Links sind blau und unterstrichen',
        'Was geladen ist, ist auch zu sehen',
      ],
    },
  },
  {
    // Text cells on the left, the picture in its own cell on the right, with padding.
    name: 'Text und Bild',
    bg: white,
    shapes: [
      ...grid,
      cell(g(1), g(1), g(7), g(2)),
      cell(g(1), g(3), g(7), g(5)),
      cell(g(8), g(1), g(7), g(7)),
    ],
    title: {
      x: g(1) + 0.6,
      y: g(1),
      w: g(7) - 1,
      h: g(2),
      valign: 'middle',
      size: 30,
    },
    body: {
      x: g(1) + 0.7,
      y: g(3) + 0.6,
      w: g(7) - 1.2,
      h: g(5) - 1,
      size: 18,
      sample: ['img ohne alt gibt es nicht', '4 Graustufen genügen', 'Lädt in 0,2 s'],
    },
    pictures: [{ x: g(8) + 0.4, y: g(1) + 0.4, w: g(7) - 0.8, h: g(7) - 0.8 }],
  },
  {
    // Two cells with their numbers, far too large, in the corners.
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      ...grid,
      cell(g(1), g(1), g(14), g(1.5)),
      cell(g(1), g(2.5), g(7), g(5.5)),
      cell(g(8), g(2.5), g(7), g(5.5)),
      glyph({ x: g(5), y: g(4.2), w: g(3), h: g(3.8) }, '1', 210, pale),
      glyph({ x: g(12), y: g(4.2), w: g(3), h: g(3.8) }, '2', 210, pale),
    ],
    title: {
      x: g(1) + 0.6,
      y: g(1),
      w: g(14) - 1,
      h: g(1.5),
      valign: 'middle',
      size: 32,
      sample: 'Mit Stil / Ohne Stil',
    },
    body: [
      {
        x: g(1) + 0.7,
        y: g(2.5) + 0.6,
        w: g(7) - 1.2,
        h: g(5.5) - 1,
        size: 18,
        sample: ['Hübsch', '2,4 MB', 'Lädt gleich'],
      },
      {
        x: g(8) + 0.7,
        y: g(2.5) + 0.6,
        w: g(7) - 1.2,
        h: g(5.5) - 1,
        size: 18,
        sample: ['Ehrlich', '14 kB', 'Ist schon da'],
      },
    ],
  },
  {
    // The number fills its cell; beside it what it means, and a bar that shows it.
    name: 'Kennzahl',
    bg: white,
    shapes: [
      ...grid,
      cell(g(1), g(1), g(10), g(7)),
      cell(g(11), g(1), g(4), g(4.5)),
      cell(g(11), g(5.5), g(4), g(2.5)),
      cell(g(11) + 0.7, g(6.4), g(4) - 1.4, 1.1),
      { t: 'rect', x: g(11) + 0.7, y: g(6.4), w: (g(4) - 1.4) * 0.72, h: 1.1, fill: blue },
    ],
    title: {
      x: g(1) + 0.3,
      y: g(1),
      w: g(10) - 0.6,
      h: g(7),
      valign: 'middle',
      align: 'center',
      size: 184,
      spacing: -6,
      sample: '14 kB',
    },
    body: {
      x: g(11) + 0.6,
      y: g(1) + 0.5,
      w: g(4) - 1,
      h: g(4.5) - 0.9,
      size: 18,
      lineHeight: 128,
      sample: 'wiegt diese Seite. Mit allem.',
    },
  },
  {
    // A block quote as the browser sets it: a thick bar on the left, the source as a link.
    name: 'Zitat',
    bg: white,
    shapes: [
      ...grid,
      cell(g(1), g(1), g(14), g(5.5)),
      { t: 'rect', x: g(1), y: g(1), w: 0.7, h: g(5.5), fill: black },
      cell(g(1), g(6.5), g(10), g(1.5)),
      cell(g(11), g(6.5), g(4), g(1.5), black),
      glyph({ x: g(11), y: g(6.5), w: g(4), h: g(1.5) }, '> _', 40, white, 'JetBrains Mono'),
    ],
    body: {
      x: g(1) + 1.6,
      y: g(1) + 0.4,
      w: g(14) - 2.6,
      h: g(5.5) - 0.8,
      valign: 'middle',
      font: 'Space Grotesk',
      bold: true,
      size: 44,
      lineHeight: 108,
      color: black,
      sample: 'Gestaltung ist, was übrig bleibt, wenn man aufhört zu dekorieren.',
    },
    subtitle: {
      x: g(1) + 0.6,
      y: g(6.5),
      w: g(10) - 1,
      h: g(1.5),
      valign: 'middle',
      sample: 'quelle: ein_kommentar_im_quelltext',
    },
  },
  {
    // The picture in a cell, edge to edge; its name in the row beneath, a blue cell to follow.
    name: 'Bild',
    bg: white,
    shapes: [
      ...grid,
      cell(g(1), g(1), g(14), g(5.5)),
      cell(g(1), g(6.5), g(12), g(1.5)),
      cell(g(12.5), g(6.5), g(2.5), g(1.5), blue),
      glyph({ x: g(12.5), y: g(6.5), w: g(2.5), h: g(1.5) }, '↗', 48, white, 'DejaVu Sans', false),
    ],
    pictures: [{ x: g(1) + 0.04, y: g(1) + 0.04, w: g(14) - 0.08, h: g(5.5) - 0.08 }],
    title: {
      x: g(1) + 0.6,
      y: g(6.5),
      w: g(11.5) - 1,
      h: g(1.5),
      valign: 'middle',
      size: 30,
      sample: 'kugel_1bit.png',
    },
  },
  {
    // The last word in a big cell; beside it a crossed box and the way back, as a link.
    name: 'Schluss',
    bg: white,
    shapes: [
      ...grid,
      cell(g(1), g(1), g(10), g(7)),
      ...crossed(g(11), g(1), g(4), g(4)),
      cell(g(11), g(5), g(4), g(3)),
      { t: 'rect', x: g(1) + 0.7, y: g(1) + 0.7, w: 1.5, h: 2.3, fill: black },
    ],
    title: {
      x: g(1) + 0.6,
      y: g(3),
      w: g(10) - 1,
      h: g(5) - 0.5,
      valign: 'bottom',
      size: 128,
      lineHeight: 92,
      sample: 'Ende.',
    },
    subtitle: {
      x: g(11) + 0.5,
      y: g(5),
      w: g(4) - 0.8,
      h: g(3),
      valign: 'middle',
      sample: 'zurück_zum_anfang',
    },
  },
];

const template: Template = {
  slug: 'brutalismus',
  name: 'Brutalismus',
  group: 'Schwarzweiß',
  tags: [
    'Schwarzweiß',
    'Brutalismus',
    'Web',
    'Raster',
    'roh',
    'Monospace',
    'Technik',
    'Entwicklung',
  ],
  description:
    'Web-Brutalismus: rohe weiße Seite, sichtbares Raster, schlichte Kästen mit dünnem schwarzem Rahmen, übergroße Ziffern und das Blau eines Links.',
  palette: {
    bg: white,
    text: black,
    bg2: '#f2f2f2',
    text2: '#555555',
    accents: [blue, '#222222', '#888888', '#bbbbbb', pale, '#551a8b'],
  },
  fonts: { head: 'Space Grotesk', body: 'JetBrains Mono' },
  text: {
    title: { font: 'Space Grotesk', size: 48, color: black, bold: true, lineHeight: 100 },
    subtitle: { font: 'JetBrains Mono', size: 17, color: blue, underline: true },
    body: { font: 'JetBrains Mono', size: 19, color: black, lineHeight: 130, paraSpace: 0.36 },
  },
  layouts,
  samplePictures: [dithered(1), dithered(2)],
};

export default template;
