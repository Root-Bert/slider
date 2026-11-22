import { paper as paperGround } from '../art';
import type { Box, Color, FillLike, Layout, Shape, Stroke, Template } from '../model';
import { disc, page } from '../shapes';

/*
 * Ukiyo-e: the calm of a woodblock print – cream paper, indigo that fades as if wiped on the
 * block, a red sun, flat mountains, waves and bands of mist. Much is left empty; nothing sits in
 * the middle. All drawings are our own.
 */

const cream = '#efe4cc';
const ink = '#2a2622';
const indigo = '#1f3b63';
const deep = '#132744';
const blue = '#4d7396';
const haze = '#a9c3cf';
const red = '#c5372c';
const ochre = '#c99b4e';
const moss = '#6f8a72';
const blossom = '#dfa69b';
const mist = '#f8f2e2';

/** The sheet every layout is printed on – one picture, stored once. */
const sheet: Shape = {
  t: 'image',
  ...page,
  src: paperGround(cream, { clouds: 0.045, grain: 0.035, seed: 21 }),
};

type Point = readonly [number, number];

/** Drawings are written in centimetres on a canvas reaching past the page's edges. */
const CANVAS: Box = { x: -2, y: -1, w: 32, h: 18.75 };
const c = (x: number, y: number) =>
  `${Math.round((x - CANVAS.x) * 100)} ${Math.round((y - CANVAS.y) * 100)}`;
const drawn = (d: string, fill: FillLike, stroke?: Stroke): Shape => ({
  t: 'path',
  ...CANVAS,
  vb: [CANVAS.w * 100, CANVAS.h * 100],
  d,
  fill,
  stroke: stroke ?? null,
});

const bezier = (p: readonly [Point, Point, Point, Point], t: number): Point => {
  const u = 1 - t;
  const at = (i: 0 | 1) =>
    u * u * u * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t * t * t * p[3][i];
  return [at(0), at(1)];
};

/** A lone mountain: long hollow slopes to a small, uneven summit; snow lies on its top third. */
function mountain(
  cx: number,
  base: number,
  w: number,
  h: number,
  fill: FillLike,
  snow: Color | null = mist,
): Shape[] {
  const top = base - h;
  const left: [Point, Point, Point, Point] = [
    [cx - w / 2, base],
    [cx - w * 0.27, base - h * 0.1],
    [cx - w * 0.11, base - h * 0.74],
    [cx - w * 0.055, top],
  ];
  const right: [Point, Point, Point, Point] = [
    [cx + w * 0.06, top + h * 0.02],
    [cx + w * 0.12, base - h * 0.72],
    [cx + w * 0.29, base - h * 0.1],
    [cx + w / 2, base],
  ];
  const summit = `L${c(cx - w * 0.02, top + h * 0.035)} L${c(cx + w * 0.02, top - h * 0.005)} L${c(right[0][0], right[0][1])}`;
  const body = drawn(
    `M${c(...left[0])} C${c(...left[1])} ${c(...left[2])} ${c(...left[3])} ${summit} C${c(...right[1])} ${c(...right[2])} ${c(...right[3])} Z`,
    fill,
  );
  if (!snow) return [body];
  // The snow: down the slopes to about a third, its lower edge running out in tongues.
  const steps = 8;
  const leftEdge = Array.from({ length: steps + 1 }, (_, i) =>
    bezier(left, 0.6 + (0.4 * i) / steps),
  );
  const rightEdge = Array.from({ length: steps + 1 }, (_, i) => bezier(right, (0.42 * i) / steps));
  const [from, to] = [rightEdge[steps]!, leftEdge[0]!];
  const tongues = 7;
  const lower = Array.from({ length: tongues * 2 - 1 }, (_, i): Point => {
    const t = (i + 1) / (tongues * 2);
    const sag = Math.sin(t * Math.PI) * h * 0.05;
    return [
      from[0] + (to[0] - from[0]) * t,
      from[1] +
        (to[1] - from[1]) * t +
        sag +
        (i % 2 === 0 ? -h * (0.1 + 0.05 * ((i / 2) % 2)) : h * 0.03),
    ];
  });
  const line = (pts: readonly Point[]) => pts.map((p) => `L${c(...p)}`).join(' ');
  return [
    body,
    drawn(
      `M${c(...leftEdge[0]!)} ${line(leftEdge.slice(1))} ${summit} ${line(rightEdge.slice(1))} ${line(lower)} Z`,
      snow,
    ),
  ];
}

/** A far range: soft ridges from edge to edge, down to `bottom`. */
function range(
  y: number,
  heights: readonly number[],
  fill: FillLike,
  bottom = 16.5,
  from = -1,
  to = 29,
): Shape {
  const step = (to - from) / (heights.length - 1);
  const pts = heights.map((height, i): Point => [from + i * step, y - height]);
  let d = `M${c(from, bottom)} L${c(...pts[0]!)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [a, b] = [pts[i]!, pts[i + 1]!];
    // Ridges rise in a hollow curve and fall in one: peaks stay pointed, as cut with a knife.
    const mid = (a[0] + b[0]) / 2;
    d += ` C${c(mid, a[1] > b[1] ? a[1] : a[1] + (b[1] - a[1]) * 0.15)} ${c(mid, a[1] > b[1] ? b[1] + (a[1] - b[1]) * 0.15 : b[1])} ${c(...b)}`;
  }
  return drawn(`${d} L${c(to, bottom)} Z`, fill);
}

/**
 * A band of waves: crests leaning to the right, one after the other, the water filled down to
 * `bottom`; a pale line follows the crests a little below, as the block's second colour.
 */
function waves(
  y: number,
  height: number,
  period: number,
  shift: number,
  fill: FillLike,
  lineColor: Color | null = haze,
  bottom = 16.5,
): Shape[] {
  const crest = (offset: number) => {
    let d = '';
    for (let x = -1.5 - shift; x < 29.5; x += period) {
      const base = y + offset;
      d += `${d ? '' : `M${c(x, base)}`} C${c(x + period * 0.42, base)} ${c(x + period * 0.5, base - height)} ${c(x + period * 0.7, base - height)} C${c(x + period * 0.86, base - height)} ${c(x + period * 0.88, base - height * 0.1)} ${c(x + period, base)}`;
    }
    return d;
  };
  const end = -1.5 - shift + Math.ceil((31 + shift) / period) * period;
  const shapes: Shape[] = [
    drawn(`${crest(0)} L${c(end, bottom)} L${c(-1.5 - shift, bottom)} Z`, fill),
  ];
  if (lineColor)
    shapes.push(drawn(crest(height * 0.42), null, { color: lineColor, width: 0.05, cap: 'round' }));
  return shapes;
}

/** Bands of mist: long rounded bars lying over each other, stepped. */
const mistBands = (
  x: number,
  y: number,
  w: number,
  fill: FillLike = mist,
  thick = 0.5,
): Shape[] => [
  { t: 'rect', x, y, w: w * 0.72, h: thick, r: thick / 2, fill },
  { t: 'rect', x: x + w * 0.2, y: y + thick * 0.72, w: w * 0.8, h: thick, r: thick / 2, fill },
  { t: 'rect', x: x + w * 0.46, y: y + thick * 1.44, w: w * 0.36, h: thick, r: thick / 2, fill },
];

/** Colour wiped on the block: full at one edge of the box, gone at the other. */
const wiped = (box: Box, color: Color, from: number, to: number): Shape => ({
  t: 'rect',
  ...box,
  fill: { t: 'solid', color, fade: { from, to, angle: 180 } },
});

/** The printer's seal: a small red square with an abstract mark cut out of it. */
const seal = (x: number, y: number, s = 0.95): Shape[] => [
  { t: 'rect', x, y, w: s, h: s, r: s * 0.12, fill: red },
  { t: 'rect', x: x + s * 0.22, y: y + s * 0.22, w: s * 0.56, h: s * 0.1, fill: mist },
  { t: 'rect', x: x + s * 0.22, y: y + s * 0.45, w: s * 0.1, h: s * 0.34, fill: mist },
  {
    t: 'rect',
    x: x + s * 0.45,
    y: y + s * 0.45,
    w: s * 0.33,
    h: s * 0.34,
    fill: null,
    stroke: { color: mist, width: s * 0.09 },
  },
];

/** Birds far off: a few small strokes. */
const birds = (x: number, y: number, color: Color = ink): Shape[] =>
  (
    [
      [0, 0, 1],
      [1.1, -0.5, 0.8],
      [1.9, 0.25, 0.65],
    ] as const
  ).map(([dx, dy, s]) =>
    drawn(
      `M${c(x + dx - 0.34 * s, y + dy - 0.1 * s)} Q${c(x + dx - 0.14 * s, y + dy - 0.2 * s)} ${c(x + dx, y + dy)} Q${c(x + dx + 0.16 * s, y + dy - 0.22 * s)} ${c(x + dx + 0.38 * s, y + dy - 0.14 * s)}`,
      null,
      { color, width: 0.055, cap: 'round', join: 'round' },
    ),
  );

const hair = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Color = ink,
  width = 0.04,
): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: { color, width },
});

const tallPicture: Box = { x: 2.2, y: 1.7, w: 9.2, h: 12.3 };
const widePicture: Box = { x: 2.6, y: 1.6, w: 21.8, h: 10.4 };
const mount = (box: Box, by = 0.2): Shape => ({
  t: 'rect',
  x: box.x - by,
  y: box.y - by,
  w: box.w + by * 2,
  h: box.h + by * 2,
  fill: null,
  stroke: { color: ink, width: 0.04 },
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: cream,
    shapes: [
      sheet,
      wiped({ x: 0, y: 0, w: 28, h: 4.6 }, indigo, 0.78, 0),
      disc(17.3, 6.3, 2.5, red),
      ...mountain(21.6, 12.9, 16.5, 6.9, {
        t: 'linear',
        angle: 180,
        stops: [
          [0, deep],
          [1, blue],
        ],
      }),
      ...mistBands(13.4, 10.5, 10.5),
      ...mistBands(21.5, 9.2, 7.5, mist, 0.42),
      ...waves(13.1, 0.75, 3.1, 0.4, blue, mist),
      ...waves(13.9, 0.8, 3.6, 1.7, indigo, haze),
      ...waves(14.8, 0.7, 3.2, 0.2, deep, blue),
      ...birds(9.6, 3.1),
      ...seal(1.9, 2.2),
    ],
    title: {
      x: 1.8,
      y: 4.2,
      w: 11.6,
      h: 5.4,
      valign: 'bottom',
      size: 54,
      sample: 'Stille\nWasser',
    },
    subtitle: { x: 1.8, y: 9.9, w: 11, h: 1.6, sample: 'Bilder einer fließenden Welt' },
  },
  {
    name: 'Abschnitt',
    bg: {
      t: 'linear',
      angle: 180,
      stops: [
        [0, deep],
        [0.7, indigo],
        [1, blue],
      ],
    },
    shapes: [
      disc(21.4, 5.2, 2.3, mist),
      ...mistBands(16.6, 5.9, 9.6, { t: 'solid', color: indigo, opacity: 0.92 }, 0.46),
      range(13.2, [1.2, 2.6, 1.5, 3.4, 1.9, 2.4, 4.2, 2.2, 3, 1.4], {
        t: 'solid',
        color: blue,
        opacity: 0.55,
      }),
      range(14.3, [2.4, 1.2, 2.2, 1.1, 2.6, 1.6, 1.2, 2.9, 1.5, 2.3], deep),
      ...mistBands(0.8, 12.6, 12, { t: 'solid', color: haze, opacity: 0.35 }, 0.4),
      ...birds(16.2, 2.7, haze),
      ...seal(1.9, 2.2),
    ],
    title: {
      x: 1.8,
      y: 4.4,
      w: 13.4,
      h: 4.6,
      valign: 'bottom',
      size: 46,
      color: mist,
      sample: 'Zweites Blatt:\nDer Abend',
    },
    subtitle: {
      x: 1.8,
      y: 9.4,
      w: 15,
      h: 1.5,
      color: haze,
      sample: 'Wenn der Mond über den Bergen steht',
    },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      sheet,
      disc(24.3, 2.5, 1.25, red),
      ...mistBands(21.6, 2.55, 5.6, mist, 0.34),
      hair(1.8, 3.55, 4.6, 3.55, red, 0.09),
      ...waves(14.55, 0.5, 2.6, 0.3, blue, mist),
      ...waves(15.1, 0.5, 3, 1.4, indigo, haze),
    ],
    title: { x: 1.8, y: 0.9, w: 18.8, h: 2.4, valign: 'bottom', size: 32 },
    body: {
      x: 1.8,
      y: 4.4,
      w: 22.4,
      h: 9.2,
      sample: [
        'Erst die Zeichnung, dann der Stock',
        'Für jede Farbe ein eigenes Holz',
        'Das Blau wird nass in nass verrieben',
        'Papier und Stock müssen genau passen',
        'Hundert Abzüge, keiner wie der andere',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: cream,
    shapes: [
      sheet,
      mount(tallPicture),
      ...seal(11.95, 13.25, 0.85),
      disc(24.6, 14.5, 1.1, red),
      range(15.2, [0.3, 0.9, 0.5, 1.3, 0.7, 1.6, 0.8], haze, 16.5, 13, 29),
      range(15.6, [0.4, 0.3, 0.8, 0.4, 0.9, 0.5, 1.1], blue, 16.5, 13, 29),
      hair(13.6, 4.75, 16.4, 4.75, red, 0.09),
    ],
    title: { x: 13.6, y: 1.2, w: 12.6, h: 3.3, valign: 'bottom', size: 30 },
    body: { x: 13.6, y: 5.5, w: 12.6, h: 8, size: 20 },
    pictures: [tallPicture],
  },
  {
    name: 'Zwei Spalten',
    bg: cream,
    shapes: [
      sheet,
      disc(4.4, 13.9, 1.5, red),
      range(14.2, [0.5, 1.5, 0.7, 1.1, 0.4, 0.8, 0.5, 1.4, 2.3, 1.2, 0.7], haze),
      range(14.9, [0.9, 0.5, 1, 0.5, 0.7, 0.4, 0.9, 0.6, 1.2, 1.6, 0.8], blue),
      range(15.5, [0.5, 0.8, 0.4, 0.6, 0.9, 0.5, 0.4, 0.7, 0.5, 0.9, 1.2], indigo),
      hair(1.8, 3.55, 4.6, 3.55, red, 0.09),
      hair(14, 4.6, 14, 12.2),
      ...birds(22.4, 1.8),
    ],
    title: { x: 1.8, y: 0.9, w: 19, h: 2.4, valign: 'bottom', size: 32 },
    body: [
      { x: 1.8, y: 4.4, w: 11.2, h: 7.9, size: 19 },
      { x: 15, y: 4.4, w: 11.2, h: 7.9, size: 19 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: cream,
    shapes: [
      sheet,
      wiped({ x: 0, y: 0, w: 28, h: 3.6 }, ochre, 0.45, 0),
      disc(8.6, 7.4, 5.4, red),
      ...mistBands(10.2, 11.2, 9.4),
      ...waves(13.2, 0.8, 3.4, 0.9, blue, mist),
      ...waves(14.1, 0.75, 3, 0.1, indigo, haze),
      ...waves(14.9, 0.7, 3.5, 1.9, deep, blue),
      ...birds(21.8, 2.6),
    ],
    title: {
      x: 3.6,
      y: 4.2,
      w: 10,
      h: 6.2,
      align: 'center',
      valign: 'middle',
      size: 110,
      color: mist,
      sample: '12',
    },
    body: {
      x: 16.4,
      y: 4.4,
      w: 9.8,
      h: 6.2,
      valign: 'middle',
      size: 23,
      sample: 'Blätter, eines für jeden Monat: ein ganzes Jahr, Druck für Druck.',
    },
  },
  {
    name: 'Zitat',
    bg: cream,
    shapes: [
      sheet,
      wiped({ x: 0, y: 0, w: 28, h: 5.4 }, indigo, 0.82, 0),
      disc(23.2, 5, 1.7, red),
      range(13.4, [0.2, 0.3, 0.2, 0.5, 0.4, 0.9, 1.6, 2.9, 4.6, 3.1, 3.8, 2.6], haze),
      range(14.4, [0.5, 0.3, 0.6, 0.4, 0.8, 0.6, 1.4, 2.2, 3.1, 2.4, 3.4, 2.9], blue),
      range(15.3, [0.6, 0.9, 0.5, 0.8, 0.5, 1, 0.8, 1.7, 1.3, 2.4, 1.8, 2.7], indigo),
      ...mistBands(15.5, 11.5, 9.5),
      ...seal(3.4, 11.15, 0.85),
    ],
    body: {
      x: 3.4,
      y: 3.2,
      w: 15.6,
      h: 7.2,
      valign: 'bottom',
      font: 'Noto Serif',
      italic: true,
      size: 30,
      lineHeight: 130,
      sample: 'Wer den Berg malen will, muss zuerst lernen, den Himmel leer zu lassen.',
    },
    subtitle: {
      x: 4.7,
      y: 10.85,
      w: 12,
      h: 1.45,
      valign: 'middle',
      sample: 'Aiko Tanemura, Holzschneiderin',
    },
  },
  {
    name: 'Bild',
    bg: cream,
    shapes: [
      sheet,
      mount(widePicture),
      { t: 'rect', x: 25.7, y: 1.4, w: 0.85, h: 4.6, fill: red },
      {
        t: 'rect',
        x: 25.87,
        y: 1.57,
        w: 0.51,
        h: 4.26,
        fill: null,
        stroke: { color: mist, width: 0.035 },
      },
      ...seal(25.7, 6.3, 0.85),
      hair(2.6, 14.35, 5.4, 14.35, red, 0.09),
    ],
    pictures: [widePicture],
    title: {
      x: 2.6,
      y: 12.4,
      w: 18,
      h: 1.8,
      valign: 'middle',
      size: 24,
      sample: 'Abend über der Bucht',
    },
  },
  {
    name: 'Schluss',
    bg: cream,
    shapes: [
      sheet,
      wiped({ x: 0, y: 0, w: 28, h: 4 }, ochre, 0.4, 0),
      disc(14, 10.9, 4.3, red),
      ...mistBands(2.4, 8.3, 8.6),
      ...mistBands(17.6, 7.5, 9),
      ...waves(11.2, 0.9, 3.8, 0.6, haze, mist),
      ...waves(12.3, 0.9, 3.3, 2, blue, mist),
      ...waves(13.5, 0.85, 3.9, 1.1, indigo, haze),
      ...waves(14.7, 0.8, 3.2, 0.3, deep, blue),
      ...birds(21.4, 4.4),
    ],
    title: {
      x: 6,
      y: 1.5,
      w: 16,
      h: 2.9,
      align: 'center',
      valign: 'bottom',
      size: 52,
      sample: 'Danke',
    },
    subtitle: {
      x: 6,
      y: 4.6,
      w: 16,
      h: 1.4,
      align: 'center',
      sample: 'Auf ein Wiedersehen am Wasser',
    },
  },
];

const template: Template = {
  slug: 'ukiyo-e',
  name: 'Ukiyo-e',
  group: 'Kunststil',
  tags: ['Ukiyo-e', 'Japan', 'Holzschnitt', 'ruhig', 'Indigo', 'Natur', 'Kultur'],
  description:
    'Ruhe wie im japanischen Holzschnitt: Indigo, rote Sonne, Berge, Wellen und Nebelbänder auf cremefarbenem Papier.',
  palette: {
    bg: cream,
    text: ink,
    bg2: '#e2d4b4',
    text2: '#5d5448',
    accents: [indigo, red, blue, ochre, moss, blossom],
  },
  fonts: { head: 'Noto Serif', body: 'Noto Sans' },
  text: {
    title: { font: 'Noto Serif', size: 40, color: ink, lineHeight: 108 },
    subtitle: { font: 'Noto Sans', size: 19, color: '#5d5448' },
    body: { font: 'Noto Sans', size: 21, color: ink, lineHeight: 128, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
