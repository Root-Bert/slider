import { paint, stencil } from '../art';
import type { Box, Color, Layout, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page } from '../shapes';

/*
 * Retro-Desktop: a graphical desktop of the 1990s – grey windows with bevelled edges, a coloured
 * title bar with tiny square buttons, sunken white fields, a dithered teal ground, a task bar.
 * Nobody's system in particular.
 */

const face = '#c6c9cf';
const light = '#ffffff';
const shade = '#858a94';
const dark = '#1e2026';
const ink = '#16181d';
const teal = '#1f8a8a';
const tealDark = '#136b6e';
const indigo = '#43318f';
const plum = '#8f2a6b';
const idle = '#8b8f99';
const yellow = '#f2c230';
const red = '#d6453d';
const green = '#3f9e5a';
const orange = '#f08a2e';
const B = 0.07;

/** A dither: every second cell of a fine grid, in one colour. */
function dither(color: Color, cell = 0.09): Shape {
  const surface = paint(PAGE, 3 / cell);
  const { ctx, w, h } = surface;
  ctx.fillStyle = color;
  for (let y = 0; y * 3 < h; y += 1) {
    for (let x = y % 2; x * 3 < w; x += 2) ctx.fillRect(x * 3, y * 3, 3, 3);
  }
  return { t: 'image', ...page, src: stencil(surface, color, 2) };
}
const teaDither = dither(tealDark);
const dimDither = dither('#06282a', 0.09);

const desktop = (dim = false): Shape[] => [
  { t: 'rect', ...page, fill: teal },
  teaDither,
  ...(dim
    ? [
        { t: 'rect', ...page, fill: { t: 'solid', color: '#06282a', opacity: 0.35 } } as Shape,
        dimDither,
      ]
    : []),
];

const box = (x: number, y: number, w: number, h: number, fill: Color): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  fill,
});

/** Standing out of the screen: lit from up left, 2 px each edge. */
const raised = (b: Box, fill: Color = face): Shape[] => [
  box(b.x, b.y, b.w, b.h, dark),
  box(b.x, b.y, b.w - B, b.h - B, light),
  box(b.x + B, b.y + B, b.w - 2 * B, b.h - 2 * B, shade),
  box(b.x + B, b.y + B, b.w - 3 * B, b.h - 3 * B, fill),
];

/** Let into the screen: a field to write in. */
const sunken = (b: Box, fill: Color = light): Shape[] => [
  box(b.x, b.y, b.w, b.h, light),
  box(b.x, b.y, b.w - B, b.h - B, shade),
  box(b.x + B, b.y + B, b.w - 2 * B, b.h - 2 * B, face),
  box(b.x + B, b.y + B, b.w - 3 * B, b.h - 3 * B, dark),
  box(b.x + 2 * B, b.y + 2 * B, b.w - 4 * B, b.h - 4 * B, fill),
];

/** A window: its frame, its bar with three tiny square buttons. */
function win(b: Box, bar: Color = indigo, barH = 1): Shape[] {
  const pad = 0.22;
  const side = barH - 0.3;
  const top = b.y + pad + 0.15;
  const right = b.x + b.w - pad - 0.15;
  const marks: Shape[][] = [0, 1, 2].map((i) => {
    const x = right - (i + 1) * side - i * 0.1;
    const m = side * 0.26;
    return [
      ...raised({ x, y: top, w: side, h: side }),
      i === 2
        ? box(x + m, top + side - m - 0.09, side - 2 * m - B, 0.09, dark)
        : i === 1
          ? {
              t: 'rect',
              x: x + m,
              y: top + m,
              w: side - 2 * m - B,
              h: side - 2 * m - B,
              fill: null,
              stroke: { color: dark, width: 0.06 },
            }
          : box(x + m, top + m, side - 2 * m - B, side - 2 * m - B, dark),
    ];
  });
  return [...raised(b), box(b.x + pad, b.y + pad, b.w - 2 * pad, barH, bar), ...marks.flat()];
}

const button = (b: Box, glyph?: string, bold = false): Shape[] => [
  ...(bold ? [box(b.x - B, b.y - B, b.w + 2 * B, b.h + 2 * B, dark)] : []),
  ...raised(b),
  ...(glyph
    ? [
        {
          t: 'text',
          ...b,
          text: glyph,
          font: 'DejaVu Sans',
          size: 16,
          color: ink,
          align: 'center',
          valign: 'middle',
        } as Shape,
      ]
    : []),
];

/** The bar at the foot of the screen: a button, a clock. */
const taskbar = (open = 1): Shape[] => [
  ...raised({ x: -0.1, y: 14.55, w: 28.2, h: 1.3 }),
  ...raised({ x: 0.3, y: 14.75, w: 2.3, h: 0.82 }),
  { t: 'ellipse', x: 0.62, y: 14.94, w: 0.44, h: 0.44, fill: indigo },
  box(1.25, 15.06, 1, 0.2, dark),
  ...Array.from({ length: open }, (_, i) => [
    ...sunken({ x: 3 + i * 4.4, y: 14.75, w: 4.2, h: 0.82 }, '#dfe2e7'),
    box(3.25 + i * 4.4, 14.98, 0.36, 0.36, i === 0 ? indigo : plum),
    box(3.8 + i * 4.4, 15.06, 2.2, 0.2, shade),
  ]).flat(),
  ...sunken({ x: 24.6, y: 14.75, w: 3.1, h: 0.82 }, face),
  {
    t: 'text',
    x: 24.6,
    y: 14.75,
    w: 3.1,
    h: 0.82,
    text: '12:00',
    font: 'IBM Plex Mono',
    size: 12,
    color: ink,
    align: 'center',
    valign: 'middle',
  },
];

/** Something lying on the desktop: a plain tile and the bar where its name would be. */
const item = (x: number, y: number, color: Color): Shape[] => [
  ...raised({ x, y, w: 1.4, h: 1.4 }),
  box(x + 0.32, y + 0.32, 0.72, 0.72, color),
  box(x - 0.25, y + 1.62, 1.9, 0.34, light),
];

/** The pointer. */
const pointer = (x: number, y: number, size = 1): Shape => ({
  t: 'poly',
  fill: light,
  stroke: { color: dark, width: 0.07, join: 'miter' },
  pts: (
    [
      [0, 0],
      [0, 1.05],
      [0.26, 0.82],
      [0.46, 1.26],
      [0.64, 1.18],
      [0.44, 0.75],
      [0.78, 0.75],
    ] as const
  ).map(([px, py]) => [x + px * size, y + py * size] as const),
});

const etched = (x: number, y: number, length: number, vertical = false): Shape[] =>
  vertical
    ? [box(x, y, B, length, shade), box(x + B, y, B, length, light)]
    : [box(x, y, length, B, shade), box(x, y + B, length, B, light)];

const list = [
  'Jedes Programm bekommt sein eigenes Fenster',
  'Die Maus ersetzt das Auswendiglernen',
  'Ordner sehen endlich aus wie Ordner',
  'Speichern nicht vergessen',
  'Und abends: ordentlich herunterfahren',
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: face,
    shapes: [
      ...desktop(),
      ...item(1.3, 1.2, yellow),
      ...item(1.3, 4, indigo),
      ...item(1.3, 6.8, red),
      ...win({ x: 12.6, y: 1.2, w: 13.8, h: 8 }, idle),
      ...sunken({ x: 13, y: 2.6, w: 13, h: 6.2 }),
      ...win({ x: 4.6, y: 3.2, w: 19.4, h: 9.8 }),
      ...sunken({ x: 5.5, y: 10.2, w: 13, h: 1.7 }),
      ...button({ x: 19.2, y: 10.4, w: 3.7, h: 1.3 }, '→', true),
      pointer(21.7, 11.2),
      ...taskbar(2),
    ],
    title: {
      x: 5.5,
      y: 4.7,
      w: 17.6,
      h: 5,
      size: 46,
      valign: 'middle',
      sample: 'Willkommen\nam Schreibtisch',
    },
    subtitle: {
      x: 5.9,
      y: 10.2,
      w: 12.4,
      h: 1.7,
      valign: 'middle',
      sample: 'Eine Einführung in 9 Fenstern',
    },
  },
  {
    name: 'Abschnitt',
    bg: face,
    shapes: [
      ...desktop(),
      ...win({ x: 2.6, y: 1.3, w: 18.4, h: 8.8 }, idle),
      ...win({ x: 3.7, y: 2.4, w: 18.4, h: 8.8 }, idle),
      ...win({ x: 4.8, y: 3.5, w: 18.4, h: 8.8 }, idle),
      ...win({ x: 5.9, y: 4.6, w: 18.4, h: 8.8 }),
      ...raised({ x: 6.9, y: 6.5, w: 2.3, h: 2.3 }),
      {
        t: 'poly',
        fill: yellow,
        stroke: { color: dark, width: 0.07, join: 'miter' },
        pts: [
          [8.05, 6.85],
          [8.85, 7.65],
          [8.05, 8.45],
          [7.25, 7.65],
        ],
      },
      ...etched(6.3, 11.25, 17.6),
      ...button({ x: 19.9, y: 11.7, w: 3.6, h: 1.2 }, '✓', true),
      ...button({ x: 15.9, y: 11.7, w: 3.6, h: 1.2 }),
      pointer(22.4, 12.5),
      ...taskbar(3),
    ],
    title: {
      x: 9.9,
      y: 6,
      w: 13.6,
      h: 3.4,
      size: 36,
      valign: 'middle',
      sample: 'Kapitel 2:\nDateien und Ordner',
    },
    subtitle: {
      x: 9.9,
      y: 9.5,
      w: 13.6,
      h: 1.5,
      valign: 'middle',
      sample: 'Alles hat seinen Platz',
    },
  },
  {
    name: 'Inhalt',
    bg: face,
    shapes: [
      ...desktop(),
      ...win({ x: 1.2, y: 0.8, w: 25.6, h: 13.2 }, indigo, 1.6),
      box(1.75, 1.6, 0.45, 0.45, light),
      ...sunken({ x: 1.5, y: 2.9, w: 23.9, h: 10.8 }),
      // The scroll bar.
      box(25.5, 2.9, 1, 10.8, '#dfe2e7'),
      ...raised({ x: 25.5, y: 2.9, w: 1, h: 1 }),
      ...raised({ x: 25.5, y: 12.7, w: 1, h: 1 }),
      ...raised({ x: 25.5, y: 4.3, w: 1, h: 3.4 }),
      ...taskbar(1),
    ],
    title: {
      x: 2.5,
      y: 1.02,
      w: 19.6,
      h: 1.6,
      size: 26,
      color: light,
      valign: 'middle',
      sample: 'So arbeitet man mit Fenstern',
    },
    body: { x: 2.2, y: 3.5, w: 22.4, h: 9.8, sample: list },
  },
  {
    name: 'Text und Bild',
    bg: face,
    shapes: [
      ...desktop(),
      ...win({ x: 12, y: 0.9, w: 14.8, h: 12.9 }),
      ...etched(14.4, 5.5, 11.4),
      ...win({ x: 1.2, y: 2.3, w: 12.4, h: 11.8 }, plum),
      ...sunken({ x: 1.55, y: 3.65, w: 11.7, h: 10.1 }, shade),
      ...taskbar(2),
    ],
    pictures: [{ x: 1.69, y: 3.79, w: 11.42, h: 9.82 }],
    title: {
      x: 14.4,
      y: 2.3,
      w: 11.4,
      h: 3,
      size: 27,
      valign: 'bottom',
      sample: 'Bilder ansehen leicht gemacht',
    },
    body: {
      x: 14.4,
      y: 6,
      w: 11.6,
      h: 7.4,
      size: 19,
      sample: ['256 Farben genügen', 'Ein Doppelklick öffnet', 'Die Lupe vergrößert'],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: face,
    shapes: [
      ...desktop(),
      ...raised({ x: 1.2, y: 0.8, w: 25.6, h: 2.6 }),
      ...sunken({ x: 1.5, y: 1.1, w: 25, h: 2 }),
      ...win({ x: 1.2, y: 3.9, w: 12.5, h: 10.2 }, indigo, 0.9),
      ...sunken({ x: 1.5, y: 5.15, w: 11.9, h: 8.65 }),
      ...win({ x: 14.3, y: 3.9, w: 12.5, h: 10.2 }, plum, 0.9),
      ...sunken({ x: 14.6, y: 5.15, w: 11.9, h: 8.65 }),
      ...taskbar(2),
    ],
    title: {
      x: 2,
      y: 1.1,
      w: 24,
      h: 2,
      size: 28,
      valign: 'middle',
      sample: 'Tastatur oder Maus?',
    },
    body: [
      {
        x: 2,
        y: 5.6,
        w: 10.9,
        h: 7.9,
        size: 19,
        sample: ['Schnell, wenn man es kann', 'Kürzel statt Menüs', 'Hände bleiben liegen'],
      },
      {
        x: 15.1,
        y: 5.6,
        w: 10.9,
        h: 7.9,
        size: 19,
        sample: ['Leicht zu lernen', 'Zeigen statt tippen', 'Braucht Platz am Tisch'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: face,
    shapes: [
      ...desktop(),
      ...item(1.1, 1.2, green),
      ...win({ x: 3.6, y: 1.4, w: 22.6, h: 12.2 }),
      ...etched(15.9, 3.4, 5.6, true),
      // Progress: blocks filling a field.
      ...sunken({ x: 4.5, y: 9.6, w: 20.8, h: 1.5 }),
      ...Array.from({ length: 16 }, (_, i) => box(4.78 + i * 0.94, 9.86, 0.78, 0.98, indigo)),
      ...button({ x: 21.4, y: 11.75, w: 3.9, h: 1.2 }, undefined, true),
      ...button({ x: 17.1, y: 11.75, w: 3.9, h: 1.2 }),
      box(22.35, 12.25, 2, 0.2, dark),
      box(18.05, 12.25, 2, 0.2, shade),
      pointer(24, 12.5),
      ...taskbar(1),
    ],
    title: {
      x: 4.4,
      y: 3,
      w: 11.2,
      h: 6.2,
      size: 116,
      color: indigo,
      align: 'center',
      valign: 'middle',
      sample: '640',
    },
    body: {
      x: 16.6,
      y: 3.2,
      w: 8.8,
      h: 6,
      size: 22,
      valign: 'middle',
      sample: 'Kilobyte Arbeitsspeicher – mehr braucht doch wirklich niemand.',
    },
  },
  {
    name: 'Zitat',
    bg: face,
    shapes: [
      ...desktop(),
      ...win({ x: 2, y: 1, w: 22.4, h: 10 }, idle),
      ...win({ x: 3.3, y: 2.1, w: 22.6, h: 11.8 }),
      ...sunken({ x: 3.6, y: 3.45, w: 22, h: 8.4 }),
      ...sunken({ x: 3.6, y: 12.05, w: 15.6, h: 1.5 }, face),
      ...sunken({ x: 19.4, y: 12.05, w: 3, h: 1.5 }, face),
      ...sunken({ x: 22.6, y: 12.05, w: 3, h: 1.5 }, face),
      {
        t: 'text',
        x: 4,
        y: 3.3,
        w: 3,
        h: 4,
        text: '“',
        font: 'IBM Plex Sans',
        bold: true,
        size: 130,
        color: indigo,
        valign: 'top',
      },
      box(24.3, 4.4, 0.12, 1.3, ink),
      ...taskbar(2),
    ],
    body: {
      x: 7.2,
      y: 4,
      w: 16.8,
      h: 7.4,
      font: 'IBM Plex Mono',
      size: 28,
      lineHeight: 122,
      valign: 'middle',
      sample: 'Ein Rechner tut, was man ihm sagt. Das ist selten das, was man meint.',
    },
    subtitle: {
      x: 4,
      y: 12.05,
      w: 14.9,
      h: 1.5,
      valign: 'middle',
      sample: 'Herr Brandt, Rechenzentrum',
    },
  },
  {
    name: 'Bild',
    bg: face,
    shapes: [
      ...desktop(),
      ...win({ x: 1.2, y: 0.7, w: 25.6, h: 13.5 }, plum),
      ...sunken({ x: 1.5, y: 2.05, w: 25, h: 10.1 }, shade),
      ...sunken({ x: 1.5, y: 12.35, w: 18.6, h: 1.55 }, face),
      ...sunken({ x: 20.3, y: 12.35, w: 3, h: 1.55 }, face),
      ...sunken({ x: 23.5, y: 12.35, w: 3, h: 1.55 }, face),
      box(21, 13.02, 1.6, 0.2, shade),
      box(24.2, 13.02, 1.6, 0.2, shade),
      ...taskbar(1),
    ],
    pictures: [{ x: 1.64, y: 2.19, w: 24.72, h: 9.82 }],
    title: {
      x: 1.95,
      y: 12.35,
      w: 17.8,
      h: 1.55,
      size: 22,
      valign: 'middle',
      sample: 'Der neue Rechner im Büro, 1994',
    },
  },
  {
    name: 'Schluss',
    bg: face,
    shapes: [
      ...desktop(true),
      ...win({ x: 4.6, y: 2.6, w: 18.8, h: 10.5 }),
      ...etched(5.1, 9.6, 17.8),
      ...button({ x: 9.2, y: 10.4, w: 9.6, h: 1.7 }, undefined, true),
      pointer(19.4, 11.4),
    ],
    title: {
      x: 5.6,
      y: 4.2,
      w: 16.8,
      h: 5,
      size: 54,
      align: 'center',
      valign: 'middle',
      sample: 'Herunterfahren?',
    },
    subtitle: {
      x: 9.4,
      y: 10.4,
      w: 9.2,
      h: 1.7,
      align: 'center',
      valign: 'middle',
      sample: 'Danke, bis morgen',
    },
  },
];

const template: Template = {
  slug: 'retro-desktop',
  name: 'Retro-Desktop',
  group: 'Designtrend',
  tags: ['Retro', 'Desktop', 'Neunziger', 'Fenster', 'Computer', 'Pixel', 'Nostalgie', 'Technik'],
  description:
    'Ein Bildschirm der Neunziger: graue Fenster mit Kanten aus Licht und Schatten, farbige Titelleisten, gerastertes Petrol.',
  palette: {
    bg: light,
    text: ink,
    bg2: face,
    text2: '#5b606b',
    accents: [indigo, teal, yellow, red, plum, orange],
  },
  fonts: { head: 'IBM Plex Sans', body: 'IBM Plex Sans' },
  text: {
    title: { font: 'IBM Plex Sans', size: 30, color: ink, bold: true, lineHeight: 104 },
    subtitle: { font: 'IBM Plex Mono', size: 18, color: ink },
    body: { font: 'IBM Plex Sans', size: 22, color: ink, lineHeight: 118, paraSpace: 0.36 },
  },
  layouts,
};

export default template;
