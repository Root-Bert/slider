import type { Box, Color, FillLike, Layout, Shape, Slot, Template } from '../model';
import { columns, disc, wave } from '../shapes';

/*
 * Gesundheit: medicine and care – clean white, mint and a soft blue, everything rounded. A calm
 * pulse line runs through the pages, a small plus on a mint tile marks every title, and soft
 * discs and waves keep it friendly.
 */

const deep = '#12404f';
const white = '#ffffff';
const mint = '#34bf9e';
const mintSoft = '#dff5ee';
const mintMid = '#a8e3d2';
const blue = '#5aa7e0';
const blueSoft = '#e4f1fb';
const blueMid = '#b7d9f3';
const teal = '#0f5565';
const calm = '#4d6f7b';
const coral = '#ff8f7a';

const L = 1.6;
const R = 26.4;

/** A plus with round ends, round a centre. */
const plus = (
  cx: number,
  cy: number,
  size: number,
  fill: FillLike,
  thick = size * 0.3,
): Shape[] => [
  { t: 'rect', x: cx - size / 2, y: cy - thick / 2, w: size, h: thick, r: thick / 2, fill },
  { t: 'rect', x: cx - thick / 2, y: cy - size / 2, w: thick, h: size, r: thick / 2, fill },
];

/** The mark of a title: a white plus on a rounded mint tile. */
const tile = (
  x: number,
  y: number,
  size = 1.3,
  fill: Color = mint,
  sign: Color = white,
): Shape[] => [
  { t: 'rect', x, y, w: size, h: size, r: size * 0.28, fill },
  ...plus(x + size / 2, y + size / 2, size * 0.5, sign, size * 0.14),
];

/** The pulse: a level line with one calm beat in it, `at` (0 … 1) along the box. */
function pulse(box: Box, color: Color, at = 0.5, width = 0.09): Shape {
  const c = Math.round(at * 2000);
  const d = [
    'M0 150',
    `L${c - 300} 150`,
    `C${c - 270} 150 ${c - 262} 118 ${c - 238} 118`,
    `C${c - 214} 118 ${c - 206} 150 ${c - 176} 150`,
    `L${c - 120} 150`,
    `L${c - 82} 186`,
    `L${c - 22} 14`,
    `L${c + 38} 246`,
    `L${c + 82} 150`,
    `L${c + 150} 150`,
    `C${c + 192} 150 ${c + 204} 96 ${c + 244} 96`,
    `C${c + 284} 96 ${c + 296} 150 ${c + 338} 150`,
    'L2000 150',
  ].join(' ');
  return {
    t: 'path',
    ...box,
    d,
    vb: [2000, 260],
    fill: null,
    stroke: { color, width, cap: 'round', join: 'round' },
  };
}

/** The head of a content page: the tile beside the title, a soft wave at the foot. */
const frame = (): Shape[] => [
  disc(27.2, 0.6, 2.3, blueSoft),
  ...tile(L, 1.75),
  wave({ x: 0, y: 14.25, w: 28, h: 1.5 }, 1.5, 0.5, mintSoft, { phase: 0.6 }),
];

const title: Slot = { x: 3.5, y: 1.1, w: 21, h: 2.6, valign: 'middle' };

const cards = columns({ x: L, y: 4.7, w: R - L, h: 9 }, 2, 0.9);

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: white,
    shapes: [
      disc(23.2, 6.6, 7.6, mintSoft),
      disc(26.2, 13, 4.2, blueSoft),
      disc(18.2, 2.3, 0.95, blueMid),
      ...plus(22.9, 6.3, 4.6, white, 1.5),
      ...plus(16.4, 9.9, 0.7, coral),
      ...plus(26, 1.9, 0.55, mint),
      pulse({ x: 0, y: 11.2, w: 28, h: 2.6 }, mint, 0.52),
      ...tile(L, 1.6),
    ],
    title: {
      x: L,
      y: 3.4,
      w: 13.6,
      h: 5,
      size: 44,
      valign: 'bottom',
      lineHeight: 104,
      sample: 'Gesund durch\nden Winter',
    },
    subtitle: {
      x: L,
      y: 8.8,
      w: 13,
      h: 2.2,
      sample: 'Vorsorge in der Hausarztpraxis\nDr. med. Lena Brandt',
    },
  },
  {
    name: 'Abschnitt',
    bg: mintSoft,
    shapes: [
      ...plus(22.6, 6.4, 6.4, '#c8eee2', 2.1),
      ...plus(18.3, 2.2, 0.7, mint),
      ...plus(25.6, 11.2, 0.55, blue),
      wave({ x: 0, y: 11.6, w: 28, h: 4.15 }, 1.3, 0.45, mintMid, { phase: 2.4 }),
      wave({ x: 0, y: 12.8, w: 28, h: 2.95 }, 1.6, 0.5, blueMid, { phase: 0.4 }),
      {
        t: 'rect',
        x: L,
        y: 3.3,
        w: 16.4,
        h: 8.2,
        r: 1.5,
        fill: white,
        shadow: { dx: 0, dy: 0.18, blur: 0.5, color: teal, opacity: 0.12 },
      },
      ...tile(2.7, 4.3),
    ],
    title: {
      x: 2.7,
      y: 5.9,
      w: 14.2,
      h: 2.9,
      size: 38,
      valign: 'bottom',
      lineHeight: 104,
      sample: 'Impfen und Vorsorge',
    },
    subtitle: {
      x: 2.7,
      y: 9,
      w: 14.2,
      h: 1.9,
      sample: 'Was jetzt ansteht und für wen',
    },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: frame(),
    title: { ...title, sample: 'So bleiben Sie in der Erkältungszeit gesund' },
    body: {
      x: L,
      y: 4.6,
      w: 22.5,
      h: 9.2,
      sample: [
        'Hände waschen: 20 Sekunden mit Seife',
        'Täglich eine halbe Stunde an die frische Luft',
        'Sieben Stunden Schlaf stärken die Abwehr',
        'Grippeimpfung am besten im Oktober oder November',
        'Viel trinken, vor allem Wasser und Tee',
        'Bei Fieber über drei Tage in die Praxis kommen',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [
      ...frame(),
      { t: 'rect', x: 14.4, y: 4.4, w: 12, h: 9.6, r: 1.3, fill: blueSoft },
      disc(26.3, 4.5, 0.85, mint),
      ...plus(26.3, 4.5, 0.8, white, 0.22),
    ],
    title: { ...title, sample: 'Bewegung senkt den Blutdruck messbar' },
    body: {
      x: L,
      y: 4.6,
      w: 11.8,
      h: 9.2,
      sample: [
        'Dreimal pro Woche 30 Minuten',
        'Gehen, Radfahren oder Schwimmen',
        'Wirkung nach etwa sechs Wochen',
      ],
    },
    pictures: [{ x: 15.1, y: 5.3, w: 10.2, h: 8 }],
  },
  {
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      ...frame(),
      { t: 'rect', ...cards[0]!, r: 1.1, fill: mintSoft },
      { t: 'rect', ...cards[1]!, r: 1.1, fill: blueSoft },
      disc(cards[0]!.x + 1.3, cards[0]!.y + 1.25, 0.5, mint),
      ...plus(cards[0]!.x + 1.3, cards[0]!.y + 1.25, 0.5, white, 0.14),
      disc(cards[1]!.x + 1.3, cards[1]!.y + 1.25, 0.5, blue),
      ...plus(cards[1]!.x + 1.3, cards[1]!.y + 1.25, 0.5, white, 0.14),
    ],
    title: { ...title, sample: 'Erkältung oder Grippe? So erkennen Sie den Unterschied' },
    body: cards.map((box, index) => ({
      x: box.x + 0.8,
      y: box.y + 2.2,
      w: box.w - 1.6,
      h: box.h - 2.8,
      sample:
        index === 0
          ? ['Erkältung beginnt langsam', 'Schnupfen und Halsweh', 'Nach einer Woche vorbei']
          : ['Grippe kommt plötzlich', 'Hohes Fieber, Gliederschmerzen', 'Zwei Wochen Schonung'],
    })),
  },
  {
    name: 'Kennzahl',
    bg: white,
    shapes: [
      disc(26.8, 1, 2.6, blueSoft),
      pulse({ x: 13, y: 11, w: 15, h: 2 }, mintMid, 0.45, 0.08),
      disc(7.9, 7.9, 6.2, mintSoft),
      {
        t: 'ellipse',
        x: 1.7,
        y: 1.7,
        w: 12.4,
        h: 12.4,
        kind: 'arc',
        start: 125,
        end: 55,
        fill: null,
        stroke: { color: mint, width: 0.3, cap: 'round' },
      },
      disc(7.9, 7.9, 4.9, white),
      ...plus(14.9, 3.4, 0.7, coral),
      ...tile(15.8, 4.2, 1.1),
    ],
    title: {
      x: 3.3,
      y: 5.2,
      w: 9.2,
      h: 5.4,
      size: 76,
      align: 'center',
      valign: 'middle',
      lineHeight: 100,
      sample: '92 %',
    },
    body: {
      x: 15.8,
      y: 5.9,
      w: 10.6,
      h: 4.8,
      size: 24,
      lineHeight: 118,
      sample: 'unserer Patientinnen und Patienten bekommen einen Termin innerhalb von drei Tagen',
    },
  },
  {
    name: 'Zitat',
    bg: blueSoft,
    shapes: [
      wave({ x: 0, y: 12.3, w: 28, h: 3.45 }, 1.4, 0.5, blueMid, { phase: 1.2 }),
      wave({ x: 0, y: 13.4, w: 28, h: 2.35 }, 1.7, 0.5, mintMid, { phase: 3 }),
      ...plus(25.6, 2, 0.7, mint),
      ...plus(1.5, 10.6, 0.55, blue),
      {
        t: 'rect',
        x: 3.2,
        y: 2.3,
        w: 21.6,
        h: 8.9,
        r: 1.6,
        fill: white,
        shadow: { dx: 0, dy: 0.18, blur: 0.5, color: teal, opacity: 0.12 },
      },
      disc(4, 2.9, 1.25, mint),
      {
        t: 'text',
        x: 2.75,
        y: 1.95,
        w: 2.5,
        h: 2.5,
        text: '“',
        font: 'Figtree',
        bold: true,
        size: 96,
        color: white,
        align: 'center',
        valign: 'middle',
        lineHeight: 100,
        pad: [1.25, 0, 0, 0],
      },
    ],
    body: {
      x: 5.6,
      y: 3,
      w: 17.6,
      h: 7.5,
      font: 'Figtree',
      size: 28,
      lineHeight: 120,
      valign: 'middle',
      sample:
        'Die beste Medizin ist die, die man gar nicht erst braucht. Dafür nehmen wir uns Zeit.',
    },
    subtitle: {
      x: 5.6,
      y: 11.55,
      w: 18,
      h: 1.3,
      color: teal,
      bold: true,
      valign: 'middle',
      sample: 'Dr. med. Lena Brandt, Hausärztin',
    },
  },
  {
    name: 'Bild',
    bg: white,
    shapes: [
      { t: 'rect', x: 1.1, y: 0.9, w: 25.8, h: 11.5, r: 1.4, fill: mintSoft },
      ...tile(L, 13),
      pulse({ x: 17.5, y: 12.7, w: 10.5, h: 1.9 }, mintMid, 0.45, 0.08),
    ],
    pictures: [{ x: 1.9, y: 1.7, w: 24.2, h: 9.9 }],
    title: {
      x: 3.5,
      y: 12.85,
      w: 14,
      h: 1.6,
      size: 22,
      valign: 'middle',
      sample: 'Unser neues Wartezimmer',
    },
  },
  {
    name: 'Schluss',
    bg: teal,
    shapes: [
      disc(23.4, 5.4, 6.4, '#16677a'),
      ...plus(23.4, 5.4, 4.2, '#1d7a8e', 1.4),
      disc(2, 15.4, 3.2, '#16677a'),
      ...plus(17, 2.2, 0.6, coral),
      pulse({ x: 0, y: 10.9, w: 28, h: 2.6 }, mint, 0.6),
      ...tile(L, 1.6),
    ],
    title: {
      x: L,
      y: 3.4,
      w: 16,
      h: 3.6,
      size: 44,
      color: white,
      valign: 'bottom',
      sample: 'Bleiben Sie gesund',
    },
    subtitle: {
      x: L,
      y: 7.3,
      w: 14,
      h: 2.4,
      color: mintMid,
      sample: 'Praxis am Stadtpark\nTermine unter 0123 456 78 90',
    },
  },
];

const template: Template = {
  slug: 'gesundheit',
  name: 'Gesundheit',
  group: 'Bereich',
  tags: ['Gesundheit', 'Medizin', 'Praxis', 'Pflege', 'freundlich', 'Mint', 'rund', 'Vorsorge'],
  description:
    'Für Praxis, Klinik und Pflege: klares Weiß, Mint und sanftes Blau, runde Formen, eine ruhige Pulslinie und kleine Pluszeichen.',
  palette: {
    bg: white,
    text: deep,
    bg2: mintSoft,
    text2: calm,
    accents: [mint, blue, teal, coral, mintMid, blueSoft],
  },
  fonts: { head: 'Figtree', body: 'Mulish' },
  text: {
    title: { font: 'Figtree', size: 30, color: deep, bold: true, lineHeight: 108 },
    subtitle: { font: 'Mulish', size: 20, color: calm, lineHeight: 124 },
    body: { font: 'Mulish', size: 20, color: deep, lineHeight: 118, paraSpace: 0.32 },
  },
  layouts,
};

export default template;
