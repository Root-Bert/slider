import { mix, rng } from '../art';
import type { Color, Layout, Shadow, Shape, Template } from '../model';
import { PAGE } from '../model';
import { smoothPath } from '../shapes';

/*
 * Papierschnitt: sheets of coloured paper cut by hand and stacked into a small stage – every
 * sheet throws a soft shadow on the one behind it, every layout stays in one family of colours.
 */

const sand = '#f7f0e3';
const linen = '#eadfc9';
const ink = '#17353c';
const slate = '#4d696c';
const deep = '#1f5a63';
const teal = '#3d8c8a';
const foam = '#9ccdbd';
const coral = '#e2725b';
const ochre = '#e5ab52';
const plum = '#6b4a6e';

type Point = readonly [number, number];
type Side = 'bottom' | 'top' | 'left' | 'right';

/** Path units per centimetre. */
const U = 100;

/**
 * A path given in page coordinates (`U` units per centimetre) as a shape. LibreOffice puts a
 * path's own bounds at the box's corner, whatever its view box says – so the box is made exactly
 * the path's bounds and the path moved to start at 0, 0.
 */
function cutOut(d: string, fill: Color, shadow?: Shadow): Shape {
  const tokens = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const commands: { op: string; pts: [number, number][] }[] = [];
  for (let i = 0; i < tokens.length;) {
    const op = tokens[i]!;
    i += 1;
    const pts: [number, number][] = [];
    while (i < tokens.length && !/[MLCZ]/.test(tokens[i]!)) {
      pts.push([Number(tokens[i]), Number(tokens[i + 1])]);
      i += 2;
    }
    commands.push({ op, pts });
  }
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const see = (x: number, y: number) => {
    [minX, minY, maxX, maxY] = [
      Math.min(minX, x),
      Math.min(minY, y),
      Math.max(maxX, x),
      Math.max(maxY, y),
    ];
  };
  let at: [number, number] = [0, 0];
  for (const { op, pts } of commands) {
    if (op === 'C') {
      for (let k = 0; k + 2 < pts.length + 0 && k + 2 <= pts.length - 1; k += 3) {
        const [a, b, c, e] = [at, pts[k]!, pts[k + 1]!, pts[k + 2]!];
        for (let step = 1; step <= 12; step += 1) {
          const t = step / 12;
          const m = 1 - t;
          see(
            m * m * m * a[0] + 3 * m * m * t * b[0] + 3 * m * t * t * c[0] + t * t * t * e[0],
            m * m * m * a[1] + 3 * m * m * t * b[1] + 3 * m * t * t * c[1] + t * t * t * e[1],
          );
        }
        at = e;
      }
    } else {
      for (const point of pts) {
        see(point[0], point[1]);
        at = point;
      }
    }
  }
  const moved = commands
    .map(
      ({ op, pts }) =>
        op + pts.map(([x, y]) => `${(x - minX).toFixed(1)} ${(y - minY).toFixed(1)}`).join(' '),
    )
    .join(' ');
  return {
    t: 'path',
    x: minX / U,
    y: minY / U,
    w: (maxX - minX) / U,
    h: (maxY - minY) / U,
    vb: [maxX - minX, maxY - minY],
    d: moved,
    fill,
    shadow,
  };
}
const OUT = 1.5;

/** The shadow a sheet of paper throws on the one behind it. */
const cast = (depth = 1, color: Color = '#0d2226'): Shadow => ({
  dx: 0.04 * depth,
  dy: 0.14 * depth,
  blur: 0.42 * depth,
  color,
  opacity: 0.38,
});

/** An edge cut by hand: a few slow waves over each other, the same for the same seed. */
function wobble(seed: number, waves: number) {
  const random = rng(seed);
  const parts = [
    [1, 0.62],
    [2.1, 0.26],
    [3.7, 0.12],
  ].map(([speed, share]) => ({
    speed: speed! * waves,
    share: share!,
    phase: random() * Math.PI * 2,
  }));
  return (t: number) =>
    parts.reduce(
      (sum, part) => sum + Math.sin(t * part.speed * Math.PI * 2 + part.phase) * part.share,
      0,
    );
}

const scaled = (points: readonly Point[]): Point[] => points.map(([x, y]) => [x * U, y * U]);

interface Cut {
  /** How far the sheet reaches into the page, centimetres. */
  depth: number;
  /** How high its waves are. */
  amp?: number;
  waves?: number;
  seed: number;
  /** The edge rises by this much from its start to its end. */
  tilt?: number;
  shadow?: Shadow | null;
}

/** A sheet lying in from one side of the page, its inner edge cut in waves. */
function sheet(side: Side, fill: Color, cut: Cut): Shape {
  const across = side === 'bottom' || side === 'top';
  const length = across ? PAGE.w : PAGE.h;
  const far = across ? PAGE.h : PAGE.w;
  const edge = wobble(cut.seed, cut.waves ?? 1.4);
  const steps = 26;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const along = -OUT + t * (length + OUT * 2);
    const reach = cut.depth + edge(t) * (cut.amp ?? 0.7) + (t - 0.5) * (cut.tilt ?? 0);
    const level = side === 'bottom' || side === 'right' ? far - reach : reach;
    points.push(across ? [along, level] : [level, along]);
  }
  const out = side === 'bottom' || side === 'right' ? far + OUT : -OUT;
  const close: Point[] = across
    ? [
        [length + OUT, out],
        [-OUT, out],
      ]
    : [
        [out, length + OUT],
        [out, -OUT],
      ];
  return cutOut(
    `${smoothPath(scaled(points), false)} ${scaled(close)
      .map(([x, y]) => `L${x.toFixed(0)} ${y.toFixed(0)}`)
      .join(' ')} Z`,
    fill,
    cut.shadow === null ? undefined : (cut.shadow ?? cast()),
  );
}

interface Hole {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  seed: number;
  wobble?: number;
  waves?: number;
}

const rim = (hole: Hole): Point[] => {
  const edge = wobble(hole.seed, hole.waves ?? 3);
  const count = 28;
  return Array.from({ length: count }, (_, index): Point => {
    const t = index / count;
    const angle = t * Math.PI * 2;
    const grow = 1 + edge(t) * (hole.wobble ?? 0.09);
    // A rounded oblong rather than an ellipse: it follows the page.
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    const squareness = 0.62;
    const stretch = 1 / Math.pow(Math.abs(c) ** 4 + Math.abs(s) ** 4, squareness / 4);
    return [hole.cx + c * hole.rx * grow * stretch, hole.cy + s * hole.ry * grow * stretch];
  });
};

/** A sheet over the whole page with a window cut out of it. */
const windowed = (fill: Color, hole: Hole, shadow: Shadow = cast()): Shape =>
  cutOut(
    `M${-OUT * U} ${-OUT * U} L${(PAGE.w + OUT) * U} ${-OUT * U} L${(PAGE.w + OUT) * U} ${(PAGE.h + OUT) * U} L${-OUT * U} ${(PAGE.h + OUT) * U} Z ${smoothPath(scaled(rim(hole)))}`,
    fill,
    shadow,
  );

/** A loose piece of paper: a rounded form cut freehand. */
const piece = (fill: Color, hole: Hole, shadow: Shadow | undefined = cast()): Shape =>
  cutOut(smoothPath(scaled(rim(hole))), fill, shadow);

/** `count` colours from the back sheet to the front one. */
const ramp = (back: Color, front: Color, count: number): Color[] =>
  Array.from({ length: count }, (_, index) =>
    mix(back, front, count === 1 ? 1 : index / (count - 1)),
  );

/** A sheet of paper to write on. */
const card = (x: number, y: number, w: number, h: number, fill: Color, rotate = 0): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  r: 0.5,
  fill,
  rotate,
  shadow: cast(1.1),
});

const bullets = [
  'Jede Ebene trägt genau einen Gedanken',
  'Vorn steht, was heute entschieden wird',
  'Dahinter liegt, was es begründet',
  'Der Hintergrund bleibt ruhig und hell',
  'Schatten zeigen, was zusammengehört',
];

const tealRamp = ramp(foam, deep, 5);
const coralRamp = ramp('#f6cdb5', '#b9473a', 5);
const plumRamp = ramp('#d9c3d3', '#4f3353', 4);
const ochreRamp = ramp('#f5dfae', '#c9822f', 4);

const layouts: Layout[] = [
  {
    // A landscape on a stage: the hills come forward and darken, the sun stays behind them.
    name: 'Titel',
    bg: sand,
    shapes: [
      piece(
        '#f1c98a',
        { cx: 21.6, cy: 6.6, rx: 3.5, ry: 3.5, seed: 4, wobble: 0.02 },
        cast(0.8, '#8a6a3a'),
      ),
      piece(
        ochre,
        { cx: 21.6, cy: 6.6, rx: 2.5, ry: 2.5, seed: 5, wobble: 0.02 },
        cast(0.8, '#8a6a3a'),
      ),
      sheet('bottom', tealRamp[0]!, { depth: 7.2, amp: 1.1, waves: 1.1, seed: 11, tilt: 4.2 }),
      sheet('bottom', tealRamp[1]!, { depth: 5.7, amp: 0.9, waves: 1.5, seed: 12, tilt: 1.6 }),
      sheet('bottom', tealRamp[2]!, { depth: 4.3, amp: 0.8, waves: 1.3, seed: 13, tilt: 3.4 }),
      sheet('bottom', tealRamp[3]!, { depth: 2.9, amp: 0.6, waves: 1.8, seed: 14, tilt: -0.6 }),
      sheet('bottom', tealRamp[4]!, { depth: 1.5, amp: 0.45, waves: 1.6, seed: 15, tilt: 1.2 }),
    ],
    title: {
      x: 2,
      y: 1.5,
      w: 15.5,
      h: 5,
      valign: 'bottom',
      size: 60,
      sample: 'Schicht\nfür Schicht',
    },
    subtitle: {
      x: 2.05,
      y: 6.8,
      w: 13,
      h: 1.5,
      sample: 'Wie aus vielen Lagen ein Bild wird',
    },
  },
  {
    // A paper tunnel: window behind window, the title on the last, lightest sheet.
    name: 'Abschnitt',
    bg: '#fbe9d9',
    shapes: [
      windowed(coralRamp[0]!, { cx: 14.6, cy: 7.9, rx: 10.6, ry: 5.1, seed: 21 }),
      windowed(coralRamp[1]!, { cx: 14.3, cy: 7.8, rx: 11.7, ry: 5.9, seed: 22 }),
      windowed(coralRamp[2]!, { cx: 14.1, cy: 7.9, rx: 12.8, ry: 6.7, seed: 23 }),
      windowed(coralRamp[3]!, { cx: 13.9, cy: 7.8, rx: 13.9, ry: 7.5, seed: 24 }),
      windowed(coralRamp[4]!, { cx: 14, cy: 7.9, rx: 15.2, ry: 8.5, seed: 25, wobble: 0.06 }),
    ],
    title: {
      x: 6.4,
      y: 4.3,
      w: 16.4,
      h: 4.6,
      align: 'center',
      valign: 'bottom',
      size: 52,
      color: '#5a1f1a',
      sample: 'Die zweite Ebene',
    },
    subtitle: {
      x: 7.4,
      y: 9.2,
      w: 14.4,
      h: 1.5,
      align: 'center',
      color: '#8f3c31',
      sample: 'Was hinter dem ersten Eindruck liegt',
    },
  },
  {
    // Sheets pushed in from the left like the wings of a stage; the page itself stays free.
    name: 'Inhalt',
    bg: sand,
    shapes: [
      sheet('left', tealRamp[0]!, { depth: 4.5, amp: 0.55, waves: 1.2, seed: 31, tilt: -1.4 }),
      sheet('left', tealRamp[1]!, { depth: 3.5, amp: 0.5, waves: 1.5, seed: 32, tilt: 1 }),
      sheet('left', tealRamp[2]!, { depth: 2.5, amp: 0.45, waves: 1.3, seed: 33, tilt: -1 }),
      sheet('left', tealRamp[3]!, { depth: 1.55, amp: 0.4, waves: 1.7, seed: 34, tilt: 0.8 }),
      sheet('left', tealRamp[4]!, { depth: 0.7, amp: 0.3, waves: 1.4, seed: 35 }),
    ],
    title: { x: 6.6, y: 1.3, w: 19.6, h: 2.3, valign: 'middle', sample: 'Was eine Ebene trägt' },
    body: { x: 6.6, y: 4.1, w: 19.6, h: 10.2, sample: bullets },
  },
  {
    // The picture lies on its own sheet; ochre layers come down from the corner behind it.
    name: 'Text und Bild',
    bg: sand,
    shapes: [
      piece(ochreRamp[0]!, { cx: 25.5, cy: 1.5, rx: 13.5, ry: 9.2, seed: 41, wobble: 0.07 }),
      piece(ochreRamp[1]!, { cx: 26.5, cy: 0.8, rx: 11, ry: 7.2, seed: 42, wobble: 0.08 }),
      piece(ochreRamp[2]!, { cx: 27.5, cy: 0.2, rx: 8.2, ry: 5.2, seed: 43, wobble: 0.09 }),
      piece(ochreRamp[3]!, { cx: 28.3, cy: -0.4, rx: 5.2, ry: 3.2, seed: 44, wobble: 0.1 }),
      card(14.6, 3.5, 11.6, 10.4, '#fffaf0'),
    ],
    title: {
      x: 1.8,
      y: 1.3,
      w: 11.8,
      h: 3.4,
      valign: 'bottom',
      size: 36,
      sample: 'Ein Bild\nals eigene Lage',
    },
    body: {
      x: 1.8,
      y: 5.2,
      w: 11.6,
      h: 9,
      sample: [
        'Das Bild liegt obenauf',
        'Der Text hat seine eigene Seite',
        'Beide teilen sich eine Farbe',
        'Nichts drängt sich vor',
      ],
    },
    pictures: [{ x: 15.1, y: 4, w: 10.6, h: 9.4 }],
  },
  {
    // Two sheets laid side by side on a green ground, hills along the bottom.
    name: 'Zwei Spalten',
    bg: '#dcebe0',
    shapes: [
      sheet('bottom', tealRamp[0]!, { depth: 4.4, amp: 0.7, waves: 1.2, seed: 51, tilt: -2.2 }),
      sheet('bottom', tealRamp[1]!, { depth: 3.1, amp: 0.6, waves: 1.6, seed: 52, tilt: 1.8 }),
      sheet('bottom', tealRamp[2]!, { depth: 1.9, amp: 0.5, waves: 1.4, seed: 53, tilt: -1 }),
      sheet('bottom', tealRamp[3]!, { depth: 0.9, amp: 0.3, waves: 1.9, seed: 54 }),
      card(1.7, 4, 11.9, 9.9, '#fffaf0', -0.8),
      card(14.4, 4, 11.9, 9.9, sand, 0.8),
    ],
    title: {
      x: 1.8,
      y: 1.1,
      w: 24.4,
      h: 2.3,
      valign: 'middle',
      sample: 'Vordergrund und Hintergrund',
    },
    body: [
      {
        x: 2.4,
        y: 4.7,
        w: 10.5,
        h: 8.5,
        size: 19,
        sample: [
          'Was sofort ins Auge fällt',
          'Klare Formen, kräftige Töne',
          'Wenige Worte, die tragen',
        ],
      },
      {
        x: 15.1,
        y: 4.7,
        w: 10.5,
        h: 8.5,
        size: 19,
        sample: [
          'Was dem Ganzen Tiefe gibt',
          'Leise Farben, weiche Kanten',
          'Zahlen, Quellen, Belege',
        ],
      },
    ],
  },
  {
    // The number at the bottom of a well cut through four dark sheets.
    name: 'Kennzahl',
    bg: sand,
    shapes: [
      windowed(
        mix(foam, sand, 0.3),
        { cx: 8.6, cy: 7.9, rx: 5.6, ry: 4.6, seed: 61, wobble: 0.07 },
        cast(1, '#0d2226'),
      ),
      windowed(tealRamp[1]!, { cx: 8.8, cy: 7.8, rx: 6.5, ry: 5.4, seed: 62, wobble: 0.07 }),
      windowed(tealRamp[2]!, { cx: 9, cy: 7.9, rx: 7.4, ry: 6.2, seed: 63, wobble: 0.07 }),
      windowed(tealRamp[3]!, { cx: 9.2, cy: 7.8, rx: 8.4, ry: 7.1, seed: 64, wobble: 0.07 }),
      windowed(ink, { cx: 9.5, cy: 7.9, rx: 9.5, ry: 8.2, seed: 65, wobble: 0.06 }),
      piece(coral, { cx: 20.7, cy: 3.6, rx: 0.7, ry: 0.7, seed: 66, wobble: 0.03 }, cast(0.7)),
    ],
    title: {
      x: 3.9,
      y: 5,
      w: 9.4,
      h: 5.8,
      align: 'center',
      valign: 'middle',
      size: 100,
      color: ink,
      sample: '7',
    },
    body: {
      x: 20,
      y: 4.6,
      w: 6.6,
      h: 6.6,
      valign: 'middle',
      size: 22,
      color: sand,
      sample: 'Lagen Papier liegen in diesem Bild übereinander.\nJede ist nur einen Schnitt breit.',
    },
  },
  {
    // Plum sheets fold in from two corners; the quote stands on the open paper between them.
    name: 'Zitat',
    bg: '#f6ecef',
    shapes: [
      piece(plumRamp[0]!, { cx: 0.5, cy: 0.5, rx: 8.8, ry: 6.4, seed: 71, wobble: 0.08 }),
      piece(plumRamp[1]!, { cx: 0, cy: 0, rx: 6.8, ry: 4.8, seed: 72, wobble: 0.09 }),
      piece(plumRamp[2]!, { cx: -0.4, cy: -0.4, rx: 4.9, ry: 3.3, seed: 73, wobble: 0.1 }),
      piece(plumRamp[3]!, { cx: -0.6, cy: -0.6, rx: 3, ry: 1.9, seed: 74, wobble: 0.1 }),
      piece(plumRamp[0]!, { cx: 27.5, cy: 15.3, rx: 9.6, ry: 5.6, seed: 75, wobble: 0.08 }),
      piece(plumRamp[1]!, { cx: 28, cy: 15.8, rx: 7.4, ry: 4.1, seed: 76, wobble: 0.09 }),
      piece(plumRamp[2]!, { cx: 28.4, cy: 16.2, rx: 5.2, ry: 2.8, seed: 77, wobble: 0.1 }),
      piece(plumRamp[3]!, { cx: 28.6, cy: 16.4, rx: 3.1, ry: 1.6, seed: 78, wobble: 0.1 }),
      // The quotation marks, cut from coral paper.
      piece(coral, { cx: 9.3, cy: 3.2, rx: 0.62, ry: 0.62, seed: 79, wobble: 0.03 }, cast(0.7)),
      piece(coral, { cx: 10.9, cy: 3.2, rx: 0.62, ry: 0.62, seed: 80, wobble: 0.03 }, cast(0.7)),
    ],
    body: {
      x: 5.4,
      y: 4.3,
      w: 17.6,
      h: 6.2,
      valign: 'middle',
      font: 'Outfit',
      size: 32,
      lineHeight: 122,
      color: '#3b2540',
      sample:
        'Tiefe entsteht nicht durch mehr Farbe, sondern durch den Schatten zwischen zwei Blättern.',
    },
    subtitle: {
      x: 5.4,
      y: 10.9,
      w: 14,
      h: 1.4,
      color: plum,
      sample: 'Mara Lind, Papierkünstlerin',
    },
  },
  {
    // The picture as the far end of the stage, the hills in front of it carry its caption.
    name: 'Bild',
    bg: linen,
    shapes: [
      sheet('bottom', tealRamp[1]!, { depth: 6.2, amp: 0.8, waves: 1.2, seed: 81, tilt: 3 }),
      sheet('bottom', tealRamp[2]!, { depth: 5, amp: 0.6, waves: 1.5, seed: 82, tilt: -2 }),
      sheet('bottom', tealRamp[4]!, { depth: 4, amp: 0.35, waves: 1.3, seed: 83, tilt: 0.6 }),
      card(1.5, 1.1, 25, 10.9, '#fffaf0'),
    ],
    pictures: [{ x: 1.9, y: 1.5, w: 24.2, h: 10.1 }],
    title: {
      x: 1.9,
      y: 12.5,
      w: 24.2,
      h: 2.2,
      valign: 'middle',
      size: 30,
      color: sand,
      sample: 'Ein Blick durch alle Ebenen',
    },
  },
  {
    // The same stage at night: dark sheets from both sides, a moon, the words in the clearing.
    name: 'Schluss',
    bg: '#12303a',
    shapes: [
      piece(
        '#f3dfb4',
        { cx: 14, cy: 4.1, rx: 9.2, ry: 9.2, seed: 91, wobble: 0.015 },
        cast(1.2, '#000000'),
      ),
      sheet('bottom', mix(deep, teal, 0.75), {
        depth: 5.6,
        amp: 1,
        waves: 1.1,
        seed: 92,
        tilt: -3.6,
      }),
      sheet('bottom', mix(deep, teal, 0.35), {
        depth: 4.3,
        amp: 0.8,
        waves: 1.4,
        seed: 93,
        tilt: 3,
      }),
      sheet('bottom', deep, { depth: 3, amp: 0.7, waves: 1.3, seed: 94, tilt: -1.6 }),
      sheet('bottom', mix(deep, '#12303a', 0.55), {
        depth: 1.7,
        amp: 0.5,
        waves: 1.8,
        seed: 95,
        tilt: 1,
      }),
    ],
    title: {
      x: 6.5,
      y: 2.2,
      w: 15,
      h: 4,
      align: 'center',
      valign: 'bottom',
      size: 60,
      sample: 'Danke',
    },
    subtitle: {
      x: 7,
      y: 6.4,
      w: 14,
      h: 1.5,
      align: 'center',
      color: slate,
      sample: 'Fragen? Wir blättern gern zurück.',
    },
  },
];

const template: Template = {
  slug: 'scherenschnitt',
  name: 'Papierschnitt',
  group: 'Kunststil',
  tags: [
    'Papierschnitt',
    'Scherenschnitt',
    'Papier',
    'Ebenen',
    'Schatten',
    'Diorama',
    'weich',
    'freundlich',
    'Natur',
  ],
  description:
    'Geschnittenes Papier in Lagen: weiche Schatten zwischen den Blättern geben jeder Folie Tiefe wie eine kleine Bühne.',
  palette: {
    bg: sand,
    text: ink,
    bg2: linen,
    text2: slate,
    accents: [deep, teal, foam, coral, ochre, plum],
  },
  fonts: { head: 'Outfit', body: 'Nunito' },
  text: {
    title: { font: 'Outfit', size: 40, color: ink, bold: true, lineHeight: 104 },
    subtitle: { font: 'Nunito', size: 22, color: slate },
    body: { font: 'Nunito', size: 21, color: ink, lineHeight: 122, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
