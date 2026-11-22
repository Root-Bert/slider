import type { Box, Color, Layout, Shape, Template } from '../model';

/*
 * De Stijl: the page is a grid of thick black lines, a few of its fields filled with red, yellow
 * or blue, most left white. Nothing slants, nothing curves; text and pictures live in fields.
 */

const white = '#fbfaf4';
const ink = '#121212';
const red = '#d6211f';
const yellow = '#f7cd1b';
const blue = '#1b49a1';
const grey = '#d8d6ce';

/** How thick the grid's lines are. */
const T = 0.36;

/** A field of the grid, corner to corner. */
const field = (x1: number, y1: number, x2: number, y2: number, fill: Color): Shape => ({
  t: 'rect',
  x: x1,
  y: y1,
  w: x2 - x1,
  h: y2 - y1,
  fill,
});

/** A vertical line of the grid at `x`. */
const v = (x: number, y1 = 0, y2 = 15.75): Shape => ({
  t: 'rect',
  x: x - T / 2,
  y: Math.max(0, y1 - T / 2),
  w: T,
  h: Math.min(15.75, y2 + T / 2) - Math.max(0, y1 - T / 2),
  fill: ink,
});

/** A horizontal line of the grid at `y`. */
const h = (y: number, x1 = 0, x2 = 28): Shape => ({
  t: 'rect',
  x: Math.max(0, x1 - T / 2),
  y: y - T / 2,
  w: Math.min(28, x2 + T / 2) - Math.max(0, x1 - T / 2),
  h: T,
  fill: ink,
});

/** The picture place filling a field between its lines (page edges have none). */
const inField = (x1: number, y1: number, x2: number, y2: number): Box => {
  const [left, top] = [x1 <= 0 ? 0 : x1 + T / 2, y1 <= 0 ? 0 : y1 + T / 2];
  const [right, bottom] = [x2 >= 28 ? 28 : x2 - T / 2, y2 >= 15.75 ? 15.75 : y2 - T / 2];
  return { x: left, y: top, w: right - left, h: bottom - top };
};

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: white,
    shapes: [
      field(0, 4.2, 7.2, 13, red),
      field(22.4, 0, 28, 3.4, yellow),
      field(17, 10.8, 28, 15.75, blue),
      field(0, 13, 3.2, 15.75, ink),
      v(7.2),
      h(10.8, 7.2, 28),
      v(22.4, 0, 10.8),
      h(4.2, 0, 7.2),
      h(3.4, 22.4, 28),
      v(17, 10.8, 15.75),
      h(13, 0, 7.2),
      v(3.2, 13, 15.75),
    ],
    title: {
      x: 8.5,
      y: 2,
      w: 13,
      h: 7.9,
      valign: 'bottom',
      size: 58,
      sample: 'Ordnung\nder Fläche',
    },
    subtitle: {
      x: 8.5,
      y: 11.6,
      w: 7.6,
      h: 3,
      sample: 'Linie, Feld und drei Farben',
    },
  },
  {
    name: 'Abschnitt',
    bg: white,
    shapes: [
      field(0, 0, 18.4, 10.2, blue),
      field(23.6, 10.2, 28, 15.75, red),
      field(18.4, 0, 28, 2.8, yellow),
      field(18.4, 2.8, 21.4, 10.2, grey),
      v(18.4),
      h(10.2),
      v(23.6, 10.2, 15.75),
      h(2.8, 18.4, 28),
      v(21.4, 2.8, 10.2),
    ],
    title: {
      x: 1.8,
      y: 2.4,
      w: 15.2,
      h: 6.6,
      valign: 'bottom',
      size: 50,
      color: white,
      sample: 'Teil zwei:\nDas Raster',
    },
    subtitle: {
      x: 1.8,
      y: 11.2,
      w: 15.2,
      h: 2.6,
      sample: 'Waagerecht und senkrecht',
    },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: [
      field(0, 0, 2.5, 6.2, red),
      field(0, 11.6, 2.5, 15.75, blue),
      field(24.4, 0, 28, 3.6, yellow),
      v(2.5),
      h(3.6, 2.5, 28),
      v(24.4, 0, 3.6),
      h(6.2, 0, 2.5),
      h(11.6, 0, 2.5),
    ],
    title: { x: 3.8, y: 0.5, w: 19.6, h: 2.8, valign: 'middle', size: 32 },
    body: {
      x: 3.8,
      y: 4.6,
      w: 22.4,
      h: 9.9,
      sample: [
        'Jede Fläche steht im rechten Winkel',
        'Schwarze Linien tragen das Blatt',
        'Rot, Gelb und Blau setzen Gewicht',
        'Weiß ist kein Rest, sondern Raum',
        'Das Gleichgewicht entsteht ohne Mitte',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [
      field(15.2, 3.6, 28, 12.1, grey),
      field(15.2, 12.1, 21.6, 15.75, yellow),
      field(23.2, 0, 28, 3.6, red),
      h(3.6),
      v(15.2, 3.6, 15.75),
      h(12.1, 15.2, 28),
      v(21.6, 12.1, 15.75),
      v(23.2, 0, 3.6),
    ],
    title: { x: 1.8, y: 0.5, w: 20.4, h: 2.8, valign: 'middle', size: 32 },
    body: { x: 1.8, y: 4.6, w: 12.2, h: 9.9, size: 20 },
    pictures: [inField(15.2, 3.6, 28, 12.1)],
  },
  {
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      field(25, 0, 28, 3.6, blue),
      field(0, 14.1, 5.6, 15.75, yellow),
      field(14, 14.1, 20.2, 15.75, red),
      h(3.6),
      v(14, 3.6, 15.75),
      h(14.1),
      v(25, 0, 3.6),
      v(5.6, 14.1, 15.75),
      v(20.2, 14.1, 15.75),
    ],
    title: { x: 1.8, y: 0.5, w: 22, h: 2.8, valign: 'middle', size: 32 },
    body: [
      { x: 1.8, y: 4.5, w: 11, h: 9, size: 19 },
      { x: 15.4, y: 4.5, w: 11, h: 9, size: 19 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: white,
    shapes: [
      field(0, 0, 14.6, 10.4, yellow),
      field(0, 10.4, 5.2, 15.75, red),
      field(23.4, 0, 28, 4, blue),
      v(14.6),
      h(10.4, 0, 14.6),
      v(5.2, 10.4, 15.75),
      h(4, 14.6, 28),
      v(23.4, 0, 4),
    ],
    title: {
      x: 1.2,
      y: 2.2,
      w: 12.4,
      h: 7.6,
      align: 'center',
      valign: 'middle',
      size: 120,
      sample: '3',
    },
    body: {
      x: 16.2,
      y: 5.3,
      w: 10.2,
      h: 8.8,
      size: 24,
      sample: 'Farben genügen für das ganze Bild.\nDazu Schwarz, Weiß und Grau.',
    },
  },
  {
    name: 'Zitat',
    bg: white,
    shapes: [
      field(0, 0, 4.2, 7.2, red),
      field(0, 12.3, 4.2, 15.75, ink),
      field(4.2, 0, 11.6, 2.4, blue),
      field(21.4, 12.3, 28, 15.75, yellow),
      v(4.2),
      h(2.4, 4.2, 28),
      h(12.3),
      v(21.4, 12.3, 15.75),
      h(7.2, 0, 4.2),
      v(11.6, 0, 2.4),
    ],
    body: {
      x: 5.7,
      y: 3.2,
      w: 20.4,
      h: 8.4,
      valign: 'middle',
      font: 'Josefin Sans',
      bold: true,
      size: 36,
      lineHeight: 118,
      sample: 'Wer das Gleichgewicht sucht, braucht keine Symmetrie.',
    },
    subtitle: {
      x: 5.7,
      y: 12.8,
      w: 14.6,
      h: 2.4,
      valign: 'middle',
      sample: 'Jorinde Baas, Malerin',
    },
  },
  {
    name: 'Bild',
    bg: white,
    shapes: [
      field(0, 0, 20.6, 11.5, grey),
      field(20.6, 0, 28, 4.6, red),
      field(0, 11.5, 3.6, 15.75, blue),
      field(24.6, 11.5, 28, 15.75, yellow),
      v(20.6),
      h(11.5),
      h(4.6, 20.6, 28),
      v(3.6, 11.5, 15.75),
      v(24.6, 11.5, 15.75),
    ],
    pictures: [inField(0, 0, 20.6, 11.5)],
    title: {
      x: 4.7,
      y: 12,
      w: 15,
      h: 3.2,
      valign: 'middle',
      size: 28,
      sample: 'Komposition mit Ausblick',
    },
  },
  {
    name: 'Schluss',
    bg: white,
    shapes: [
      field(0, 5.2, 8.4, 11.6, yellow),
      field(21.4, 3.8, 28, 15.75, red),
      field(0, 11.6, 4.4, 15.75, blue),
      field(21.4, 0, 24.6, 3.8, ink),
      v(8.4),
      v(21.4),
      h(3.8, 8.4, 28),
      h(11.6, 0, 21.4),
      h(5.2, 0, 8.4),
      v(4.4, 11.6, 15.75),
      v(24.6, 0, 3.8),
    ],
    title: {
      x: 9.2,
      y: 4.6,
      w: 11.4,
      h: 3.6,
      align: 'center',
      valign: 'bottom',
      size: 58,
      sample: 'Danke',
    },
    subtitle: {
      x: 9.2,
      y: 8.5,
      w: 11.4,
      h: 2.4,
      align: 'center',
      sample: 'Fragen sind willkommen',
    },
  },
];

const template: Template = {
  slug: 'de-stijl',
  name: 'De Stijl',
  group: 'Kunststil',
  tags: ['De Stijl', 'Raster', 'Grundfarben', 'Moderne', 'streng', 'Architektur', 'Kunst'],
  description:
    'Ein Raster aus kräftigen schwarzen Linien mit Feldern in Rot, Gelb und Blau auf viel Weiß.',
  palette: {
    bg: white,
    text: ink,
    bg2: grey,
    text2: '#45443f',
    accents: [red, yellow, blue, '#8c8a82', '#e8713a', '#2c6fc7'],
  },
  fonts: { head: 'Josefin Sans', body: 'Work Sans' },
  text: {
    title: { font: 'Josefin Sans', size: 44, color: ink, bold: true, lineHeight: 100 },
    subtitle: { font: 'Work Sans', size: 20, color: '#45443f', lineHeight: 120 },
    body: { font: 'Work Sans', size: 21, color: ink, lineHeight: 124, paraSpace: 0.4 },
  },
  layouts,
};

export default template;
