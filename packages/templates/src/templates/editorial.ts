import type { Color, Layout, Shape, Template } from '../model';
import { rule } from '../shapes';

/*
 * Editorial: a quality magazine – high-contrast serif headlines, small caps kickers, hairlines on
 * a strict twelve-column grid, much white, one quiet green, and folio numerals as ornament.
 */

const paper = '#faf8f4';
const ink = '#161616';
const sand = '#efebe3';
const stone = '#6b6660';
const green = '#1e5a4c';
const camel = '#c9b79c';

const serif = 'Playfair Display';
const sans = 'Source Sans 3';

/** The grid: twelve columns between the margins. */
const LEFT = 1.8;
const RIGHT = 26.2;
const WIDTH = RIGHT - LEFT;
const GUTTER = 0.6;
const COLUMN = (WIDTH - GUTTER * 11) / 12;
/** Where column `index` (0 … 11) starts, and how wide `span` columns are. */
const col = (index: number) => LEFT + index * (COLUMN + GUTTER);
const span = (count: number) => count * COLUMN + (count - 1) * GUTTER;

/** A hairline with the short bar that opens a page. */
const opener = (y: number, color: Color, bar: Color, x = LEFT, w = WIDTH): Shape[] => [
  rule(x, y, w, color, 0.025),
  { t: 'rect', x, y: y - 0.02, w: span(1), h: 0.2, fill: bar },
];

/** A numeral or glyph as ornament: huge, one colour, not wrapped. */
const ornament = (
  text: string,
  x: number,
  y: number,
  size: number,
  color: Color,
  italic = false,
): Shape => ({
  t: 'text',
  x,
  y,
  w: 4,
  h: size * 0.0353 * 1.4,
  text,
  font: serif,
  size,
  color,
  italic,
  nowrap: true,
  lineHeight: 100,
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paper,
    shapes: [
      ornament('1', 18.9, -3.4, 520, '#ece6da'),
      ...opener(1.6, ink, green),
      rule(LEFT, 11.55, span(6), ink, 0.025),
      rule(LEFT, 14.25, WIDTH, ink, 0.025),
    ],
    title: {
      x: LEFT,
      y: 3,
      w: 18,
      h: 7.9,
      sample: 'Die Rückkehr\nder Langsamkeit',
    },
    subtitle: { x: LEFT, y: 12, w: 17, h: 1.5, sample: 'Ein Bericht in neun Kapiteln' },
  },
  {
    name: 'Abschnitt',
    bg: green,
    shapes: [
      ornament('2', 0.6, -4.6, 640, '#2b6a5b'),
      rule(col(6), 1.6, span(6), '#9fbfb3', 0.025),
      rule(col(6), 10.75, span(6), '#9fbfb3', 0.025),
      { t: 'rect', x: col(6), y: 10.73, w: span(1), h: 0.2, fill: camel },
    ],
    title: {
      x: col(6),
      y: 3.4,
      w: span(6),
      h: 6.8,
      size: 50,
      color: paper,
      sample: 'Was bleibt,\nwenn es still wird',
    },
    subtitle: {
      x: col(6),
      y: 11.3,
      w: span(6),
      h: 2.2,
      font: serif,
      italic: true,
      bold: false,
      upper: false,
      spacing: 0,
      size: 22,
      color: '#d8e5df',
      sample: 'Zweites Kapitel',
    },
  },
  {
    name: 'Inhalt',
    bg: paper,
    shapes: [
      ...opener(1.6, ink, green),
      rule(col(4) - GUTTER / 2, 2.3, 11.7, '#bdb7ac', 0.025, true),
      rule(LEFT, 14.25, WIDTH, ink, 0.025),
      { t: 'rect', x: RIGHT - 0.32, y: 14.5, w: 0.32, h: 0.32, fill: green },
    ],
    title: {
      x: LEFT,
      y: 2.3,
      w: span(4) - 0.3,
      h: 9,
      valign: 'top',
      size: 30,
      lineHeight: 112,
      sample: 'Was eine gute Geschichte trägt',
    },
    body: {
      x: col(4) + 0.3,
      y: 2.35,
      w: span(8) - 0.3,
      h: 11.5,
      size: 24,
      sample: [
        'Ein Anfang, der eine Frage stellt',
        'Menschen, denen man zuhören will',
        'Zahlen, die etwas bedeuten',
        'Ein Ort, den man vor sich sieht',
        'Ein Gedanke, der hängen bleibt',
        'Ein Schluss, der nichts erklärt',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: paper,
    shapes: [
      { t: 'rect', x: col(5), y: 6.05, w: span(1), h: 0.16, fill: green },
      rule(col(5), 14.25, span(7), ink, 0.025),
    ],
    pictures: [{ x: 0, y: 0, w: col(5) - 1.4, h: 15.75 }],
    title: {
      x: col(5),
      y: 1.5,
      w: span(7),
      h: 4.1,
      size: 30,
      lineHeight: 112,
      sample: 'Ein Morgen in der Druckerei',
    },
    body: {
      x: col(5),
      y: 6.8,
      w: span(7),
      h: 7.1,
      size: 19,
      sample: [
        'Um fünf Uhr laufen die Maschinen an',
        'Das Papier kommt aus dem Norden',
        'Jede Seite wird von Hand geprüft',
        'Um neun ist die Auflage verladen',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: paper,
    shapes: [
      rule(LEFT, 4.35, WIDTH, ink, 0.1),
      rule(LEFT, 4.55, WIDTH, ink, 0.025),
      rule(14, 5.2, 9.05, '#bdb7ac', 0.025, true),
      ornament('1', LEFT, 4.85, 34, green, true),
      ornament('2', col(6) + 0.3, 4.85, 34, green, true),
      rule(LEFT, 14.25, WIDTH, ink, 0.025),
    ],
    title: {
      x: LEFT,
      y: 1.2,
      w: WIDTH,
      h: 2.8,
      size: 34,
      sample: 'Zwei Blicke auf dieselbe Stadt',
    },
    body: [
      {
        x: LEFT,
        y: 7,
        w: span(6) - 0.5,
        h: 6.9,
        size: 19,
        sample: [
          'Am Tag: Lärm, Tempo, Glas',
          'Die Wege sind kurz und voll',
          'Niemand bleibt lange stehen',
        ],
      },
      {
        x: col(6) + 0.3,
        y: 7,
        w: span(6) - 0.3,
        h: 6.9,
        size: 19,
        sample: [
          'In der Nacht: Licht, Raum, Ruhe',
          'Die Plätze gehören den Wenigen',
          'Man hört die eigenen Schritte',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: sand,
    shapes: [
      { t: 'rect', x: col(10), y: 0, w: span(2), h: 10.9, fill: green },
      rule(LEFT, 10.9, WIDTH, ink, 0.025),
    ],
    title: {
      x: LEFT,
      y: 1.6,
      w: span(9),
      h: 8.9,
      size: 170,
      lineHeight: 90,
      sample: '68 %',
    },
    body: {
      x: LEFT,
      y: 11.5,
      w: span(8),
      h: 2.9,
      size: 22,
      sample: 'der Leserinnen und Leser lesen einen langen Text bis zum letzten Satz.',
    },
  },
  {
    name: 'Zitat',
    bg: paper,
    shapes: [
      ornament('“', col(2) - 0.25, -1.9, 330, green),
      rule(col(2), 11.9, span(2), ink, 0.1),
      rule(LEFT, 14.25, WIDTH, ink, 0.025),
    ],
    body: {
      x: col(2),
      y: 5.3,
      w: span(9),
      h: 6.1,
      valign: 'top',
      font: serif,
      italic: true,
      size: 34,
      lineHeight: 124,
      paraSpace: 0,
      sample: 'Schreiben heißt weglassen, bis nur noch das übrig ist, was man nicht vergisst.',
    },
    subtitle: {
      x: col(2),
      y: 12.3,
      w: span(9),
      h: 1.4,
      color: stone,
      sample: 'Martha Lindqvist, Chefredakteurin',
    },
  },
  {
    name: 'Bild',
    bg: paper,
    shapes: [
      { t: 'rect', x: LEFT, y: 11.4, w: span(1), h: 0.2, fill: green },
      rule(col(9), 14.25, span(3), ink, 0.025),
    ],
    pictures: [{ x: 0, y: 0, w: 28, h: 11.4 }],
    title: {
      x: LEFT,
      y: 12.1,
      w: span(8),
      h: 2.5,
      valign: 'middle',
      italic: true,
      size: 26,
      sample: 'Hinter dem Hafen beginnt das Land, das niemand fotografiert',
    },
  },
  {
    name: 'Schluss',
    bg: ink,
    shapes: [
      ornament('&', 14.6, -3.2, 560, '#242424', true),
      rule(LEFT, 1.6, WIDTH, '#5a5650', 0.025),
      { t: 'rect', x: LEFT, y: 1.58, w: span(1), h: 0.2, fill: camel },
      rule(LEFT, 11.15, span(6), '#8a857c', 0.025),
      rule(LEFT, 14.25, WIDTH, '#5a5650', 0.025),
    ],
    title: {
      x: LEFT,
      y: 3,
      w: 18,
      h: 7.5,
      size: 76,
      color: paper,
      sample: 'Danke fürs\nLesen',
    },
    subtitle: {
      x: LEFT,
      y: 11.6,
      w: 17,
      h: 1.5,
      color: camel,
      sample: 'Fragen und Widerspruch willkommen',
    },
  },
];

const template: Template = {
  slug: 'editorial',
  name: 'Editorial',
  group: 'Kunststil',
  tags: ['Magazin', 'Editorial', 'Serife', 'ruhig', 'elegant', 'Bericht', 'Kultur', 'Weißraum'],
  description:
    'Wie ein gutes Magazin: große Serifen, feine Linien, viel Weiß und ein ruhiges Grün.',
  palette: {
    bg: paper,
    text: ink,
    bg2: sand,
    text2: stone,
    accents: [green, camel, '#a8573a', '#2f3a44', '#8fa69c', '#d9d3c7'],
  },
  fonts: { head: serif, body: sans },
  text: {
    title: { font: serif, size: 60, color: ink, lineHeight: 106 },
    subtitle: { font: sans, size: 15, color: green, bold: true, upper: true, spacing: 2.6 },
    body: { font: sans, size: 21, color: ink, lineHeight: 128, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
