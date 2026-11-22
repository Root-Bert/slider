import { createCanvas } from '@napi-rs/canvas';
import { jpeg, noise, rgb } from '../art';
import type { Box, Color, FillLike, Layout, Picture, Shape, Stroke, Template } from '../model';
import { PAGE } from '../model';
import { page } from '../shapes';

/*
 * Psychedelic: a 1960s concert poster – liquid bands of colours that should not go together,
 * rings that melt, frames that bulge and echo outwards. What a slide says sits on calm fields.
 */

const cream = '#fff3d1';
const night = '#2b0b45';
const violet = '#5a1aa8';
const magenta = '#e6007e';
const orange = '#ff7a00';
const yellow = '#ffd000';
const lime = '#a8e000';
const teal = '#00b3a6';

const hot: readonly Color[] = [magenta, orange, yellow, lime, violet];

type Point = readonly [number, number];

/**
 * A page of flat colour bands: `value` says for a place (centimetres) which band it lies in
 * (its whole part picks the colour) or gives a colour itself. Drawn twice as large and scaled
 * down, so the edges come out smooth.
 */
function bands(
  value: (x: number, y: number) => number | Color,
  colors: readonly Color[],
  width = 1600,
): Picture {
  const [w, h] = [width * 2, Math.round((width * PAGE.h) / PAGE.w) * 2];
  const big = createCanvas(w, h);
  const ctx = big.getContext('2d');
  const image = ctx.createImageData(w, h);
  const table = colors.map(rgb);
  const named = new Map<Color, [number, number, number]>();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const at = value((x / w) * PAGE.w, (y / h) * PAGE.h);
      let color: [number, number, number];
      if (typeof at === 'string') {
        color = named.get(at) ?? rgb(at);
        named.set(at, color);
      } else {
        const index = Math.floor(at) % table.length;
        color = table[index < 0 ? index + table.length : index]!;
      }
      const i = (y * w + x) * 4;
      image.data[i] = color[0];
      image.data[i + 1] = color[1];
      image.data[i + 2] = color[2];
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const small = createCanvas(w / 2, h / 2);
  const out = small.getContext('2d');
  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = 'high';
  out.drawImage(big, 0, 0, w / 2, h / 2);
  return jpeg(small, 80);
}

/** Liquid marbling: the contour lines of a noise field that was stirred. */
const liquid = (() => {
  const [a, b, c] = [noise(21), noise(22), noise(23)];
  return bands((x, y) => {
    const [u, v] = [x / 8, y / 8];
    const wu = u + 1.5 * (a(u, v, 2) - 0.5);
    const wv = v + 1.5 * (b(u + 4, v + 4, 2) - 0.5);
    return c(wu * 0.85, wv * 0.85, 2) * 26 + x * 0.12 + 40;
  }, hot);
})();

/** Rings round a centre that lose their shape, ending in a calm field. */
const TUNNEL = { x: 8.4, y: 7.9 } as const;
const tunnel = (() => {
  const field = noise(31);
  return bands(
    (x, y) => {
      const [dx, dy] = [x - TUNNEL.x, y - TUNNEL.y];
      const r = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const melted =
        r * (1 + 0.09 * Math.sin(6 * angle + r * 0.55) + 0.045 * Math.sin(11 * angle - r * 0.9)) +
        1.5 * (field(x / 5, y / 5, 2) - 0.5) * Math.min(1, r / 4);
      return melted > 10.6 ? night : melted / 0.82 + 50;
    },
    [magenta, orange, yellow, lime, violet, teal],
  );
})();

/** A spiral of five arms, one of each colour. */
const spiral = (() => {
  const field = noise(41);
  return bands((x, y) => {
    const [dx, dy] = [x - 14, y - 7.9];
    const r = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const wobble = 1 + 0.07 * Math.sin(7 * angle + r * 0.8);
    return (
      r * wobble * 0.62 + (angle / (Math.PI * 2)) * 5 + 1.3 * (field(x / 6, y / 6, 2) - 0.5) + 50
    );
  }, hot);
})();

const whole = (src: Picture): Shape => ({ t: 'image', ...page, src });

/** A frame whose sides bow outwards, as if blown up. */
function bulge(
  box: Box,
  fill: FillLike,
  options: { bow?: number; r?: number; stroke?: Stroke; rotate?: number } = {},
): Shape {
  const bx = options.bow ?? 0.4;
  const by = bx * 0.8;
  const r = Math.min(options.r ?? 1.1, box.w / 2, box.h / 2);
  const [w, h] = [box.w, box.h];
  const p = (x: number, y: number) => `${Math.round((x + bx) * 100)} ${Math.round((y + by) * 100)}`;
  const d = [
    `M${p(r, 0)}`,
    `Q${p(w / 2, -2 * by)} ${p(w - r, 0)}`,
    `Q${p(w, 0)} ${p(w, r)}`,
    `Q${p(w + 2 * bx, h / 2)} ${p(w, h - r)}`,
    `Q${p(w, h)} ${p(w - r, h)}`,
    `Q${p(w / 2, h + 2 * by)} ${p(r, h)}`,
    `Q${p(0, h)} ${p(0, h - r)}`,
    `Q${p(-2 * bx, h / 2)} ${p(0, r)}`,
    `Q${p(0, 0)} ${p(r, 0)} Z`,
  ].join(' ');
  return {
    t: 'path',
    x: box.x - bx,
    y: box.y - by,
    w: w + 2 * bx,
    h: h + 2 * by,
    d,
    vb: [Math.round((w + 2 * bx) * 100), Math.round((h + 2 * by) * 100)],
    fill,
    stroke: options.stroke,
    rotate: options.rotate,
  };
}

const grown = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  w: box.w + by * 2,
  h: box.h + by * 2,
});

/** A bulging frame with its echoes: the same shape again and again, larger, in other colours. */
const echo = (box: Box, fill: Color, colors: readonly Color[], step = 0.42, bow = 0.4): Shape[] => [
  ...colors
    .map((color, index) =>
      bulge(grown(box, (index + 1) * step), color, {
        bow: bow + (index + 1) * 0.1,
        r: 1.1 + (index + 1) * step,
      }),
    )
    .reverse(),
  bulge(box, fill, { bow }),
];

/** A disc whose rim wanders in and out. */
function wobbly(
  cx: number,
  cy: number,
  radius: number,
  fill: FillLike,
  lobes = 7,
  depth = 0.06,
  phase = 0,
): Shape {
  const count = 96;
  return {
    t: 'poly',
    fill,
    pts: Array.from({ length: count }, (_, index): Point => {
      const angle = (index / count) * Math.PI * 2;
      const r =
        radius *
        (1 + depth * Math.sin(lobes * angle + phase) + depth * 0.4 * Math.sin(3 * angle - phase));
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
    }),
  };
}

/** Wobbly rings round a centre, the largest first. */
const rings = (
  cx: number,
  cy: number,
  radius: number,
  colors: readonly Color[],
  lobes = 7,
): Shape[] =>
  colors.map((color, index) =>
    wobbly(
      cx,
      cy,
      radius * (1 - index / (colors.length + 0.35)),
      color,
      lobes,
      0.05 + index * 0.012,
      index * 0.7,
    ),
  );

/** Colour running down from the top edge in drops, band inside band. */
function drips(
  colors: readonly Color[],
  base: number,
  drops: readonly (readonly [x: number, length: number])[],
  gap = 0.55,
): Shape[] {
  const edge = (x: number) =>
    base +
    0.35 * Math.sin(x * 0.55 + 1) +
    drops.reduce((sum, [at, length]) => sum + length * Math.exp(-(((x - at) / 0.75) ** 4)), 0);
  return colors.map((color, index): Shape => {
    const pts: Point[] = [
      [-1, -1],
      [PAGE.w + 1, -1],
    ];
    for (let x = PAGE.w + 1; x >= -1; x -= 0.125) {
      // Each inner band hangs a little less far – and its drops are thinner.
      const y = edge(x) - index * gap - index * 0.12 * (edge(x) - base);
      pts.push([x, Math.max(-1, y)]);
    }
    return { t: 'poly', fill: color, pts };
  });
}

/** Wavy bands standing along the left edge, band inside band. */
function shore(colors: readonly Color[], reach: number, gap = 0.62): Shape[] {
  return colors.map((color, index): Shape => {
    const pts: Point[] = [
      [-1, PAGE.h + 1],
      [-1, -1],
    ];
    for (let y = -1; y <= PAGE.h + 1; y += 0.125) {
      const x =
        reach -
        index * gap +
        0.55 * Math.sin(y * 0.62 + index * 0.35) +
        0.22 * Math.sin(y * 1.7 + 2 - index * 0.5);
      pts.push([x, y]);
    }
    return { t: 'poly', fill: color, pts };
  });
}

const pill = (box: Box, fill: Color): Shape => ({ t: 'rect', ...box, r: box.h / 2, fill });

/** Nested rounded frames round a picture. */
const frames = (box: Box, colors: readonly Color[], step = 0.42): Shape[] =>
  colors
    .map((color, index): Shape => ({
      t: 'rect',
      ...grown(box, (index + 1) * step),
      r: 0.5 + (index + 1) * step,
      fill: color,
    }))
    .reverse();

const bullets = [
  'Farben, die laut miteinander streiten',
  'Formen, die fließen statt stehen',
  'Schrift als Bild, nicht als Beipackzettel',
  'Ruhige Flächen für alles, was zählt',
  'Ein Abend, der im Kopf bleibt',
];

const titleBox: Box = { x: 2.3, y: 3.1, w: 15.2, h: 6.6 };
const quoteBox: Box = { x: 4.4, y: 2.9, w: 19.2, h: 8 };
const bildBox: Box = { x: 3.4, y: 2, w: 21.2, h: 9.4 };
const tubBox: Box = { x: 2.3, y: 2.7, w: 10.2, h: 10.4 };

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: violet,
    shapes: [
      whole(liquid),
      ...echo(titleBox, cream, [night, yellow], 0.38),
      pill({ x: 3.1, y: 11.4, w: 15, h: 1.7 }, night),
    ],
    title: {
      x: 3.2,
      y: 3.4,
      w: 13.4,
      h: 6,
      valign: 'middle',
      sample: 'Farben\nhören',
    },
    subtitle: {
      x: 3.9,
      y: 11.4,
      w: 13.4,
      h: 1.7,
      valign: 'middle',
      color: cream,
      sample: 'Ein Abend zwischen Klang und Licht',
    },
  },
  {
    name: 'Abschnitt',
    bg: night,
    shapes: [
      ...drips(
        [violet, magenta, orange, yellow, lime],
        3.3,
        [
          [2.4, 2.2],
          [5.6, 3.4],
          [9.4, 1.4],
          [13.2, 2.6],
          [16.6, 1.2],
          [19.8, 5.6],
          [23, 9.4],
          [25.9, 4.4],
        ],
        0.58,
      ),
    ],
    title: {
      x: 2.2,
      y: 8.3,
      w: 17,
      h: 3.4,
      valign: 'bottom',
      size: 56,
      color: cream,
      sample: 'Zweiter Satz',
    },
    subtitle: {
      x: 2.2,
      y: 12,
      w: 17,
      h: 1.6,
      color: yellow,
      sample: 'Jetzt beginnt es zu fließen',
    },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      ...shore([night, violet, magenta, orange, yellow, lime], 4.1),
      ...rings(27.3, 0.5, 3.3, [violet, magenta, orange, yellow], 6),
    ],
    title: {
      x: 5.9,
      y: 1.3,
      w: 17.6,
      h: 2.4,
      valign: 'middle',
      size: 38,
      sample: 'Was diesen Abend trägt',
    },
    body: { x: 5.9, y: 4.3, w: 20.3, h: 9.8, sample: bullets },
  },
  {
    name: 'Text und Bild',
    bg: cream,
    shapes: [
      ...frames(tubBox, [lime, orange, magenta, violet], 0.42),
      ...rings(27.6, 15.4, 2.3, [magenta, orange, yellow], 5),
    ],
    pictures: [tubBox],
    title: {
      x: 15.2,
      y: 1.4,
      w: 11.4,
      h: 3.2,
      valign: 'bottom',
      size: 34,
      sample: 'Das Plakat als Bühne',
    },
    body: {
      x: 15.2,
      y: 5.1,
      w: 11.4,
      h: 8.6,
      size: 20,
      sample: [
        'Das Bild zieht in den Raum',
        'Der Rahmen schwingt nach',
        'Der Text bleibt ruhig daneben',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    // The page itself stays light so that bullets, coloured against the page, show on the panels.
    bg: cream,
    shapes: [
      { t: 'rect', x: -0.1, y: -0.1, w: 28.2, h: 15.95, fill: night },
      ...rings(26.2, 1, 4, [violet, magenta, orange, yellow, lime], 6),
      ...echo({ x: 1.9, y: 4.6, w: 11.4, h: 9.2 }, cream, [magenta], 0.3, 0.3),
      ...echo({ x: 14.7, y: 4.6, w: 11.4, h: 9.2 }, cream, [orange], 0.3, 0.3),
    ],
    title: {
      x: 1.9,
      y: 1,
      w: 19,
      h: 2.4,
      valign: 'middle',
      size: 38,
      color: cream,
      sample: 'Klang trifft Licht',
    },
    body: [
      {
        x: 2.6,
        y: 5.2,
        w: 10,
        h: 8,
        size: 19,
        sample: [
          'Die Band spielt ohne Pause',
          'Jedes Stück hat seine Farbe',
          'Laut wird es erst am Ende',
        ],
      },
      {
        x: 15.4,
        y: 5.2,
        w: 10,
        h: 8,
        size: 19,
        sample: [
          'Projektoren malen die Wände',
          'Öl und Wasser auf Glas',
          'Kein Bild gleicht dem anderen',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: night,
    shapes: [
      whole(tunnel),
      wobbly(TUNNEL.x, TUNNEL.y, 4.5, night, 6, 0.05, 1),
      wobbly(TUNNEL.x, TUNNEL.y, 4.1, yellow, 6, 0.05, 1),
      ...echo({ x: 18.2, y: 4.9, w: 8, h: 6 }, cream, [magenta], 0.3, 0.35),
    ],
    title: {
      x: 4.4,
      y: 5.2,
      w: 8,
      h: 5.4,
      valign: 'middle',
      align: 'center',
      size: 80,
      sample: '68 %',
    },
    body: {
      x: 18.7,
      y: 5.3,
      w: 7,
      h: 5.2,
      valign: 'middle',
      align: 'center',
      size: 22,
      sample: 'der Gäste kamen wegen des Plakats.',
    },
  },
  {
    name: 'Zitat',
    bg: magenta,
    shapes: [
      ...echo(
        quoteBox,
        cream,
        [night, yellow, orange, magenta, violet, lime, yellow, orange, magenta, violet, night],
        0.62,
        0.5,
      ),
      pill({ x: 8.6, y: 10.2, w: 10.8, h: 1.6 }, night),
    ],
    body: {
      x: 5.6,
      y: 3.3,
      w: 16.8,
      h: 6.6,
      valign: 'middle',
      align: 'center',
      font: 'Righteous',
      bold: false,
      size: 34,
      lineHeight: 115,
      sample: 'Wer die Augen schließt, sieht die Musik am besten.',
    },
    subtitle: {
      x: 9,
      y: 10.2,
      w: 10,
      h: 1.6,
      valign: 'middle',
      align: 'center',
      size: 20,
      color: cream,
      sample: 'Lotte, Lichtkünstlerin',
    },
  },
  {
    name: 'Bild',
    bg: night,
    shapes: [
      ...frames(bildBox, [yellow, orange, magenta, violet, lime, teal], 0.5),
      bulge({ x: 6.8, y: 11.9, w: 14.4, h: 2.4 }, cream, {
        bow: 0.3,
        r: 0.9,
        stroke: { color: night, width: 0.14 },
      }),
    ],
    pictures: [bildBox],
    title: {
      x: 7.4,
      y: 12,
      w: 13.2,
      h: 2.2,
      valign: 'middle',
      align: 'center',
      size: 30,
      sample: 'Sommer der Farben',
    },
  },
  {
    name: 'Schluss',
    bg: violet,
    shapes: [
      whole(spiral),
      wobbly(14, 7, 5.5, night, 8, 0.045, 0.4),
      wobbly(14, 7, 5.1, cream, 8, 0.045, 0.4),
      pill({ x: 8.2, y: 12.9, w: 11.6, h: 1.7 }, night),
    ],
    title: {
      x: 9.6,
      y: 4.4,
      w: 8.8,
      h: 5.2,
      valign: 'middle',
      align: 'center',
      size: 58,
      sample: 'Danke!',
    },
    subtitle: {
      x: 8.8,
      y: 12.9,
      w: 10.4,
      h: 1.7,
      valign: 'middle',
      align: 'center',
      color: cream,
      sample: 'Bleibt noch auf ein Lied',
    },
  },
];

const template: Template = {
  slug: 'psychedelic',
  name: 'Psychedelic',
  group: 'Farbenfroh',
  tags: ['Psychedelic', 'Sechziger', 'Konzertplakat', 'bunt', 'Wellen', 'Musik', 'Festival'],
  description:
    'Konzertplakat der Sechziger: fließende Farbbänder, schmelzende Ringe und Rahmen, die sich wölben.',
  palette: {
    bg: cream,
    text: night,
    bg2: '#ffd3e8',
    text2: '#6b3a8f',
    accents: [magenta, orange, yellow, lime, violet, teal],
  },
  fonts: { head: 'Righteous', body: 'Fredoka' },
  text: {
    title: { font: 'Righteous', size: 62, color: night, lineHeight: 102 },
    subtitle: { font: 'Fredoka', size: 22, color: violet, bold: true },
    body: { font: 'Fredoka', size: 22, color: night, lineHeight: 122, paraSpace: 0.32 },
  },
  layouts,
};

export default template;
