import { grain, jpeg, noise, paint, PX, rgb, rng } from '../art';
import type { Box, Color, Layout, Picture, Shape, Template } from '../model';
import { blob, page } from '../shapes';

/*
 * Botanik: a page from a plant collector's notebook. Cream paper with its grain, sage, moss and
 * clay, twigs and ferns drawn with a fine pen – their colour printed a little beside the line, as
 * on an old plate – and soft blobs of tint behind them. Much air, nothing loud.
 */

const paperColor = '#f3eee2';
const ink = '#2c3628';
const moss = '#5a6946';
const sage = '#a9b89b';
const sageLight = '#d7deca';
const clay = '#b9775a';
const clayLight = '#e7c9b6';
const ochre = '#c8a45e';
const mist = '#8a9a93';
const quiet = '#676d5c';

type Pt = readonly [number, number];
type Curve = (t: number) => Pt;

/** The paper every page lies on: clouded a little, with a soft tooth. */
const paperPicture: Picture = (() => {
  const surface = paint(undefined, PX * 0.62);
  const { ctx, w, h } = surface;
  const field = noise(21);
  const [r, g, b] = rgb(paperColor);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const shade = 1 + (field(x / 170, y / 170, 5) - 0.5) * 0.07;
      const i = (y * w + x) * 4;
      image.data[i] = r * shade;
      image.data[i + 1] = g * shade;
      image.data[i + 2] = b * shade;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  grain(surface, 0.05, 5);
  return jpeg(surface, 74);
})();

const ground: Shape = { t: 'image', ...page, src: paperPicture };

/** A stem from one point to another, bowed to the side by `bend` of its length. */
const bow = (from: Pt, to: Pt, bend: number): Curve => {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const control: Pt = [(from[0] + to[0]) / 2 - dy * bend, (from[1] + to[1]) / 2 + dx * bend];
  return (t) => [
    (1 - t) ** 2 * from[0] + 2 * t * (1 - t) * control[0] + t ** 2 * to[0],
    (1 - t) ** 2 * from[1] + 2 * t * (1 - t) * control[1] + t ** 2 * to[1],
  ];
};

/** A stem along a circle, from one angle to another (degrees, 90 = below the centre). */
const arc =
  (cx: number, cy: number, radius: number, from: number, to: number): Curve =>
  (t) => {
    const angle = ((from + (to - from) * t) * Math.PI) / 180;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  };

const u = (value: number) => Math.round(value * 100);
const at = ([x, y]: Pt) => `${u(x)} ${u(y)}`;

/** A leaf from `base` towards `angle`: its outline, and its midrib. */
function leafPaths(base: Pt, angle: number, length: number, width: number, shift: Pt = [0, 0]) {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const from: Pt = [base[0] + shift[0], base[1] + shift[1]];
  const tip: Pt = [from[0] + cos * length, from[1] + sin * length];
  const side = (sign: number): Pt => [
    from[0] + cos * length * 0.42 - sin * width * sign,
    from[1] + sin * length * 0.42 + cos * width * sign,
  ];
  const rib: Pt = [from[0] + cos * length * 0.82, from[1] + sin * length * 0.82];
  return {
    outline: `M${at(from)} Q${at(side(1))} ${at(tip)} Q${at(side(-1))} ${at(from)} Z`,
    rib: `M${at(from)} L${at(rib)}`,
  };
}

/** A small ring (a berry, a bud) as four curves. */
function ringPath(centre: Pt, radius: number, shift: Pt = [0, 0]) {
  const [x, y] = [centre[0] + shift[0], centre[1] + shift[1]];
  const k = radius;
  return `M${at([x - k, y])} Q${at([x - k, y - k])} ${at([x, y - k])} Q${at([x + k, y - k])} ${at([x + k, y])} Q${at([x + k, y + k])} ${at([x, y + k])} Q${at([x - k, y + k])} ${at([x - k, y])} Z`;
}

interface PlantLook {
  kind: 'leaf' | 'fern' | 'round' | 'berry';
  /** How many leaves (or pairs) along the stem. */
  count: number;
  /** Length of the largest leaf, centimetres. */
  size: number;
  /** Where along the stem the first leaf sits, 0 … 1. */
  start?: number;
  line?: Color;
  width?: number;
  /** The colour printed beside the line; `null` for a bare drawing. */
  tint?: Color | null;
  tintOpacity?: number;
  seed?: number;
}

/** A plant drawn with a pen along a stem: its tint first, a little off, then the line. */
function plant(stem: Curve, look: PlantLook): Shape[] {
  const random = rng(look.seed ?? 1);
  const shift: Pt = [0.16, 0.11];
  const tangent = (t: number) => {
    const [a, b] = [stem(Math.max(0, t - 0.01)), stem(Math.min(1, t + 0.01))];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  let line = `M${at(stem(0))}`;
  for (let i = 1; i <= 24; i += 1) line += ` L${at(stem(i / 24))}`;
  let tint = '';
  const start = look.start ?? 0.22;
  const add = (base: Pt, angle: number, length: number, width: number) => {
    const drawn = leafPaths(base, angle, length, width);
    line += ` ${drawn.outline} ${drawn.rib}`;
    tint += ` ${leafPaths(base, angle, length, width, shift).outline}`;
  };
  for (let index = 0; index < look.count; index += 1) {
    const t = start + ((1 - start) * index) / look.count;
    const base = stem(t);
    const along = tangent(t);
    const wobble = () => random.range(-0.09, 0.09);
    if (look.kind === 'leaf') {
      const length = look.size * (1 - 0.5 * t) * random.range(0.9, 1.08);
      const side = index % 2 === 0 ? 1 : -1;
      add(base, along + side * (0.82 + wobble()), length, length * 0.27);
    } else if (look.kind === 'fern') {
      // Longest a little above the foot, then tapering to the tip.
      const profile = Math.sin(Math.PI * (0.18 + 0.82 * (index / look.count))) ** 0.8;
      const length = look.size * (0.16 + 0.84 * profile);
      add(base, along + 1.08 + wobble(), length, length * 0.13);
      add(base, along - 1.08 + wobble(), length, length * 0.13);
    } else if (look.kind === 'round') {
      const length = look.size * (1 - 0.45 * t);
      add(base, along + 1.05 + wobble(), length, length * 0.5);
      add(base, along - 1.05 + wobble(), length, length * 0.5);
    } else {
      const side = index % 2 === 0 ? 1 : -1;
      const reach = look.size * (1 - 0.3 * t);
      const angle = along + side * (0.75 + wobble());
      const end: Pt = [base[0] + Math.cos(angle) * reach, base[1] + Math.sin(angle) * reach];
      const centre: Pt = [end[0] + Math.cos(angle) * 0.16, end[1] + Math.sin(angle) * 0.16];
      line += ` M${at(base)} L${at(end)} ${ringPath(centre, 0.16)}`;
      tint += ` ${ringPath(centre, 0.16, [0.06, 0.05])}`;
    }
  }
  // The tip: one leaf straight on (ferns and berries end in the bare stem).
  if (look.kind === 'leaf' || look.kind === 'round') {
    const length = look.size * (look.kind === 'round' ? 0.5 : 0.52);
    add(stem(1), tangent(1), length, length * (look.kind === 'round' ? 0.5 : 0.27));
  }
  const frame = { ...page, vb: [2800, 1575] as const };
  const shapes: Shape[] = [];
  if (look.tint !== null) {
    shapes.push({
      t: 'path',
      ...frame,
      d: tint.trim(),
      fill: { t: 'solid', color: look.tint ?? sage, opacity: look.tintOpacity ?? 0.6 },
    });
  }
  shapes.push({
    t: 'path',
    ...frame,
    d: line,
    fill: null,
    stroke: {
      color: look.line ?? moss,
      width: look.width ?? 0.04,
      cap: 'round',
      join: 'round',
    },
  });
  return shapes;
}

/** A soft patch of tint. */
const patch = (box: Box, color: Color, seed: number, opacity = 0.75): Shape =>
  blob(box, rng(seed), { t: 'solid', color, opacity }, { points: 7, wobble: 0.3 });

const hair = (x: number, y: number, length: number, color: Color = clay): Shape => ({
  t: 'line',
  x1: x,
  y1: y,
  x2: x + length,
  y2: y,
  stroke: { color, width: 0.05, cap: 'round' },
});

/** A fine frame set a little off a picture. */
const frame = (box: Box, off = 0.35): Shape => ({
  t: 'rect',
  x: box.x - off,
  y: box.y - off,
  w: box.w + off * 2,
  h: box.h + off * 2,
  fill: null,
  stroke: { color: moss, width: 0.035 },
});

const sideBySide: Box = { x: 1.9, y: 1.9, w: 10.4, h: 11.95 };
const large: Box = { x: 9.8, y: 1.6, w: 16.3, h: 10.6 };

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paperColor,
    shapes: [
      ground,
      patch({ x: 14.4, y: -2, w: 15.5, h: 15.5 }, sageLight, 3),
      patch({ x: 21.6, y: 9.4, w: 7.4, h: 7.4 }, clayLight, 9, 0.7),
      ...plant(bow([26, 16.3], [25, 4.8], -0.1), { kind: 'fern', count: 17, size: 2.5, seed: 4 }),
      ...plant(bow([20.6, 16.3], [17.6, 2], 0.13), {
        kind: 'leaf',
        count: 9,
        size: 3.5,
        seed: 2,
        width: 0.045,
      }),
      ...plant(bow([15.2, 16.3], [13.9, 9.6], 0.1), {
        kind: 'round',
        count: 5,
        size: 1.15,
        tint: clayLight,
        tintOpacity: 0.85,
        seed: 6,
      }),
      hair(1.9, 10.05, 2.4),
    ],
    title: {
      x: 1.8,
      y: 2.6,
      w: 12,
      h: 6.9,
      size: 56,
      sample: 'Stille\nGärten',
    },
    subtitle: { x: 1.8, y: 10.5, w: 11.4, h: 2.4, sample: 'Ein Jahr zwischen Beet und Wiese' },
  },
  {
    name: 'Abschnitt',
    bg: moss,
    shapes: [
      ground,
      {
        t: 'rect',
        x: -0.2,
        y: -0.2,
        w: 28.4,
        h: 16.15,
        fill: { t: 'solid', color: moss, opacity: 0.93 },
      },
      ...plant(arc(14, 7.7, 5.9, 104, 262), {
        kind: 'leaf',
        count: 11,
        size: 2.1,
        start: 0.06,
        line: '#e9eedd',
        tint: sage,
        tintOpacity: 0.45,
        seed: 12,
      }),
      ...plant(arc(14, 7.7, 5.9, 76, -82), {
        kind: 'leaf',
        count: 11,
        size: 2.1,
        start: 0.06,
        line: '#e9eedd',
        tint: sage,
        tintOpacity: 0.45,
        seed: 14,
      }),
      hair(12.9, 8.75, 2.2, clayLight),
    ],
    title: {
      x: 9.4,
      y: 4.6,
      w: 9.2,
      h: 3.8,
      align: 'center',
      size: 44,
      color: paperColor,
      sample: 'Frühling',
    },
    subtitle: {
      x: 9.6,
      y: 9.1,
      w: 8.8,
      h: 1.9,
      align: 'center',
      color: sageLight,
      sample: 'Was zuerst austreibt',
    },
  },
  {
    name: 'Inhalt',
    bg: paperColor,
    shapes: [
      ground,
      patch({ x: 21.4, y: 5.6, w: 9, h: 10 }, clayLight, 17, 0.6),
      ...plant(bow([25.4, 16.3], [23.6, 1.5], 0.08), {
        kind: 'fern',
        count: 20,
        size: 2.7,
        seed: 8,
      }),
      ...plant(bow([22.3, 16.3], [20.9, 11.4], -0.12), {
        kind: 'berry',
        count: 6,
        size: 0.9,
        tint: clay,
        tintOpacity: 0.8,
        seed: 3,
      }),
      hair(1.9, 3.8, 2.4),
    ],
    title: { x: 1.8, y: 1.2, w: 18.4, h: 2.3, valign: 'middle', size: 36 },
    body: {
      x: 1.8,
      y: 4.7,
      w: 17.8,
      h: 9.6,
      sample: [
        'Im März kommt das Licht in den Garten zurück',
        'Farne entrollen sich vor dem ersten Schatten',
        'Salbei und Thymian mögen es trocken',
        'Wer wenig gießt, bekommt tiefere Wurzeln',
        'Im Herbst bleibt das Laub als Decke liegen',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: paperColor,
    shapes: [
      ground,
      patch({ x: 19.6, y: 10.4, w: 10, h: 7 }, sageLight, 23),
      frame(sideBySide),
      ...plant(bow([28.3, 14.9], [19.8, 13.7], 0.14), {
        kind: 'leaf',
        count: 8,
        size: 1.5,
        start: 0.12,
        seed: 21,
      }),
      hair(14.3, 5.2, 2.4),
    ],
    title: { x: 14.2, y: 1.4, w: 12, h: 3.4, size: 32 },
    body: { x: 14.2, y: 5.8, w: 12, h: 6.4, size: 20 },
    pictures: [sideBySide],
  },
  {
    name: 'Zwei Spalten',
    bg: paperColor,
    shapes: [
      ground,
      patch({ x: 21.5, y: -3.6, w: 9.5, h: 7.4 }, sageLight, 31),
      patch({ x: -2.6, y: 11.6, w: 7, h: 6.4 }, clayLight, 33, 0.55),
      ...plant(bow([14, 15], [14, 4.7], 0.05), {
        kind: 'leaf',
        count: 9,
        size: 1.15,
        start: 0.16,
        seed: 30,
      }),
      hair(1.9, 3.8, 2.4),
    ],
    title: { x: 1.8, y: 1.2, w: 19, h: 2.3, valign: 'middle', size: 36 },
    body: [
      { x: 1.8, y: 4.8, w: 10.6, h: 9.4, size: 20 },
      { x: 15.6, y: 4.8, w: 10.6, h: 9.4, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: paperColor,
    shapes: [
      ground,
      patch({ x: 1.4, y: 1.5, w: 12.8, h: 12.8 }, clay, 41, 1),
      ...plant(bow([12.6, 16.3], [15.4, 3.4], -0.14), {
        kind: 'fern',
        count: 17,
        size: 2,
        seed: 44,
      }),
      ...plant(bow([2.2, 16.3], [0.9, 9.6], 0.12), {
        kind: 'round',
        count: 5,
        size: 1.1,
        seed: 47,
      }),
      hair(17.5, 5.5, 2.4),
    ],
    title: {
      x: 2.4,
      y: 4.9,
      w: 10.4,
      h: 6,
      valign: 'middle',
      align: 'center',
      size: 92,
      color: paperColor,
      sample: '68 %',
    },
    body: {
      x: 17.4,
      y: 6,
      w: 8.8,
      h: 5.6,
      size: 24,
      sample: 'der heimischen Wildbienen brauchen offene Erde. Ein Beet ohne Mulch genügt.',
    },
  },
  {
    name: 'Zitat',
    bg: sageLight,
    shapes: [
      ground,
      {
        t: 'rect',
        x: -0.2,
        y: -0.2,
        w: 28.4,
        h: 16.15,
        fill: { t: 'solid', color: sageLight, opacity: 0.86 },
      },
      patch({ x: -3, y: 9, w: 11, h: 9 }, paperColor, 52, 0.7),
      patch({ x: 20, y: -3, w: 11, h: 8 }, paperColor, 55, 0.7),
      ...plant(bow([-0.4, 15.4], [7.4, 10.4], 0.2), {
        kind: 'leaf',
        count: 8,
        size: 1.8,
        start: 0.1,
        seed: 51,
      }),
      ...plant(bow([28.4, 14.6], [21.6, 11.6], -0.16), {
        kind: 'fern',
        count: 14,
        size: 1.6,
        start: 0.08,
        seed: 53,
      }),
      ...plant(bow([28.4, 0.4], [23, 3.2], 0.16), {
        kind: 'berry',
        count: 7,
        size: 0.9,
        start: 0.1,
        tint: clay,
        tintOpacity: 0.8,
        seed: 57,
      }),
      {
        t: 'text',
        x: 11,
        y: 1,
        w: 6,
        h: 3.6,
        text: '“',
        font: 'Fraunces',
        size: 120,
        color: clay,
        align: 'center',
        valign: 'top',
      },
    ],
    body: {
      x: 4.6,
      y: 4.3,
      w: 18.8,
      h: 5.4,
      valign: 'middle',
      align: 'center',
      font: 'Fraunces',
      italic: true,
      size: 31,
      lineHeight: 120,
      sample: 'Ein Garten wird nicht fertig. Er wird nur jedes Jahr ein wenig mehr er selbst.',
    },
    subtitle: {
      x: 6,
      y: 10.3,
      w: 16,
      h: 1.4,
      align: 'center',
      size: 15,
      upper: true,
      spacing: 2.4,
      sample: 'Johanna Wied, Gärtnerin',
    },
  },
  {
    name: 'Bild',
    bg: paperColor,
    shapes: [
      ground,
      patch({ x: -2.4, y: 3.6, w: 10.4, h: 13 }, sageLight, 61),
      ...plant(bow([5.4, 16.3], [6.3, 1.7], 0.09), {
        kind: 'round',
        count: 9,
        size: 1.3,
        seed: 62,
      }),
      ...plant(bow([2.4, 16.3], [1.9, 8.6], -0.1), {
        kind: 'leaf',
        count: 6,
        size: 1.7,
        tint: clayLight,
        tintOpacity: 0.9,
        seed: 64,
      }),
      frame(large),
    ],
    pictures: [large],
    title: {
      x: 9.8,
      y: 12.8,
      w: 16.3,
      h: 1.8,
      valign: 'middle',
      italic: true,
      size: 24,
      sample: 'Morgens im Kräuterbeet',
    },
  },
  {
    name: 'Schluss',
    bg: paperColor,
    shapes: [
      ground,
      patch({ x: 6, y: 8.6, w: 16, h: 10 }, sageLight, 71, 0.6),
      ...plant(bow([2.6, 16.3], [2, 9.6], 0.1), { kind: 'leaf', count: 6, size: 1.7, seed: 72 }),
      ...plant(bow([6.2, 16.3], [7.1, 8.6], -0.08), {
        kind: 'fern',
        count: 13,
        size: 1.7,
        seed: 73,
      }),
      ...plant(bow([9.9, 16.3], [9.5, 10.8], 0.1), {
        kind: 'berry',
        count: 6,
        size: 0.9,
        tint: clay,
        tintOpacity: 0.8,
        seed: 74,
      }),
      ...plant(bow([13.6, 16.3], [14.2, 8.2], 0.07), {
        kind: 'round',
        count: 7,
        size: 1.2,
        tint: clayLight,
        tintOpacity: 0.9,
        seed: 75,
      }),
      ...plant(bow([17.6, 16.3], [17, 10.2], -0.1), {
        kind: 'leaf',
        count: 6,
        size: 1.6,
        seed: 76,
      }),
      ...plant(bow([21.4, 16.3], [22.2, 8.4], 0.08), {
        kind: 'fern',
        count: 14,
        size: 1.8,
        seed: 77,
      }),
      ...plant(bow([25.4, 16.3], [25.9, 10.4], -0.09), {
        kind: 'round',
        count: 5,
        size: 1.1,
        seed: 78,
      }),
      hair(12.8, 5.55, 2.4),
    ],
    title: {
      x: 3,
      y: 1.5,
      w: 22,
      h: 3.6,
      align: 'center',
      size: 56,
      sample: 'Danke',
    },
    subtitle: {
      x: 5,
      y: 6,
      w: 18,
      h: 1.6,
      align: 'center',
      sample: 'Fragen wachsen am besten im Gespräch',
    },
  },
];

const template: Template = {
  slug: 'botanik',
  name: 'Botanik',
  group: 'Kunststil',
  tags: ['Natur', 'Pflanzen', 'ruhig', 'Strichzeichnung', 'Papier', 'Salbei', 'Garten', 'Wellness'],
  description:
    'Ruhige Natur auf Papier: Salbei, Moos und Ton, fein gezeichnete Zweige und Farne, viel Luft.',
  palette: {
    bg: paperColor,
    text: ink,
    bg2: sageLight,
    text2: quiet,
    accents: [moss, sage, clay, clayLight, ochre, mist],
  },
  fonts: { head: 'Fraunces', body: 'Nunito Sans' },
  text: {
    title: { font: 'Fraunces', size: 54, color: ink, lineHeight: 100 },
    subtitle: { font: 'Nunito Sans', size: 20, color: quiet, lineHeight: 120 },
    body: { font: 'Nunito Sans', size: 22, color: ink, lineHeight: 125, paraSpace: 0.42 },
  },
  layouts,
};

export default template;
