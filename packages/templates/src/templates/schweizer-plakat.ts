import type { Layout, Shape, Template } from '../model';
import { disc } from '../shapes';

/*
 * Schweizer Plakat: the International Typographic Style – a twelve-column grid, a grotesque set
 * flush left in few sizes, white, black and one signal red, and a single gesture per page: a
 * large circle or a diagonal. Everything else is alignment.
 */

const white = '#ffffff';
const black = '#121212';
const red = '#e2001a';
const paper = '#efece6';
const grey = '#6b6a66';

/** The grid: twelve columns between 1.6 cm margins, 0.4 cm apart. */
const M = 1.6;
const STEP = 2.1;
const COL = 1.7;
const col = (index: number) => M + STEP * index;
/** The width of `count` columns with the gaps between them. */
const span = (count: number) => STEP * count - (STEP - COL);

/** The page number of a poster series, top right: a numeral as ornament, on the grid. */
const folio = (text: string, color: string): Shape[] => [
  {
    t: 'text',
    x: col(10),
    y: 0.72,
    w: span(2),
    h: 0.7,
    text,
    font: 'Inter',
    bold: true,
    size: 11,
    color,
    align: 'right',
    valign: 'middle',
    spacing: 0.6,
  },
];

/** The bar every page hangs from. */
const bar = (color: string, x = M, w = 28 - 2 * M): Shape => ({
  t: 'rect',
  x,
  y: 1.6,
  w,
  h: 0.16,
  fill: color,
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: white,
    shapes: [
      disc(21.4, 5.4, 7.0, red),
      bar(black, M, span(5)),
      { t: 'rect', x: M, y: 14.0, w: span(12), h: 0.05, fill: black },
      ...folio('01', white),
    ],
    title: {
      x: M,
      y: 6.3,
      w: span(8),
      h: 5.3,
      size: 48,
      sample: 'Ordnung\nschafft Freiheit',
    },
    subtitle: {
      x: M,
      y: 12.1,
      w: span(6),
      h: 1.5,
      sample: 'Jahresbericht in zwölf Spalten',
    },
  },
  {
    name: 'Abschnitt',
    bg: red,
    shapes: [
      {
        t: 'poly',
        fill: black,
        pts: [
          [10.2, 15.75],
          [28, 1.9],
          [28, 15.75],
        ],
      },
      bar(white, M, span(5)),
      ...folio('02', white),
    ],
    title: {
      x: M,
      y: 2.4,
      w: span(8),
      h: 5.2,
      valign: 'top',
      size: 56,
      color: white,
      sample: 'Zweiter Teil:\nDas Raster',
    },
    subtitle: {
      x: M,
      y: 12.5,
      w: span(5),
      h: 1.7,
      valign: 'bottom',
      color: white,
      sample: 'Wie aus Regeln Spielraum wird',
    },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: [bar(black), disc(0.4, 15.6, 5.1, red), ...folio('03', black)],
    title: { x: M, y: 2.2, w: span(11), h: 1.9, valign: 'top', size: 34 },
    body: { x: col(3), y: 4.9, w: span(9), h: 9.3 },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [
      bar(black, M, span(6)),
      { t: 'rect', x: col(6) + 0.75, y: 0, w: 0.7, h: 15.75, fill: red },
    ],
    title: { x: M, y: 2.2, w: span(6), h: 3.2, valign: 'top', size: 32 },
    body: { x: M, y: 5.9, w: span(6), h: 8.3, size: 20 },
    pictures: [{ x: col(6) + 1.45, y: 0, w: 28 - col(6) - 1.45, h: 15.75 }],
  },
  {
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      { t: 'rect', x: 0, y: 0, w: col(4) - 0.4, h: 15.75, fill: black },
      disc(col(4) - 0.4, 15.75, 4.2, red),
      // The disc ends where the black field ends.
      { t: 'rect', x: col(4) - 0.4, y: 11, w: 5, h: 5, fill: white },
      bar(white, M, span(3)),
      bar(red, col(4) + 0.4, span(4) - 0.4),
      bar(black, col(8) + 0.4, span(4) - 0.4),
    ],
    title: {
      x: M,
      y: 2.2,
      w: span(3) + 0.3,
      h: 6,
      valign: 'top',
      size: 30,
      color: white,
      sample: 'Zwei Wege,\nein Raster',
    },
    body: [
      { x: col(4) + 0.4, y: 2.3, w: span(4) - 0.4, h: 11.9, size: 19 },
      { x: col(8) + 0.4, y: 2.3, w: span(4) - 0.4, h: 11.9, size: 19 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: black,
    shapes: [
      { t: 'rect', x: col(8), y: 0, w: 28 - col(8), h: 15.75, fill: red },
      bar(white, M, span(7)),
      bar(white, col(8) + 0.8, span(4) - 0.8),
      ...folio('06', white),
    ],
    title: {
      x: M,
      y: 4.6,
      w: span(8) - 0.6,
      h: 9.6,
      valign: 'bottom',
      size: 188,
      spacing: -9,
      lineHeight: 90,
      color: white,
      sample: '73 %',
    },
    body: {
      x: col(8) + 0.8,
      y: 8.6,
      w: span(4) - 0.8,
      h: 5.6,
      valign: 'bottom',
      size: 21,
      bold: true,
      color: white,
      sample: 'aller Entscheidungen fallen schneller, wenn die Folie nur eine Sache sagt.',
    },
  },
  {
    name: 'Zitat',
    bg: white,
    shapes: [
      { t: 'rect', x: 0, y: 0, w: col(3) - 0.4, h: 15.75, fill: red },
      {
        t: 'text',
        x: 0.9,
        y: 0.2,
        w: 7,
        h: 7,
        text: '«',
        font: 'Inter',
        bold: true,
        size: 230,
        color: white,
        valign: 'top',
      },
      bar(black, col(3), span(9)),
      { t: 'rect', x: col(3), y: 11.9, w: span(3), h: 0.05, fill: black },
    ],
    body: {
      x: col(3),
      y: 2.4,
      w: span(9),
      h: 8.8,
      valign: 'top',
      size: 35,
      bold: true,
      lineHeight: 112,
      spacing: -0.6,
      sample: 'Das Raster ist kein Käfig. Es ist das Gerüst, an dem der Gedanke klettert.',
    },
    subtitle: {
      x: col(3),
      y: 12.3,
      w: span(8),
      h: 1.8,
      sample: 'Lina Aebersold, Gestalterin',
    },
  },
  {
    name: 'Bild',
    bg: white,
    shapes: [
      { t: 'rect', x: M, y: 11.9, w: span(12), h: 0.16, fill: black },
      { t: 'rect', x: col(10), y: 12.5, w: span(2), h: 1.7, fill: red },
    ],
    pictures: [{ x: 0, y: 0, w: 28, h: 11.3 }],
    title: {
      x: M,
      y: 12.4,
      w: span(9),
      h: 1.9,
      valign: 'top',
      size: 30,
      sample: 'Form folgt dem Inhalt',
    },
  },
  {
    name: 'Schluss',
    bg: black,
    shapes: [disc(4.4, 12.9, 8.4, red), bar(white, col(6), span(6)), ...folio('09', white)],
    title: {
      x: col(6),
      y: 2.3,
      w: span(6),
      h: 5.4,
      valign: 'top',
      size: 80,
      spacing: -3,
      color: white,
      sample: 'Danke.',
    },
    subtitle: {
      x: col(6),
      y: 12.2,
      w: span(6),
      h: 2,
      valign: 'bottom',
      color: white,
      sample: 'Fragen, Einwände, Gegenentwürfe: jetzt.',
    },
  },
];

const template: Template = {
  slug: 'schweizer-plakat',
  name: 'Schweizer Plakat',
  group: 'Plakat',
  tags: [
    'Schweizer Stil',
    'Raster',
    'Typografie',
    'sachlich',
    'Rot',
    'minimal',
    'Bericht',
    'Architektur',
  ],
  description:
    'Sachliche Plakatgestaltung im strengen Raster: linksbündige Grotesk, Weiß, Schwarz und ein Signalrot.',
  palette: {
    bg: white,
    text: black,
    bg2: paper,
    text2: grey,
    accents: [red, '#a30013', '#c9c5bc', '#2f2f2d', '#f0b400', '#1d4f9c'],
  },
  fonts: { head: 'Inter', body: 'Inter' },
  text: {
    title: { font: 'Inter', size: 44, color: black, bold: true, spacing: -1.4, lineHeight: 100 },
    subtitle: { font: 'Inter', size: 17, color: black, lineHeight: 125 },
    body: { font: 'Inter', size: 21, color: black, lineHeight: 128, paraSpace: 0.42 },
  },
  layouts,
};

export default template;
