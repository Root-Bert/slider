import type { Color, Layout, Shape, Template } from '../model';

/*
 * Farbblock: colour blocking. The page is cut into a few large fields of bold colour that are
 * not expected side by side – cobalt beside tangerine, emerald beside pink, plum beside lemon.
 * Every layout has its own pair and its own cut; nothing else decorates the page.
 */

const cobalt = '#2340d9';
const tangerine = '#ff7a1f';
const emerald = '#0b8f63';
const pink = '#ff6fae';
const lemon = '#ffd53d';
const plum = '#4d1a66';
const paper = '#f6f1e7';
const ink = '#15141c';
const white = '#ffffff';

/** A field of colour; fields overlap the page edge a little so no hairline of ground shows. */
const field = (x: number, y: number, w: number, h: number, fill: Color): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  fill,
});

const five = [
  'Zwei Farben, die sich nicht kennen',
  'Eine klare Kante statt vieler Linien',
  'Große Flächen geben dem Text Ruhe',
  'Jede Folie bekommt ihr eigenes Paar',
  'Am Ende bleibt die Aussage hängen',
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: cobalt,
    shapes: [field(18.2, -0.2, 10, 16.2, tangerine), field(18.2, 10.4, 10, 5.6, pink)],
    title: {
      x: 1.8,
      y: 2.2,
      w: 15.4,
      h: 8.6,
      valign: 'bottom',
      size: 66,
      sample: 'Mut zur\nFläche',
    },
    subtitle: {
      x: 1.8,
      y: 11.2,
      w: 15.4,
      h: 2.4,
      color: lemon,
      sample: 'Gestaltung mit zwei Farben und einer Kante',
    },
  },
  {
    name: 'Abschnitt',
    bg: emerald,
    shapes: [field(-0.2, -0.2, 28.4, 6.2, pink), field(21.4, -0.2, 6.8, 6.2, lemon)],
    title: {
      x: 1.8,
      y: 6.9,
      w: 22,
      h: 6.6,
      valign: 'top',
      size: 72,
      sample: 'Die Kante',
    },
    subtitle: {
      x: 1.8,
      y: 2.6,
      w: 18.5,
      h: 2.8,
      valign: 'bottom',
      color: plum,
      bold: true,
      sample: 'Teil zwei',
    },
  },
  {
    name: 'Inhalt',
    bg: paper,
    shapes: [field(-0.2, -0.2, 9.4, 16.2, lemon), field(-0.2, 12.2, 9.4, 3.8, plum)],
    title: {
      x: 1.5,
      y: 1.5,
      w: 6.9,
      h: 10,
      valign: 'top',
      size: 32,
      color: ink,
      lineHeight: 96,
    },
    body: { x: 10.9, y: 2.3, w: 15.6, h: 11.8, size: 24, sample: five },
  },
  {
    name: 'Text und Bild',
    bg: plum,
    shapes: [field(11.6, 13.0, 3, 3, lemon)],
    title: { x: 1.8, y: 1.4, w: 11, h: 4, valign: 'bottom', size: 34, color: lemon },
    body: { x: 1.8, y: 5.9, w: 11, h: 8.2, color: white, size: 20 },
    pictures: [{ x: 14.6, y: 0, w: 13.4, h: 15.75 }],
  },
  {
    name: 'Zwei Spalten',
    bg: paper,
    shapes: [field(-0.2, 4.3, 14.2, 11.7, tangerine), field(14, 4.3, 14.2, 11.7, pink)],
    title: { x: 1.8, y: 0.9, w: 24.4, h: 2.6, valign: 'middle', size: 36, color: ink },
    body: [
      { x: 1.8, y: 5.4, w: 10.8, h: 8.8, size: 20 },
      { x: 15.6, y: 5.4, w: 10.6, h: 8.8, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: lemon,
    shapes: [field(17.6, -0.2, 10.6, 16.2, cobalt), field(17.6, -0.2, 10.6, 3.6, tangerine)],
    title: {
      x: 1.2,
      y: 3.2,
      w: 15.6,
      h: 9.4,
      valign: 'middle',
      size: 170,
      color: cobalt,
      sample: '64 %',
    },
    body: {
      x: 19,
      y: 4.6,
      w: 7.6,
      h: 9.4,
      valign: 'middle',
      color: white,
      size: 22,
      sample: 'erinnern sich an die Farbe.\nAn den Text erst danach.',
    },
  },
  {
    name: 'Zitat',
    bg: pink,
    shapes: [
      field(-0.2, -0.2, 21.4, 12.4, emerald),
      ...[22.3, 24.9].map((x): Shape => ({
        t: 'poly',
        fill: plum,
        pts: [
          [x + 1.1, 3.6],
          [x + 3.1, 3.6],
          [x + 2, 7.4],
          [x, 7.4],
        ],
      })),
    ],
    body: {
      x: 1.8,
      y: 1.4,
      w: 17.6,
      h: 9.6,
      valign: 'middle',
      font: 'Kanit',
      bold: true,
      size: 38,
      color: white,
      lineHeight: 108,
      sample: 'Farbe ist kein Schmuck. Farbe ist die Entscheidung, was zuerst gesehen wird.',
    },
    subtitle: {
      x: 1.8,
      y: 12.7,
      w: 19,
      h: 2,
      valign: 'middle',
      color: plum,
      bold: true,
      sample: 'Ida Brandt, Gestalterin',
    },
  },
  {
    name: 'Bild',
    bg: tangerine,
    shapes: [field(19.6, 9.2, 8.6, 6.8, cobalt)],
    pictures: [{ x: 0, y: 0, w: 19.6, h: 15.75 }],
    title: {
      x: 20.6,
      y: 9.8,
      w: 6.4,
      h: 4.9,
      valign: 'bottom',
      size: 28,
      sample: 'Zwei Flächen, ein Bild',
    },
  },
  {
    name: 'Schluss',
    bg: lemon,
    shapes: [field(8.6, 5, 19.6, 11, cobalt), field(-0.2, 10.6, 8.8, 5.4, pink)],
    title: {
      x: 10.2,
      y: 5.6,
      w: 16.4,
      h: 6,
      valign: 'middle',
      size: 96,
      sample: 'Danke',
    },
    subtitle: {
      x: 10.2,
      y: 11.8,
      w: 16.4,
      h: 2.4,
      color: lemon,
      sample: 'Fragen, Widerspruch, Farbwünsche?',
    },
  },
];

const template: Template = {
  slug: 'farbblock',
  name: 'Farbblock',
  group: 'Farbenfroh',
  tags: ['Colour Blocking', 'Farbflächen', 'kräftig', 'modern', 'plakativ', 'Marke', 'Pitch'],
  description:
    'Große Flächen in unerwarteten Farbpaaren, auf jeder Folie ein anderes – sonst nichts.',
  palette: {
    bg: paper,
    text: ink,
    bg2: '#e9e1d0',
    text2: '#4b4956',
    accents: [cobalt, tangerine, emerald, pink, lemon, plum],
  },
  fonts: { head: 'Kanit', body: 'Red Hat Display' },
  text: {
    title: { font: 'Kanit', size: 60, color: white, bold: true, lineHeight: 88 },
    subtitle: { font: 'Red Hat Display', size: 22, color: white, lineHeight: 115 },
    body: {
      font: 'Red Hat Display',
      size: 22,
      color: ink,
      lineHeight: 122,
      paraSpace: 0.4,
    },
  },
  layouts,
};

export default template;
