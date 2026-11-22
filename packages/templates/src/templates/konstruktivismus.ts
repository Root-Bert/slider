import type { Color, Layout, Shape, Template } from '../model';
import { disc, ring } from '../shapes';

/*
 * Konstruktivismus: the poster as a machine – red, black and cream, everything on the move along
 * steep diagonals: wedges, beams, bars, a circle as the hub. Heavy condensed capitals.
 */

const cream = '#ece2cc';
const ink = '#181513';
const red = '#d2281b';
const deep = '#9b1b13';
const sand = '#d8ccb0';

type Point = readonly [number, number];

const poly = (fill: Color, ...pts: Point[]): Shape => ({ t: 'poly', pts, fill });

/** A beam from one point to another, `width` thick, its ends cut square to it. */
const beam = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  fill: Color,
): Shape => {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const [nx, ny] = [(-(y2 - y1) / length) * (width / 2), ((x2 - x1) / length) * (width / 2)];
  return poly(fill, [x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]);
};

/** A bar with slanted ends (leaning `lean` over its height), lying level. */
const slab = (x: number, y: number, w: number, h: number, lean: number, fill: Color): Shape =>
  poly(fill, [x + lean, y], [x + w + lean, y], [x + w, y + h], [x, y + h]);

/** A single glyph as ornament, on a slant. */
const glyph = (
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  size: number,
  color: Color,
  rotate: number,
): Shape => ({
  t: 'text',
  x,
  y,
  w,
  h,
  text,
  font: 'Oswald',
  bold: true,
  size,
  color,
  align: 'center',
  valign: 'middle',
  rotate,
  nowrap: true,
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: cream,
    shapes: [
      poly(red, [8.6, 15.75], [28, 1.9], [28, 15.75]),
      beam(10.2, 13.2, 29, -0.2, 0.5, ink),
      beam(17.6, 6.6, 29, -1.55, 0.18, ink),
      disc(22.6, 9.6, 2.9, ink),
      ring(22.6, 9.6, 3.5, { color: cream, width: 0.12 }),
      beam(22.6, 9.6, 12.4, 16.9, 0.36, ink),
      disc(22.6, 9.6, 0.75, cream),
      slab(1.8, 1.5, 4.4, 0.42, 0.3, red),
      slab(6.7, 1.5, 0.7, 0.42, 0.3, ink),
    ],
    title: {
      x: 1.8,
      y: 2.4,
      w: 14.4,
      h: 6.4,
      valign: 'top',
      size: 66,
      sample: 'Vorwärts\nzum Plan',
    },
    subtitle: {
      x: 12.8,
      y: 13.5,
      w: 13.4,
      h: 1.5,
      align: 'right',
      valign: 'middle',
      color: cream,
      sample: 'Bericht der Arbeitsgruppe',
    },
  },
  {
    name: 'Abschnitt',
    bg: ink,
    shapes: [
      disc(22.2, 7.4, 6.6, red),
      beam(12.4, 17, 29.5, 3.2, 0.7, cream),
      beam(15.2, 17, 29.5, 5.5, 0.22, cream),
      poly(ink, [22.2, 7.4], [28.6, -0.6], [31, 3]),
      disc(22.2, 7.4, 1.1, ink),
      poly(cream, [0, 0], [6.6, 0], [0, 2.9]),
      slab(1.8, 10.6, 5.2, 0.4, 0.3, red),
    ],
    title: {
      x: 1.8,
      y: 3.8,
      w: 13.4,
      h: 6.4,
      valign: 'bottom',
      size: 58,
      color: cream,
      sample: 'Zweiter\nAbschnitt',
    },
    subtitle: {
      x: 1.8,
      y: 11.5,
      w: 10.6,
      h: 1.6,
      color: sand,
      sample: 'Vom Entwurf zur Tat',
    },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      slab(-2, 1.1, 23.6, 2.7, 1.5, ink),
      slab(22.2, 1.1, 1.9, 2.7, 1.5, red),
      slab(24.7, 1.1, 0.5, 2.7, 1.5, ink),
      poly(red, [28, 8.8], [28, 15.75], [21.6, 15.75]),
      beam(20.4, 16.2, 28.6, 7.3, 0.3, ink),
      disc(25.7, 13.6, 0.8, cream),
    ],
    title: { x: 1.8, y: 1.3, w: 19, h: 2.3, valign: 'middle', size: 34, color: cream },
    body: {
      x: 1.8,
      y: 4.9,
      w: 19.6,
      h: 9.5,
      sample: [
        'Die Fläche wird gebaut, nicht geschmückt',
        'Rot ruft, Schwarz trägt, Papier atmet',
        'Die Schräge bringt Bewegung ins Blatt',
        'Schrift ist Baustoff wie Balken und Keil',
        'Ein Gedanke pro Blatt, groß gesetzt',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: cream,
    shapes: [
      poly(red, [17.4, 0], [28, 0], [28, 15.75], [13.9, 15.75]),
      beam(16.75, -0.2, 13.2, 15.95, 0.26, ink),
      disc(26.5, 13.5, 1.9, ink),
      { t: 'rect', x: 16.2, y: 2.75, w: 10.3, h: 10.9, fill: ink },
      slab(1.8, 4.75, 5.6, 0.42, 0.3, red),
      slab(7.9, 4.75, 0.7, 0.42, 0.3, ink),
    ],
    title: { x: 1.8, y: 1, w: 12.6, h: 3.5, valign: 'bottom', size: 34 },
    body: { x: 1.8, y: 5.8, w: 10.9, h: 8.6, size: 20 },
    pictures: [{ x: 16.6, y: 2.3, w: 10.3, h: 10.9 }],
  },
  {
    name: 'Zwei Spalten',
    bg: cream,
    shapes: [
      poly(ink, [0, 0], [28, 0], [28, 2.7], [0, 4.2]),
      beam(-0.5, 4.85, 28.5, 3.3, 0.34, red),
      beam(14.75, 5.4, 13.25, 14.8, 0.12, ink),
      poly(red, [28, 15.75], [28, 13.1], [24.2, 15.75]),
      poly(ink, [0, 15.75], [0, 14.2], [2.2, 15.75]),
    ],
    title: { x: 1.8, y: 0.55, w: 22.4, h: 2.2, valign: 'middle', size: 34, color: cream },
    body: [
      { x: 1.8, y: 5.9, w: 10.8, h: 8.4, size: 20 },
      { x: 15.6, y: 5.9, w: 10.6, h: 8.4, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: red,
    shapes: [
      poly(cream, [8.6, 7.9], [28, -3.2], [28, 0.7]),
      poly(deep, [8.6, 7.9], [28, 0.7], [28, 1.7]),
      poly(ink, [8.6, 7.9], [28, 14.1], [28, 17.6]),
      poly(deep, [8.6, 7.9], [0, 13], [0, 15.75], [1.5, 15.75]),
      poly(cream, [8.6, 7.9], [-0.5, 0.6], [1.6, -0.6]),
      ring(8.6, 7.9, 6.25, { color: cream, width: 0.14 }),
      disc(8.6, 7.9, 5.6, ink),
    ],
    title: {
      x: 3.4,
      y: 4.6,
      w: 10.4,
      h: 6.6,
      align: 'center',
      valign: 'middle',
      size: 112,
      color: cream,
      sample: '5',
    },
    body: {
      x: 16.6,
      y: 5.3,
      w: 9.8,
      h: 5,
      valign: 'middle',
      size: 25,
      bold: true,
      color: cream,
      sample: 'Jahre Arbeit in einem Plan – und jeder Schritt steht im Kalender.',
    },
  },
  {
    name: 'Zitat',
    bg: cream,
    shapes: [
      poly(ink, [0, 0], [8.4, 0], [3.4, 15.75], [0, 15.75]),
      beam(9.25, -0.2, 4.15, 15.95, 0.24, red),
      glyph('“', 0.3, 2.6, 6.6, 6.6, 400, red, -14),
      slab(9.6, 11.15, 6.4, 0.42, 0.3, red),
      poly(red, [28, 15.75], [28, 11.4], [23.2, 15.75]),
      beam(21.6, 16.2, 28.6, 9.85, 0.26, ink),
    ],
    body: {
      x: 9.6,
      y: 1.8,
      w: 16.6,
      h: 8.8,
      valign: 'bottom',
      font: 'Oswald',
      bold: true,
      upper: true,
      size: 36,
      lineHeight: 116,
      sample: 'Ein Plakat muss treffen wie ein Signal: kurz, laut und deutlich.',
    },
    subtitle: {
      x: 9.6,
      y: 12,
      w: 12.6,
      h: 1.6,
      color: ink,
      sample: 'Lew Arden, Plakatmaler',
    },
  },
  {
    name: 'Bild',
    bg: ink,
    shapes: [
      slab(-2, 11.3, 17.4, 4.6, 3.2, red),
      slab(16.3, 11.3, 0.6, 4.6, 3.2, cream),
      slab(17.6, 11.3, 0.22, 4.6, 3.2, cream),
      disc(24.6, 13.5, 1.15, red),
      ring(24.6, 13.5, 1.7, { color: cream, width: 0.1 }),
    ],
    pictures: [{ x: 0, y: 0, w: 28, h: 11.3 }],
    title: {
      x: 1.8,
      y: 11.9,
      w: 12.2,
      h: 3.2,
      valign: 'middle',
      size: 30,
      color: cream,
      sample: 'Die Halle im Bau',
    },
  },
  {
    name: 'Schluss',
    bg: red,
    shapes: [
      poly(ink, [28, 0], [28, 15.75], [6.4, 15.75]),
      beam(8.4, 16.4, 29, 1.65, 0.5, cream),
      beam(11.2, 16.4, 29, 3.65, 0.16, cream),
      disc(22.4, 11.2, 2.7, cream),
      glyph('!', 20.4, 8.9, 4, 4.6, 96, red, 14),
      poly(ink, [0, 0], [5.4, 0], [0, 2.4]),
    ],
    title: {
      x: 1.8,
      y: 2.6,
      w: 13.4,
      h: 4.6,
      valign: 'bottom',
      size: 84,
      color: cream,
      sample: 'Danke',
    },
    subtitle: {
      x: 1.8,
      y: 7.6,
      w: 11.6,
      h: 1.6,
      color: cream,
      sample: 'Und nun: an die Arbeit',
    },
  },
];

const template: Template = {
  slug: 'konstruktivismus',
  name: 'Konstruktivismus',
  group: 'Kunststil',
  tags: ['Konstruktivismus', 'Plakat', 'Rot', 'Diagonale', 'dynamisch', 'Avantgarde', 'kraftvoll'],
  description:
    'Rot, Schwarz und Papier: steile Diagonalen, Keile, Balken und Kreise mit schwerer, schmaler Schrift.',
  palette: {
    bg: cream,
    text: ink,
    bg2: sand,
    text2: '#4b443b',
    accents: [red, deep, '#3b3632', '#c59a2a', '#8b806b', '#f7f1e3'],
  },
  fonts: { head: 'Oswald', body: 'Roboto Condensed' },
  text: {
    title: { font: 'Oswald', size: 44, color: ink, bold: true, upper: true, lineHeight: 104 },
    subtitle: {
      font: 'Roboto Condensed',
      size: 22,
      color: '#4b443b',
      bold: true,
      upper: true,
      spacing: 1.5,
    },
    body: { font: 'Roboto Condensed', size: 23, color: ink, lineHeight: 120, paraSpace: 0.4 },
  },
  layouts,
};

export default template;
