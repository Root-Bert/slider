import { createCanvas } from '@napi-rs/canvas';
import { grain, jpeg, paint, rng } from '../art';
import type { Box, Fill, Layout, Picture, Shape, Stroke, Template } from '../model';
import { smoothPath } from '../shapes';

/*
 * Strichzeichnung: a sketchbook page. Fine black lines on white – faces, sprigs and a vase drawn
 * in one go – with hatching as the only shade and a great deal of air around the words.
 */

const ink = '#141414';
const white = '#ffffff';
const grey = '#5c5c5c';

const pen: Stroke = { color: ink, width: 0.05, cap: 'round', join: 'round' };
const fine: Stroke = { color: ink, width: 0.03, cap: 'round', join: 'round' };
const hatch = (angle = 45, distance = 0.11, color = '#5e5e5e'): Fill => ({
  t: 'hatch',
  color,
  distance,
  angle,
});
const cross: Fill = { t: 'hatch', color: '#6e6e6e', distance: 0.15, angle: 45, style: 'double' };

type Point = readonly [number, number];

/**
 * A path given in hundredths of a centimetre on the page. LibreOffice sets a path's own bounds
 * at the shape's place, so the shape gets exactly those bounds as its box.
 */
function drawn(d: string, stroke: Stroke | null = pen, fill: Fill | null = null): Shape {
  const parts = d.match(/[MLCQZ]|-?\d+(?:\.\d+)?/g) ?? [];
  // The curve's true reach: every segment walked in small steps.
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const reach = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  let command = 'M';
  const numbers: number[] = [];
  let [px, py] = [0, 0];
  const flush = () => {
    const need = command === 'C' ? 6 : command === 'Q' ? 4 : 2;
    while (numbers.length >= need) {
      const n = numbers.splice(0, need);
      for (let i = 1; i <= 16; i += 1) {
        const t = i / 16;
        const u = 1 - t;
        if (need === 6) {
          reach(
            u * u * u * px + 3 * u * u * t * n[0]! + 3 * u * t * t * n[2]! + t * t * t * n[4]!,
            u * u * u * py + 3 * u * u * t * n[1]! + 3 * u * t * t * n[3]! + t * t * t * n[5]!,
          );
        } else if (need === 4) {
          reach(
            u * u * px + 2 * u * t * n[0]! + t * t * n[2]!,
            u * u * py + 2 * u * t * n[1]! + t * t * n[3]!,
          );
        }
      }
      [px, py] = [n[need - 2]!, n[need - 1]!];
      reach(px, py);
    }
  };
  for (const part of parts) {
    if (/[MLCQZ]/.test(part)) {
      flush();
      command = part;
    } else {
      numbers.push(Number(part));
      flush();
    }
  }
  const [w, h] = [Math.max(maxX - minX, 1), Math.max(maxY - minY, 1)];
  let index = 0;
  const moved = d.replace(/-?\d+(?:\.\d+)?/g, (value) => {
    const shifted = Number(value) - (index % 2 === 0 ? minX : minY);
    index += 1;
    return shifted.toFixed(1);
  });
  return {
    t: 'path',
    x: minX / 100,
    y: minY / 100,
    w: w / 100,
    h: h / 100,
    vb: [Number(w.toFixed(1)), Number(h.toFixed(1))],
    d: moved,
    fill,
    stroke,
  };
}

/** A drawing's points (0 … 1000) set into a square on the page, turned if asked. */
const into =
  (x: number, y: number, size: number, turn = 0) =>
  (points: readonly Point[]): Point[] => {
    const angle = (turn * Math.PI) / 180;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    return points.map(([px, py]) => {
      const [u, v] = [(px - 500) / 1000, (py - 500) / 1000];
      return [
        (x + size / 2 + (u * cos - v * sin) * size) * 100,
        (y + size / 2 + (u * sin + v * cos) * size) * 100,
      ];
    });
  };

const curve = (points: readonly Point[], closed = false) => smoothPath(points, closed);

/** A face seen from the front, as few lines as it takes. */
function face(x: number, y: number, size: number): Shape[] {
  const at = into(x, y, size);
  const lines: (readonly Point[])[] = [
    // The head's outline, left open at the top.
    [
      [330, 90],
      [190, 240],
      [150, 470],
      [210, 720],
      [360, 900],
      [520, 950],
      [690, 890],
      [830, 700],
      [870, 450],
      [800, 210],
      [640, 80],
    ],
    // Brow running into the nose.
    [
      [250, 360],
      [340, 310],
      [450, 330],
      [490, 420],
      [480, 540],
      [440, 640],
      [470, 690],
      [540, 690],
      [575, 660],
    ],
    // The other brow.
    [
      [600, 330],
      [690, 300],
      [790, 345],
    ],
    // Eyes, closed.
    [
      [275, 430],
      [335, 465],
      [405, 440],
    ],
    [
      [610, 440],
      [680, 470],
      [750, 430],
    ],
    // The mouth.
    [
      [390, 790],
      [460, 765],
      [510, 782],
      [560, 765],
      [640, 790],
    ],
    [
      [420, 810],
      [510, 850],
      [610, 812],
    ],
    // Neck.
    [
      [380, 915],
      [370, 1010],
      [300, 1080],
    ],
    [
      [680, 900],
      [700, 1010],
      [790, 1080],
    ],
    // A strand of hair.
    [
      [640, 80],
      [470, 60],
      [330, 90],
      [240, 180],
      [300, 150],
      [420, 130],
      [540, 180],
    ],
  ];
  return lines.map((line) => drawn(curve(at(line))));
}

/** A head in profile, looking left: one line down the face, one round the back of the head. */
function profile(x: number, y: number, size: number): Shape[] {
  const at = into(x, y, size);
  const lines: (readonly Point[])[] = [
    [
      [640, 70],
      [480, 80],
      [370, 160],
      [330, 280],
      [320, 350],
      [235, 465],
      [250, 495],
      [300, 500],
      [282, 540],
      [312, 566],
      [290, 606],
      [316, 640],
      [312, 710],
      [370, 760],
      [470, 750],
      [505, 810],
      [500, 920],
      [430, 1010],
    ],
    [
      [640, 70],
      [790, 130],
      [870, 300],
      [845, 500],
      [740, 640],
      [715, 780],
      [770, 900],
      [900, 990],
    ],
    // Brow, eye, ear.
    [
      [345, 300],
      [410, 268],
      [485, 290],
    ],
    [
      [372, 365],
      [420, 388],
      [470, 362],
    ],
    [
      [640, 400],
      [700, 360],
      [735, 420],
      [700, 500],
      [655, 480],
    ],
    // Hair falling over the brow.
    [
      [640, 70],
      [560, 170],
      [570, 300],
      [640, 380],
    ],
  ];
  return lines.map((line) => drawn(curve(at(line))));
}

/**
 * A sprig: a bending stem with leaves left and right, growing from (`x`, `y`) in direction
 * `angle` (−90 is up). Every `shade`th leaf is hatched.
 */
function sprig(
  x: number,
  y: number,
  length: number,
  angle: number,
  options: { bend?: number; leaves?: number; shade?: number; seed?: number; stroke?: Stroke } = {},
): Shape[] {
  const random = rng(options.seed ?? 1);
  const count = options.leaves ?? 7;
  const bend = options.bend ?? 0.25;
  const stroke = options.stroke ?? pen;
  const a = (angle * Math.PI) / 180;
  const [dx, dy] = [Math.cos(a), Math.sin(a)];
  const [nx, ny] = [-dy, dx];
  const pointAt = (t: number): Point => [
    (x + dx * length * t + nx * bend * length * t * t) * 100,
    (y + dy * length * t + ny * bend * length * t * t) * 100,
  ];
  const tangentAt = (t: number) => Math.atan2(dy + ny * bend * 2 * t, dx + nx * bend * 2 * t);
  const stem = Array.from({ length: 9 }, (_, i) => pointAt(i / 8));
  const n = (value: number) => value.toFixed(1);
  const leaf = (base: Point, direction: number, size: number) => {
    const [cos, sin] = [Math.cos(direction), Math.sin(direction)];
    const tip: Point = [base[0] + cos * size, base[1] + sin * size];
    const belly = size * 0.3;
    const mid: Point = [base[0] + cos * size * 0.45, base[1] + sin * size * 0.45];
    const one: Point = [mid[0] - sin * belly, mid[1] + cos * belly];
    const two: Point = [mid[0] + sin * belly, mid[1] - cos * belly];
    const outline = `M${n(base[0])} ${n(base[1])} Q${n(one[0])} ${n(one[1])} ${n(tip[0])} ${n(tip[1])} Q${n(two[0])} ${n(two[1])} ${n(base[0])} ${n(base[1])} Z`;
    const rib = `M${n(base[0])} ${n(base[1])} L${n(base[0] + cos * size * 0.72)} ${n(base[1] + sin * size * 0.72)}`;
    return { outline, rib };
  };
  let d = curve(stem);
  const shaded: Shape[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = 0.2 + (i / count) * 0.78;
    const side = i % 2 === 0 ? 1 : -1;
    const direction = tangentAt(t) + side * (0.78 + random.range(-0.12, 0.12));
    const size = length * 100 * (0.3 - t * 0.14) * random.range(0.9, 1.1);
    const { outline, rib } = leaf(pointAt(t), direction, size);
    if (options.shade && i % options.shade === 1)
      shaded.push(drawn(outline, null, hatch(60, 0.09)));
    d += ` ${outline} ${rib}`;
  }
  const tip = leaf(pointAt(1), tangentAt(1), length * 100 * 0.17);
  d += ` ${tip.outline} ${tip.rib}`;
  return [...shaded, drawn(d, stroke)];
}

/** A vase: its outline, a hatched shadow on one side, the table's line. */
function vase(x: number, y: number, size: number): Shape[] {
  const at = into(x, y, size);
  const outline: Point[] = [
    [430, 250],
    [570, 250],
    [556, 330],
    [600, 420],
    [700, 560],
    [715, 720],
    [640, 880],
    [500, 915],
    [360, 880],
    [285, 720],
    [300, 560],
    [400, 420],
    [444, 330],
  ];
  const shadow: Point[] = [
    [575, 400],
    [700, 560],
    [715, 720],
    [640, 880],
    [540, 910],
    [610, 760],
    [625, 600],
  ];
  const table = at([
    [60, 905],
    [960, 905],
  ]);
  return [
    drawn(curve(at(shadow), true), null, hatch(45, 0.09)),
    drawn(curve(at(outline), true)),
    drawn(
      curve(
        at([
          [432, 262],
          [500, 285],
          [568, 262],
        ]),
      ),
      fine,
    ),
    drawn(`M${table[0]![0]} ${table[0]![1]} L${table[1]![0]} ${table[1]![1]}`, fine),
  ];
}

/** A shape of shade behind a drawing: a hatched disc. */
const shadeDisc = (cx: number, cy: number, r: number, fill: Fill = hatch()): Shape => ({
  t: 'ellipse',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  fill,
  stroke: null,
});

/** A picture's place with a hatched shadow set off behind it. */
const mount = (box: Box, shift = 0.45): Shape[] => [
  { t: 'rect', x: box.x + shift, y: box.y + shift, w: box.w, h: box.h, fill: hatch(45, 0.11) },
  { t: 'rect', ...box, fill: white, stroke: fine },
];

/** A line drawn by hand: nearly straight. */
const handLine = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed = 1,
  stroke = fine,
): Shape => {
  const random = rng(seed);
  const steps = 6;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const points: Point[] = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const off = i === 0 || i === steps ? 0 : random.range(-1, 1) * length * 0.004;
    return [
      (x1 + (x2 - x1) * t - ((y2 - y1) / length) * off) * 100,
      (y1 + (y2 - y1) * t + ((x2 - x1) / length) * off) * 100,
    ];
  });
  return drawn(curve(points), stroke);
};

/** Shadows of leaves on a sunlit wall – a soft grey stand-in for a photo. */
function leafShadows(seed: number): Picture {
  const surface = paint({ w: 28, h: 17.5 }, 56);
  const { ctx, w, h } = surface;
  const random = rng(seed);
  const small = createCanvas(Math.round(w / 12), Math.round(h / 12));
  const soft = small.getContext('2d');
  const [sw, sh] = [small.width, small.height];
  const wall = soft.createLinearGradient(0, 0, sw, sh);
  wall.addColorStop(0, '#f1f1ef');
  wall.addColorStop(1, '#cfcfcc');
  soft.fillStyle = wall;
  soft.fillRect(0, 0, sw, sh);
  for (let branch = 0; branch < 4; branch += 1) {
    let [x, y] = [sw * random.range(-0.1, 0.5), sh * random.range(-0.1, 0.3)];
    let heading = random.range(0.3, 0.9);
    for (let i = 0; i < 16; i += 1) {
      heading += random.range(-0.18, 0.18);
      x += Math.cos(heading) * sw * 0.055;
      y += Math.sin(heading) * sw * 0.055;
      for (const side of [-1, 1]) {
        const turn = heading + side * random.range(0.6, 1.1);
        const size = sw * random.range(0.035, 0.07);
        soft.save();
        soft.translate(x + Math.cos(turn) * size, y + Math.sin(turn) * size);
        soft.rotate(turn);
        soft.fillStyle = `rgba(70,70,72,${random.range(0.25, 0.55)})`;
        soft.beginPath();
        soft.ellipse(0, 0, size, size * 0.36, 0, 0, Math.PI * 2);
        soft.fill();
        soft.restore();
      }
    }
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);
  // A window's bright patch.
  const sun = ctx.createRadialGradient(w * 0.7, h * 0.35, 0, w * 0.7, h * 0.35, w * 0.5);
  sun.addColorStop(0, 'rgba(255,255,255,0.5)');
  sun.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  grain(surface, 0.06, seed + 2);
  return jpeg(surface, 84);
}

const layouts: Layout[] = [
  {
    // A face on the right, a disc of hatching behind its cheek; the title in the air on the left.
    name: 'Titel',
    bg: white,
    shapes: [
      shadeDisc(23.6, 5.2, 2.9),
      ...face(15.2, 1.5, 11.2),
      handLine(1.9, 10.55, 6.4, 10.55, 3, pen),
    ],
    title: {
      x: 1.8,
      y: 3.2,
      w: 13.4,
      h: 6.8,
      valign: 'bottom',
      size: 68,
      lineHeight: 98,
      sample: 'Eine Linie\ngenügt',
    },
    subtitle: { x: 1.9, y: 11, w: 13, h: 1.6, valign: 'middle', sample: 'Notizen zum Weglassen' },
  },
  {
    // A sprig grows up the left; the chapter stands to its right.
    name: 'Abschnitt',
    bg: white,
    shapes: [
      shadeDisc(6.4, 5.6, 2.4, cross),
      ...sprig(3.4, 15.2, 13.6, -78, { bend: 0.2, leaves: 9, shade: 3, seed: 5 }),
    ],
    title: {
      x: 12,
      y: 4.6,
      w: 14.4,
      h: 4.6,
      valign: 'bottom',
      size: 62,
      italic: true,
      sample: 'Zweites Blatt',
    },
    subtitle: {
      x: 12.1,
      y: 9.6,
      w: 14,
      h: 1.6,
      valign: 'middle',
      sample: 'Was wächst, braucht Raum',
    },
  },
  {
    // The title's line ends in a small sprig; the rest is air.
    name: 'Inhalt',
    bg: white,
    shapes: [
      handLine(1.9, 4.2, 21.6, 4.2, 9),
      ...sprig(21.6, 4.2, 4.3, -24, { bend: -0.18, leaves: 6, shade: 3, seed: 2, stroke: fine }),
    ],
    title: { x: 1.8, y: 1.3, w: 19.5, h: 2.6, valign: 'bottom', size: 38 },
    body: {
      x: 1.9,
      y: 5,
      w: 21,
      h: 9.3,
      sample: [
        'Erst sehen, dann zeichnen',
        'Eine Linie, die nicht absetzt, bleibt ehrlich',
        'Schatten entsteht aus Strichen, nicht aus Farbe',
        'Der leere Raum gehört zum Bild',
        'Fertig ist, was man nicht mehr verbessern kann',
      ],
    },
  },
  {
    // The picture mounted with a hatched shadow, a sprig leaning in beneath the text.
    name: 'Text und Bild',
    bg: white,
    shapes: [...mount({ x: 15, y: 1.7, w: 11, h: 11.7 }), handLine(1.9, 5.3, 6.4, 5.3, 4, pen)],
    title: { x: 1.8, y: 1.3, w: 12.2, h: 3.7, valign: 'bottom', size: 36 },
    body: {
      x: 1.9,
      y: 6.1,
      w: 12,
      h: 8.2,
      size: 20,
      sample: ['Das Foto liefert den Ton', 'Die Linie die Form', 'Zusammen ein Blatt'],
    },
    pictures: [{ x: 15.3, y: 2, w: 10.4, h: 11.1 }],
  },
  {
    // Two columns either side of a line drawn by hand, each under its own little mark.
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      handLine(14, 5, 14, 14.2, 7),
      shadeDisc(2.5, 5.45, 0.55, hatch(45, 0.08, ink)),
      { t: 'ellipse', x: 1.95, y: 4.9, w: 1.1, h: 1.1, fill: null, stroke: fine },
      { t: 'ellipse', x: 15.55, y: 4.9, w: 1.1, h: 1.1, fill: null, stroke: fine },
      handLine(1.9, 4.05, 26.1, 4.05, 12),
    ],
    title: {
      x: 1.8,
      y: 1.3,
      w: 24,
      h: 2.5,
      valign: 'bottom',
      size: 38,
      sample: 'Schatten und Licht',
    },
    body: [
      {
        x: 1.9,
        y: 6.5,
        w: 11,
        h: 7.8,
        size: 20,
        sample: ['Gibt der Form Gewicht', 'Führt den Blick', 'Braucht Geduld'],
      },
      {
        x: 15.5,
        y: 6.5,
        w: 11,
        h: 7.8,
        size: 20,
        sample: ['Lässt das Blatt atmen', 'Kostet keinen Strich', 'Bleibt, was es war'],
      },
    ],
  },
  {
    // The number over a hatched disc, underlined by hand.
    name: 'Kennzahl',
    bg: white,
    shapes: [
      shadeDisc(11.4, 5.6, 3.6, hatch(45, 0.15, '#9c9c9c')),
      drawn(
        curve([
          [200, 1230],
          [520, 1205],
          [900, 1238],
          [1250, 1210],
          [1560, 1232],
        ]),
      ),
      handLine(17.6, 6.1, 21, 6.1, 5, pen),
    ],
    title: {
      x: 1.8,
      y: 2.6,
      w: 14.6,
      h: 9.4,
      valign: 'bottom',
      size: 190,
      sample: '64 %',
    },
    body: {
      x: 17.6,
      y: 6.7,
      w: 8.6,
      h: 6,
      size: 23,
      sample: 'der Fläche bleiben frei. Genau deshalb sieht man den Rest.',
    },
  },
  {
    // A head in profile listens on the left; the quote in italics beside it.
    name: 'Zitat',
    bg: white,
    shapes: [shadeDisc(9.6, 9.9, 2.6), ...profile(0.6, 1.4, 12.4)],
    body: {
      x: 13.6,
      y: 2.6,
      w: 12.6,
      h: 8.2,
      valign: 'middle',
      font: 'Newsreader',
      italic: true,
      size: 38,
      lineHeight: 112,
      color: ink,
      sample: 'Zeichnen heißt, eine Linie spazieren zu führen.',
    },
    subtitle: {
      x: 13.7,
      y: 11.4,
      w: 12.4,
      h: 1.6,
      valign: 'middle',
      sample: 'Aus dem Skizzenbuch',
    },
  },
  {
    // The picture wide and mounted; its caption under it, a sprig lying beside.
    name: 'Bild',
    bg: white,
    shapes: [
      ...mount({ x: 1.8, y: 1.3, w: 24.2, h: 10.6 }),
      ...sprig(20.2, 14, 5.6, -8, { bend: -0.14, leaves: 7, shade: 3, seed: 8, stroke: fine }),
    ],
    pictures: [{ x: 2.1, y: 1.6, w: 23.6, h: 10 }],
    title: {
      x: 1.8,
      y: 12.7,
      w: 17.6,
      h: 2,
      valign: 'middle',
      italic: true,
      size: 30,
      sample: 'Blattschatten am Nachmittag',
    },
  },
  {
    // A vase with three sprigs; the last word beside it.
    name: 'Schluss',
    bg: white,
    shapes: [
      ...sprig(21.4, 8.3, 6.6, -112, { bend: -0.22, leaves: 7, shade: 3, seed: 3 }),
      ...sprig(21.6, 8.3, 7.2, -84, { bend: 0.1, leaves: 8, shade: 4, seed: 6 }),
      ...sprig(21.8, 8.3, 5.6, -52, { bend: 0.24, leaves: 6, shade: 3, seed: 10 }),
      ...vase(17.1, 6, 9),
      handLine(1.9, 10.05, 6.4, 10.05, 6, pen),
    ],
    title: {
      x: 1.8,
      y: 3.6,
      w: 14,
      h: 5.9,
      valign: 'bottom',
      size: 96,
      sample: 'Danke',
    },
    subtitle: {
      x: 1.9,
      y: 10.5,
      w: 13,
      h: 1.6,
      valign: 'middle',
      sample: 'Der Stift liegt jetzt bei Ihnen',
    },
  },
];

const template: Template = {
  slug: 'strichzeichnung',
  name: 'Strichzeichnung',
  group: 'Schwarzweiß',
  tags: ['Schwarzweiß', 'Zeichnung', 'Linie', 'Schraffur', 'leicht', 'Kunst', 'Skizze', 'ruhig'],
  description:
    'Feine schwarze Linien auf Weiß: Gesichter, Zweige und eine Vase in einem Zug gezeichnet, Schraffur als einziger Schatten, viel Luft.',
  palette: {
    bg: white,
    text: ink,
    bg2: '#f3f2ee',
    text2: grey,
    accents: ['#2f2f2f', '#8a8a8a', '#b5b5b5', '#dcdcd8', '#b9603f', '#7d8f7a'],
  },
  fonts: { head: 'Newsreader', body: 'Karla' },
  text: {
    title: { font: 'Newsreader', size: 54, color: ink, lineHeight: 102 },
    subtitle: { font: 'Karla', size: 20, color: grey },
    body: { font: 'Karla', size: 22, color: ink, lineHeight: 126, paraSpace: 0.4 },
  },
  layouts,
  samplePictures: [leafShadows(4), leafShadows(9)],
};

export default template;
