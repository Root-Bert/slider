import type { Box, Color, Layout, Shape, Slot, Template } from '../model';

/*
 * Architektur: an architect's presentation – white and concrete grey, very thin black lines,
 * tall spaced capitals. The ornament is drawn as on a plan: walls and door swings, dimension
 * lines with their small slashes, one red section line, and concrete with its formwork joints.
 */

const black = '#141414';
const white = '#ffffff';
const concrete = '#cfccc5';
const pale = '#eceae5';
const stone = '#6d6a65';
const dark = '#8a8780';
const joint = '#b9b6ae';
const red = '#c8442e';
const sand = '#d8cdb8';
const steel = '#8fa0a8';

const L = 1.6;
const R = 26.4;

const ln = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Color = black,
  width = 0.02,
): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: { color, width },
});

/** The slash where a dimension line meets what it measures. */
const slash = (x: number, y: number, color: Color = black): Shape =>
  ln(x - 0.14, y + 0.14, x + 0.14, y - 0.14, color, 0.05);

/** A horizontal dimension line from `x1` to `x2`, with further marks between. */
function dimH(
  x1: number,
  x2: number,
  y: number,
  marks: readonly number[] = [],
  color: Color = black,
): Shape[] {
  return [
    ln(x1 - 0.3, y, x2 + 0.3, y, color),
    ...[x1, ...marks, x2].flatMap((x) => [ln(x, y - 0.4, x, y + 0.22, color), slash(x, y, color)]),
  ];
}

/** A vertical dimension line from `y1` to `y2`; its witness lines point to `side` (1 right, -1 left). */
function dimV(
  x: number,
  y1: number,
  y2: number,
  marks: readonly number[] = [],
  side: 1 | -1 = 1,
  color: Color = black,
): Shape[] {
  return [
    ln(x, y1 - 0.3, x, y2 + 0.3, color),
    ...[y1, ...marks, y2].flatMap((y) => [
      ln(x - 0.22 * side, y, x + 0.4 * side, y, color),
      slash(x, y, color),
    ]),
  ];
}

/** A quarter circle: a door's swing round its hinge. Angles counter-clockwise from 3 o'clock. */
const swing = (
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  color: Color = black,
): Shape => ({
  t: 'ellipse',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  kind: 'arc',
  start,
  end,
  fill: null,
  stroke: { color, width: 0.02 },
});

/** The red section line: dashed, an arrow head at each end showing where one looks. */
function section(x1: number, y1: number, x2: number, y2: number): Shape[] {
  const vertical = x1 === x2;
  const head = (x: number, y: number): Shape =>
    vertical
      ? {
          t: 'poly',
          fill: red,
          pts: [
            [x, y - 0.2],
            [x, y + 0.2],
            [x + 0.42, y],
          ],
        }
      : {
          t: 'poly',
          fill: red,
          pts: [
            [x - 0.2, y],
            [x + 0.2, y],
            [x, y - 0.42],
          ],
        };
  return [
    { t: 'line', x1, y1, x2, y2, stroke: { color: red, width: 0.035, dash: [0.55, 0.16] } },
    head(x1, y1),
    head(x2, y2),
  ];
}

/** Fair-faced concrete: a field with its formwork joints and the tie holes of each panel. */
function formwork(
  box: Box,
  across: number,
  down: number,
  fill: Color = concrete,
  line: Color = joint,
): Shape[] {
  const [w, h] = [box.w / across, box.h / down];
  const shapes: Shape[] = [{ t: 'rect', ...box, fill }];
  for (let i = 1; i < across; i += 1)
    shapes.push(ln(box.x + i * w, box.y, box.x + i * w, box.y + box.h, line, 0.025));
  for (let j = 1; j < down; j += 1)
    shapes.push(ln(box.x, box.y + j * h, box.x + box.w, box.y + j * h, line, 0.025));
  for (let i = 0; i < across; i += 1) {
    for (let j = 0; j < down; j += 1) {
      for (const [u, v] of [
        [0.2, 0.25],
        [0.8, 0.25],
        [0.2, 0.75],
        [0.8, 0.75],
      ] as const) {
        shapes.push({
          t: 'ellipse',
          x: box.x + (i + u) * w - 0.07,
          y: box.y + (j + v) * h - 0.07,
          w: 0.14,
          h: 0.14,
          fill: '#a29e95',
        });
      }
    }
  }
  return shapes;
}

/** An abstract floor plan: outer and inner walls, windows, three doors, a stair, its axes. */
function plan(ox: number, oy: number, u: number, color: Color = black): Shape[] {
  const X = (x: number) => ox + x * u;
  const Y = (y: number) => oy + y * u;
  const wall = (x1: number, y1: number, x2: number, y2: number, width = 0.16): Shape => ({
    t: 'line',
    x1: X(x1),
    y1: Y(y1),
    x2: X(x2),
    y2: Y(y2),
    stroke: { color, width, cap: 'square' },
  });
  const fine = (x1: number, y1: number, x2: number, y2: number): Shape =>
    ln(X(x1), Y(y1), X(x2), Y(y2), color);
  const windowH = (x1: number, x2: number, y: number): Shape[] => [
    ln(X(x1), Y(y) - 0.07, X(x2), Y(y) - 0.07, color),
    ln(X(x1), Y(y) + 0.07, X(x2), Y(y) + 0.07, color),
    ln(X((x1 + x2) / 2), Y(y) - 0.07, X((x1 + x2) / 2), Y(y) + 0.07, color),
  ];
  const axes = [0, 4, 6.5, 10];
  const levels = [0, 4.5, 7];
  return [
    // Axes with their bubbles, and the dimension chain along them.
    ...axes.flatMap((x): Shape[] => [
      {
        t: 'line',
        x1: X(x),
        y1: Y(-2.05),
        x2: X(x),
        y2: Y(7.5),
        stroke: { color: joint, width: 0.02, dash: [0.5, 0.14] },
      },
      {
        t: 'ellipse',
        x: X(x) - 0.3,
        y: Y(-2.05) - 0.6,
        w: 0.6,
        h: 0.6,
        fill: null,
        stroke: { color, width: 0.02 },
      },
    ]),
    ...levels.flatMap((y): Shape[] => [
      {
        t: 'line',
        x1: X(-1.6),
        y1: Y(y),
        x2: X(10.5),
        y2: Y(y),
        stroke: { color: joint, width: 0.02, dash: [0.5, 0.14] },
      },
      {
        t: 'ellipse',
        x: X(-1.6) - 0.6,
        y: Y(y) - 0.3,
        w: 0.6,
        h: 0.6,
        fill: null,
        stroke: { color, width: 0.02 },
      },
    ]),
    ...dimH(X(0), X(10), Y(-0.95), [X(4), X(6.5)], color),
    ...dimV(X(-0.8), Y(0), Y(7), [Y(4.5)], 1, color),
    // Outer walls, open where a window or the entrance sits.
    wall(0, 0, 1.6, 0),
    ...windowH(1.6, 3.2, 0),
    wall(3.2, 0, 5.2, 0),
    ...windowH(5.2, 8.8, 0),
    wall(8.8, 0, 10, 0),
    wall(10, 0, 10, 4.5),
    wall(10, 4.5, 8.7, 4.5),
    wall(7.6, 4.5, 6.5, 4.5),
    wall(6.5, 4.5, 6.5, 7),
    wall(6.5, 7, 4.3, 7),
    ...windowH(1.5, 4.3, 7),
    wall(1.5, 7, 0, 7),
    wall(0, 7, 0, 0),
    // Inner walls.
    wall(4, 0, 4, 2.1, 0.09),
    wall(4, 3.1, 4, 4.5, 0.09),
    wall(0, 4.5, 2.3, 4.5, 0.09),
    wall(3.3, 4.5, 5.1, 4.5, 0.09),
    // Doors: the leaf and its swing.
    fine(7.6, 4.5, 7.6, 3.4),
    swing(X(7.6), Y(4.5), 1.1 * u, 0, 90, color),
    fine(4, 2.1, 3, 2.1),
    swing(X(4), Y(2.1), 1 * u, 180, 270, color),
    fine(2.3, 4.5, 2.3, 5.5),
    swing(X(2.3), Y(4.5), 1 * u, 270, 360, color),
    // The stair, its steps and the line of walking.
    ...Array.from({ length: 9 }, (_, index) =>
      fine(4.1 + index * 0.25, 5.1, 4.1 + index * 0.25, 6.4),
    ),
    fine(4.1, 5.1, 6.1, 5.1),
    fine(4.1, 6.4, 6.1, 6.4),
    fine(4.25, 5.75, 5.95, 5.75),
    fine(5.95, 5.75, 5.75, 5.6),
    fine(5.95, 5.75, 5.75, 5.9),
    // What stands in the rooms.
    {
      t: 'rect',
      x: X(0.5),
      y: Y(0.55),
      w: 1.9 * u,
      h: 1.5 * u,
      fill: null,
      stroke: { color, width: 0.02 },
    },
    {
      t: 'rect',
      x: X(5.6),
      y: Y(1.5),
      w: 2.6 * u,
      h: 1.1 * u,
      fill: null,
      stroke: { color, width: 0.02 },
    },
    {
      t: 'ellipse',
      x: X(8.7),
      y: Y(1.7),
      w: 0.7 * u,
      h: 0.7 * u,
      fill: null,
      stroke: { color, width: 0.02 },
    },
  ];
}

/** The head of a content page: the title measured by a dimension line. */
const frame = (marks: readonly number[] = []): Shape[] => [
  ...dimH(L, R, 4.35, marks),
  ln(L, 14.4, R, 14.4, joint, 0.02),
  { t: 'rect', x: L, y: 14.4, w: 0.9, h: 0.14, fill: black },
];

const title: Slot = { x: L, y: 1.2, w: 22, h: 2.6, valign: 'bottom' };

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: white,
    shapes: [
      ...plan(15.4, 5.2, 1.05),
      ...section(13.4, 8.05, 27, 8.05),
      { t: 'rect', x: L, y: 10.55, w: 0.9, h: 0.14, fill: black },
      ln(L, 10.62, 11.6, 10.62),
    ],
    title: {
      x: L,
      y: 4.4,
      w: 11,
      h: 5.8,
      size: 38,
      valign: 'bottom',
      lineHeight: 104,
      sample: 'Wohnen\nam Hang',
    },
    subtitle: {
      x: L,
      y: 11.1,
      w: 10.5,
      h: 2.6,
      sample: 'Neubau eines Wohnhauses\nEntwurf, Stand März 2027',
    },
  },
  {
    name: 'Abschnitt',
    bg: pale,
    shapes: [
      // An elevation: the house on its ground, a tree, the cut through it.
      ...Array.from({ length: 40 }, (_, index) =>
        ln(14.6 + index * 0.35, 13, 14.9 + index * 0.35, 12.7, dark, 0.02),
      ),
      {
        t: 'rect',
        x: 17.4,
        y: 5.6,
        w: 7,
        h: 7,
        fill: white,
        stroke: { color: black, width: 0.05 },
      },
      { t: 'rect', x: 17, y: 5.3, w: 7.8, h: 0.32, fill: black },
      ln(17.4, 9.1, 24.4, 9.1),
      ...[18.2, 20.25, 22.3].map((x): Shape => ({
        t: 'rect',
        x,
        y: 6.4,
        w: 1.4,
        h: 1.9,
        fill: pale,
        stroke: { color: black, width: 0.02 },
      })),
      {
        t: 'rect',
        x: 18.2,
        y: 9.8,
        w: 3.6,
        h: 2.8,
        fill: pale,
        stroke: { color: black, width: 0.02 },
      },
      ln(19.4, 9.8, 19.4, 12.6),
      ln(20.6, 9.8, 20.6, 12.6),
      {
        t: 'rect',
        x: 22.6,
        y: 10.2,
        w: 1.1,
        h: 2.4,
        fill: null,
        stroke: { color: black, width: 0.02 },
      },
      {
        t: 'ellipse',
        x: 25.1,
        y: 8.3,
        w: 2.5,
        h: 2.5,
        fill: null,
        stroke: { color: black, width: 0.02 },
      },
      {
        t: 'ellipse',
        x: 25.6,
        y: 9.1,
        w: 1.3,
        h: 1.3,
        fill: null,
        stroke: { color: black, width: 0.02 },
      },
      ln(26.35, 10.8, 26.35, 12.6),
      { t: 'line', x1: 14.2, y1: 12.6, x2: 28, y2: 12.6, stroke: { color: black, width: 0.09 } },
      ...dimV(16.2, 5.3, 12.6, [9.1]),
      ...section(21.1, 3.4, 21.1, 13.8),
      { t: 'rect', x: L, y: 9.55, w: 0.9, h: 0.14, fill: black },
      ln(L, 9.62, 13, 9.62),
    ],
    title: {
      x: L,
      y: 3.6,
      w: 12,
      h: 5.6,
      size: 38,
      valign: 'bottom',
      lineHeight: 104,
      sample: 'Schnitt und\nAnsichten',
    },
    subtitle: {
      x: L,
      y: 10.1,
      w: 11.4,
      h: 2.4,
      sample: 'Wie das Haus in den Hang greift',
    },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: frame([9.9]),
    title: { ...title, sample: 'Drei Ebenen folgen dem Gelände' },
    body: {
      x: L,
      y: 5.1,
      w: 22.5,
      h: 8.8,
      sample: [
        'Eingang und Garage auf Straßenniveau',
        'Wohnen und Kochen eine halbe Treppe tiefer',
        'Schlafräume im Gartengeschoss, direkt am Hang',
        'Sichtbeton innen, Lärchenholz an der Fassade',
        'Wärmepumpe mit Erdsonden, kein Gasanschluss',
        'Wohnfläche 186 m², Grundstück 640 m²',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [
      ...dimV(1.75, 1.5, 12.9, [], 1),
      ...dimH(2.6, 15.2, 13.75, [6.8]),
      ...dimH(16.6, R, 5.6),
      ln(16.6, 14.4, R, 14.4, joint, 0.02),
      { t: 'rect', x: 16.6, y: 14.4, w: 0.9, h: 0.14, fill: black },
    ],
    pictures: [{ x: 2.6, y: 1.5, w: 12.6, h: 11.4 }],
    title: {
      x: 16.6,
      y: 1.2,
      w: 9.8,
      h: 3.9,
      size: 22,
      valign: 'bottom',
      sample: 'Der Wohnraum öffnet sich zum Tal',
    },
    body: {
      x: 16.6,
      y: 6.3,
      w: 9.8,
      h: 7.6,
      size: 18,
      sample: [
        'Verglasung über die ganze Breite',
        'Raumhöhe 3,20 Meter',
        'Terrasse als Verlängerung des Bodens',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      ...frame([13.55, 14.45]),
      { t: 'rect', x: L, y: 5.3, w: 3.2, h: 0.16, fill: black },
      ln(L, 5.38, 13.55, 5.38),
      { t: 'rect', x: 14.45, y: 5.3, w: 3.2, h: 0.16, fill: concrete },
      ln(14.45, 5.38, R, 5.38),
      {
        t: 'line',
        x1: 14,
        y1: 4.9,
        x2: 14,
        y2: 13.9,
        stroke: { color: joint, width: 0.02, dash: [0.5, 0.14] },
      },
    ],
    title: { ...title, sample: 'Zwei Varianten für das Dach' },
    body: [
      {
        x: L,
        y: 6,
        w: 11.6,
        h: 7.9,
        sample: ['Flachdach, begrünt', 'Hält Regenwasser zurück', 'Niedrigere Bauhöhe am Hang'],
      },
      {
        x: 14.45,
        y: 6,
        w: 11.6,
        h: 7.9,
        sample: [
          'Pultdach mit Photovoltaik',
          'Deckt 70 % des Strombedarfs',
          'Ein Geschoss mehr Raumhöhe',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: white,
    shapes: [
      ...formwork({ x: 18.4, y: 0, w: 9.6, h: 15.75 }, 2, 4),
      ...dimV(17.5, 1.5, 14.25, [5.75, 10]),
      ...dimH(L, 15.4, 9.75),
      { t: 'rect', x: L, y: 14.4, w: 0.9, h: 0.14, fill: black },
      ln(L, 14.4, 15.4, 14.4, joint, 0.02),
    ],
    title: {
      x: L,
      y: 2.2,
      w: 14.6,
      h: 6.9,
      size: 112,
      valign: 'bottom',
      lineHeight: 100,
      upper: false,
      spacing: 0,
      sample: '186 m²',
    },
    body: {
      x: L,
      y: 10.5,
      w: 13.8,
      h: 3.5,
      sample: 'Wohnfläche auf drei Ebenen, jede mit eigenem Zugang zum Garten',
    },
  },
  {
    name: 'Zitat',
    bg: pale,
    shapes: [
      ...dimV(3.4, 2.6, 10, [], -1),
      ...section(5.2, 11, 16, 11).slice(0, 1),
      {
        t: 'poly',
        fill: red,
        pts: [
          [5.2, 10.8],
          [5.2, 11.2],
          [5.62, 11],
        ],
      },
      ...formwork({ x: 22.6, y: 11.35, w: 5.4, h: 4.4 }, 2, 2),
    ],
    body: {
      x: 5.2,
      y: 2.4,
      w: 19.6,
      h: 7.8,
      font: 'Jost',
      size: 30,
      lineHeight: 112,
      valign: 'middle',
      sample:
        'Ein Haus am Hang muss nicht gegen den Berg gebaut werden. Es darf sich an ihn lehnen.',
    },
    subtitle: {
      x: 5.2,
      y: 11.5,
      w: 16,
      h: 1.6,
      upper: true,
      size: 14,
      spacing: 1.6,
      sample: 'Jonas Reuter, Architekt',
    },
  },
  {
    name: 'Bild',
    bg: white,
    shapes: [
      ...dimV(1.75, 1.4, 11.9, [], 1),
      ...dimH(2.6, R, 12.8, [10.53, 18.47]),
      { t: 'rect', x: 2.6, y: 14.4, w: 0.9, h: 0.14, fill: black },
      ln(2.6, 14.4, R, 14.4, joint, 0.02),
    ],
    pictures: [{ x: 2.6, y: 1.4, w: 23.8, h: 10.5 }],
    title: {
      x: 2.6,
      y: 13.1,
      w: 22,
      h: 1.2,
      size: 16,
      valign: 'middle',
      sample: 'Ansicht von Süden, Modellfoto',
    },
  },
  {
    name: 'Schluss',
    bg: concrete,
    shapes: [
      ...formwork({ x: 0, y: 0, w: 28, h: 15.75 }, 4, 3),
      { t: 'rect', x: L, y: 2.2, w: 13.4, h: 11.35, fill: white },
      ...dimH(L, 15, 14.3, [], black),
      ...dimV(15.9, 2.2, 13.55, [], -1, black),
      { t: 'rect', x: 2.7, y: 8.45, w: 0.9, h: 0.14, fill: black },
      ln(2.7, 8.52, 13.9, 8.52),
    ],
    title: {
      x: 2.7,
      y: 3.2,
      w: 11.2,
      h: 4.9,
      size: 38,
      valign: 'bottom',
      lineHeight: 104,
      sample: 'Vielen\nDank',
    },
    subtitle: {
      x: 2.7,
      y: 9,
      w: 11.2,
      h: 3.4,
      sample: 'Reuter Architekten\nbuero@reuter-beispiel.de',
    },
  },
];

const template: Template = {
  slug: 'architektur',
  name: 'Architektur',
  group: 'Bereich',
  tags: ['Architektur', 'Entwurf', 'Bauen', 'Plan', 'Beton', 'Linien', 'reduziert', 'Wettbewerb'],
  description:
    'Die Präsentation eines Architekturbüros: Weiß und Betongrau, haarfeine schwarze Linien, Grundriss, Maßketten und eine rote Schnittlinie.',
  palette: {
    bg: white,
    text: black,
    bg2: pale,
    text2: stone,
    accents: [concrete, red, dark, joint, sand, steel],
  },
  fonts: { head: 'Jost', body: 'Inter' },
  text: {
    title: { font: 'Jost', size: 26, color: black, upper: true, spacing: 2.2, lineHeight: 106 },
    subtitle: { font: 'Inter', size: 16, color: stone, lineHeight: 130 },
    body: { font: 'Inter', size: 20, color: black, lineHeight: 112, paraSpace: 0.32 },
  },
  layouts,
};

export default template;
