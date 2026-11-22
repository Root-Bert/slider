import type { Color, Layout, Shape, Template } from '../model';
import { disc, ring } from '../shapes';

/*
 * Bauhaus: circle, square and triangle in red, yellow and blue, black bars and hairlines on warm
 * white. Strict geometry, weighed asymmetrically – a few large forms against much quiet ground.
 */

const paper = '#f3eee2';
const ink = '#161616';
const red = '#d7281c';
const yellow = '#f1b40a';
const blue = '#1c4c9c';
const grey = '#b9b3a6';

/** A quarter circle round a centre: 0 opens up right, 1 up left, 2 down left, 3 down right. */
const quarter = (cx: number, cy: number, r: number, quadrant: number, fill: Color): Shape => ({
  t: 'ellipse',
  kind: 'section',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  start: quadrant * 90,
  end: quadrant * 90 + 90,
  fill,
});

const square = (x: number, y: number, side: number, fill: Color): Shape => ({
  t: 'rect',
  x,
  y,
  w: side,
  h: side,
  fill,
});

const bar = (x: number, y: number, w: number, h: number, fill: Color = ink): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  fill,
});

const triangle = (pts: readonly (readonly [number, number])[], fill: Color): Shape => ({
  t: 'poly',
  pts,
  fill,
});

const hair = (x1: number, y1: number, x2: number, y2: number, width = 0.05): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: { color: ink, width },
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paper,
    shapes: [
      quarter(28, 15.75, 10.4, 1, yellow),
      disc(19.6, 5.6, 4.1, red),
      quarter(19.6, 5.6, 4.1, 0, ink),
      square(23.7, 1.5, 2.8, blue),
      bar(15.5, 9.7, 12.5, 0.55),
      triangle(
        [
          [14.2, 15.75],
          [17.6, 15.75],
          [17.6, 11.6],
        ],
        blue,
      ),
      hair(1.8, 1.8, 1.8, 13.95, 0.09),
      ring(23.2, 12.6, 1.5, { color: ink, width: 0.09 }),
      disc(23.2, 12.6, 0.42, ink),
    ],
    title: {
      x: 2.6,
      y: 5.4,
      w: 12.4,
      h: 6.2,
      valign: 'bottom',
      size: 62,
      sample: 'Form folgt\nFunktion',
    },
    subtitle: {
      x: 2.6,
      y: 12,
      w: 11.4,
      h: 1.9,
      sample: 'Gestaltung aus drei Grundformen',
    },
  },
  {
    name: 'Abschnitt',
    bg: blue,
    shapes: [
      quarter(28, 0, 12.2, 2, yellow),
      quarter(28, 0, 6.1, 2, red),
      bar(0, 11.3, 15.8, 0.5, paper),
      square(1.8, 1.8, 1.5, paper),
      disc(18.9, 13, 1.25, paper),
      triangle(
        [
          [21.4, 15.75],
          [28, 15.75],
          [28, 9.15],
        ],
        ink,
      ),
    ],
    title: {
      x: 1.8,
      y: 5.2,
      w: 13.6,
      h: 5.6,
      valign: 'bottom',
      size: 54,
      color: paper,
      sample: 'Zweiter Teil:\nDas Material',
    },
    subtitle: {
      x: 1.8,
      y: 12.3,
      w: 13.6,
      h: 1.7,
      color: '#f6d77a',
      sample: 'Vom Entwurf zur Werkstatt',
    },
  },
  {
    name: 'Inhalt',
    bg: paper,
    shapes: [
      bar(0, 0, 0.9, 5.25, red),
      bar(0, 5.25, 0.9, 5.25, yellow),
      bar(0, 10.5, 0.9, 5.25, blue),
      bar(2.4, 3.55, 6.2, 0.32),
      hair(8.6, 3.71, 26.2, 3.71, 0.05),
      quarter(28, 15.75, 3.6, 1, yellow),
      disc(25.3, 2.2, 0.9, red),
    ],
    title: { x: 2.4, y: 1.1, w: 20.6, h: 2.2, valign: 'bottom', size: 36 },
    body: {
      x: 2.4,
      y: 4.5,
      w: 21.4,
      h: 9.8,
      sample: [
        'Die Form ergibt sich aus der Aufgabe',
        'Wenige Mittel, klar eingesetzt',
        'Farbe ordnet und führt das Auge',
        'Schrift ohne Schnörkel, gut lesbar',
        'Jedes Teil hat seinen Platz im Raster',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: paper,
    shapes: [
      bar(15.6, 0, 12.4, 15.75, ink),
      quarter(15.6, 15.75, 2.8, 1, red),
      square(13.5, 0, 2.1, yellow),
      bar(1.8, 4.75, 4.4, 0.32),
      disc(27, 14.75, 0.45, yellow),
    ],
    title: { x: 1.8, y: 1.2, w: 11.2, h: 3.3, valign: 'bottom', size: 32 },
    body: { x: 1.8, y: 5.6, w: 10.8, h: 8.6, size: 20 },
    pictures: [{ x: 16.5, y: 0.9, w: 10.6, h: 12.9 }],
  },
  {
    name: 'Zwei Spalten',
    bg: paper,
    shapes: [
      bar(0, 0, 28, 0.55, ink),
      hair(14, 4.6, 14, 13.9, 0.07),
      disc(2.35, 5.15, 0.55, red),
      square(15.2, 4.6, 1.1, blue),
      bar(3.3, 5.0, 9.4, 0.3, ink),
      bar(16.7, 5.0, 9.5, 0.3, ink),
      quarter(28, 0.55, 3.2, 2, yellow),
      triangle(
        [
          [0, 15.75],
          [2.6, 15.75],
          [0, 13.15],
        ],
        ink,
      ),
    ],
    title: { x: 1.8, y: 1.3, w: 21.6, h: 2.3, valign: 'middle', size: 36 },
    body: [
      { x: 1.8, y: 6.2, w: 11, h: 7.9, size: 19 },
      { x: 15.2, y: 6.2, w: 11, h: 7.9, size: 19 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: paper,
    shapes: [
      bar(0, 0, 28, 15.75, paper),
      quarter(0, 15.75, 15.4, 0, red),
      quarter(0, 15.75, 5.2, 0, ink),
      square(15.4, 0, 3.1, yellow),
      disc(24.6, 2.9, 1.6, blue),
      bar(16.9, 6.1, 9.3, 0.4),
      hair(15.4, 3.1, 15.4, 15.75, 0.06),
    ],
    title: {
      x: 1.4,
      y: 4.3,
      w: 12.2,
      h: 6.4,
      align: 'left',
      valign: 'middle',
      size: 120,
      color: paper,
      sample: '90°',
    },
    body: {
      x: 16.9,
      y: 7,
      w: 9.3,
      h: 6.6,
      size: 24,
      sample: 'Der rechte Winkel trägt jedes Blatt.\nAlles Weitere ordnet sich daran.',
    },
  },
  {
    name: 'Zitat',
    bg: ink,
    shapes: [
      disc(2.6, 2.6, 4.4, red),
      quarter(28, 15.75, 5.8, 1, blue),
      bar(7.4, 11.45, 3.4, 0.32, yellow),
      square(24.7, 1.5, 1.8, yellow),
      triangle(
        [
          [0, 15.75],
          [4.4, 15.75],
          [0, 11.35],
        ],
        paper,
      ),
    ],
    body: {
      x: 7.4,
      y: 2.6,
      w: 17,
      h: 8.2,
      valign: 'bottom',
      size: 38,
      bold: true,
      lineHeight: 112,
      color: paper,
      sample: 'Weniger Schmuck, mehr Haltung: Die Form sagt, wozu ein Ding da ist.',
    },
    subtitle: {
      x: 7.4,
      y: 12.1,
      w: 13.6,
      h: 1.6,
      color: yellow,
      sample: 'Marta Ehlers, Werkmeisterin',
    },
  },
  {
    name: 'Bild',
    bg: paper,
    shapes: [
      bar(0, 0, 19.6, 15.75, grey),
      square(19.6, 0, 4.2, red),
      quarter(23.8, 4.2, 4.2, 0, blue),
      quarter(28, 8.72, 2.3, 2, yellow),
      disc(25.9, 6.3, 1.05, ink),
      bar(19.6, 8.4, 8.4, 0.32),
    ],
    pictures: [{ x: 0, y: 0, w: 19.6, h: 15.75 }],
    title: {
      x: 20.5,
      y: 10.6,
      w: 6.6,
      h: 3.9,
      valign: 'bottom',
      size: 24,
      sample: 'Werkstatt, Blick nach Norden',
    },
  },
  {
    name: 'Schluss',
    bg: yellow,
    shapes: [
      disc(9.4, 7.875, 6.3, paper),
      quarter(28, 15.75, 8.6, 1, red),
      square(21.5, 1.5, 3.4, blue),
      bar(15.7, 7.6, 12.3, 0.55),
      triangle(
        [
          [0, 0],
          [3.8, 0],
          [0, 3.8],
        ],
        ink,
      ),
    ],
    title: {
      x: 4.4,
      y: 5.1,
      w: 10,
      h: 3.6,
      align: 'center',
      valign: 'bottom',
      size: 60,
      sample: 'Danke',
    },
    subtitle: {
      x: 4.9,
      y: 8.9,
      w: 9,
      h: 2.4,
      align: 'center',
      color: ink,
      sample: 'Fragen und Gespräch',
    },
  },
];

const template: Template = {
  slug: 'bauhaus',
  name: 'Bauhaus',
  group: 'Kunststil',
  tags: ['Bauhaus', 'Geometrie', 'Grundfarben', 'Moderne', 'klar', 'Architektur', 'Design'],
  description:
    'Kreis, Quadrat und Dreieck in Rot, Gelb und Blau: strenge Geometrie auf warmem Weiß.',
  palette: {
    bg: paper,
    text: ink,
    bg2: '#e4ddcc',
    text2: '#4a4741',
    accents: [red, yellow, blue, grey, '#e2572b', '#2f7d6b'],
  },
  fonts: { head: 'Jost', body: 'Jost' },
  text: {
    title: { font: 'Jost', size: 44, color: ink, bold: true, lineHeight: 100 },
    subtitle: { font: 'Jost', size: 22, color: '#4a4741' },
    body: { font: 'Jost', size: 21, color: ink, lineHeight: 122, paraSpace: 0.4 },
  },
  layouts,
};

export default template;
