import { grain, jpeg, noise, paint, rng, stencil, type Rng } from '../art';
import type { Color, Layout, Picture, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page } from '../shapes';

/*
 * Kreidetafel: a classroom board – green-grey slate with the dust of many wipings, and on it
 * what a teacher draws while talking: rough frames, arrows, underlines, little doodles in white
 * and pastel chalk. Lettering by hand, long text in a round, plain face.
 */

const slate = '#2b4640';
const dark = '#1f342f';
const chalk = '#f4f0e4';
const dust = '#c5cfc6';
const yellow = '#f7e07a';
const pink = '#f4a9b8';
const sky = '#9fd4ec';
const green = '#b9e3a2';
const orange = '#f6b97c';
const wood = '#8a6644';

/** The board: slate, lighter where the sponge went, darker to the rim. */
function board(): Picture {
  const surface = paint(PAGE, 1600 / PAGE.w);
  const { ctx, w, h } = surface;
  ctx.fillStyle = slate;
  ctx.fillRect(0, 0, w, h);
  const wipe = noise(31);
  const cloud = noise(32);
  const image = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // Long, slightly slanted wipes and soft clouds of dust.
      const streak = wipe((x + y * 0.35) / 520, (y - x * 0.12) / 70, 3);
      const fog = cloud(x / 300, y / 300, 4);
      const edge = Math.hypot((x / w - 0.5) * 1.1, y / h - 0.5);
      const light = Math.max(0, streak - 0.45) * 0.34 + (fog - 0.5) * 0.16 - edge * edge * 0.3;
      const i = (y * w + x) * 4;
      image.data[i] = image.data[i]! + light * 150;
      image.data[i + 1] = image.data[i + 1]! + light * 158;
      image.data[i + 2] = image.data[i + 2]! + light * 150;
    }
  }
  ctx.putImageData(image, 0, 0);
  grain(surface, 0.045, 9);
  return jpeg(surface, 76);
}

const ground: Shape = { t: 'image', ...page, src: board() };

type Pt = readonly [number, number];

/** Chalk in the hand: everything is drawn in centimetres of the page, a little unsteady. */
function chalkPen(ctx: ReturnType<typeof paint>['ctx'], px: number, random: Rng) {
  /** Dense points along a smooth curve through `pts`. */
  const dense = (pts: readonly Pt[]): Pt[] => {
    if (pts.length < 3) {
      const [a, b] = [pts[0]!, pts[1]!];
      const count = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.6));
      return Array.from({ length: count + 1 }, (_, i): Pt => {
        const t = i / count;
        const push = i === 0 || i === count ? 0 : 0.035;
        return [
          a[0] + (b[0] - a[0]) * t + random.bell() * push,
          a[1] + (b[1] - a[1]) * t + random.bell() * push,
        ];
      });
    }
    const out: Pt[] = [];
    const at = (i: number) => pts[Math.min(pts.length - 1, Math.max(0, i))]!;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      for (let s = 0; s < 10; s += 1) {
        const t = s / 10;
        const f = (a: number, b: number, c: number, d: number) =>
          0.5 *
          (2 * b +
            (c - a) * t +
            (2 * a - 5 * b + 4 * c - d) * t * t +
            (3 * b - a - 3 * c + d) * t * t * t);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(pts[pts.length - 1]!);
    return out;
  };
  const strokeDense = (pts: readonly Pt[], width: number) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let pass = 0; pass < 3; pass += 1) {
      const [ox, oy] =
        pass === 0 ? [0, 0] : [random.bell() * width * 0.5, random.bell() * width * 0.5];
      ctx.globalAlpha = pass === 0 ? 0.9 : 0.5;
      ctx.lineWidth = width * px * (pass === 0 ? 1 : 0.5);
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo((x + ox) * px, (y + oy) * px);
        else ctx.lineTo((x + ox) * px, (y + oy) * px);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  const pen = {
    /** A stroke through points: straight between two, a smooth curve through more. */
    stroke(pts: readonly Pt[], width = 0.1) {
      strokeDense(dense(pts), width);
    },
    line(x1: number, y1: number, x2: number, y2: number, width = 0.1) {
      pen.stroke(
        [
          [x1, y1],
          [x2, y2],
        ],
        width,
      );
    },
    /** A dashed curve. */
    dashed(pts: readonly Pt[], width = 0.08, on = 4, off = 3) {
      const all = dense(pts);
      for (let i = 0; i + on < all.length; i += on + off)
        strokeDense(all.slice(i, i + on + 1), width);
    },
    /** A circle drawn round and round, not quite closing. */
    loop(cx: number, cy: number, rx: number, ry: number, turns = 1.2, width = 0.1, start = -2) {
      const count = Math.round(40 * turns);
      const pts: Pt[] = [];
      for (let i = 0; i <= count; i += 1) {
        const a = start + (i / 40) * Math.PI * 2;
        const drift = 1 + (i / count - 0.5) * 0.07 + random.bell() * 0.008;
        pts.push([cx + Math.cos(a) * rx * drift, cy + Math.sin(a) * ry * drift]);
      }
      strokeDense(pts, width);
    },
    /** A frame drawn in four strokes that overshoot their corners. */
    frame(x: number, y: number, w: number, h: number, width = 0.1) {
      const o = () => random.range(0.1, 0.35);
      const s = () => random.bell() * 0.08;
      pen.line(x - o(), y + s(), x + w + o(), y + s(), width);
      pen.line(x + w + s(), y - o(), x + w + s(), y + h + o(), width);
      pen.line(x + w + o(), y + h + s(), x - o(), y + h + s(), width);
      pen.line(x + s(), y + h + o(), x + s(), y - o(), width);
    },
    /** A curve ending in an arrow head. */
    arrow(pts: readonly Pt[], width = 0.1, size = 0.55) {
      const all = dense(pts);
      strokeDense(all, width);
      const [tip, before] = [all[all.length - 1]!, all[all.length - 4]!];
      const a = Math.atan2(tip[1] - before[1], tip[0] - before[0]);
      for (const side of [-1, 1]) {
        const b = a + Math.PI + side * 0.5;
        pen.line(tip[0], tip[1], tip[0] + Math.cos(b) * size, tip[1] + Math.sin(b) * size, width);
      }
    },
    /** A wavy line. */
    wave(x: number, y: number, length: number, amp: number, waves: number, width = 0.1) {
      const count = Math.round(waves * 2);
      pen.stroke(
        Array.from({ length: count + 1 }, (_, i): Pt => [
          x + (i / count) * length,
          y + (i % 2 === 0 ? -amp : amp),
        ]),
        width,
      );
    },
    /** Short strokes pointing away from a centre. */
    rays(
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      length: number,
      count: number,
      width = 0.1,
      from = 0,
      to = 360,
    ) {
      for (let i = 0; i < count; i += 1) {
        const a =
          ((from + ((to - from) * i) / (to - from >= 360 ? count : count - 1)) * Math.PI) / 180;
        const reach = length * random.range(0.75, 1.15);
        pen.line(
          cx + Math.cos(a) * rx,
          cy + Math.sin(a) * ry,
          cx + Math.cos(a) * (rx + reach),
          cy + Math.sin(a) * (ry + reach),
          width,
        );
      }
    },
    /** A five-pointed star in one go. */
    star(cx: number, cy: number, r: number, width = 0.09, turn = 0) {
      const pts: Pt[] = Array.from({ length: 6 }, (_, i) => {
        const a = turn - Math.PI / 2 + (i * 4 * Math.PI) / 5;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      });
      for (let i = 0; i < 5; i += 1)
        pen.line(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], width);
    },
    /** A triangle scribbled full, from its edge a–b to its tip c. */
    flag(a: Pt, b: Pt, c: Pt, width = 0.09) {
      pen.line(a[0], a[1], b[0], b[1], width);
      pen.line(b[0], b[1], c[0], c[1], width);
      pen.line(c[0], c[1], a[0], a[1], width);
      const zig: Pt[] = [];
      for (let i = 0; i <= 9; i += 1) {
        const t = i / 10 + 0.04;
        const from = i % 2 === 0 ? a : b;
        zig.push([from[0] + (c[0] - from[0]) * t, from[1] + (c[1] - from[1]) * t]);
      }
      for (let i = 0; i < zig.length - 1; i += 1) {
        pen.line(zig[i]![0], zig[i]![1], zig[i + 1]![0], zig[i + 1]![1], width * 1.5);
      }
    },
    /** A quotation mark: two fat commas. */
    quote(x: number, y: number, size: number, closing = false) {
      for (const dx of [0, size * 0.62]) {
        const [cx, cy] = [x + dx, y];
        const dir = closing ? 1 : -1;
        pen.loop(cx, cy, size * 0.1, size * 0.1, 1.5, size * 0.2);
        pen.stroke(
          [
            [cx + size * 0.16, cy],
            [cx + size * 0.14, cy + dir * size * 0.3],
            [cx - size * 0.1, cy + dir * size * 0.55],
          ],
          size * 0.11,
        );
      }
    },
  };
  return pen;
}

type Pen = ReturnType<typeof chalkPen>;

/**
 * What one chalk drew on a page: drawn, then worn by the board's tooth – the chalk only holds
 * where the slate is rough.
 */
function drawn(color: Color, seed: number, draw: (pen: Pen) => void): Shape {
  const surface = paint(PAGE, 1500 / PAGE.w);
  const { ctx, w, h, px } = surface;
  ctx.strokeStyle = '#ffffff';
  draw(chalkPen(ctx, px, rng(seed)));
  const tooth = noise(seed + 77);
  const image = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4 + 3;
      if (image.data[i] === 0) continue;
      const hold = (tooth(x / 1.7, y / 1.7, 2) - 0.2) * 2.3;
      image.data[i] = image.data[i]! * Math.min(1, Math.max(0, hold));
    }
  }
  ctx.putImageData(image, 0, 0);
  return { t: 'image', ...page, src: stencil(surface, color) };
}

/** The ledge under the board with what lies on it. */
function ledge(): Shape[] {
  const stick = (x: number, w: number, color: Color, rotate: number): Shape => ({
    t: 'rect',
    x,
    y: 14.16,
    w,
    h: 0.42,
    r: 0.1,
    fill: {
      t: 'linear',
      angle: 180,
      stops: [
        [0, color],
        [1, `${color}`],
      ],
    },
    rotate,
    shadow: { dx: 0.03, dy: 0.06, blur: 0.12, opacity: 0.45 },
  });
  return [
    {
      t: 'rect',
      x: 0,
      y: 14.3,
      w: 28,
      h: 0.5,
      fill: { t: 'solid', color: '#000000', opacity: 0.22, fade: { from: 0, to: 1, angle: 180 } },
    },
    {
      t: 'rect',
      x: -0.2,
      y: 14.6,
      w: 28.4,
      h: 1.3,
      fill: {
        t: 'linear',
        angle: 180,
        stops: [
          [0, '#a17a52'],
          [0.14, wood],
          [1, '#5f432a'],
        ],
      },
    },
    { t: 'rect', x: -0.2, y: 14.6, w: 28.4, h: 0.07, fill: '#c29a6c' },
    {
      t: 'rect',
      x: -0.2,
      y: 15.1,
      w: 28.4,
      h: 0.03,
      fill: { t: 'solid', color: '#4a321e', opacity: 0.6 },
    },
    stick(2.6, 2.1, chalk, -3),
    stick(5.1, 1.5, yellow, 2),
    stick(7, 1.9, pink, -1),
    // The sponge.
    {
      t: 'rect',
      x: 22.4,
      y: 13.72,
      w: 3,
      h: 0.9,
      r: 0.14,
      fill: '#e2bd55',
      shadow: { dx: 0.04, dy: 0.06, blur: 0.14, opacity: 0.45 },
    },
    { t: 'rect', x: 22.4, y: 13.72, w: 3, h: 0.3, r: 0.12, fill: '#4a6d8c' },
  ];
}

const hand = { font: 'Amatic SC', bold: true, upper: true, spacing: 2 } as const;

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: slate,
    shapes: [
      ground,
      drawn(chalk, 1, (p) => {
        // A paper plane.
        p.line(25.4, 2.6, 19.6, 4.9);
        p.line(19.6, 4.9, 22.1, 5.9);
        p.line(22.1, 5.9, 25.4, 2.6);
        p.line(22.1, 5.9, 22.7, 8.1);
        p.line(22.7, 8.1, 25.4, 2.6);
        p.line(22.7, 8.1, 23.5, 6.5);
        p.line(23.5, 6.5, 25.4, 2.6, 0.07);
        // A cloud.
        p.stroke(
          [
            [16.2, 2.9],
            [16.3, 2.2],
            [17.1, 2.1],
            [17.5, 1.5],
            [18.5, 1.6],
            [18.9, 2.2],
            [19.6, 2.3],
            [19.7, 2.9],
          ],
          0.09,
        );
        p.line(16.1, 2.95, 19.8, 2.95, 0.09);
      }),
      drawn(pink, 2, (p) => {
        p.dashed(
          [
            [21.6, 6.6],
            [19.6, 8.6],
            [17.4, 8.2],
            [17.5, 6.6],
            [19, 6.6],
            [19.2, 8.8],
            [17.2, 11],
            [15.2, 11.6],
          ],
          0.09,
        );
      }),
      drawn(yellow, 3, (p) => {
        p.stroke(
          [
            [2.1, 10.05],
            [6, 9.82],
            [10, 9.95],
            [14.6, 9.75],
          ],
          0.13,
        );
        p.stroke(
          [
            [3, 10.4],
            [7, 10.22],
            [12.2, 10.3],
          ],
          0.09,
        );
        p.star(25.4, 10.6, 0.8);
        p.star(23.2, 11.9, 0.42, 0.08, 0.4);
      }),
      ...ledge(),
    ],
    title: { x: 2.2, y: 2.2, w: 15.6, h: 7.4, sample: 'Warum fliegt\nein Flugzeug?' },
    subtitle: { x: 2.3, y: 10.9, w: 15, h: 1.7, color: sky, sample: 'Physik in der achten Klasse' },
  },
  {
    name: 'Abschnitt',
    bg: slate,
    shapes: [
      ground,
      drawn(chalk, 4, (p) => {
        // The string of the bunting.
        p.stroke(
          [
            [-0.5, 0.9],
            [7, 2.5],
            [14, 3],
            [21, 2.5],
            [28.5, 0.9],
          ],
          0.08,
        );
        p.stroke(
          [
            [8.6, 10.35],
            [12, 10.2],
            [16, 10.32],
            [19.4, 10.15],
          ],
          0.11,
        );
      }),
      ...[yellow, pink, sky].map((color, which) =>
        drawn(color, 5 + which, (p) => {
          for (let i = which; i < 9; i += 3) {
            const x = 1.6 + i * 3;
            const sag = (x: number) => 3 - ((x - 14) / 14) ** 2 * 2.1;
            p.flag(
              [x, sag(x) + 0.05],
              [x + 1.9, sag(x + 1.9) + 0.05],
              [x + 0.95, sag(x + 0.95) + 2.3],
            );
          }
        }),
      ),
    ],
    title: { x: 3, y: 5.4, w: 22, h: 4.6, align: 'center', size: 96, sample: 'Der Auftrieb' },
    subtitle: {
      x: 5,
      y: 10.9,
      w: 18,
      h: 1.7,
      align: 'center',
      color: yellow,
      sample: 'Was die Luft unter dem Flügel tut',
    },
  },
  {
    name: 'Inhalt',
    bg: slate,
    shapes: [
      ground,
      drawn(pink, 8, (p) => {
        p.wave(2.1, 3.62, 11.5, 0.11, 9, 0.1);
      }),
      drawn(chalk, 9, (p) => {
        // A light bulb.
        p.loop(23.9, 9, 1.55, 1.6, 0.86, 0.1, 2.25);
        p.line(23.05, 10.4, 23.15, 11.1);
        p.line(24.75, 10.4, 24.65, 11.1);
        p.line(23.1, 11.15, 24.7, 11.1);
        p.line(23.2, 11.5, 24.6, 11.45);
        p.line(23.4, 11.85, 24.4, 11.8);
        p.stroke(
          [
            [23.45, 10.9],
            [23.3, 9.5],
            [23.65, 9.1],
            [23.9, 9.6],
            [24.15, 9.1],
            [24.5, 9.5],
            [24.35, 10.9],
          ],
          0.07,
        );
      }),
      drawn(yellow, 10, (p) => {
        p.rays(23.9, 9, 2.05, 2.05, 0.75, 7, 0.1, 180, 360);
      }),
    ],
    title: {
      x: 2.1,
      y: 1,
      w: 22,
      h: 2.4,
      valign: 'middle',
      size: 54,
      sample: 'Was wir heute herausfinden',
    },
    body: {
      x: 2.2,
      y: 4.6,
      w: 18.4,
      h: 9.8,
      sample: [
        'Luft hat Gewicht, auch wenn wir es nicht spüren',
        'Über dem Flügel strömt sie schneller',
        'Schneller heißt: weniger Druck',
        'Der Druck von unten hebt den Flügel',
        'Im Versuch reicht ein Blatt Papier',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: slate,
    shapes: [
      ground,
      {
        t: 'rect',
        x: 14.9,
        y: 3.5,
        w: 10.9,
        h: 8.7,
        fill: { t: 'solid', color: dark, opacity: 0.6 },
      },
      drawn(chalk, 11, (p) => {
        p.frame(14.7, 3.3, 11.3, 9.1, 0.1);
        p.frame(14.5, 3.12, 11.7, 9.45, 0.06);
      }),
      drawn(sky, 12, (p) => {
        p.stroke(
          [
            [2.1, 3.65],
            [5, 3.52],
            [9, 3.62],
            [12.4, 3.5],
          ],
          0.11,
        );
        p.arrow(
          [
            [9.4, 13.9],
            [11.6, 14.5],
            [13.4, 13.9],
            [14.2, 12.9],
          ],
          0.1,
        );
      }),
    ],
    title: { x: 2.1, y: 1, w: 12, h: 2.4, valign: 'middle', size: 54, sample: 'Der Versuch' },
    body: {
      x: 2.2,
      y: 4.6,
      w: 11.4,
      h: 8.6,
      sample: [
        'Blatt an die Unterlippe halten',
        'Kräftig darüber pusten',
        'Das Blatt steigt nach oben',
      ],
    },
    pictures: [{ x: 15.1, y: 3.7, w: 10.5, h: 8.3 }],
  },
  {
    name: 'Zwei Spalten',
    bg: slate,
    shapes: [
      ground,
      drawn(yellow, 13, (p) => {
        p.frame(1.7, 4.4, 11.7, 9.9, 0.1);
      }),
      drawn(sky, 14, (p) => {
        p.frame(14.7, 4.4, 11.7, 9.9, 0.1);
      }),
      drawn(chalk, 15, (p) => {
        p.stroke(
          [
            [2.1, 3.6],
            [8, 3.48],
            [14, 3.6],
            [19.5, 3.46],
          ],
          0.1,
        );
        p.star(26.3, 4.3, 0.62, 0.09, 0.2);
        p.star(1.75, 14.3, 0.4, 0.08, 0.5);
      }),
    ],
    title: {
      x: 2.1,
      y: 1,
      w: 23.8,
      h: 2.4,
      valign: 'middle',
      size: 54,
      sample: 'Vogel und Flugzeug',
    },
    body: [
      {
        x: 2.4,
        y: 5.1,
        w: 10.4,
        h: 8.6,
        sample: ['Schlägt mit den Flügeln', 'Federn lenken die Luft', 'Landet auf einem Ast'],
      },
      {
        x: 15.4,
        y: 5.1,
        w: 10.4,
        h: 8.6,
        sample: [
          'Starre Flügel, Schub vom Motor',
          'Klappen lenken die Luft',
          'Braucht eine lange Bahn',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: slate,
    shapes: [
      ground,
      drawn(chalk, 16, (p) => {
        p.loop(8.6, 7.6, 6.5, 4.5, 1.32, 0.11, -2.4);
        p.arrow(
          [
            [17.6, 11.6],
            [16.6, 12.3],
            [15.2, 12],
            [14.3, 10.9],
          ],
          0.1,
        );
      }),
      drawn(pink, 17, (p) => {
        p.rays(8.6, 7.6, 7.1, 5.1, 0.8, 9, 0.11, 205, 335);
        p.star(24.8, 2.6, 0.6, 0.09, 0.3);
      }),
    ],
    title: {
      x: 2.8,
      y: 4,
      w: 11.6,
      h: 7.2,
      valign: 'middle',
      align: 'center',
      size: 150,
      color: yellow,
      sample: '9,81',
    },
    body: {
      x: 17,
      y: 4.2,
      w: 9.2,
      h: 6.8,
      valign: 'middle',
      size: 24,
      sample: 'Meter pro Sekunde schneller wird ein fallender Apfel. In jeder Sekunde.',
    },
  },
  {
    name: 'Zitat',
    bg: slate,
    shapes: [
      ground,
      drawn(pink, 18, (p) => {
        p.quote(2.6, 2.6, 2.2);
        p.quote(23.6, 10.2, 2.2, true);
      }),
      drawn(chalk, 19, (p) => {
        p.line(12.6, 12.25, 14.2, 12.2, 0.1);
        p.wave(3, 14.1, 6, 0.1, 5, 0.07);
      }),
    ],
    body: {
      x: 4.4,
      y: 3.2,
      w: 19.4,
      h: 7.4,
      valign: 'middle',
      align: 'center',
      font: 'Caveat',
      bold: true,
      size: 46,
      lineHeight: 100,
      sample: '„Wer fragt, ist für eine Minute dumm. Wer nicht fragt, bleibt es.“',
    },
    subtitle: {
      x: 14.6,
      y: 11.4,
      w: 11,
      h: 1.7,
      color: yellow,
      sample: 'Herr Okafor, Mathelehrer',
    },
  },
  {
    name: 'Bild',
    bg: slate,
    shapes: [
      ground,
      {
        t: 'rect',
        x: 3.1,
        y: 1.4,
        w: 21.8,
        h: 9.7,
        fill: { t: 'solid', color: dark, opacity: 0.6 },
      },
      drawn(chalk, 20, (p) => {
        p.frame(2.9, 1.2, 22.2, 10.1, 0.1);
        p.frame(2.68, 1, 22.64, 10.5, 0.06);
      }),
      drawn(yellow, 21, (p) => {
        p.arrow(
          [
            [6.4, 13.4],
            [4.4, 13.6],
            [3.3, 12.9],
            [3.6, 11.9],
          ],
          0.1,
        );
        p.star(24.6, 13.2, 0.6, 0.09, 0.2);
      }),
    ],
    pictures: [{ x: 3.3, y: 1.6, w: 21.4, h: 9.3 }],
    title: {
      x: 7,
      y: 11.9,
      w: 16.4,
      h: 2.4,
      valign: 'middle',
      size: 46,
      sample: 'So sah es am Dienstag aus',
    },
  },
  {
    name: 'Schluss',
    bg: slate,
    shapes: [
      ground,
      drawn(yellow, 22, (p) => {
        p.rays(14, 6.6, 8.6, 3.4, 0.95, 11, 0.12, 195, 345);
      }),
      drawn(pink, 23, (p) => {
        p.star(4.3, 4.6, 0.8, 0.09, 0.2);
        p.star(23.9, 9.8, 0.55, 0.08, 0.5);
      }),
      drawn(sky, 24, (p) => {
        p.star(23.2, 3.4, 0.5, 0.08);
        p.star(5.6, 9.9, 0.45, 0.08, 0.3);
        p.stroke(
          [
            [9, 9.25],
            [12, 9.1],
            [15.5, 9.22],
            [19, 9.05],
          ],
          0.12,
        );
      }),
      ...ledge(),
    ],
    title: { x: 3, y: 3.6, w: 22, h: 5.2, align: 'center', size: 104, sample: 'Noch Fragen?' },
    subtitle: { x: 6, y: 9.9, w: 16, h: 1.7, align: 'center', sample: 'Dann los, traut euch' },
  },
];

const template: Template = {
  slug: 'kreidetafel',
  name: 'Kreidetafel',
  group: 'Bereich',
  tags: [
    'Kreide',
    'Tafel',
    'Schule',
    'Unterricht',
    'Lernen',
    'handgezeichnet',
    'Workshop',
    'dunkel',
  ],
  description:
    'Eine Schultafel: grüngrauer Schiefer mit Kreidestaub, Rahmen, Pfeile und kleine Zeichnungen in weißer und bunter Kreide, Schrift von Hand.',
  palette: {
    bg: slate,
    text: chalk,
    bg2: dark,
    text2: dust,
    accents: [yellow, pink, sky, green, orange, wood],
  },
  fonts: { head: 'Caveat', body: 'Nunito' },
  text: {
    title: { font: 'Caveat', size: 84, color: chalk, bold: true, lineHeight: 88 },
    subtitle: { ...hand, size: 30, color: chalk },
    body: { font: 'Nunito', size: 21, color: chalk, lineHeight: 124, paraSpace: 0.36 },
  },
  layouts,
};

export default template;
