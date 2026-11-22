import type { Color, Layout, Shape, Template } from '../model';

/*
 * Typo-Plakat: the letter is the picture. One glyph per sheet, set so large that the page cuts
 * it, against type set as small as it will go; two colours per sheet, and they swap from sheet
 * to sheet.
 */

const paper = '#f1eee6';
const black = '#111111';
const blue = '#2238ff';
const orange = '#ff4a1c';
const yellow = '#ffd91a';

/** One glyph, huge, its middle at a place; the page cuts what does not fit. */
const glyph = (text: string, cx: number, cy: number, size: number, color: Color): Shape => ({
  t: 'text',
  x: cx - 20,
  y: cy - 20,
  w: 40,
  h: 40,
  text,
  font: 'Anton',
  size,
  color,
  align: 'center',
  valign: 'middle',
  nowrap: true,
  lineHeight: 100,
});

const bar = (x: number, y: number, w: number, color: Color): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h: 0.12,
  fill: color,
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paper,
    shapes: [glyph('A', 20.6, 8.6, 640, black), bar(1.5, 1.5, 3.2, black)],
    subtitle: { x: 1.5, y: 1.9, w: 11, h: 1.6, sample: 'Ein Vortrag über 26 Buchstaben' },
    title: {
      x: 1.5,
      y: 7.2,
      w: 13.4,
      h: 7.1,
      size: 76,
      sample: 'Schrift\nist Bild',
    },
  },
  {
    name: 'Abschnitt',
    bg: blue,
    shapes: [glyph('2', 6.4, 8.9, 760, paper), bar(15.2, 1.5, 3.2, paper)],
    subtitle: { x: 15.2, y: 1.9, w: 11.3, h: 1.6, color: paper, sample: 'Groß gegen klein' },
    title: {
      x: 15.2,
      y: 7.2,
      w: 11.3,
      h: 7.1,
      size: 76,
      color: paper,
      sample: 'Zweiter\nTeil',
    },
  },
  {
    name: 'Inhalt',
    bg: paper,
    shapes: [glyph('S', 27.6, 8.2, 720, black), bar(1.5, 1.5, 3.2, black)],
    title: { x: 1.5, y: 1.9, w: 19, h: 2.2, valign: 'top', size: 40 },
    body: { x: 1.5, y: 4.9, w: 18.6, h: 9.4 },
  },
  {
    name: 'Text und Bild',
    bg: black,
    shapes: [glyph('R', 4.6, 10.4, 820, '#1d1d1d'), bar(1.5, 1.5, 3.2, paper)],
    pictures: [{ x: 15.2, y: 0, w: 12.8, h: 15.75 }],
    title: { x: 1.5, y: 1.9, w: 12.6, h: 3.6, valign: 'top', size: 40, color: paper },
    body: { x: 1.5, y: 6, w: 12.4, h: 8.3, size: 20, color: paper },
  },
  {
    name: 'Zwei Spalten',
    bg: yellow,
    shapes: [glyph('&', 14, 9.6, 350, black), bar(1.5, 1.5, 3.2, black)],
    title: { x: 1.5, y: 1.9, w: 25, h: 2.2, valign: 'top', size: 40 },
    body: [
      { x: 1.5, y: 5.2, w: 8.6, h: 9.1, size: 19 },
      { x: 17.9, y: 5.2, w: 8.6, h: 9.1, size: 19 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: orange,
    shapes: [bar(1.5, 1.5, 3.2, black)],
    body: {
      x: 1.5,
      y: 1.9,
      w: 15,
      h: 2.6,
      size: 18,
      bold: true,
      lineHeight: 125,
      sample: 'der Leute lesen zuerst das Größte auf der Seite. Also machen wir es groß.',
    },
    title: {
      x: 1.2,
      y: 4.6,
      w: 25.6,
      h: 11.15,
      size: 265,
      spacing: -6,
      sample: '87 %',
    },
  },
  {
    name: 'Zitat',
    bg: black,
    shapes: [glyph('“', 4.6, 12.2, 900, blue)],
    body: {
      x: 10,
      y: 2.2,
      w: 16.5,
      h: 9.4,
      valign: 'bottom',
      bold: true,
      size: 33,
      lineHeight: 112,
      spacing: -0.6,
      color: paper,
      sample: 'Wer alles betont, hat am Ende nichts gesagt. Ein Wort groß, der Rest hat zu dienen.',
    },
    subtitle: { x: 10, y: 12.3, w: 16, h: 1.4, color: paper, sample: 'Ada Voss, Setzerin' },
  },
  {
    name: 'Bild',
    bg: paper,
    shapes: [glyph('O', 3.5, 4.4, 430, black)],
    pictures: [{ x: 9.4, y: 0, w: 18.6, h: 15.75 }],
    title: {
      x: 1.5,
      y: 11.2,
      w: 7.5,
      h: 3.1,
      size: 26,
      lineHeight: 100,
      sample: 'Das Auge liest mit',
    },
  },
  {
    name: 'Schluss',
    bg: blue,
    shapes: [glyph('?', 21.4, 8.6, 720, paper), bar(1.5, 1.5, 3.2, paper)],
    subtitle: { x: 1.5, y: 1.9, w: 11, h: 1.6, color: paper, sample: 'Fragen sind willkommen' },
    title: {
      x: 1.5,
      y: 7.2,
      w: 14,
      h: 7.1,
      size: 110,
      color: paper,
      sample: 'Danke',
    },
  },
];

const template: Template = {
  slug: 'typo-plakat',
  name: 'Typo-Plakat',
  group: 'Plakat',
  tags: [
    'Typografie',
    'Buchstaben',
    'groß',
    'Kontrast',
    'plakativ',
    'modern',
    'Agentur',
    'Keynote',
  ],
  description:
    'Die Schrift ist das Bild: riesige angeschnittene Zeichen gegen winzigen Text, je Folie zwei Farben im Wechsel.',
  palette: {
    bg: paper,
    text: black,
    bg2: '#e0dcd0',
    text2: '#57554f',
    accents: [blue, orange, yellow, '#0e1b9c', '#b9b4a6', '#ff9d80'],
  },
  fonts: { head: 'Anton', body: 'Inter' },
  text: {
    title: { font: 'Anton', size: 64, color: black, upper: true, spacing: -0.5, lineHeight: 84 },
    subtitle: {
      font: 'Inter',
      size: 14,
      color: black,
      bold: true,
      upper: true,
      spacing: 2.2,
      lineHeight: 130,
    },
    body: { font: 'Inter', size: 21, color: black, lineHeight: 128, paraSpace: 0.4 },
  },
  layouts,
};

export default template;
