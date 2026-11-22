import { jpeg, mesh, rgb } from '../art';
import type { Box, Color, Layout, Shape, Template } from '../model';
import { page, star } from '../shapes';

/*
 * Y2K: the turn of the millennium – liquid chrome running together in drops and rings (painted:
 * a sky mirrored in metal, band by band), silver air with a breath of ice blue and pink, frosted
 * pills, four-point sparkles, thin orbits.
 */

const silver = '#e9eef5';
const navy = '#1b2250';
const steel = '#cfd9e8';
const slate = '#5a6690';
const pink = '#ff2e93';
const ice = '#58b8ff';
const blue = '#2b50ff';
const lilac = '#b79bff';
const aqua = '#62e6d8';
const chromeGrey = '#8c9ab5';
const white = '#ffffff';

/** How much metal is at a place: over 1 is inside. */
type Field = (x: number, y: number) => number;

const ball =
  (cx: number, cy: number, r: number): Field =>
  (x, y) => {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    const q = (r * r) / Math.max(d2, 1e-4);
    return q * q;
  };
/** A ring of metal: `R` to its middle line, `r` thick. */
const torus =
  (cx: number, cy: number, R: number, r: number): Field =>
  (x, y) => {
    const d = Math.abs(Math.hypot(x - cx, y - cy) - R);
    const q = (r * r) / Math.max(d * d, 1e-4);
    return Math.min(q * q, 400);
  };
/** A frame of metal along a rounded box. */
const hoop =
  (box: Box, corner: number, r: number): Field =>
  (x, y) => {
    const qx = Math.abs(x - (box.x + box.w / 2)) - (box.w / 2 - corner);
    const qy = Math.abs(y - (box.y + box.h / 2)) - (box.h / 2 - corner);
    const d = Math.abs(
      Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - corner,
    );
    const q = (r * r) / Math.max(d * d, 1e-4);
    return Math.min(q * q, 400);
  };
const all =
  (...fields: Field[]): Field =>
  (x, y) => {
    let sum = 0;
    for (const field of fields) sum += field(x, y);
    return sum;
  };
const balls = (...list: (readonly [number, number, number])[]): Field =>
  all(...list.map(([x, y, r]) => ball(x, y, r)));

/** What the metal mirrors, from straight up (−1) to straight down (1). */
const SKY: readonly (readonly [number, Color])[] = [
  [-1, '#ffffff'],
  [-0.78, '#a8d2ff'],
  [-0.52, '#2f6fe0'],
  [-0.36, '#bfe0ff'],
  [-0.2, '#ffffff'],
  [-0.03, '#ffffff'],
  [0.02, '#0d1238'],
  [0.14, '#2a2f6e'],
  [0.3, '#7f86c9'],
  [0.48, '#ff8fcc'],
  [0.66, '#fff0f8'],
  [0.82, '#7d8db8'],
  [1, '#e9eefc'],
];
const SKY_RGB = SKY.map(([at, color]) => [at, ...rgb(color)] as const);
function mirrored(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(-1, t));
  for (let i = 1; i < SKY_RGB.length; i += 1) {
    const [b, a] = [SKY_RGB[i]!, SKY_RGB[i - 1]!];
    if (clamped <= b[0]) {
      const k = (clamped - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
    }
  }
  const last = SKY_RGB[SKY_RGB.length - 1]!;
  return [last[1], last[2], last[3]];
}

/** Silver air with the metal of `field` lying on it, as the page's ground. */
function chrome(field: Field, tint: 'ice' | 'pink' | 'both' = 'both'): Shape {
  const surface = mesh(
    silver,
    [
      { x: 0.1, y: 0.05, r: 0.55, color: tint === 'pink' ? '#ffd3ea' : '#c6e4ff', alpha: 0.8 },
      { x: 0.95, y: 0.95, r: 0.6, color: tint === 'ice' ? '#c6e4ff' : '#ffd0e9', alpha: 0.75 },
      { x: 0.55, y: 0.4, r: 0.5, color: '#ffffff', alpha: 0.9 },
      { x: 0.9, y: 0.1, r: 0.35, color: '#dcd4ff', alpha: 0.5 },
    ],
    {},
  );
  const { ctx, w, h, px } = surface;
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const e = 1.2 / px;
  const height = (f: number) => {
    if (f <= 1) return 0;
    const out = 1 / Math.sqrt(f);
    return Math.sqrt(1 - out * out);
  };
  for (let py = 0; py < h; py += 1) {
    for (let pxl = 0; pxl < w; pxl += 1) {
      const [x, y] = [(pxl + 0.5) / px, (py + 0.5) / px];
      const f = field(x, y);
      const i = (py * w + pxl) * 4;
      if (f < 0.97) {
        // Its shadow on the air, down right.
        const lifted = field(x - 0.16, y - 0.3);
        if (lifted > 0.5) {
          const shade = Math.min(1, (lifted - 0.5) / 0.6) * 0.3;
          data[i] = data[i]! * (1 - shade) + 60 * shade;
          data[i + 1] = data[i + 1]! * (1 - shade) + 70 * shade;
          data[i + 2] = data[i + 2]! * (1 - shade) + 130 * shade;
        }
        if (f < 0.9) continue;
      }
      const h0 = height(f);
      const dx = (height(field(x + e, y)) - h0) / e;
      const dy = (height(field(x, y + e)) - h0) / e;
      const scale = 2.1;
      const length = Math.hypot(dx * scale, dy * scale, 1);
      const [nx, ny, nz] = [(-dx * scale) / length, (-dy * scale) / length, 1 / length];
      let [r, g, b] = mirrored(ny * 1.1 + nx * 0.22 - 0.12 + Math.sin(x * 0.9 + y * 0.5) * 0.04);
      // The lamp, and the dark where the metal turns away.
      const lamp = Math.max(0, nx * -0.42 + ny * -0.62 + nz * 0.66) ** 26;
      r += (255 - r) * lamp;
      g += (255 - g) * lamp;
      b += (255 - b) * lamp;
      const rim = Math.max(0, 1 - nz * 2.6) * 0.5;
      r = r * (1 - rim) + 20 * rim;
      g = g * (1 - rim) + 26 * rim;
      b = b * (1 - rim) + 70 * rim;
      const cover = Math.min(1, Math.max(0, (f - 0.97) / 0.05));
      data[i] = data[i]! * (1 - cover) + r * cover;
      data[i + 1] = data[i + 1]! * (1 - cover) + g * cover;
      data[i + 2] = data[i + 2]! * (1 - cover) + b * cover;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { t: 'image', ...page, src: jpeg(surface, 82) };
}

/** A frosted panel, rounded far – a pill when it is low. */
const frost = (box: Box, r = 1.1, opacity = 0.62): Shape => ({
  t: 'rect',
  ...box,
  r,
  fill: { t: 'solid', color: white, opacity },
  stroke: { color: white, width: 0.08 },
});

const pill = (box: Box, fill: Color = pink): Shape => ({ t: 'rect', ...box, r: box.h / 2, fill });

const sparkle = (cx: number, cy: number, r: number, fill: Color = pink): Shape =>
  star(cx, cy, r, r * 0.17, 4, fill);

const orbit = (box: Box, rotate: number, color: Color = ice): Shape => ({
  t: 'ellipse',
  ...box,
  rotate,
  fill: null,
  stroke: { color, width: 0.05 },
});

const list = [
  'Alles wird rund, weich und glänzend',
  'Das Netz passt jetzt in die Hosentasche',
  'Silber ist die Farbe von morgen',
  'Musik kommt ohne Hülle aus',
  'Die Zukunft beginnt um Mitternacht',
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: silver,
    shapes: [
      chrome(
        balls(
          [21.6, 7.3, 3.5],
          [24.8, 4.1, 1.8],
          [18.6, 10.7, 1.7],
          [25.4, 10.6, 1.2],
          [17, 3.9, 0.85],
          [26.2, 13.4, 0.6],
          [15.6, 12.9, 0.5],
        ),
      ),
      orbit({ x: 15.2, y: 3.6, w: 12.6, h: 7.6 }, -24, blue),
      sparkle(15.2, 2.1, 1, pink),
      sparkle(16.5, 3.2, 0.4, blue),
      sparkle(26.4, 1.7, 0.55, ice),
      pill({ x: 1.8, y: 9.7, w: 13.6, h: 1.7 }),
      sparkle(2.4, 14, 0.5, ice),
    ],
    title: {
      x: 1.8,
      y: 3.1,
      w: 14.4,
      h: 6,
      size: 60,
      valign: 'middle',
      sample: 'Hallo,\nZukunft!',
    },
    subtitle: {
      x: 2.5,
      y: 9.7,
      w: 12.4,
      h: 1.7,
      valign: 'middle',
      sample: 'Was das neue Jahrtausend bringt',
    },
  },
  {
    name: 'Abschnitt',
    bg: silver,
    shapes: [
      chrome(
        balls(
          [26.2, 0.4, 2.7],
          [23.2, 3.3, 2.1],
          [21.7, 6.9, 2.4],
          [19.5, 10.1, 2],
          [18.9, 13.7, 2.7],
          [22.4, 15, 1.7],
          [16.3, 6.3, 0.7],
          [25.2, 9.7, 0.8],
          [15.2, 12.2, 0.45],
        ),
        'ice',
      ),
      pill({ x: 1.9, y: 3.4, w: 3.4, h: 0.6 }),
      sparkle(6.2, 3.7, 0.5, blue),
      sparkle(14.6, 2.6, 0.8, pink),
      sparkle(26, 13.2, 0.6, pink),
    ],
    title: {
      x: 1.8,
      y: 4.3,
      w: 14,
      h: 5.2,
      size: 50,
      valign: 'middle',
      sample: 'Teil zwei:\nganz flüssig',
    },
    subtitle: {
      x: 1.8,
      y: 9.8,
      w: 13,
      h: 1.7,
      color: slate,
      valign: 'middle',
      sample: 'Formen, die nicht stillhalten',
    },
  },
  {
    name: 'Inhalt',
    bg: silver,
    shapes: [
      chrome(balls([25.7, 1.5, 1.6], [23.7, 2.7, 0.9], [26.7, 4, 0.7], [1, 15.2, 1.3]), 'ice'),
      frost({ x: 1.6, y: 4, w: 22.4, h: 10.3 }, 1.1),
      sparkle(22.1, 1.5, 0.5, pink),
      ...[pink, ice, blue].map((color, i): Shape => ({
        t: 'ellipse',
        x: 25.1,
        y: 11.6 + i * 0.8,
        w: 0.45,
        h: 0.45,
        fill: color,
      })),
    ],
    title: {
      x: 1.8,
      y: 1,
      w: 19.6,
      h: 2.4,
      valign: 'middle',
      sample: 'Fünf Dinge, die 2000 neu sind',
    },
    body: { x: 2.6, y: 4.8, w: 20.4, h: 8.9, sample: list },
  },
  {
    name: 'Text und Bild',
    bg: silver,
    shapes: [
      chrome(
        all(
          hoop({ x: 1.5, y: 1.6, w: 12.2, h: 12.6 }, 1.1, 0.5),
          balls([13.5, 13.9, 1.15], [15.2, 14.9, 0.6], [1.7, 1.9, 0.9]),
        ),
        'pink',
      ),
      pill({ x: 15.5, y: 5.05, w: 3.4, h: 0.5 }),
      sparkle(25.6, 1.9, 0.7, ice),
      sparkle(24.4, 2.9, 0.35, pink),
    ],
    pictures: [{ x: 2, y: 2.1, w: 11.2, h: 11.6 }],
    title: {
      x: 15.5,
      y: 1.3,
      w: 10.9,
      h: 3.4,
      size: 30,
      valign: 'bottom',
      sample: 'Ein Blick durchs Bullauge',
    },
    body: {
      x: 15.5,
      y: 6.1,
      w: 10.9,
      h: 8,
      size: 20,
      sample: ['Rund statt eckig', 'Durchsichtig statt grau', 'Bunt statt beige'],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: silver,
    shapes: [
      chrome(
        balls(
          [14, 14.1, 1.35],
          [15.7, 15.2, 0.8],
          [12.3, 15.3, 0.6],
          [26.6, 0.9, 1.3],
          [24.9, 1.9, 0.6],
        ),
      ),
      frost({ x: 1.6, y: 4, w: 12, h: 9.6 }, 1.2),
      frost({ x: 14.4, y: 4, w: 12, h: 9.6 }, 1.2),
      pill({ x: 2.6, y: 3.72, w: 3.2, h: 0.56 }, pink),
      pill({ x: 15.4, y: 3.72, w: 3.2, h: 0.56 }, ice),
      sparkle(22.6, 1.9, 0.5, pink),
    ],
    title: { x: 1.8, y: 1, w: 19.6, h: 2.4, valign: 'middle', sample: 'Gestern und morgen' },
    body: [
      {
        x: 2.5,
        y: 4.9,
        w: 10.4,
        h: 8.1,
        size: 20,
        sample: ['Kabel und Stecker', 'Graue Kästen', 'Einwahl mit Pfeifton'],
      },
      {
        x: 15.3,
        y: 4.9,
        w: 10.4,
        h: 8.1,
        size: 20,
        sample: ['Alles ohne Schnur', 'Gehäuse wie Bonbons', 'Immer verbunden'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: silver,
    shapes: [
      chrome(
        all(
          torus(8.5, 7.9, 5.3, 0.95),
          balls([12.8, 12, 1.3], [14.7, 13.5, 0.65], [3.8, 3.3, 0.9], [2.3, 1.9, 0.45]),
        ),
      ),
      frost({ x: 15.9, y: 4.5, w: 10.5, h: 6.8 }, 1.3),
      sparkle(15.6, 2.6, 0.8, pink),
      sparkle(25.6, 13, 0.55, blue),
      sparkle(24.6, 13.9, 0.3, pink),
    ],
    title: {
      x: 4.3,
      y: 5,
      w: 8.4,
      h: 5.8,
      size: 84,
      color: pink,
      align: 'center',
      valign: 'middle',
      sample: '2000',
    },
    body: {
      x: 16.8,
      y: 5,
      w: 8.8,
      h: 5.8,
      size: 23,
      valign: 'middle',
      sample: 'Ein Jahr mit drei Nullen – und alle Uhren laufen einfach weiter.',
    },
  },
  {
    name: 'Zitat',
    bg: silver,
    shapes: [
      chrome(
        balls(
          [3.2, 3.5, 1.05],
          [3.95, 2.3, 0.6],
          [4.5, 1.55, 0.36],
          [5.9, 3.5, 1.05],
          [6.65, 2.3, 0.6],
          [7.2, 1.55, 0.36],
          [2.2, 14.6, 1.5],
          [4.4, 15.4, 0.9],
          [26.4, 14.9, 1.1],
        ),
        'pink',
      ),
      frost({ x: 1.8, y: 5.1, w: 24.4, h: 6.6 }, 1.6, 0.66),
      pill({ x: 15.2, y: 12.3, w: 11, h: 1.7 }),
      sparkle(24.4, 2.6, 1, blue),
      sparkle(22.8, 3.6, 0.45, pink),
      sparkle(25.6, 4, 0.3, ice),
    ],
    body: {
      x: 3.3,
      y: 5.5,
      w: 21.4,
      h: 5.8,
      font: 'Exo 2',
      size: 33,
      italic: true,
      color: navy,
      lineHeight: 118,
      valign: 'middle',
      sample: 'Die Zukunft ist schon da. Sie glänzt nur noch nicht überall gleich.',
    },
    subtitle: {
      x: 15.9,
      y: 12.3,
      w: 9.6,
      h: 1.7,
      align: 'center',
      valign: 'middle',
      sample: 'Jana, 16, im Januar 2000',
    },
  },
  {
    name: 'Bild',
    bg: silver,
    shapes: [
      chrome(
        balls(
          [26.3, 1.3, 1.8],
          [24.1, 0.5, 0.9],
          [1.4, 12.3, 1.7],
          [3.5, 13.9, 1.05],
          [1.4, 14.9, 0.5],
          [26.9, 4, 0.5],
        ),
      ),
      { t: 'rect', x: 1.8, y: 1.3, w: 24.4, h: 10.9, fill: steel },
      frost({ x: 6, y: 12.9, w: 16, h: 1.9 }, 0.95, 0.7),
      sparkle(24, 13.8, 0.6, pink),
      sparkle(25.2, 14.5, 0.3, blue),
    ],
    pictures: [{ x: 1.8, y: 1.3, w: 24.4, h: 10.9 }],
    title: {
      x: 6.8,
      y: 12.9,
      w: 14.4,
      h: 1.9,
      size: 26,
      align: 'center',
      valign: 'middle',
      sample: 'Silvester am Fluss',
    },
  },
  {
    name: 'Schluss',
    bg: silver,
    shapes: [
      chrome(
        balls(
          [1, 16, 2.6],
          [4.6, 16.2, 2.4],
          [8.4, 16.5, 2.5],
          [12, 16.2, 2.2],
          [15.6, 16.5, 2.5],
          [19.4, 16.1, 2.5],
          [23.2, 16.4, 2.5],
          [27, 15.9, 2.7],
          [6, 12.5, 0.95],
          [6.4, 10.6, 0.5],
          [20.6, 12.7, 1.15],
          [21.4, 10.5, 0.6],
          [13.4, 13.3, 0.7],
        ),
      ),
      pill({ x: 8.4, y: 8.3, w: 11.2, h: 1.7 }),
      sparkle(5.2, 3.4, 0.9, pink),
      sparkle(6.6, 4.6, 0.4, blue),
      sparkle(23.2, 2.9, 0.6, ice),
      sparkle(22.4, 6.4, 1, blue),
      orbit({ x: 3.4, y: 1.6, w: 21.2, h: 9.4 }, -6, ice),
    ],
    title: {
      x: 4,
      y: 2.6,
      w: 20,
      h: 5.2,
      size: 68,
      align: 'center',
      valign: 'middle',
      sample: 'Bis morgen!',
    },
    subtitle: {
      x: 9,
      y: 8.3,
      w: 10,
      h: 1.7,
      align: 'center',
      valign: 'middle',
      sample: 'Danke fürs Zuhören',
    },
  },
];

const template: Template = {
  slug: 'y2k',
  name: 'Y2K',
  group: 'Designtrend',
  tags: ['Y2K', 'Chrom', 'Silber', 'Jahrtausendwende', 'glänzend', 'Zukunft', 'Pop', 'Mode'],
  description:
    'Jahrtausendwende: flüssiges Chrom in Tropfen und Ringen auf Silber, dazu Eisblau, Pink, mattes Glas und Funkeln.',
  palette: {
    bg: silver,
    text: navy,
    bg2: steel,
    text2: slate,
    accents: [pink, ice, blue, lilac, aqua, chromeGrey],
  },
  fonts: { head: 'Exo 2', body: 'Outfit' },
  text: {
    title: { font: 'Exo 2', size: 36, color: navy, bold: true, italic: true, lineHeight: 100 },
    subtitle: { font: 'Outfit', size: 20, color: white, bold: true },
    body: { font: 'Outfit', size: 23, color: navy, lineHeight: 116, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
