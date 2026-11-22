import { noise, paint, stencil } from '../art';
import type { Box, Color, Layout, Picture, Shape, Stroke, Template } from '../model';

/*
 * Aquarell: white paper, and on it a few washes – wet colour that ran where it wanted, pooled at
 * its rim and bled into the next – with a sprig or a frame in fine ink drawn loosely over them.
 * Much paper stays white; the text has the page.
 */

const paper = '#fdfcf8';
const shell = '#f1eee4';
const ink = '#2b3a4a';
const pencil = '#667382';
const blue = '#4b86bb';
const teal = '#4fb0a2';
const rose = '#e58692';
const ochre = '#e3ad49';
const violet = '#957fc4';
const green = '#86b562';

/**
 * A wash: one colour, see-through, its rim ragged where the water stopped. Darker along the rim
 * and in pools, lighter where water ran back into it. `power` 2 is a round stain, more a band
 * as a flat brush leaves it.
 */
function stain(
  size: { w: number; h: number },
  color: Color,
  seed: number,
  options: { power?: number; ragged?: number; alpha?: number } = {},
): Picture {
  const surface = paint(size, 44);
  const { ctx, w, h } = surface;
  const field = noise(seed);
  const power = options.power ?? 2;
  const ragged = options.ragged ?? 0.55;
  const alpha = options.alpha ?? 0.62;
  const image = ctx.createImageData(w, h);
  const scale = Math.min(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [u, v] = [(x / w) * 2 - 1, (y / h) * 2 - 1];
      const far = (Math.abs(u) ** power + Math.abs(v) ** power) ** (1 / power);
      const push =
        (field(x / (scale * 0.32), y / (scale * 0.32), 4) - 0.5) * ragged +
        (field(x / (scale * 0.06) + 5, y / (scale * 0.06), 2) - 0.5) * ragged * 0.16;
      const rim = 0.86 - far - push;
      if (rim <= 0) continue;
      const body = Math.min(1, rim * 26);
      // Pigment settles at the rim, pools inside, and thins where water ran back.
      const edge = rim < 0.035 ? 0.34 * (1 - rim / 0.035) : 0;
      const pool = field(x / (scale * 0.5) + 9, y / (scale * 0.5) + 9, 3);
      const bloom = field(x / (scale * 0.22) + 31, y / (scale * 0.22), 3);
      const grain = field(x / 2.2 + 3, y / 2.2 + 7, 1);
      const depth =
        0.42 + pool * 0.5 + edge - Math.max(0, bloom - 0.58) * 1.5 + (grain - 0.5) * 0.12;
      image.data[(y * w + x) * 4 + 3] = 255 * body * Math.min(1, Math.max(0.12, depth)) * alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
  return stencil(surface, color, 64);
}

const ROUND = { w: 12, h: 9 };
const BAND = { w: 15, h: 3.4 };

const round = {
  blue: stain(ROUND, blue, 3),
  teal: stain(ROUND, teal, 14),
  rose: stain(ROUND, rose, 27),
  ochre: stain(ROUND, ochre, 41),
  violet: stain(ROUND, violet, 58),
  green: stain(ROUND, green, 66),
};
const band = {
  ochre: stain(BAND, ochre, 72, { power: 5, ragged: 0.4 }),
  blue: stain(BAND, blue, 85, { power: 5, ragged: 0.4 }),
  rose: stain(BAND, rose, 93, { power: 5, ragged: 0.4 }),
};

const wash = (src: Picture, x: number, y: number, w: number, h: number, rotate = 0): Shape => ({
  t: 'image',
  x,
  y,
  w,
  h,
  src,
  rotate,
});

const pen: Stroke = { color: ink, width: 0.035, cap: 'round', join: 'round' };
const fine: Stroke = { ...pen, width: 0.025 };

type Point = readonly [number, number];

/**
 * An ink drawing from lines in page centimetres. LibreOffice places a path by the bounds of what
 * is drawn, so the box is exactly those bounds and curves are given as the points they pass.
 */
function drawn(lines: readonly (readonly Point[])[], stroke: Stroke = pen): Shape {
  const all = lines.flat();
  const left = Math.min(...all.map(([x]) => x));
  const top = Math.min(...all.map(([, y]) => y));
  const w = Math.max(0.01, Math.max(...all.map(([x]) => x)) - left);
  const h = Math.max(0.01, Math.max(...all.map(([, y]) => y)) - top);
  const d = lines
    .map((line) =>
      line
        .map(
          ([x, y], index) =>
            `${index === 0 ? 'M' : 'L'}${Math.round((x - left) * 100)} ${Math.round((y - top) * 100)}`,
        )
        .join(' '),
    )
    .join(' ');
  return {
    t: 'path',
    x: left,
    y: top,
    w,
    h,
    vb: [Math.round(w * 100), Math.round(h * 100)],
    d,
    fill: null,
    stroke,
  };
}

/** The points of a curve from `from` to `to`, pulled towards `via`. */
const curve = (from: Point, via: Point, to: Point, steps = 10): Point[] =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const [a, b, c] = [(1 - t) ** 2, 2 * t * (1 - t), t ** 2];
    return [a * from[0] + b * via[0] + c * to[0], a * from[1] + b * via[1] + c * to[1]];
  });

/**
 * A sprig: a stem from a point, bending as it goes, with leaves to both sides – each leaf a
 * small wash and, a little off it, its outline in ink.
 */
function sprig(
  base: Point,
  degrees: number,
  length: number,
  options: { leaves?: number; bend?: number; size?: number; colors?: readonly Picture[] } = {},
): Shape[] {
  const count = options.leaves ?? 6;
  const bend = options.bend ?? 0.16;
  const size = options.size ?? length * 0.24;
  const colors = options.colors ?? [round.green, round.teal];
  const angle = (degrees * Math.PI) / 180;
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
  const along = (t: number): Point => {
    const off = Math.sin(t * Math.PI * 0.9) * bend * length;
    return [base[0] + dx * length * t - dy * off, base[1] + dy * length * t + dx * off];
  };
  const heading = (t: number) => {
    const [a, b] = [along(t - 0.02), along(t + 0.02)];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  const washes: Shape[] = [];
  const lines: Point[][] = [Array.from({ length: 17 }, (_, index) => along(index / 16))];
  for (let i = 0; i <= count; i += 1) {
    const last = i === count;
    const t = last ? 1 : 0.2 + (i / count) * 0.74;
    const side = last ? 0 : i % 2 === 0 ? 1 : -1;
    const turn = heading(t) + side * (0.85 - i * 0.03);
    const long = size * (last ? 1 : 1 - i * 0.05);
    const from = along(t);
    const tip: Point = [from[0] + Math.cos(turn) * long, from[1] + Math.sin(turn) * long];
    const mid: Point = [(from[0] + tip[0]) / 2, (from[1] + tip[1]) / 2];
    const [nx, ny] = [-Math.sin(turn) * long * 0.3, Math.cos(turn) * long * 0.3];
    lines.push([
      ...curve(from, [mid[0] + nx, mid[1] + ny], tip),
      ...curve(tip, [mid[0] - nx, mid[1] - ny], from),
    ]);
    lines.push([from, [from[0] + (tip[0] - from[0]) * 0.72, from[1] + (tip[1] - from[1]) * 0.72]]);
    // The colour misses its outline a little, as it does when painted first.
    washes.push(
      wash(
        colors[i % colors.length]!,
        mid[0] - long * 0.62 + 0.12,
        mid[1] - long * 0.34 - 0.08,
        long * 1.24,
        long * 0.68,
        (turn * 180) / Math.PI,
      ),
    );
  }
  return [...washes, drawn(lines)];
}

/** A frame as drawn with a ruler in a hurry: four lines that overshoot their corners. */
const frame = (box: Box, over = 0.35): Shape[] => {
  const [l, t, r, b] = [box.x, box.y, box.x + box.w, box.y + box.h];
  return [
    drawn(
      [
        [
          [l - over, t],
          [r + over * 0.6, t - 0.03],
        ],
        [
          [r, t - over * 0.7],
          [r + 0.03, b + over],
        ],
        [
          [r + over, b],
          [l - over * 0.5, b + 0.03],
        ],
        [
          [l, b + over * 0.8],
          [l - 0.03, t - over],
        ],
      ],
      fine,
    ),
  ];
};

/** An ink rule ending in a small ring. */
const ruled = (x: number, y: number, length: number): Shape[] => [
  { t: 'line', x1: x, y1: y, x2: x + length, y2: y, stroke: fine },
  { t: 'ellipse', x: x + length + 0.08, y: y - 0.1, w: 0.2, h: 0.2, fill: null, stroke: fine },
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paper,
    shapes: [
      wash(round.blue, 12.6, -0.6, 15.5, 11.2, -10),
      wash(round.teal, 17.2, 5.6, 11.8, 9.6, 14),
      wash(round.rose, 11.2, 7.6, 8.6, 6.6, -4),
      wash(round.ochre, 22.2, 0.6, 5.2, 4.2, 20),
      ...sprig([15.4, 14.6], -52, 12.5, { leaves: 7, size: 2.7 }),
      ...ruled(1.9, 9.05, 3.2),
    ],
    title: { x: 1.8, y: 3.4, w: 11.6, h: 5.3, valign: 'bottom', sample: 'Farbe,\ndie fließt' },
    subtitle: { x: 1.8, y: 9.5, w: 10.5, h: 1.4, sample: 'Notizen aus dem Skizzenbuch' },
  },
  {
    name: 'Abschnitt',
    bg: paper,
    shapes: [
      wash(round.violet, 15.4, 1.6, 11.6, 11.2, 8),
      wash(band.ochre, -1.2, 4.3, 23.5, 7.2, -2),
      wash(round.rose, 19.6, 7.4, 7.4, 6.2, -12),
      ...sprig([20.6, 13.6], -78, 9.5, { leaves: 6, size: 2.2, bend: -0.14 }),
    ],
    title: { x: 2.4, y: 5.3, w: 15.6, h: 4.2, size: 46, valign: 'middle', sample: 'Nass in Nass' },
    subtitle: { x: 2.4, y: 11.9, w: 14, h: 1.4, sample: 'Zweiter Teil: das Wasser arbeitet mit' },
  },
  {
    name: 'Inhalt',
    bg: paper,
    shapes: [
      wash(round.teal, 0.4, 0.5, 7.4, 3.6, -3),
      wash(round.blue, 20.6, 9.2, 9.2, 8, 10),
      wash(round.ochre, 24.2, 6.9, 3.6, 3, 0),
      ...sprig([27.2, 15.4], -122, 7.6, { leaves: 5, size: 1.9, bend: 0.12 }),
      ...ruled(1.9, 3.85, 23.8),
    ],
    title: {
      x: 1.8,
      y: 1.1,
      w: 24.4,
      h: 2.5,
      size: 36,
      valign: 'bottom',
      sample: 'Was ein Aquarell braucht',
    },
    body: {
      x: 1.8,
      y: 4.5,
      w: 19,
      h: 9.8,
      sample: [
        'Gutes Papier, das Wasser lange hält',
        'Wenige Farben, dafür viel Geduld',
        'Das Weiß ist das Papier selbst',
        'Erst die hellen Flächen, dann die dunklen',
        'Wissen, wann man aufhört',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: paper,
    shapes: [
      wash(round.violet, 12.6, 0.9, 15.6, 13.2, 6),
      wash(round.rose, 20.4, 9.4, 8, 6.4, -8),
      wash(round.teal, 13.2, 10.6, 5.4, 4.2, 12),
      ...frame({ x: 14.9, y: 2.6, w: 11.2, h: 10.5 }),
    ],
    pictures: [{ x: 15.2, y: 2.9, w: 10.6, h: 9.9 }],
    title: {
      x: 1.8,
      y: 1.3,
      w: 11.6,
      h: 3.1,
      size: 34,
      valign: 'bottom',
      sample: 'Draußen gemalt',
    },
    body: {
      x: 1.8,
      y: 5,
      w: 11.6,
      h: 9.3,
      sample: [
        'Ein Kasten, ein Pinsel, ein Becher',
        'Das Licht wartet nicht',
        'Die Skizze darf offen bleiben',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: paper,
    shapes: [
      wash(band.blue, 1.2, 4.1, 9.6, 1.5, -1),
      wash(band.ochre, 14.6, 4.1, 9.6, 1.5, 1),
      wash(round.green, 22.6, -1.4, 6.6, 5, 0),
      wash(round.rose, 22.4, 11.6, 7.6, 5.8, -10),
      wash(round.teal, 19.8, 13.2, 5, 3.8, 8),
      { t: 'line', x1: 14, y1: 4.5, x2: 14, y2: 14, stroke: fine },
      { t: 'ellipse', x: 13.9, y: 14.1, w: 0.2, h: 0.2, fill: null, stroke: fine },
    ],
    title: {
      x: 1.8,
      y: 1.1,
      w: 22,
      h: 2.5,
      size: 36,
      valign: 'bottom',
      sample: 'Lasieren oder lavieren',
    },
    body: [
      {
        x: 1.8,
        y: 6.1,
        w: 11.2,
        h: 8.2,
        size: 19,
        sample: [
          'Schicht über trockene Schicht',
          'Farben mischen sich im Auge',
          'Tiefe ohne Schwere',
        ],
      },
      {
        x: 15.2,
        y: 6.1,
        w: 11,
        h: 8.2,
        size: 19,
        sample: [
          'Farbe in die nasse Fläche',
          'Verläufe, die niemand plant',
          'Weiche Ränder, viel Luft',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: paper,
    shapes: [
      wash(round.teal, 9.4, 0.9, 8.4, 7.2, 14),
      wash(band.rose, 0.6, 8, 16.6, 4.4, -3),
      wash(round.ochre, 0.4, 2.6, 4.6, 3.8, 0),
      ...ruled(17.6, 5.2, 2.4),
    ],
    title: {
      x: 1.8,
      y: 3.4,
      w: 14.4,
      h: 7.6,
      size: 130,
      align: 'left',
      valign: 'middle',
      sample: '300 g',
    },
    body: {
      x: 17.5,
      y: 5.8,
      w: 8.8,
      h: 6,
      size: 21,
      sample: 'wiegt ein Quadratmeter gutes Aquarellpapier. Darunter wellt sich jedes Blatt.',
    },
  },
  {
    name: 'Zitat',
    bg: paper,
    shapes: [
      wash(round.blue, -2.4, -2.2, 12, 9, -12),
      wash(round.violet, 4.6, -1.6, 7, 5.4, 10),
      wash(round.teal, 19.2, 9.4, 11.4, 8.6, 8),
      wash(round.ochre, 15.6, 12, 7, 5, -6),
      wash(round.rose, 11.9, 1.5, 4.2, 3.4, 0),
      {
        t: 'text',
        x: 11.5,
        y: 1.75,
        w: 5,
        h: 3,
        text: '“',
        font: 'Lora',
        bold: true,
        size: 96,
        color: ink,
        align: 'center',
        valign: 'top',
      },
    ],
    body: {
      x: 4.6,
      y: 4.7,
      w: 18.8,
      h: 5.4,
      font: 'Lora',
      italic: true,
      bold: false,
      size: 30,
      lineHeight: 118,
      align: 'center',
      valign: 'middle',
      sample: 'Das Wasser malt mit. Man muss ihm nur rechtzeitig aus dem Weg gehen.',
    },
    subtitle: {
      x: 7,
      y: 10.5,
      w: 14,
      h: 1.4,
      align: 'center',
      valign: 'middle',
      sample: 'Aus dem Malkurs',
    },
  },
  {
    name: 'Bild',
    bg: paper,
    shapes: [
      wash(round.blue, -1.6, -1.8, 11.6, 8.6, -8),
      wash(round.ochre, 18.4, 7.6, 11, 8.2, 6),
      wash(round.rose, 21.6, -0.8, 6.4, 5, 16),
      wash(round.green, 0.2, 9.4, 5.6, 4.4, 0),
      ...frame({ x: 2.3, y: 1.3, w: 23.4, h: 11 }),
    ],
    pictures: [{ x: 2.6, y: 1.6, w: 22.8, h: 10.4 }],
    title: {
      x: 2.6,
      y: 12.8,
      w: 18,
      h: 1.6,
      size: 24,
      italic: true,
      valign: 'middle',
      sample: 'Blick über die Bucht, vormittags',
    },
  },
  {
    name: 'Schluss',
    bg: paper,
    shapes: [
      wash(round.blue, 4.6, 0.6, 14.4, 11.4, -10),
      wash(round.rose, 11.4, 2.4, 12.6, 10.6, 8),
      wash(round.ochre, 8.6, 7.4, 10.8, 7.6, -4),
      ...sprig([19.6, 13.9], -18, 6.4, { leaves: 5, size: 1.5, bend: -0.12 }),
      ...sprig([8.4, 13.9], -162, 6.4, { leaves: 5, size: 1.5, bend: 0.12 }),
    ],
    title: {
      x: 4,
      y: 3.8,
      w: 20,
      h: 4.2,
      size: 62,
      align: 'center',
      valign: 'bottom',
      sample: 'Vielen Dank',
    },
    subtitle: { x: 6, y: 8.5, w: 16, h: 1.4, align: 'center', sample: 'Lassen Sie es trocknen' },
  },
];

const template: Template = {
  slug: 'aquarell',
  name: 'Aquarell',
  group: 'Kunststil',
  tags: [
    'Aquarell',
    'Wasserfarbe',
    'Lavierung',
    'Tusche',
    'hell',
    'ruhig',
    'leicht',
    'Natur',
    'Skizzenbuch',
  ],
  description:
    'Weißes Aquarellpapier mit durchscheinenden Lavierungen, die ineinanderlaufen, und feinen Tuschelinien.',
  palette: {
    bg: paper,
    text: ink,
    bg2: shell,
    text2: pencil,
    accents: [blue, teal, rose, ochre, violet, green],
  },
  fonts: { head: 'Lora', body: 'Quicksand' },
  text: {
    title: { font: 'Lora', size: 56, color: ink, lineHeight: 102 },
    subtitle: { font: 'Quicksand', size: 19, color: pencil, bold: true },
    body: { font: 'Quicksand', size: 21, color: ink, bold: true, lineHeight: 125, paraSpace: 0.32 },
  },
  layouts,
};

export default template;
