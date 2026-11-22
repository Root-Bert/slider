import { darken, jpeg, lighten, noise, paint, rgb } from '../art';
import type { Box, Color, Fill, Layout, Picture, Shape, Template } from '../model';
import { PAGE } from '../model';
import { disc, page } from '../shapes';

/*
 * Skeuomorph, around 2010: the screen pretends to be a desk. Stitched leather, linen, wood,
 * brushed metal plates held by screws, paper with a shadow under it, buttons of glossy glass.
 * The three materials of the ground are painted (noise, no photos); everything on them is drawn
 * with gradients, highlights and shadows.
 */

const paperTone = '#f7f0df';
const brown = '#3a2616';
const umber = '#7a6248';
const hide = '#6b3f22';
const tan = '#b9824a';
const red = '#b3272d';
const blue = '#2f6fb5';
const brass = '#c79a3c';
const moss = '#5f7f3a';
const cream = '#f6ecd6';
const steel = '#2f3237';

// ── The grounds ────────────────────────────────────────────────────────────────────────────

const TEXTURE_PX = 1440 / PAGE.w;

/** A whole-page texture: `shade` says how light each pixel of `color` is (1 = as it is). */
function texture(color: Color, shade: (x: number, y: number) => number, vignette = 0.3): Picture {
  const surface = paint(PAGE, TEXTURE_PX);
  const { ctx, w, h } = surface;
  const [r, g, b] = rgb(color);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [u, v] = [(x / w) * 2 - 1, (y / h) * 2 - 1];
      const light = shade(x, y) * (1 - vignette * (u * u * 0.5 + v * v * 0.5));
      const i = (y * w + x) * 4;
      image.data[i] = r * light;
      image.data[i + 1] = g * light;
      image.data[i + 2] = b * light;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return jpeg(surface, 78);
}

const leather = (() => {
  const [pebble, cloud] = [noise(11), noise(12)];
  return texture(
    hide,
    (x, y) => {
      const crease = 1 - Math.abs(pebble(x / 5.5, y / 5.5, 3) - 0.5) * 2;
      return 0.98 + (cloud(x / 170, y / 170, 3) - 0.5) * 0.3 - crease ** 5 * 0.34;
    },
    0.5,
  );
})();

const linen = (() => {
  const [warp, weft, cloud] = [noise(21), noise(22), noise(23)];
  return texture(
    '#cfc5b0',
    (x, y) =>
      0.98 +
      (warp(x / 1.25, y / 18, 2) - 0.5) * 0.2 +
      (weft(x / 18, y / 1.25, 2) - 0.5) * 0.2 +
      (cloud(x / 220, y / 220, 2) - 0.5) * 0.08,
    0.22,
  );
})();

const wood = (() => {
  const [bend, fibre, tone] = [noise(31), noise(32), noise(33)];
  const plank = 3.9375 * TEXTURE_PX;
  return texture(
    '#8f5c33',
    (x, y) => {
      const row = Math.floor(y / plank);
      const [px, py] = [x + row * 517, y + row * 91];
      const ring = Math.sin(py / 6.5 + bend(px / 260, py / 46, 3) * 16) * 0.5 + 0.5;
      const seam = y % plank < 2.2 ? 0.55 : y % plank < 4 ? 1.12 : 1;
      return (
        (0.86 +
          ring * 0.13 +
          (fibre(px / 90, py / 1.6, 2) - 0.5) * 0.22 +
          (tone(row * 3.3, 0.5, 1) - 0.5) * 0.16) *
        seam
      );
    },
    0.35,
  );
})();

const ground = (src: Picture): Shape => ({ t: 'image', ...page, src });

// ── The things on the desk ─────────────────────────────────────────────────────────────────

const down = (stops: Fill & { t: 'linear' }): Fill => stops;
const fall = (...stops: (readonly [number, Color])[]): Fill =>
  down({ t: 'linear', angle: 180, stops });

/** A sheet of paper lying on the ground. */
const paper = (box: Box, lift = 1, tone: Color = paperTone): Shape[] => [
  {
    t: 'rect',
    ...box,
    r: 0.1,
    fill: fall([0, lighten(tone, 0.35)], [1, darken(tone, 0.05)]),
    stroke: { color: darken(tone, 0.22), width: 0.02 },
    shadow: { dx: 0.04, dy: 0.12 + lift * 0.1, blur: 0.25 + lift * 0.2, opacity: 0.55 },
  },
];

/** A seam: the thread, and the dent it pulls into the leather. */
const seam = (box: Box, r = 0.3, thread: Color = '#ecdcb6'): Shape[] => [
  {
    t: 'rect',
    ...box,
    r,
    fill: null,
    stroke: { color: '#000000', width: 0.13, opacity: 0.28 },
  },
  {
    t: 'rect',
    x: box.x,
    y: box.y - 0.02,
    w: box.w,
    h: box.h,
    r,
    fill: null,
    stroke: { color: thread, width: 0.065, dash: [0.3, 0.2], cap: 'round' },
  },
];

const seamLine = (x: number, y: number, length: number, thread: Color = '#ecdcb6'): Shape[] => [
  {
    t: 'line',
    x1: x,
    y1: y + 0.02,
    x2: x + length,
    y2: y + 0.02,
    stroke: { color: '#000000', width: 0.13, opacity: 0.28 },
  },
  {
    t: 'line',
    x1: x,
    y1: y,
    x2: x + length,
    y2: y,
    stroke: { color: thread, width: 0.065, dash: [0.3, 0.2], cap: 'round' },
  },
];

/** A piece of leather sewn on: lighter than the ground, with its seam. */
const patch = (box: Box, color: Color = '#8a5530', r = 0.25): Shape[] => [
  {
    t: 'rect',
    ...box,
    r,
    fill: fall([0, lighten(color, 0.14)], [1, darken(color, 0.2)]),
    stroke: { color: darken(color, 0.45), width: 0.03 },
    shadow: { dx: 0, dy: 0.16, blur: 0.3, opacity: 0.6 },
  },
  {
    t: 'rect',
    x: box.x + 0.04,
    y: box.y + 0.04,
    w: box.w - 0.08,
    h: box.h - 0.08,
    r,
    fill: null,
    stroke: { color: '#ffffff', width: 0.025, opacity: 0.22 },
  },
  ...seam(
    { x: box.x + 0.25, y: box.y + 0.25, w: box.w - 0.5, h: box.h - 0.5 },
    Math.max(0.05, r - 0.1),
  ),
];

const STEEL = [
  [0, '#f6f7f8'],
  [0.2, '#c6c9cd'],
  [0.5, '#e9ebed'],
  [0.82, '#aeb2b7'],
  [1, '#d2d5d8'],
] as const;
const BRASS = [
  [0, '#f8e7ad'],
  [0.22, '#cfa348'],
  [0.5, '#f0d68c'],
  [0.82, '#a87b2a'],
  [1, '#d9b660'],
] as const;

/** A plate of brushed metal with a bright upper edge. */
const plate = (
  box: Box,
  r = 0.2,
  stops: readonly (readonly [number, Color])[] = STEEL,
): Shape[] => [
  {
    t: 'rect',
    ...box,
    r,
    fill: { t: 'linear', angle: 180, stops },
    stroke: { color: darken(stops[3]![1], 0.45), width: 0.03 },
    shadow: { dx: 0, dy: 0.16, blur: 0.3, opacity: 0.6 },
  },
  {
    t: 'rect',
    x: box.x + 0.05,
    y: box.y + 0.05,
    w: box.w - 0.1,
    h: box.h - 0.1,
    r,
    fill: null,
    stroke: { color: '#ffffff', width: 0.03, opacity: 0.6 },
  },
];

/** A slotted screw. */
const screw = (cx: number, cy: number, turn = 30, r = 0.2): Shape[] => {
  const angle = (turn * Math.PI) / 180;
  const [dx, dy] = [Math.cos(angle) * r * 0.72, Math.sin(angle) * r * 0.72];
  return [
    {
      t: 'ellipse',
      x: cx - r,
      y: cy - r,
      w: r * 2,
      h: r * 2,
      fill: {
        t: 'radial',
        cx: 0.35,
        cy: 0.3,
        stops: [
          [0, '#ffffff'],
          [1, '#8a8e94'],
        ],
      },
      stroke: { color: '#4b4e53', width: 0.025 },
      shadow: { dx: 0, dy: 0.04, blur: 0.06, opacity: 0.5 },
    },
    {
      t: 'line',
      x1: cx - dx,
      y1: cy - dy,
      x2: cx + dx,
      y2: cy + dy,
      stroke: { color: '#3c3f44', width: 0.05 },
    },
  ];
};

/** A button of glossy glass. */
const glassButton = (box: Box, color: Color = blue): Shape[] => [
  {
    t: 'rect',
    ...box,
    r: box.h / 2,
    fill: fall(
      [0, lighten(color, 0.3)],
      [0.5, color],
      [0.51, darken(color, 0.18)],
      [1, lighten(color, 0.08)],
    ),
    stroke: { color: darken(color, 0.5), width: 0.04 },
    shadow: { dx: 0, dy: 0.18, blur: 0.3, opacity: 0.6 },
  },
  {
    t: 'rect',
    x: box.x + 0.14,
    y: box.y + 0.09,
    w: box.w - 0.28,
    h: box.h * 0.44,
    r: box.h * 0.22,
    fill: { t: 'solid', color: '#ffffff', fade: { from: 0.7, to: 0.12, angle: 180 } },
  },
];

/** A round knob of glass in a metal ring. */
const knob = (cx: number, cy: number, r: number, color: Color = blue): Shape[] => [
  {
    t: 'ellipse',
    x: cx - r,
    y: cy - r,
    w: r * 2,
    h: r * 2,
    fill: { t: 'linear', angle: 180, stops: STEEL },
    stroke: { color: '#5b5f65', width: 0.04 },
    shadow: { dx: 0, dy: 0.3, blur: 0.6, opacity: 0.65 },
  },
  disc(cx, cy, r * 0.86, '#3c4046'),
  disc(cx, cy, r * 0.83, {
    t: 'radial',
    cx: 0.5,
    cy: 0.78,
    stops: [
      [0, lighten(color, 0.55)],
      [0.55, color],
      [1, darken(color, 0.5)],
    ],
  }),
  {
    t: 'ellipse',
    x: cx - r * 0.6,
    y: cy - r * 0.78,
    w: r * 1.2,
    h: r * 0.72,
    fill: { t: 'solid', color: '#ffffff', fade: { from: 0.8, to: 0.05, angle: 180 } },
  },
];

/** A silk ribbon hanging down from the page's upper edge, cut to a swallowtail. */
const ribbon = (x: number, w: number, length: number): Shape[] => [
  {
    t: 'poly',
    fill: {
      t: 'linear',
      angle: 90,
      stops: [
        [0, darken(red, 0.25)],
        [0.3, lighten(red, 0.12)],
        [1, darken(red, 0.12)],
      ],
    },
    shadow: { dx: 0.08, dy: 0.1, blur: 0.25, opacity: 0.5 },
    pts: [
      [x, -0.2],
      [x + w, -0.2],
      [x + w, length],
      [x + w / 2, length - w * 0.55],
      [x, length],
    ],
  },
];

/** The seam that runs round a leather page. */
const border = seam({ x: 0.75, y: 0.75, w: 26.5, h: 14.25 }, 0.5);

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: hide,
    shapes: [
      ground(leather),
      ...border,
      ...paper({ x: 2.2, y: 2.4, w: 16.2, h: 8.8 }, 2),
      {
        t: 'line',
        x1: 3.4,
        y1: 9.95,
        x2: 17.2,
        y2: 9.95,
        stroke: { color: '#cdbb92', width: 0.05 },
      },
      {
        t: 'line',
        x1: 3.4,
        y1: 10.1,
        x2: 17.2,
        y2: 10.1,
        stroke: { color: '#cdbb92', width: 0.02 },
      },
      ...ribbon(15.4, 1.3, 5.2),
      ...plate({ x: 2.2, y: 12, w: 12.4, h: 2 }),
      ...screw(2.8, 13, 25),
      ...screw(14, 13, 110),
      ...knob(22.9, 7.4, 3.2),
    ],
    title: {
      x: 3.4,
      y: 3.2,
      w: 11.6,
      h: 6.4,
      valign: 'middle',
      sample: 'Handwerk\nzum Anfassen',
    },
    subtitle: {
      x: 3.5,
      y: 12,
      w: 9.8,
      h: 2,
      color: steel,
      valign: 'middle',
      sample: 'Werkstattbericht, Ausgabe 4',
    },
  },
  {
    name: 'Abschnitt',
    bg: '#8f5c33',
    shapes: [
      ground(wood),
      // A leather strap across the table, with its buckle.
      {
        t: 'rect',
        x: -0.5,
        y: 4.3,
        w: 29,
        h: 6.6,
        fill: fall([0, '#7d4c2a'], [0.5, '#6b3f22'], [1, '#532f17']),
        shadow: { dx: 0, dy: 0.3, blur: 0.6, opacity: 0.7 },
      },
      {
        t: 'line',
        x1: 0,
        y1: 4.36,
        x2: 28,
        y2: 4.36,
        stroke: { color: '#ffffff', width: 0.04, opacity: 0.2 },
      },
      ...seamLine(0, 4.8, 28),
      ...seamLine(0, 10.4, 28),
      ...plate({ x: 21, y: 4.9, w: 4.6, h: 5.4 }, 0.7, BRASS),
      {
        t: 'rect',
        x: 21.9,
        y: 5.8,
        w: 2.8,
        h: 3.6,
        r: 0.35,
        fill: fall([0, '#3f230f'], [0.35, '#6b3f22'], [1, '#7a4a28']),
        stroke: { color: '#7a5a1e', width: 0.04 },
      },
      {
        t: 'rect',
        x: 21.4,
        y: 7.38,
        w: 3.5,
        h: 0.44,
        r: 0.22,
        fill: { t: 'linear', angle: 180, stops: BRASS },
        stroke: { color: '#7a5a1e', width: 0.03 },
        shadow: { dx: 0, dy: 0.08, blur: 0.12, opacity: 0.6 },
      },
      ...paper({ x: 2.4, y: 12, w: 12, h: 1.9 }, 1),
      disc(3.15, 12.95, 0.2, { t: 'linear', angle: 180, stops: BRASS }),
      disc(3.15, 12.95, 0.1, '#4a2f18'),
    ],
    title: {
      x: 2.4,
      y: 5.1,
      w: 17.6,
      h: 5,
      size: 42,
      color: cream,
      valign: 'middle',
      sample: 'Zweites Kapitel:\nMaterial',
    },
    subtitle: {
      x: 3.9,
      y: 12,
      w: 10.2,
      h: 1.9,
      valign: 'middle',
      sample: 'Leder, Holz und Messing',
    },
  },
  {
    name: 'Inhalt',
    bg: '#cfc5b0',
    shapes: [
      ground(linen),
      // A writing pad: its block of sheets, the top one, the leather it is bound in.
      {
        t: 'rect',
        x: 2.5,
        y: 1.5,
        w: 23.4,
        h: 13.4,
        r: 0.1,
        fill: '#d9cdb2',
        shadow: { dx: 0.05, dy: 0.25, blur: 0.5, opacity: 0.5 },
      },
      {
        t: 'rect',
        x: 2.35,
        y: 1.35,
        w: 23.4,
        h: 13.4,
        r: 0.1,
        fill: '#e8dec6',
        stroke: { color: '#c9bc9c', width: 0.02 },
      },
      ...paper({ x: 2.2, y: 1.2, w: 23.4, h: 13.4 }, 0.2),
      {
        t: 'line',
        x1: 4.3,
        y1: 4.1,
        x2: 4.3,
        y2: 14.55,
        stroke: { color: '#dd8f89', width: 0.04 },
      },
      {
        t: 'line',
        x1: 4.42,
        y1: 4.1,
        x2: 4.42,
        y2: 14.55,
        stroke: { color: '#dd8f89', width: 0.02 },
      },
      {
        t: 'rect',
        x: 2.2,
        y: 1.2,
        w: 23.4,
        h: 2.9,
        r: 0.1,
        fill: fall([0, '#84512c'], [0.5, '#6b3f22'], [1, '#55301a']),
        stroke: { color: '#3b2110', width: 0.03 },
      },
      {
        t: 'line',
        x1: 2.3,
        y1: 1.27,
        x2: 25.5,
        y2: 1.27,
        stroke: { color: '#ffffff', width: 0.04, opacity: 0.25 },
      },
      ...seamLine(2.6, 1.6, 22.6),
      ...seamLine(2.6, 3.72, 22.6),
      {
        t: 'rect',
        x: 2.2,
        y: 4.1,
        w: 23.4,
        h: 0.35,
        fill: { t: 'solid', color: '#000000', fade: { from: 0.3, to: 0, angle: 180 } },
      },
    ],
    title: {
      x: 3.4,
      y: 1.7,
      w: 21,
      h: 1.95,
      size: 28,
      color: cream,
      valign: 'middle',
      sample: 'Woran man gute Arbeit erkennt',
    },
    body: {
      x: 5,
      y: 4.9,
      w: 19.8,
      h: 9.2,
      sample: [
        'Jede Naht sitzt, auch wo niemand hinsieht',
        'Das Material darf altern und wird schöner',
        'Knöpfe geben spürbar nach',
        'Nichts glänzt ohne Grund',
        'Werkzeug liegt dort, wo die Hand es sucht',
      ],
    },
  },
  {
    name: 'Text und Bild',
    // Light, so that the bullets on the paper come out dark; the wood covers it.
    bg: paperTone,
    shapes: [
      ground(wood),
      ...paper({ x: 1.6, y: 1.5, w: 12, h: 12.8 }, 1.5),
      { t: 'line', x1: 2.7, y1: 5.5, x2: 12.5, y2: 5.5, stroke: { color: '#cdbb92', width: 0.04 } },
      // The pin that holds the note.
      disc(7.72, 1.98, 0.36, { t: 'solid', color: '#000000', opacity: 0.3 }),
      disc(7.6, 1.8, 0.36, {
        t: 'radial',
        cx: 0.35,
        cy: 0.3,
        stops: [
          [0, '#ff8f8a'],
          [0.5, red],
          [1, darken(red, 0.45)],
        ],
      }),
      // A print with its white border, taped to the table.
      {
        t: 'rect',
        x: 14.8,
        y: 2.2,
        w: 11.6,
        h: 11.4,
        fill: fall([0, '#ffffff'], [1, '#f1ede2']),
        stroke: { color: '#d8d2c2', width: 0.02 },
        shadow: { dx: 0.06, dy: 0.25, blur: 0.5, opacity: 0.6 },
      },
      {
        t: 'rect',
        x: 19,
        y: 1.7,
        w: 3.2,
        h: 0.95,
        rotate: -3,
        fill: { t: 'solid', color: '#f3e4a2', opacity: 0.78 },
        stroke: { color: '#d6c57e', width: 0.015, opacity: 0.8 },
      },
    ],
    title: {
      x: 2.7,
      y: 2.5,
      w: 9.8,
      h: 2.8,
      size: 24,
      valign: 'middle',
      sample: 'Aus der Werkstatt',
    },
    body: {
      x: 2.7,
      y: 5.9,
      w: 9.9,
      h: 7.8,
      size: 19,
      sample: ['Zuschnitt von Hand', 'Kanten gefärbt und poliert', 'Jedes Stück geprüft'],
    },
    pictures: [{ x: 15.4, y: 2.95, w: 10.4, h: 8.7 }],
  },
  {
    name: 'Zwei Spalten',
    bg: paperTone,
    shapes: [
      ground(leather),
      ...border,
      ...plate({ x: 1.8, y: 1.4, w: 24.4, h: 2.5 }, 0.25),
      ...screw(2.45, 2.65, 40),
      ...screw(25.55, 2.65, -20),
      // Index cards, each with its tab.
      {
        t: 'rect',
        x: 2.6,
        y: 4.25,
        w: 3.4,
        h: 1,
        r: 0.15,
        fill: fall([0, '#e0b06c'], [1, tan]),
        shadow: { dx: 0, dy: 0.1, blur: 0.2, opacity: 0.5 },
      },
      {
        t: 'rect',
        x: 15.2,
        y: 4.25,
        w: 3.4,
        h: 1,
        r: 0.15,
        fill: fall([0, '#79a7d6'], [1, blue]),
        shadow: { dx: 0, dy: 0.1, blur: 0.2, opacity: 0.5 },
      },
      ...paper({ x: 1.8, y: 4.8, w: 11.8, h: 9.5 }, 1.2),
      ...paper({ x: 14.4, y: 4.8, w: 11.8, h: 9.5 }, 1.2),
    ],
    title: {
      x: 3.3,
      y: 1.4,
      w: 21.4,
      h: 2.5,
      size: 28,
      color: steel,
      valign: 'middle',
      sample: 'Maschine oder Hand',
    },
    body: [
      {
        x: 2.8,
        y: 5.6,
        w: 9.9,
        h: 8.1,
        size: 19,
        sample: ['Schnell und gleichmäßig', 'Günstig in großer Zahl', 'Jedes Stück wie das andere'],
      },
      {
        x: 15.4,
        y: 5.6,
        w: 9.9,
        h: 8.1,
        size: 19,
        sample: [
          'Langsam und genau',
          'Lohnt sich bei kleinen Reihen',
          'Jedes Stück ein Einzelstück',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: hide,
    shapes: [
      ground(leather),
      ...border,
      // A gauge: metal ring, paper face with its scale, glass over it.
      {
        t: 'ellipse',
        x: 2.8,
        y: 2.1,
        w: 11.6,
        h: 11.6,
        fill: { t: 'linear', angle: 180, stops: STEEL },
        stroke: { color: '#5b5f65', width: 0.04 },
        shadow: { dx: 0, dy: 0.35, blur: 0.7, opacity: 0.7 },
      },
      disc(8.6, 7.9, 5.15, '#3c4046'),
      disc(8.6, 7.9, 5, {
        t: 'radial',
        stops: [
          [0, '#fffaf0'],
          [0.7, '#f3ead6'],
          [1, '#d9cdb2'],
        ],
      }),
      ...Array.from({ length: 41 }, (_, index): Shape => {
        const angle = ((135 + index * 6.75) * Math.PI) / 180;
        const inner = index % 5 === 0 ? 4.05 : 4.3;
        return {
          t: 'line',
          x1: 8.6 + Math.cos(angle) * inner,
          y1: 7.9 + Math.sin(angle) * inner,
          x2: 8.6 + Math.cos(angle) * 4.62,
          y2: 7.9 + Math.sin(angle) * 4.62,
          stroke: { color: index >= 32 ? red : brown, width: index % 5 === 0 ? 0.08 : 0.04 },
        };
      }),
      {
        t: 'ellipse',
        x: 4.5,
        y: 3.25,
        w: 8.2,
        h: 3.6,
        fill: { t: 'solid', color: '#ffffff', fade: { from: 0.4, to: 0, angle: 180 } },
      },
      ...paper({ x: 16.2, y: 4.5, w: 10, h: 6.8 }, 1.5),
      ...ribbon(23.6, 1.1, 5.6),
    ],
    title: {
      x: 5,
      y: 5.7,
      w: 7.2,
      h: 4.4,
      size: 60,
      align: 'center',
      valign: 'middle',
      sample: '412',
    },
    body: {
      x: 17.1,
      y: 5.9,
      w: 8.2,
      h: 5,
      size: 21,
      valign: 'middle',
      sample: 'Stiche hält eine Tasche zusammen. Jeder davon von Hand gesetzt.',
    },
  },
  {
    name: 'Zitat',
    bg: '#cfc5b0',
    shapes: [
      ground(linen),
      ...paper({ x: 2.6, y: 1.8, w: 22.8, h: 10.4 }, 2),
      {
        t: 'text',
        x: 3,
        y: 1.7,
        w: 5,
        h: 5,
        text: '“',
        font: 'Merriweather',
        bold: true,
        size: 150,
        color: '#e2d3b0',
        align: 'left',
        valign: 'top',
      },
      ...ribbon(22.4, 1.2, 4.6),
      ...patch({ x: 13.2, y: 11.2, w: 11.4, h: 2.5 }),
    ],
    body: {
      x: 5.2,
      y: 3.4,
      w: 16.6,
      h: 7.2,
      font: 'Merriweather',
      italic: true,
      size: 27,
      lineHeight: 130,
      valign: 'middle',
      sample: 'Was man gern anfasst, das benutzt man auch gern.',
    },
    subtitle: {
      x: 13.9,
      y: 11.2,
      w: 10,
      h: 2.5,
      color: cream,
      align: 'center',
      valign: 'middle',
      sample: 'Henrik Vogt, Sattlermeister',
    },
  },
  {
    name: 'Bild',
    bg: '#8f5c33',
    shapes: [
      ground(wood),
      ...plate({ x: 1.6, y: 0.9, w: 24.8, h: 11.7 }, 0.12),
      {
        t: 'rect',
        x: 2.05,
        y: 1.35,
        w: 23.9,
        h: 10.8,
        fill: '#fbfaf5',
        stroke: { color: '#8b8f95', width: 0.03 },
      },
      {
        t: 'rect',
        x: 2.05,
        y: 1.35,
        w: 23.9,
        h: 0.3,
        fill: { t: 'solid', color: '#000000', fade: { from: 0.22, to: 0, angle: 180 } },
      },
      ...plate({ x: 8, y: 13.1, w: 12, h: 1.8 }, 0.15, BRASS),
      ...screw(8.55, 14, 20, 0.17),
      ...screw(19.45, 14, 100, 0.17),
    ],
    pictures: [{ x: 2.7, y: 2, w: 22.6, h: 9.5 }],
    title: {
      x: 9.1,
      y: 13.1,
      w: 9.8,
      h: 1.8,
      size: 19,
      color: '#4a3410',
      align: 'center',
      valign: 'middle',
      sample: 'Die Werkbank am Morgen',
    },
  },
  {
    name: 'Schluss',
    bg: hide,
    shapes: [
      ground(leather),
      ...border,
      ...plate({ x: 5.6, y: 2.8, w: 16.8, h: 6.6 }, 0.3),
      ...screw(6.2, 3.4, 15),
      ...screw(21.8, 3.4, 80),
      ...screw(6.2, 8.8, 130),
      ...screw(21.8, 8.8, 50),
      ...glassButton({ x: 8.6, y: 10.9, w: 10.8, h: 2.3 }),
    ],
    title: {
      x: 7,
      y: 3.2,
      w: 14,
      h: 5.8,
      size: 54,
      color: steel,
      align: 'center',
      valign: 'middle',
      sample: 'Danke',
    },
    subtitle: {
      x: 9.2,
      y: 10.9,
      w: 9.6,
      h: 2.3,
      color: '#ffffff',
      bold: true,
      align: 'center',
      valign: 'middle',
      sample: 'Fragen zur Fertigung',
    },
  },
];

const template: Template = {
  slug: 'skeuomorph',
  name: 'Skeuomorph',
  group: 'Designtrend',
  tags: ['Skeuomorph', 'Leder', 'Holz', 'Metall', 'Papier', 'Handwerk', 'warm', 'Nostalgie'],
  description:
    'Der Bildschirm als Schreibtisch: genähtes Leder, Leinen und Holz, gebürstetes Metall mit Schrauben, Papier mit Schatten und Knöpfe aus glänzendem Glas.',
  palette: {
    bg: paperTone,
    text: brown,
    bg2: '#e4d8bf',
    text2: umber,
    accents: [hide, tan, red, blue, brass, moss],
  },
  fonts: { head: 'Merriweather', body: 'Lato' },
  text: {
    title: { font: 'Merriweather', size: 44, bold: true, color: brown, lineHeight: 112 },
    subtitle: { font: 'Lato', size: 19, bold: true, color: umber },
    body: { font: 'Lato', size: 21, color: brown, lineHeight: 124, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
