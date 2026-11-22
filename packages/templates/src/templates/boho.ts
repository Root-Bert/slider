import { grain, jpeg, noise, paint, PX, rgb, rgba, rng } from '../art';
import type { Box, Color, Layout, Picture, Shape, Template } from '../model';
import { blob, disc, page, star } from '../shapes';

/*
 * Boho: sun-baked colours on warm, flecked paper. Arches like windows and doorways, arches
 * stacked into rainbows, suns with fine rays, pebbles. Flat shapes only – nothing drawn, nothing
 * with a face.
 */

const cream = '#f6eddd';
const shell = '#fbf5ea';
const brown = '#4a2d21';
const terracotta = '#c4623f';
const rust = '#9c452b';
const ochre = '#dca243';
const blush = '#efc6b3';
const rose = '#d98e7a';
const sage = '#9dab8b';
const sageLight = '#cbd3ba';
const taupe = '#7d6253';

/** Handmade paper: warm, clouded, with dark and light flecks. */
const paperPicture: Picture = (() => {
  const surface = paint(undefined, PX * 0.62);
  const { ctx, w, h } = surface;
  const field = noise(33);
  const [r, g, b] = rgb(cream);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const shade = 1 + (field(x / 140, y / 140, 5) - 0.5) * 0.08;
      const i = (y * w + x) * 4;
      image.data[i] = r * shade;
      image.data[i + 1] = g * shade;
      image.data[i + 2] = b * shade;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const random = rng(8);
  for (let i = 0; i < 1500; i += 1) {
    const light = random() < 0.35;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.5)' : rgba('#8a6a4f', random.range(0.1, 0.3));
    ctx.beginPath();
    ctx.ellipse(
      random() * w,
      random() * h,
      random.range(0.5, 1.5),
      random.range(0.4, 0.9),
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  grain(surface, 0.04, 9);
  return jpeg(surface, 76);
})();

const ground: Shape = { t: 'image', ...page, src: paperPicture };

/** The paper dyed: a sheet of colour through which its flecks still show. */
const dyed = (color: Color, opacity = 0.9): Shape => ({
  t: 'rect',
  x: -0.2,
  y: -0.2,
  w: 28.4,
  h: 16.15,
  fill: { t: 'solid', color, opacity },
});

const u = (value: number) => Math.round(value * 100);
const K = 0.5523;

/** An arch's outline: two legs and a round (or flatter, `rise`) top. */
function archPath(x: number, y: number, w: number, h: number, rise = w / 2, closed = true) {
  const [rx, mid, right, bottom, spring] = [w / 2, x + w / 2, x + w, y + h, y + rise];
  return (
    `M${u(x)} ${u(bottom)} L${u(x)} ${u(spring)} ` +
    `C${u(x)} ${u(spring - rise * K)} ${u(mid - rx * K)} ${u(y)} ${u(mid)} ${u(y)} ` +
    `C${u(mid + rx * K)} ${u(y)} ${u(right)} ${u(spring - rise * K)} ${u(right)} ${u(spring)} ` +
    `L${u(right)} ${u(bottom)}${closed ? ' Z' : ''}`
  );
}

const vb = [2800, 1575] as const;

/** A filled arch standing in a box. */
const arch = (box: Box, fill: Color, rise?: number): Shape => ({
  t: 'path',
  ...page,
  vb,
  d: archPath(box.x, box.y, box.w, box.h, rise),
  fill,
});

/** An arch as a line. */
const archLine = (box: Box, color: Color, width: number): Shape => ({
  t: 'path',
  ...page,
  vb,
  d: archPath(box.x, box.y, box.w, box.h, undefined, false),
  fill: null,
  stroke: { color, width, cap: 'butt', join: 'round' },
});

/** Arches inside each other, standing on `base`: a rainbow. */
function rainbow(
  cx: number,
  base: number,
  radius: number,
  colors: readonly Color[],
  band: number,
  gap: number,
  legs = 0,
): Shape[] {
  return colors.map((color, index) => {
    const r = radius - index * (band + gap) - band / 2;
    return archLine({ x: cx - r, y: base - legs - r, w: r * 2, h: r + legs }, color, band);
  });
}

/** A sun: a disc with fine rays, long and short in turn. */
function sun(
  cx: number,
  cy: number,
  radius: number,
  fill: Color,
  rays: { color: Color; count: number; length: number; gap?: number; width?: number },
): Shape[] {
  const gap = rays.gap ?? radius * 0.22;
  return [
    ...Array.from({ length: rays.count }, (_, index): Shape => {
      const angle = (index / rays.count) * Math.PI * 2;
      const from = radius + gap;
      const to = from + rays.length * (index % 2 === 0 ? 1 : 0.55);
      return {
        t: 'line',
        x1: cx + Math.cos(angle) * from,
        y1: cy + Math.sin(angle) * from,
        x2: cx + Math.cos(angle) * to,
        y2: cy + Math.sin(angle) * to,
        stroke: { color: rays.color, width: rays.width ?? 0.04, cap: 'round' },
      };
    }),
    disc(cx, cy, radius, fill),
  ];
}

const pebble = (box: Box, fill: Color, seed: number, rotate = 0): Shape =>
  blob(box, rng(seed), fill, { points: 6, wobble: 0.2, rotate });

const sparkle = (cx: number, cy: number, r: number, fill: Color): Shape =>
  star(cx, cy, r, r * 0.3, 4, fill);

/** Three small dots: the mark under a heading. */
const beads = (x: number, y: number, colors: readonly Color[] = [terracotta, ochre, sage]) =>
  colors.map((color, index) => disc(x + 0.16 + index * 0.55, y, 0.16, color));

const label = { upper: true, spacing: 2.2, size: 15 } as const;

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: cream,
    shapes: [
      ground,
      pebble({ x: 12.8, y: 6, w: 8.8, h: 8.2 }, blush, 3),
      pebble({ x: 23.2, y: 9.6, w: 6, h: 5.2 }, sageLight, 5),
      ...sun(23.4, 3.3, 1.5, ochre, { color: terracotta, count: 30, length: 0.95 }),
      ...rainbow(20.4, 16.2, 6.4, [terracotta, ochre, rose, sage], 0.95, 0.4, 2.8),
      pebble({ x: 11.2, y: 12.7, w: 2.7, h: 2.1 }, rust, 7),
      sparkle(16, 3.6, 0.5, terracotta),
      sparkle(26.4, 7.2, 0.32, rust),
      ...beads(1.9, 10),
    ],
    title: { x: 1.8, y: 2.4, w: 12.6, h: 6.9, sample: 'Zurück zur\nWärme' },
    subtitle: { x: 1.8, y: 10.6, w: 11.4, h: 2.2, sample: 'Ideen für ein ruhiges Zuhause' },
  },
  {
    name: 'Abschnitt',
    bg: terracotta,
    shapes: [
      ground,
      dyed(terracotta, 0.93),
      pebble({ x: 0.8, y: 9.4, w: 5.2, h: 4.4 }, rust, 11),
      pebble({ x: 22.4, y: 2.2, w: 4.4, h: 3.7 }, rose, 13),
      archLine({ x: 7.1, y: 0.9, w: 13.8, h: 16 }, shell, 0.045),
      archLine({ x: 7.8, y: 1.55, w: 12.4, h: 15.4 }, shell, 0.045),
      arch({ x: 8.5, y: 2.2, w: 11, h: 14.6 }, shell),
      ...sun(14, 5.5, 1.2, ochre, { color: terracotta, count: 24, length: 0.7 }),
      sparkle(4, 4.2, 0.45, shell),
      sparkle(24.2, 11.6, 0.4, shell),
      sparkle(22.2, 13.4, 0.22, shell),
    ],
    title: {
      x: 9.2,
      y: 7.8,
      w: 9.6,
      h: 3.4,
      align: 'center',
      valign: 'middle',
      size: 42,
      sample: 'Material',
    },
    subtitle: { x: 9.4, y: 11.5, w: 9.2, h: 1.5, align: 'center', sample: 'Teil zwei' },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      ground,
      ...sun(24.5, 3.2, 1.15, ochre, { color: terracotta, count: 24, length: 0.75 }),
      arch({ x: 20.2, y: 5.6, w: 3.7, h: 11 }, sage),
      arch({ x: 24.9, y: 10.2, w: 2.5, h: 6 }, blush),
      arch({ x: 22.6, y: 8.2, w: 3.3, h: 8 }, terracotta),
      sparkle(21, 2.2, 0.3, rust),
      ...beads(1.9, 3.85),
    ],
    title: { x: 1.8, y: 1.2, w: 17.6, h: 2.3, valign: 'middle', size: 36 },
    body: {
      x: 1.8,
      y: 4.7,
      w: 17.4,
      h: 9.6,
      sample: [
        'Naturtöne statt greller Akzente',
        'Leinen, Ton und Holz dürfen altern',
        'Runde Formen nehmen dem Raum die Strenge',
        'Lieber wenige Dinge, dafür mit Geschichte',
        'Licht ist das wichtigste Möbelstück',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: cream,
    shapes: [
      ground,
      pebble({ x: 23.8, y: 12.4, w: 6, h: 5 }, sageLight, 21),
      arch({ x: 1.6, y: 0.9, w: 11.8, h: 13.9 }, blush),
      ...sun(7.5, 2.9, 0.75, ochre, { color: terracotta, count: 18, length: 0.5 }),
      ...beads(15.1, 5.25),
    ],
    title: { x: 15, y: 1.4, w: 11.2, h: 3.4, size: 32 },
    body: { x: 15, y: 5.9, w: 11.2, h: 8, size: 20 },
    pictures: [{ x: 2.4, y: 4.7, w: 10.2, h: 9.3 }],
  },
  {
    name: 'Zwei Spalten',
    bg: cream,
    shapes: [
      ground,
      dyed(blush, 0.82),
      arch({ x: 1.8, y: 3.6, w: 11.6, h: 10.6 }, shell, 2.7),
      arch({ x: 14.6, y: 3.6, w: 11.6, h: 10.6 }, shell, 2.7),
      disc(7.6, 5, 0.36, terracotta),
      disc(20.4, 5, 0.36, sage),
      sparkle(26, 1.9, 0.4, terracotta),
      sparkle(24.9, 2.9, 0.22, rust),
    ],
    title: { x: 1.8, y: 0.7, w: 21.6, h: 2.4, valign: 'middle', size: 34 },
    body: [
      { x: 2.9, y: 6.3, w: 9.5, h: 7.3, size: 19 },
      { x: 15.7, y: 6.3, w: 9.5, h: 7.3, size: 19 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: cream,
    shapes: [
      ground,
      pebble({ x: 21.6, y: -1.8, w: 7.6, h: 5.6 }, blush, 31),
      pebble({ x: -1.8, y: 12, w: 5.6, h: 5.2 }, sageLight, 33),
      ...sun(8.6, 7.9, 4.5, ochre, {
        color: terracotta,
        count: 64,
        length: 1.7,
        gap: 0.42,
        width: 0.045,
      }),
      ...rainbow(24.4, 16.2, 3.3, [terracotta, rose, sage], 0.62, 0.3, 1),
      ...beads(16.9, 5.2),
    ],
    title: {
      x: 4.4,
      y: 5,
      w: 8.4,
      h: 5.8,
      valign: 'middle',
      align: 'center',
      size: 84,
      sample: '42 %',
    },
    body: {
      x: 16.8,
      y: 5.8,
      w: 9.4,
      h: 5,
      size: 24,
      sample: 'der Befragten wünschen sich wärmere Farben in ihren vier Wänden.',
    },
  },
  {
    name: 'Zitat',
    bg: sageLight,
    shapes: [
      ground,
      dyed(sage, 0.72),
      ...sun(0.8, 0.6, 2.5, ochre, { color: brown, count: 40, length: 1.1 }),
      pebble({ x: 2.6, y: 0.9, w: 22.8, h: 13.6 }, shell, 44),
      ...rainbow(24.6, 16.2, 3.5, [terracotta, ochre, blush], 0.66, 0.3, 0.8),
      sparkle(25.6, 3, 0.45, shell),
      sparkle(2.4, 12.6, 0.35, shell),
      {
        t: 'text',
        x: 11.5,
        y: 2.3,
        w: 5,
        h: 2.6,
        text: '“',
        font: 'DM Serif Display',
        size: 96,
        color: terracotta,
        align: 'center',
        valign: 'top',
      },
    ],
    body: {
      x: 6.4,
      y: 4.6,
      w: 15.2,
      h: 5.2,
      valign: 'middle',
      align: 'center',
      font: 'DM Serif Display',
      italic: true,
      size: 28,
      lineHeight: 118,
      sample: 'Ein Raum ist fertig, wenn man sich darin gern die Schuhe auszieht.',
    },
    subtitle: {
      x: 8,
      y: 10.2,
      w: 12,
      h: 1.3,
      align: 'center',
      sample: 'Mina Sand, Keramikerin',
    },
  },
  {
    name: 'Bild',
    bg: cream,
    shapes: [
      ground,
      ...sun(3.3, 2.5, 0.9, ochre, { color: terracotta, count: 20, length: 0.6 }),
      arch({ x: 1.5, y: 4.8, w: 3.6, h: 12 }, sage),
      arch({ x: 3.5, y: 9, w: 2.5, h: 8 }, terracotta),
      sparkle(1.9, 3.9, 0.22, rust),
    ],
    pictures: [{ x: 6.8, y: 1.5, w: 19.4, h: 10.6 }],
    title: {
      x: 6.8,
      y: 12.5,
      w: 19.4,
      h: 1.9,
      valign: 'middle',
      size: 26,
      sample: 'Nachmittagslicht im Atelier',
    },
  },
  {
    name: 'Schluss',
    bg: cream,
    shapes: [
      ground,
      pebble({ x: 0.8, y: 9.8, w: 5.6, h: 4.6 }, blush, 51),
      pebble({ x: 21.8, y: 10.6, w: 5.2, h: 4.2 }, sageLight, 53),
      ...sun(14, 14.4, 1.25, ochre, { color: terracotta, count: 26, length: 0.8 }),
      ...rainbow(14, 16.2, 8.6, [terracotta, ochre, rose, sage], 0.95, 0.36, 0.6),
      sparkle(4.6, 4, 0.45, terracotta),
      sparkle(23.4, 5.2, 0.5, ochre),
      sparkle(24.6, 7, 0.24, rust),
      sparkle(3.2, 6.2, 0.22, rust),
    ],
    title: { x: 4, y: 0.9, w: 20, h: 3.6, align: 'center', size: 54, sample: 'Danke' },
    subtitle: {
      x: 5,
      y: 4.9,
      w: 18,
      h: 1.4,
      align: 'center',
      sample: 'Schön, dass ihr da wart',
    },
  },
];

const template: Template = {
  slug: 'boho',
  name: 'Boho',
  group: 'Farbenfroh',
  tags: ['Boho', 'Terrakotta', 'warm', 'Bögen', 'Sonne', 'Erdtöne', 'Interior', 'Lifestyle'],
  description:
    'Warme Erdtöne auf gesprenkeltem Papier: Bögen, Regenbögen, Sonnen mit feinen Strahlen und Kiesel.',
  palette: {
    bg: cream,
    text: brown,
    bg2: blush,
    text2: taupe,
    accents: [terracotta, ochre, sage, rose, rust, sageLight],
  },
  fonts: { head: 'DM Serif Display', body: 'Jost' },
  text: {
    title: { font: 'DM Serif Display', size: 58, color: brown, lineHeight: 92 },
    subtitle: { font: 'Jost', color: taupe, ...label },
    body: { font: 'Jost', size: 22, color: brown, lineHeight: 122, paraSpace: 0.4 },
  },
  layouts,
};

export default template;
