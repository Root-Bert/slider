import type { Box, Color, Layout, Shape, Template } from '../model';
import { disc } from '../shapes';

/*
 * Flat Design, around 2013: nothing shines, nothing floats. Saturated colour fields, simple
 * geometric signs and the one allowed trick of depth – the long shadow, itself a flat polygon
 * running down right at 45°.
 */

const teal = '#17b3a3';
const blue = '#2f8fdc';
const red = '#e4533f';
const yellow = '#f7c520';
const purple = '#8c5bb8';
const orange = '#f08226';
const navy = '#2a394c';
const cloud = '#f1f4f5';
const white = '#ffffff';

const K = Math.SQRT1_2;
/** The shadow's tone: the ground a step darker, whatever the ground is. */
const shade = { t: 'solid', color: '#000000', opacity: 0.16 } as const;

/** The long shadow of a disc. */
const discShadow = (cx: number, cy: number, r: number, len = 40): Shape => ({
  t: 'poly',
  fill: shade,
  pts: [
    [cx + r * K, cy - r * K],
    [cx + r * K + len, cy - r * K + len],
    [cx - r * K + len, cy + r * K + len],
    [cx - r * K, cy + r * K],
  ],
});

/** The long shadow of a box. */
const boxShadow = (box: Box, len = 40): Shape => ({
  t: 'poly',
  fill: shade,
  pts: [
    [box.x + box.w, box.y],
    [box.x + box.w + len, box.y + len],
    [box.x + len, box.y + box.h + len],
    [box.x, box.y + box.h],
  ],
});

type Sign = (cx: number, cy: number, s: number, color: Color) => Shape[];

/** A paper plane. */
const plane: Sign = (cx, cy, s, color) => [
  {
    t: 'poly',
    fill: color,
    pts: [
      [cx - s, cy - 0.12 * s],
      [cx + s, cy - 0.85 * s],
      [cx + 0.28 * s, cy + 0.9 * s],
      [cx - 0.08 * s, cy + 0.22 * s],
    ],
  },
  {
    t: 'poly',
    fill: { t: 'solid', color: '#000000', opacity: 0.14 },
    pts: [
      [cx - 0.08 * s, cy + 0.22 * s],
      [cx + s, cy - 0.85 * s],
      [cx + 0.28 * s, cy + 0.9 * s],
    ],
  },
];

/** Three rising bars. */
const bars: Sign = (cx, cy, s, color) =>
  [0.55, 1, 1.5].map((h, index): Shape => ({
    t: 'rect',
    x: cx - 0.8 * s + index * 0.6 * s,
    y: cy + 0.75 * s - h * s,
    w: 0.42 * s,
    h: h * s,
    fill: color,
  }));

/** A tick. */
const tick: Sign = (cx, cy, s, color) => [
  {
    t: 'path',
    x: cx - s,
    y: cy - s,
    w: 2 * s,
    h: 2 * s,
    vb: [100, 100],
    d: 'M18 52 L42 75 L84 28',
    fill: null,
    stroke: { color, width: 0.34 * s, cap: 'butt', join: 'miter' },
  },
];

/** A plus. */
const plus: Sign = (cx, cy, s, color) => [
  { t: 'rect', x: cx - 0.8 * s, y: cy - 0.17 * s, w: 1.6 * s, h: 0.34 * s, fill: color },
  { t: 'rect', x: cx - 0.17 * s, y: cy - 0.8 * s, w: 0.34 * s, h: 1.6 * s, fill: color },
];

/** A play triangle. */
const play: Sign = (cx, cy, s, color) => [
  {
    t: 'poly',
    fill: color,
    pts: [
      [cx - 0.5 * s, cy - 0.8 * s],
      [cx + 0.85 * s, cy],
      [cx - 0.5 * s, cy + 0.8 * s],
    ],
  },
];

/** A speech card with its tip. */
const talk: Sign = (cx, cy, s, color) => [
  { t: 'rect', x: cx - 0.9 * s, y: cy - 0.75 * s, w: 1.8 * s, h: 1.2 * s, fill: color },
  {
    t: 'poly',
    fill: color,
    pts: [
      [cx - 0.5 * s, cy + 0.4 * s],
      [cx + 0.1 * s, cy + 0.4 * s],
      [cx - 0.5 * s, cy + 0.95 * s],
    ],
  },
];

/** A pie with a slice pulled out of it. */
const pie: Sign = (cx, cy, s, color) => [
  {
    t: 'ellipse',
    kind: 'section',
    start: 90,
    end: 360,
    x: cx - 0.9 * s,
    y: cy - 0.8 * s,
    w: 1.7 * s,
    h: 1.7 * s,
    fill: color,
  },
  {
    t: 'ellipse',
    kind: 'section',
    start: 0,
    end: 90,
    x: cx - 0.72 * s,
    y: cy - 0.98 * s,
    w: 1.7 * s,
    h: 1.7 * s,
    fill: color,
  },
];

/** A sign on its disc. */
const badge = (
  cx: number,
  cy: number,
  r: number,
  fill: Color,
  sign: Sign,
  color: Color = white,
): Shape[] => [disc(cx, cy, r, fill), ...sign(cx, cy, r * 0.5, color)];

const bar = (x: number, y: number, w: number, color: Color, h = 0.22): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  fill: color,
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: teal,
    shapes: [
      { t: 'rect', x: 0, y: 12.9, w: 28, h: 2.85, fill: '#129688' },
      discShadow(21.4, 6.6, 4.3),
      disc(21.4, 6.6, 4.3, yellow),
      ...plane(21.3, 6.7, 2.5, white),
      discShadow(25.6, 1.9, 0.55, 3.2),
      disc(25.6, 1.9, 0.55, red),
      discShadow(16.3, 2.3, 0.32, 2),
      disc(16.3, 2.3, 0.32, white),
      bar(1.9, 3.3, 2.6, white),
    ],
    title: {
      x: 1.9,
      y: 3.9,
      w: 14.6,
      h: 6.6,
      valign: 'top',
      sample: 'Einfach.\nKlar. Flach.',
    },
    subtitle: {
      x: 1.9,
      y: 13.35,
      w: 18,
      h: 1.9,
      valign: 'middle',
      sample: 'Produktvorstellung, Frühjahr',
    },
  },
  {
    name: 'Abschnitt',
    bg: red,
    shapes: [
      // Three tiles on their corners, stepping down to the right.
      ...[
        { cx: 17.2, cy: 4.2, s: 1.9, fill: yellow },
        { cx: 21, cy: 8, s: 2.6, fill: white },
        { cx: 16.4, cy: 11.6, s: 1.5, fill: navy },
      ].flatMap(({ cx, cy, s, fill }): Shape[] => [
        {
          t: 'poly',
          fill: shade,
          pts: [
            [cx, cy - s],
            [cx + s, cy],
            [cx + s + 40, cy + 40],
            [cx + 40, cy + s + 40],
            [cx, cy + s],
            [cx - s, cy],
          ],
        },
        {
          t: 'poly',
          fill,
          pts: [
            [cx, cy - s],
            [cx + s, cy],
            [cx, cy + s],
            [cx - s, cy],
          ],
        },
      ]),
      ...play(21.15, 8, 1.1, red),
      bar(1.9, 5.1, 2.6, white),
    ],
    title: {
      x: 1.9,
      y: 5.7,
      w: 12.6,
      h: 4.6,
      size: 48,
      valign: 'top',
      sample: 'Zweiter Teil:\ndie Umsetzung',
    },
    subtitle: {
      x: 1.9,
      y: 10.7,
      w: 12.4,
      h: 1.6,
      color: '#ffe3de',
      sample: 'Vom Entwurf zum fertigen Produkt',
    },
  },
  {
    name: 'Inhalt',
    bg: cloud,
    shapes: [
      { t: 'rect', x: 0, y: 0, w: 9.2, h: 15.75, fill: blue },
      discShadow(3.6, 11.6, 1.7),
      // The shadow ends where the field does.
      { t: 'rect', x: 9.2, y: 0, w: 18.8, h: 15.75, fill: cloud },
      ...badge(3.6, 11.6, 1.7, white, bars, blue),
      bar(1.9, 1.9, 2.2, white),
      { t: 'rect', x: 25.2, y: 14.1, w: 0.5, h: 0.5, fill: teal },
      { t: 'rect', x: 25.9, y: 14.1, w: 0.5, h: 0.5, fill: yellow },
      { t: 'rect', x: 26.6, y: 14.1, w: 0.5, h: 0.5, fill: red },
    ],
    title: {
      x: 1.9,
      y: 2.5,
      w: 6.4,
      h: 6.6,
      size: 30,
      valign: 'top',
      sample: 'Was sich für uns ändert',
    },
    body: {
      x: 10.9,
      y: 2.5,
      w: 15.5,
      h: 11,
      valign: 'top',
      sample: [
        'Eine Oberfläche ohne Verzierung',
        'Farbe zeigt, was wichtig ist',
        'Große Schrift statt kleiner Symbole',
        'Jede Seite hat genau eine Aufgabe',
        'Weniger Klicks bis zum Ziel',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: cloud,
    shapes: [
      { t: 'rect', x: 14, y: 0, w: 14, h: 15.75, fill: yellow },
      boxShadow({ x: 12.4, y: 2.6, w: 13.2, h: 9.6 }),
      { t: 'rect', x: 0, y: 0, w: 12.4, h: 15.75, fill: cloud },
      { t: 'rect', x: 12.4, y: 12.2, w: 1.6, h: 3.55, fill: cloud },
      { t: 'rect', x: 12.4, y: 2.6, w: 13.2, h: 9.6, fill: white },
      bar(1.9, 5, 2.2, teal),
      ...badge(25.6, 12.2, 1.05, red, plus),
    ],
    title: {
      x: 1.9,
      y: 1.5,
      w: 9.8,
      h: 3.1,
      size: 30,
      color: navy,
      valign: 'bottom',
      sample: 'Ein Bild sagt, wohin es geht',
    },
    body: {
      x: 1.9,
      y: 5.8,
      w: 9.6,
      h: 8.4,
      size: 19,
      color: navy,
      sample: ['Klare Flächen lenken den Blick', 'Text bleibt knapp', 'Das Bild trägt die Aussage'],
    },
    pictures: [{ x: 12.75, y: 2.95, w: 12.5, h: 8.9 }],
  },
  {
    name: 'Zwei Spalten',
    // Dark, so that the bullets on the colour fields come out light.
    bg: navy,
    shapes: [
      { t: 'rect', x: 0, y: 4.7, w: 14, h: 11.05, fill: teal },
      { t: 'rect', x: 14, y: 4.7, w: 14, h: 11.05, fill: navy },
      discShadow(3, 4.7, 1.15),
      discShadow(17, 4.7, 1.15),
      { t: 'rect', x: 0, y: 0, w: 28, h: 4.7, fill: cloud },
      // The half of each shadow that would lie on the light ground is cut by it; the discs sit on
      // the seam.
      ...badge(3, 4.7, 1.15, yellow, tick, navy),
      ...badge(17, 4.7, 1.15, red, plus),
    ],
    title: {
      x: 1.9,
      y: 0.9,
      w: 24.2,
      h: 2.3,
      size: 32,
      color: navy,
      valign: 'middle',
      sample: 'Vorher und nachher',
    },
    body: [
      {
        x: 1.9,
        y: 6.6,
        w: 10.6,
        h: 7.9,
        size: 19,
        color: white,
        sample: ['Glanz und Schatten', 'Viele kleine Schaltflächen', 'Drei Schriften pro Seite'],
      },
      {
        x: 15.9,
        y: 6.6,
        w: 10.6,
        h: 7.9,
        size: 19,
        color: white,
        sample: ['Reine Farbflächen', 'Wenige, große Ziele', 'Eine Schrift, zwei Stärken'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: yellow,
    shapes: [
      discShadow(8.6, 7.9, 5.7),
      { t: 'rect', x: 17.2, y: 0, w: 10.8, h: 15.75, fill: navy },
      disc(8.6, 7.9, 5.7, white),
      bar(19.1, 5.1, 2.2, yellow),
      ...badge(24.6, 12.6, 0.9, teal, pie),
    ],
    title: {
      x: 3.4,
      y: 5,
      w: 10.4,
      h: 5.8,
      size: 92,
      color: navy,
      align: 'center',
      valign: 'middle',
      sample: '3×',
    },
    body: {
      x: 19.1,
      y: 5.7,
      w: 7.4,
      h: 5.6,
      size: 22,
      color: white,
      valign: 'top',
      sample: 'schneller am Ziel, seit die Startseite nur noch eine Frage stellt.',
    },
  },
  {
    name: 'Zitat',
    bg: purple,
    shapes: [
      {
        t: 'poly',
        fill: '#7a4aa6',
        pts: [
          [28, 7.4],
          [28, 15.75],
          [19.65, 15.75],
        ],
      },
      discShadow(4.6, 4.3, 2.1, 5.2),
      disc(4.6, 4.3, 2.1, yellow),
      {
        t: 'text',
        x: 2.5,
        y: 2.75,
        w: 4.2,
        h: 4.2,
        text: '“',
        font: 'Lato',
        bold: true,
        size: 120,
        color: navy,
        align: 'center',
        valign: 'top',
      },
      bar(8.2, 11.55, 2.2, yellow),
    ],
    body: {
      x: 8.2,
      y: 2.6,
      w: 17.6,
      h: 8.4,
      size: 34,
      bold: true,
      color: white,
      lineHeight: 118,
      valign: 'middle',
      sample: 'Gestaltung ist fertig, wenn man nichts mehr weglassen kann.',
    },
    subtitle: {
      x: 8.2,
      y: 12.05,
      w: 16,
      h: 1.5,
      color: '#eadcf5',
      sample: 'Mara Lindqvist, Gestalterin',
    },
  },
  {
    name: 'Bild',
    bg: navy,
    shapes: [
      boxShadow({ x: 1.9, y: 1.5, w: 24.2, h: 10.5 }),
      { t: 'rect', x: 0, y: 12.6, w: 28, h: 3.15, fill: '#223041' },
      { t: 'rect', x: 1.9, y: 1.5, w: 24.2, h: 10.5, fill: white },
      { t: 'rect', x: 0, y: 12.6, w: 15.6, h: 2.1, fill: red },
      {
        t: 'poly',
        fill: red,
        pts: [
          [15.6, 12.6],
          [16.65, 13.65],
          [15.6, 14.7],
        ],
      },
      ...badge(24.6, 13.65, 0.75, teal, play),
    ],
    pictures: [{ x: 2.2, y: 1.8, w: 23.6, h: 9.9 }],
    title: {
      x: 1.9,
      y: 12.6,
      w: 13.4,
      h: 2.1,
      size: 26,
      valign: 'middle',
      sample: 'Der neue Startbildschirm',
    },
  },
  {
    name: 'Schluss',
    bg: blue,
    shapes: [
      { t: 'rect', x: 0, y: 10.2, w: 28, h: 5.55, fill: '#2a80c6' },
      ...[6.8, 10.4, 14, 17.6, 21.2].map((cx) => discShadow(cx, 10.2, 1.25, 5.55)),
      ...badge(6.8, 10.2, 1.25, yellow, tick, navy),
      ...badge(10.4, 10.2, 1.25, red, talk),
      ...badge(14, 10.2, 1.25, white, plane, blue),
      ...badge(17.6, 10.2, 1.25, teal, bars),
      ...badge(21.2, 10.2, 1.25, navy, play),
    ],
    title: {
      x: 3,
      y: 2.4,
      w: 22,
      h: 4,
      size: 60,
      align: 'center',
      valign: 'middle',
      sample: 'Danke!',
    },
    subtitle: {
      x: 4,
      y: 6.5,
      w: 20,
      h: 1.6,
      align: 'center',
      valign: 'middle',
      sample: 'Fragen, Ideen, Widerspruch – gern jetzt',
    },
  },
];

const template: Template = {
  slug: 'flat-design',
  name: 'Flat Design',
  group: 'Designtrend',
  tags: ['Flat Design', 'flach', 'Farbflächen', 'lange Schatten', 'klar', 'Start-up', 'App'],
  description:
    'Reine Farbflächen ohne Verlauf und Tiefe, einfache geometrische Zeichen und lange, flache Schatten.',
  palette: {
    bg: cloud,
    text: navy,
    bg2: '#dde4e7',
    text2: '#667784',
    accents: [teal, blue, red, yellow, purple, orange],
  },
  fonts: { head: 'Lato', body: 'Lato' },
  text: {
    title: { font: 'Lato', size: 56, bold: true, color: white, lineHeight: 104 },
    subtitle: { font: 'Lato', size: 22, color: white },
    body: { font: 'Lato', size: 22, color: navy, lineHeight: 122, paraSpace: 0.4 },
  },
  layouts,
};

export default template;
