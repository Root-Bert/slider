import type { Box, Color, Layout, Shape, Stroke, Template } from '../model';

/*
 * Art déco: an evening in gold on midnight blue, emerald and black – sunrays, fans, stepped
 * frames, fine double rules with a diamond in the middle. Everything on the centre axis.
 */

const night = '#0d1b2b';
const emerald = '#0d3a33';
const black = '#0a0a0b';
const gold = '#c9a55b';
const pale = '#ead8a6';
const cream = '#f4ecd9';
const bronze = '#8f7438';

const fine: Stroke = { color: gold, width: 0.035 };
const firm: Stroke = { color: gold, width: 0.08 };

const line = (x1: number, y1: number, x2: number, y2: number, stroke: Stroke = fine): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke,
});

/** An arc round a centre, degrees counter-clockwise from 3 o'clock. */
const arc = (
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  stroke: Stroke = fine,
): Shape => ({
  t: 'ellipse',
  kind: 'arc',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  start,
  end,
  fill: null,
  stroke,
});

/** A filled slice of a disc. */
const slice = (
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  fill: Color,
): Shape => ({
  t: 'ellipse',
  kind: 'section',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  start,
  end,
  fill,
});

/** Rays between two radii, spread from `start` to `end` (degrees as an arc's). */
const rays = (
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  start: number,
  end: number,
  count: number,
  stroke: Stroke = fine,
  /** Every second ray this much shorter. */
  shorter = 0,
): Shape[] =>
  Array.from({ length: count }, (_, index) => {
    const a = ((start + ((end - start) * index) / (count - 1)) * Math.PI) / 180;
    const reach = r1 - (index % 2 === 1 ? shorter : 0);
    return line(
      cx + Math.cos(a) * r0,
      cy - Math.sin(a) * r0,
      cx + Math.cos(a) * reach,
      cy - Math.sin(a) * reach,
      stroke,
    );
  });

/** A fan: rings and rays over a part of a circle, a gold core in its centre. */
const fan = (
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  rings: number,
  count: number,
): Shape[] => [
  ...Array.from({ length: rings }, (_, index) =>
    arc(
      cx,
      cy,
      r * (0.34 + (0.66 * (index + 1)) / rings),
      start,
      end,
      index === rings - 1 ? firm : fine,
    ),
  ),
  ...rays(cx, cy, r * 0.34, r, start, end, count),
  slice(cx, cy, r * 0.24, start, end, gold),
];

const diamond = (cx: number, cy: number, r: number, fill: Color | null = gold): Shape => ({
  t: 'poly',
  fill,
  stroke: fill ? undefined : fine,
  pts: [
    [cx, cy - r],
    [cx + r * 0.62, cy],
    [cx, cy + r],
    [cx - r * 0.62, cy],
  ],
});

/** A rule with a diamond in its middle and a fine second rule beneath: the house ornament. */
const ornament = (cx: number, y: number, half: number, gap = 0.5): Shape[] => [
  line(cx - half, y, cx - gap, y, firm),
  line(cx + gap, y, cx + half, y, firm),
  line(cx - half * 0.72, y + 0.16, cx - gap, y + 0.16),
  line(cx + gap, y + 0.16, cx + half * 0.72, y + 0.16),
  diamond(cx, y + 0.05, 0.3),
  diamond(cx - half - 0.22, y, 0.13),
  diamond(cx + half + 0.22, y, 0.13),
];

/** A frame whose corners step in. */
const stepped = (box: Box, step: number, stroke: Stroke = fine): Shape => {
  const [l, t, r, b] = [box.x, box.y, box.x + box.w, box.y + box.h];
  return {
    t: 'poly',
    fill: null,
    stroke: { ...stroke, join: 'miter' },
    pts: [
      [l + step, t],
      [r - step, t],
      [r - step, t + step],
      [r, t + step],
      [r, b - step],
      [r - step, b - step],
      [r - step, b],
      [l + step, b],
      [l + step, b - step],
      [l, b - step],
      [l, t + step],
      [l + step, t + step],
    ],
  };
};

/** The page's double frame, stepped at the corners. */
const pageFrame = (): Shape[] => [
  stepped({ x: 0.7, y: 0.7, w: 26.6, h: 14.35 }, 0.7, firm),
  stepped({ x: 0.95, y: 0.95, w: 26.1, h: 13.85 }, 0.7),
];

/** Upright lines stepping down away from the middle one – a pilaster, as on a façade. */
const pilaster = (x: number, top: number, bottom: number, outward: number): Shape[] =>
  [0, 1, 2, 3].flatMap((index) => [
    line(
      x + outward * index * 0.3,
      top + index * 0.75,
      x + outward * index * 0.3,
      bottom - index * 0.75,
      index === 0 ? firm : fine,
    ),
  ]);

const plain = (box: Box, stroke: Stroke): Shape => ({ t: 'rect', ...box, fill: null, stroke });
const grow = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  w: box.w + by * 2,
  h: box.h + by * 2,
});

const caps = { upper: true, spacing: 3, size: 16 } as const;

const textPicture: Box = { x: 16.6, y: 2.7, w: 8.8, h: 10.6 };
const bigPicture: Box = { x: 3.4, y: 1.5, w: 21.2, h: 9.9 };

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: {
      t: 'radial',
      stops: [
        [0, '#16304b'],
        [1, night],
      ],
      cx: 0.5,
      cy: 0.45,
    },
    shapes: [
      ...pageFrame(),
      slice(14, 0.95, 1.25, 180, 360, gold),
      arc(14, 0.95, 1.6, 180, 360, firm),
      ...rays(14, 0.95, 1.95, 3.9, 184, 356, 21, fine, 0.8),
      ...pilaster(3.4, 3.4, 12.35, -1),
      ...pilaster(24.6, 3.4, 12.35, 1),
      ...ornament(14, 10.75, 4.6),
      ...fan(14, 14.8, 1.9, 0, 180, 3, 13),
    ],
    title: {
      x: 4.6,
      y: 5.1,
      w: 18.8,
      h: 5.2,
      valign: 'middle',
      size: 50,
      sample: 'Der grosse\nAbend',
    },
    subtitle: {
      x: 6,
      y: 11.25,
      w: 16,
      h: 1.3,
      valign: 'middle',
      sample: 'Ein Programm in drei Akten',
    },
  },
  {
    name: 'Abschnitt',
    bg: {
      t: 'linear',
      angle: 180,
      stops: [
        [0, '#0a2d28'],
        [1, '#12493f'],
      ],
    },
    shapes: [
      ...Array.from({ length: 13 }, (_, index): Shape => {
        const a = (Math.PI * (index * 2 + 0.5)) / 26;
        const b = (Math.PI * (index * 2 + 1.5)) / 26;
        return {
          t: 'poly',
          fill: { t: 'solid', color: '#1b6152', opacity: 0.45 },
          pts: [
            [14, 15.75],
            [14 + Math.cos(a) * 30, 15.75 - Math.sin(a) * 30],
            [14 + Math.cos(b) * 30, 15.75 - Math.sin(b) * 30],
          ],
        };
      }),
      slice(14, 15.75, 2.3, 0, 180, gold),
      arc(14, 15.75, 2.75, 0, 180, firm),
      arc(14, 15.75, 3.0, 0, 180),
      ...rays(14, 15.75, 3.4, 5.6, 3, 177, 27, fine, 0.9),
      ...fan(0, 0, 3.1, 270, 360, 3, 7),
      ...fan(28, 0, 3.1, 180, 270, 3, 7),
      ...ornament(14, 8.15, 4.2),
    ],
    title: {
      x: 4.6,
      y: 2.5,
      w: 18.8,
      h: 5.2,
      valign: 'bottom',
      size: 44,
      sample: 'Zweiter Akt',
    },
    subtitle: { x: 6, y: 8.6, w: 16, h: 1.3, valign: 'middle', sample: 'Der Vorhang hebt sich' },
  },
  {
    name: 'Inhalt',
    bg: night,
    shapes: [
      line(1.35, 1.2, 1.35, 14.55, firm),
      line(1.6, 1.9, 1.6, 13.85),
      line(26.65, 1.2, 26.65, 14.55, firm),
      line(26.4, 1.9, 26.4, 13.85),
      diamond(1.35, 0.85, 0.2),
      diamond(1.35, 14.9, 0.2),
      diamond(26.65, 0.85, 0.2),
      diamond(26.65, 14.9, 0.2),
      ...ornament(14, 3.5, 9.6),
    ],
    title: { x: 3.4, y: 0.9, w: 21.2, h: 2.3, valign: 'middle', size: 28 },
    body: {
      x: 3.6,
      y: 4.5,
      w: 20.8,
      h: 9.7,
      sample: [
        'Der Saal öffnet um acht Uhr',
        'Das Orchester spielt bis Mitternacht',
        'Jeder Tisch erhält seine eigene Karte',
        'Garderobe: festlich, gern mit Glanz',
        'Zum Ausklang Kaffee auf der Terrasse',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: emerald,
    shapes: [
      plain(grow(textPicture, 0.22), firm),
      stepped(grow(textPicture, 0.62), 0.5),
      slice(21, 1.86, 0.55, 0, 180, gold),
      ...rays(21, 1.86, 0.75, 1.25, 8, 172, 9),
      slice(21, 14.14, 0.55, 180, 360, gold),
      ...rays(21, 14.14, 0.75, 1.25, 188, 352, 9),
      line(1.8, 4.55, 14.2, 4.55, firm),
      line(1.8, 4.71, 10.6, 4.71),
      diamond(14.5, 4.55, 0.16),
    ],
    title: { x: 1.8, y: 1.2, w: 12.8, h: 3.1, align: 'left', valign: 'bottom', size: 27 },
    body: { x: 1.8, y: 5.4, w: 12.6, h: 8.9, size: 20 },
    pictures: [textPicture],
  },
  {
    name: 'Zwei Spalten',
    bg: night,
    shapes: [
      { t: 'rect', x: 0, y: 0, w: 28, h: 3.6, fill: black },
      line(0, 3.6, 28, 3.6, firm),
      line(0, 3.78, 28, 3.78),
      slice(14, 3.78, 0.6, 180, 360, gold),
      ...rays(14, 3.78, 0.8, 1.4, 190, 350, 9),
      line(14, 5.9, 14, 8.75, firm),
      line(14, 10.05, 14, 13.9, firm),
      diamond(14, 9.4, 0.48, null),
      diamond(14, 9.4, 0.22),
      diamond(14, 14.25, 0.14),
      ...fan(0, 15.75, 2.2, 0, 90, 3, 6),
      ...fan(28, 15.75, 2.2, 90, 180, 3, 6),
    ],
    title: { x: 3.4, y: 0.6, w: 21.2, h: 2.5, valign: 'middle', size: 28 },
    body: [
      { x: 2.4, y: 5.4, w: 10.4, h: 8.3, size: 19 },
      { x: 15.4, y: 5.4, w: 10.4, h: 8.3, size: 19 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: {
      t: 'radial',
      stops: [
        [0, '#1c1a14'],
        [1, black],
      ],
      cx: 0.5,
      cy: 0.38,
    },
    shapes: [
      ...rays(14, 5.9, 4.3, 5.2, 0, 360 - 360 / 60, 60, fine, 0.4),
      arc(14, 5.9, 4.0, 0, 360, firm),
      arc(14, 5.9, 3.75, 0, 360),
      // Wings: rules stepping in above and below the middle one.
      ...[0, 1, 2, 3].flatMap((index) =>
        (index === 0 ? [0] : [-1, 1]).flatMap((side) => [
          line(
            1.8 + index * 1.1,
            5.9 + side * index * 0.32,
            8.3,
            5.9 + side * index * 0.32,
            index === 0 ? firm : fine,
          ),
          line(
            19.7,
            5.9 + side * index * 0.32,
            26.2 - index * 1.1,
            5.9 + side * index * 0.32,
            index === 0 ? firm : fine,
          ),
        ]),
      ),
      diamond(1.45, 5.9, 0.16),
      diamond(26.55, 5.9, 0.16),
    ],
    title: {
      x: 10.5,
      y: 3.4,
      w: 7,
      h: 5,
      valign: 'middle',
      size: 76,
      color: gold,
      spacing: 0,
      sample: '100',
    },
    body: {
      x: 5,
      y: 11.7,
      w: 18,
      h: 2.9,
      align: 'center',
      size: 22,
      sample: 'Gäste, ein Saal, eine Nacht –\nund kein Platz blieb leer.',
    },
  },
  {
    name: 'Zitat',
    bg: {
      t: 'radial',
      stops: [
        [0, '#145045'],
        [1, '#0a2d28'],
      ],
      cx: 0.5,
      cy: 0.45,
    },
    shapes: [
      ...fan(0, 15.75, 5.2, 0, 90, 5, 10),
      ...fan(28, 15.75, 5.2, 90, 180, 5, 10),
      diamond(14, 2.2, 0.36),
      diamond(12.9, 2.2, 0.18),
      diamond(15.1, 2.2, 0.18),
      line(8.6, 2.2, 12.4, 2.2),
      line(15.6, 2.2, 19.4, 2.2),
      ...ornament(14, 11, 3.2, 0.45),
    ],
    body: {
      x: 4.8,
      y: 3.1,
      w: 18.4,
      h: 7.4,
      align: 'center',
      valign: 'middle',
      font: 'Cinzel',
      size: 29,
      color: pale,
      lineHeight: 128,
      sample: 'Eleganz ist die Kunst, im rechten Augenblick zu glänzen.',
    },
    subtitle: {
      x: 7,
      y: 11.5,
      w: 14,
      h: 1.3,
      valign: 'middle',
      sample: 'Vera Lindholm, Gastgeberin',
    },
  },
  {
    name: 'Bild',
    bg: black,
    shapes: [
      plain(grow(bigPicture, 0.22), firm),
      stepped(grow(bigPicture, 0.62), 0.5),
      line(3.4, 13.4, 6.9, 13.4, firm),
      line(3.4, 13.56, 5.9, 13.56),
      diamond(7.25, 13.4, 0.16),
      line(21.1, 13.4, 24.6, 13.4, firm),
      line(22.1, 13.56, 24.6, 13.56),
      diamond(20.75, 13.4, 0.16),
    ],
    pictures: [bigPicture],
    title: {
      x: 7.8,
      y: 12.4,
      w: 12.4,
      h: 2.1,
      valign: 'middle',
      size: 22,
      sample: 'Der Saal um Mitternacht',
    },
  },
  {
    name: 'Schluss',
    bg: {
      t: 'linear',
      angle: 180,
      stops: [
        [0, night],
        [1, '#132a43'],
      ],
    },
    shapes: [
      // The great fan: bands of two blues, gold rings between them, rays across.
      ...[8.4, 7.2, 6, 4.8, 3.6].flatMap((r, index) => [
        slice(14, 15.75, r, 0, 180, index % 2 === 0 ? '#1a3a5a' : '#10243a'),
        arc(14, 15.75, r, 0, 180, index === 0 ? firm : fine),
      ]),
      ...rays(14, 15.75, 2.4, 8.4, 0, 180, 19),
      ...rays(14, 15.75, 8.7, 9.3, 5, 175, 35, fine, 0.3),
      slice(14, 15.75, 2.4, 0, 180, gold),
      slice(14, 15.75, 1.5, 0, 180, bronze),
      ...ornament(14, 4.75, 4.2),
      ...fan(0, 0, 2.6, 270, 360, 3, 6),
      ...fan(28, 0, 2.6, 180, 270, 3, 6),
    ],
    title: { x: 6, y: 1.3, w: 16, h: 3.1, valign: 'bottom', size: 52, sample: 'Danke' },
    subtitle: {
      x: 6,
      y: 5.15,
      w: 16,
      h: 1.2,
      valign: 'middle',
      sample: 'Auf einen glänzenden Abend',
    },
  },
];

const template: Template = {
  slug: 'art-deco',
  name: 'Art déco',
  group: 'Kunststil',
  tags: ['Art déco', 'Gold', 'elegant', 'festlich', 'Zwanzigerjahre', 'Gala', 'symmetrisch'],
  description:
    'Goldene Linien auf Nachtblau, Smaragd und Schwarz: Fächer, Sonnenstrahlen und gestufte Rahmen.',
  palette: {
    bg: night,
    text: cream,
    bg2: '#17304a',
    text2: pale,
    accents: [gold, emerald, bronze, black, '#7b2d3b', '#2f7a78'],
  },
  fonts: { head: 'Cinzel', body: 'Josefin Sans' },
  text: {
    title: {
      font: 'Cinzel',
      size: 40,
      color: pale,
      bold: true,
      align: 'center',
      spacing: 2,
      lineHeight: 112,
    },
    subtitle: { font: 'Josefin Sans', color: cream, align: 'center', ...caps },
    body: { font: 'Josefin Sans', size: 21, color: cream, lineHeight: 128, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
