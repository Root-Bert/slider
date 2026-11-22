import { halftone } from '../art';
import type { Box, Color, Layout, Shape, Template } from '../model';
import { page, star, sunburst } from '../shapes';

/*
 * Pop Art: printed comics blown up – flat primaries, a dot screen, thick black outlines with a
 * hard shadow, bursts. Loud on purpose.
 */

const yellow = '#ffd900';
const red = '#e8112d';
const blue = '#0b6fd6';
const pink = '#ff5fa2';
const cyan = '#19c3e6';
const ink = '#111111';
const cream = '#fffdf2';

const line = { color: ink, width: 0.16, join: 'miter' } as const;

/** A panel as in a comic: outlined, with its hard shadow down right. */
const panel = (box: Box, fill: Color, rotate = 0, drop = 0.28): Shape[] => [
  { t: 'rect', x: box.x + drop, y: box.y + drop, w: box.w, h: box.h, fill: ink, rotate },
  { t: 'rect', ...box, fill, stroke: line, rotate },
];

/** A dot screen over a box, denser where `tone` says. */
const screen = (color: Color, tone: (u: number, v: number) => number, cell = 0.36): Shape => ({
  t: 'image',
  ...page,
  src: halftone({ color, tone, cell, angle: 45 }),
});

const burst = (cx: number, cy: number, r: number, fill: Color, points = 14): Shape[] => [
  star(cx + 0.25, cy + 0.25, r, r * 0.72, points, ink, { rotate: -80 }),
  star(cx, cy, r, r * 0.72, points, fill, { stroke: line, rotate: -80 }),
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: yellow,
    shapes: [
      ...sunburst(21.5, 6.2, 34, 22, '#ffe85a'),
      screen(red, (u, v) => Math.max(0, (u - 0.45) * 1.1 + (v - 0.55) * 1.3)),
      {
        t: 'poly',
        fill: blue,
        stroke: line,
        pts: [
          [-1, -1],
          [9.5, -1],
          [-1, 5.2],
        ],
      },
      ...burst(22.6, 5.3, 4.1, red),
      {
        t: 'text',
        x: 20.1,
        y: 2.6,
        w: 5,
        h: 5.4,
        text: '!',
        font: 'Anton',
        size: 130,
        color: '#ffffff',
        align: 'center',
        valign: 'middle',
      },
      ...panel({ x: 1.8, y: 5.2, w: 17.4, h: 6.2 }, '#ffffff', -2),
      ...panel({ x: 2.6, y: 12.1, w: 12.6, h: 1.9 }, red, 0, 0.2),
    ],
    title: { x: 2.5, y: 5.6, w: 16, h: 5.4, valign: 'middle', sample: 'Das wird\ngroß!' },
    subtitle: { x: 3, y: 12.2, w: 11.8, h: 1.7, valign: 'middle', sample: 'Ein Vortrag mit Wumms' },
  },
  {
    name: 'Abschnitt',
    bg: blue,
    shapes: [
      screen('#3d93ec', (u, v) => 0.75 - Math.hypot(u - 0.3, (v - 0.5) * 0.6) * 1.3),
      {
        t: 'poly',
        fill: pink,
        stroke: line,
        pts: [
          [19, -1],
          [29, -1],
          [29, 17],
          [14.5, 17],
        ],
      },
      screen(ink, (u, v) => (u > 0.62 ? Math.max(0, (v - 0.35) * 0.55) : 0), 0.3),
      ...burst(22.4, 8, 4.6, yellow, 12),
      {
        t: 'text',
        x: 19.4,
        y: 5.4,
        w: 6,
        h: 5.2,
        text: '★',
        font: 'DejaVu Sans',
        size: 90,
        color: ink,
        align: 'center',
        valign: 'middle',
      },
      ...panel({ x: 1.8, y: 4.4, w: 14.6, h: 5.4 }, '#ffffff', 1.5),
    ],
    title: { x: 2.4, y: 4.8, w: 13.4, h: 4.6, valign: 'middle', size: 54, sample: 'Kapitel zwei' },
    subtitle: {
      x: 2.2,
      y: 10.6,
      w: 13,
      h: 1.6,
      color: '#ffffff',
      sample: 'Jetzt wird es spannend',
    },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      screen(cyan, (u, v) => Math.max(0, (u - 0.62) * 1.2 + (v - 0.5) * 1.1), 0.3),
      { t: 'rect', x: -0.5, y: -0.5, w: 29, h: 3.6, fill: yellow, stroke: line },
      ...burst(25.4, 3.1, 1.7, red, 10),
    ],
    title: { x: 1.8, y: 0.5, w: 21, h: 2.2, valign: 'middle', size: 38 },
    body: { x: 1.8, y: 4.4, w: 21.5, h: 9.8 },
  },
  {
    name: 'Text und Bild',
    bg: cream,
    shapes: [
      { t: 'rect', x: -0.5, y: -0.5, w: 29, h: 3.6, fill: pink, stroke: line },
      screen(yellow, (u, v) => (v > 0.2 ? Math.max(0, 0.55 - u * 1.6 + (v - 0.6)) : 0), 0.3),
      ...panel({ x: 14.6, y: 4.2, w: 11.6, h: 9.6 }, '#ffffff'),
    ],
    title: { x: 1.8, y: 0.5, w: 24, h: 2.2, valign: 'middle', size: 38 },
    body: { x: 1.8, y: 4.4, w: 11.4, h: 9.8 },
    pictures: [{ x: 15.1, y: 4.7, w: 10.6, h: 8.6 }],
  },
  {
    name: 'Zwei Spalten',
    bg: cyan,
    shapes: [
      screen('#ffffff', (u, v) => 0.5 - v * 0.55 + u * 0.1, 0.34),
      { t: 'rect', x: -0.5, y: -0.5, w: 29, h: 3.6, fill: yellow, stroke: line },
      ...panel({ x: 1.6, y: 4.3, w: 11.9, h: 9.6 }, '#ffffff', -1),
      ...panel({ x: 14.5, y: 4.3, w: 11.9, h: 9.6 }, '#ffffff', 1),
      ...burst(14, 4.2, 1.3, red, 10),
    ],
    title: { x: 1.8, y: 0.5, w: 24, h: 2.2, valign: 'middle', size: 38 },
    body: [
      { x: 2.3, y: 5.1, w: 10.5, h: 8.1, size: 18 },
      { x: 15.2, y: 5.1, w: 10.5, h: 8.1, size: 18 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: red,
    shapes: [
      screen('#b80a22', (u, v) => 0.2 + Math.hypot(u - 0.3, (v - 0.5) * 0.6) * 0.9),
      ...sunburst(8.2, 7.9, 9, 18, '#ff3d55'),
      ...burst(8.2, 7.9, 6.3, yellow, 18),
      ...panel({ x: 16, y: 5, w: 10.4, h: 5.8 }, '#ffffff', 1.5),
    ],
    title: {
      x: 3.2,
      y: 4.9,
      w: 10,
      h: 6,
      valign: 'middle',
      align: 'center',
      size: 96,
      sample: '87 %',
    },
    body: {
      x: 16.7,
      y: 5.6,
      w: 9,
      h: 4.6,
      valign: 'middle',
      size: 22,
      sample: 'der Leute lesen nur die Überschrift.\nDeshalb zählt sie.',
    },
  },
  {
    name: 'Zitat',
    bg: pink,
    shapes: [
      screen('#ff8fbf', (u, v) => 0.8 - v * 0.9),
      // The bubble with its tail, shadow first.
      {
        t: 'poly',
        fill: ink,
        pts: [
          [6.3, 11.3],
          [10.3, 11.3],
          [5.3, 14.6],
        ],
      },
      { t: 'rect', x: 2.9, y: 2.3, w: 22.6, h: 9.2, r: 1.6, fill: ink },
      { t: 'rect', x: 2.6, y: 2, w: 22.6, h: 9.2, r: 1.6, fill: '#ffffff', stroke: line },
      {
        t: 'poly',
        fill: '#ffffff',
        pts: [
          [6, 11.1],
          [10, 11.1],
          [5, 14.3],
        ],
      },
      { t: 'line', x1: 6, y1: 11.2, x2: 5, y2: 14.3, stroke: line },
      { t: 'line', x1: 10, y1: 11.2, x2: 5, y2: 14.3, stroke: line },
      { t: 'rect', x: 6.1, y: 10.9, w: 3.8, h: 0.42, fill: '#ffffff' },
    ],
    body: {
      x: 4,
      y: 2.8,
      w: 19.8,
      h: 7.6,
      valign: 'middle',
      align: 'center',
      font: 'Anton',
      size: 36,
      upper: true,
      lineHeight: 118,
      sample: 'Gute Ideen sind laut, bevor sie richtig sind.',
    },
    subtitle: { x: 11.2, y: 12.2, w: 14, h: 1.6, sample: 'Roy, Zeichner' },
  },
  {
    name: 'Bild',
    bg: yellow,
    shapes: [
      screen(red, (u, v) => Math.max(0, (v - 0.6) * 1.6 + (u - 0.7) * 0.6), 0.3),
      ...panel({ x: 1.5, y: 1.2, w: 25, h: 11.4 }, '#ffffff', 0, 0.3),
      ...panel({ x: 0.9, y: 11.6, w: 14.4, h: 2.9 }, yellow, -1.5, 0.22),
    ],
    pictures: [{ x: 1.9, y: 1.6, w: 24.2, h: 10.6 }],
    title: {
      x: 1.5,
      y: 11.9,
      w: 13.3,
      h: 2.3,
      valign: 'middle',
      size: 34,
      sample: 'Schau genau hin',
    },
  },
  {
    name: 'Schluss',
    bg: blue,
    shapes: [
      ...sunburst(14, 7.4, 34, 24, '#2b86e6'),
      screen(ink, (u, v) => Math.max(0, (v - 0.72) * 1.5), 0.3),
      ...burst(14, 7.2, 7.2, yellow, 20),
      ...panel({ x: 9, y: 12.6, w: 10, h: 1.8 }, red, 0, 0.2),
    ],
    title: {
      x: 8.2,
      y: 4.4,
      w: 11.6,
      h: 5.6,
      valign: 'middle',
      align: 'center',
      size: 68,
      sample: 'Danke!',
    },
    subtitle: {
      x: 9.3,
      y: 12.7,
      w: 9.4,
      h: 1.6,
      valign: 'middle',
      align: 'center',
      sample: 'Fragen? Nur zu.',
    },
  },
];

const template: Template = {
  slug: 'pop-art',
  name: 'Pop Art',
  group: 'Kunststil',
  tags: ['Pop Art', 'Comic', 'laut', 'farbenfroh', 'Rasterpunkte', 'Keynote', 'Marke'],
  description:
    'Comic im Großformat: Grundfarben, Rasterpunkte, dicke schwarze Linien und Sprechblasen.',
  palette: {
    bg: cream,
    text: ink,
    bg2: '#fff3a6',
    text2: '#3a3a3a',
    accents: [red, blue, yellow, pink, cyan, '#ff8a00'],
  },
  fonts: { head: 'Anton', body: 'Nunito Sans' },
  text: {
    title: { font: 'Anton', size: 64, color: ink, upper: true, lineHeight: 104 },
    subtitle: { font: 'Permanent Marker', size: 24, color: '#ffffff' },
    body: {
      font: 'Nunito Sans',
      size: 22,
      color: ink,
      bold: true,
      lineHeight: 120,
      paraSpace: 0.35,
    },
  },
  layouts,
};

export default template;
