import type { SKRSContext2D } from '@napi-rs/canvas';
import { jpeg, noise, paint, rgb, rng } from '../art';
import type { Color, Layout, Shape, Template } from '../model';
import { page } from '../shapes';

/*
 * Risograph: two or three spot colours from a stencil duplicator – fluorescent pink, blue and
 * yellow printed one over the other, never quite in register, the ink grainy and uneven on
 * off-white paper. Simple cut shapes; where inks cross, a third colour appears.
 */

const paper = '#f6f1e4';
const pink = '#ff4aa8';
const blue = '#2456c4';
const yellow = '#ffe21a';
const navy = '#1a1e4d';
const slate = '#5a5f85';
const violet = '#3b2a9c';
const orange = '#ff6a2b';
const green = '#2f8f4e';
const blush = '#ffd3e6';

type Draw = (ctx: SKRSContext2D) => void;
interface Run {
  ink: Color;
  /** How far off register this run is, centimetres. */
  dx: number;
  dy: number;
  draw: Draw;
}

const WIDTH = 1440;

/**
 * A sheet through the machine: every run is drawn as a stencil (how dark = how much ink), gets
 * the duplicator's grain and uneven inking, and is laid over the paper multiplying.
 */
function print(seed: number, runs: readonly Run[]): Shape {
  const surface = paint(page, WIDTH / 28);
  const { ctx, w, h, px } = surface;
  const [pr, pg, pb] = rgb(paper);
  const sheet = new Float32Array(w * h * 3);
  const random = rng(seed);
  for (let i = 0; i < w * h; i += 1) {
    // Paper: a few fibres, hardly any tone.
    const fibre = random() < 0.012 ? -9 * random() : 0;
    sheet[i * 3] = pr + fibre;
    sheet[i * 3 + 1] = pg + fibre;
    sheet[i * 3 + 2] = pb + fibre;
  }
  runs.forEach((run, index) => {
    const stencil = paint(page, WIDTH / 28);
    const s = stencil.ctx;
    s.translate(run.dx * px, run.dy * px);
    s.rotate((index - 1) * 0.0016);
    s.scale(px, px);
    s.fillStyle = '#000000';
    s.strokeStyle = '#000000';
    run.draw(s);
    const alpha = s.getImageData(0, 0, w, h).data;
    const field = noise(seed * 13 + index * 7);
    const [ir, ig, ib] = rgb(run.ink);
    const speck = rng(seed * 31 + index);
    for (let y = 0; y < h; y += 1) {
      // The drum leaves faint bands across the sheet.
      const band = 0.94 + 0.06 * Math.sin(y / 23 + index * 2);
      for (let x = 0; x < w; x += 1) {
        const a = alpha[(y * w + x) * 4 + 3]! / 255;
        if (a <= 0.004) {
          speck();
          continue;
        }
        const uneven = 0.74 + 0.26 * field(x / 150, y / 150, 3);
        const density = a * uneven * band;
        // Grain: ink either takes or it doesn't; solid areas keep small pinholes.
        const dice = speck();
        const taken = dice < density ** 0.75 * 0.97 ? 1 : 0;
        const amount = Math.min(1, density * 0.42 + taken * 0.58 * Math.min(1, a * 1.5 + 0.25));
        const i = (y * w + x) * 3;
        sheet[i] = sheet[i]! * (1 - amount * (1 - ir / 255));
        sheet[i + 1] = sheet[i + 1]! * (1 - amount * (1 - ig / 255));
        sheet[i + 2] = sheet[i + 2]! * (1 - amount * (1 - ib / 255));
      }
    }
  });
  const image = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i += 1) {
    image.data[i * 4] = sheet[i * 3]!;
    image.data[i * 4 + 1] = sheet[i * 3 + 1]!;
    image.data[i * 4 + 2] = sheet[i * 3 + 2]!;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return { t: 'image', ...page, src: jpeg(surface, 76) };
}

const P = (draw: Draw): Run => ({ ink: pink, dx: 0.07, dy: -0.05, draw });
const B = (draw: Draw): Run => ({ ink: blue, dx: -0.06, dy: 0.07, draw });
const Y = (draw: Draw): Run => ({ ink: yellow, dx: 0, dy: 0, draw });

const circle = (ctx: SKRSContext2D, cx: number, cy: number, r: number) => {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
};
/** Half a disc; `turn` 0 keeps the upper half. */
const half = (ctx: SKRSContext2D, cx: number, cy: number, r: number, turn = 0) => {
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI + turn, Math.PI * 2 + turn);
  ctx.closePath();
  ctx.fill();
};
const outline = (ctx: SKRSContext2D, cx: number, cy: number, r: number, width = 0.14) => {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
};
const lines = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  count: number,
  step = 0.5,
  thick = 0.17,
) => {
  for (let i = 0; i < count; i += 1) ctx.fillRect(x, y + i * step, w, thick);
};
const triangle = (ctx: SKRSContext2D, pts: readonly [number, number][]) => {
  ctx.beginPath();
  pts.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
};
const wavy = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  waves: number,
  height = 0.45,
  width = 0.2,
) => {
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 80; i += 1) {
    const t = i / 80;
    const [px, py] = [x + t * w, y + Math.sin(t * waves * Math.PI * 2) * height];
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.stroke();
};
/** A register mark: circle and cross. */
const mark = (ctx: SKRSContext2D, cx: number, cy: number, r = 0.42) => {
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
};
/** A fat comma: a disc with its tail, as a quotation mark. */
const comma = (ctx: SKRSContext2D, cx: number, cy: number, r: number) => {
  circle(ctx, cx, cy, r);
  triangle(ctx, [
    [cx - r * 0.98, cy - r * 0.15],
    [cx + r * 0.95, cy - r * 2.2],
    [cx + r * 0.6, cy - r * 0.75],
  ]);
};
/** A band whose ink thins out along it – the grain makes the tone. */
const fade = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  from: number,
  to: number,
  vertical = false,
) => {
  const gradient = vertical
    ? ctx.createLinearGradient(0, y, 0, y + h)
    : ctx.createLinearGradient(x, 0, x + w, 0);
  gradient.addColorStop(0, `rgba(0,0,0,${from})`);
  gradient.addColorStop(1, `rgba(0,0,0,${to})`);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
};

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paper,
    shapes: [
      print(11, [
        Y((c) => {
          c.fillRect(17.4, 1.4, 9.2, 12.95);
        }),
        P((c) => {
          circle(c, 18.6, 7.3, 4.5);
          mark(c, 2.3, 2.2);
        }),
        B((c) => {
          half(c, 22.0, 14.35, 4.6);
          lines(c, 21.6, 2.4, 5.0, 5);
          mark(c, 2.3, 2.2);
          c.fillRect(1.8, 10.75, 3.2, 0.2);
        }),
      ]),
    ],
    title: {
      x: 1.8,
      y: 3.2,
      w: 12,
      h: 7.2,
      valign: 'bottom',
      size: 64,
      sample: 'Frisch\ngedruckt',
    },
    subtitle: { x: 1.8, y: 11.4, w: 12, h: 2.4, sample: 'Werkstattbericht aus der Druckerei' },
  },
  {
    name: 'Abschnitt',
    bg: paper,
    shapes: [
      print(23, [
        Y((c) => circle(c, 9.5, 10.2, 4.9)),
        P((c) => circle(c, 6.0, 5.3, 4.9)),
        B((c) => {
          circle(c, 3.4, 11.0, 4.9);
          lines(c, 21.8, 1.6, 4.8, 3);
          wavy(c, 15.8, 12.6, 6, 4);
        }),
      ]),
    ],
    title: {
      x: 15.8,
      y: 3.6,
      w: 10.8,
      h: 5.0,
      valign: 'bottom',
      size: 48,
      sample: 'Zweiter Durchgang',
    },
    subtitle: { x: 15.8, y: 9.0, w: 10.8, h: 2.4, sample: 'Jede Farbe braucht ihre Runde' },
  },
  {
    name: 'Inhalt',
    bg: paper,
    shapes: [
      print(37, [
        Y((c) => circle(c, 24.2, 4.2, 2.4)),
        P((c) => {
          half(c, 24.2, 10.0, 2.4);
          c.fillRect(1.8, 3.95, 4.2, 0.34);
        }),
        B((c) => {
          triangle(c, [
            [21.8, 14.35],
            [26.6, 14.35],
            [24.2, 9.2],
          ]);
          outline(c, 24.55, 4.5, 2.4);
          c.fillRect(1.8, 3.95, 4.2, 0.34);
        }),
      ]),
    ],
    title: { x: 1.8, y: 1.1, w: 19, h: 2.6, valign: 'bottom', size: 36 },
    body: {
      x: 1.8,
      y: 5.0,
      w: 19,
      h: 9.3,
      sample: [
        'Zwei Farben reichen für fast alles',
        'Wo sie sich treffen, entsteht die dritte',
        'Der Versatz gehört dazu',
        'Körnung macht Flächen lebendig',
        'Einfache Formen, klare Aussage',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: paper,
    shapes: [
      print(41, [
        Y((c) => circle(c, 12.3, 2.3, 2.0)),
        P((c) => c.fillRect(2.3, 2.3, 11.2, 12.0)),
        B((c) => {
          c.lineWidth = 0.14;
          c.strokeRect(1.45, 1.45, 11.2, 12.0);
          lines(c, 22.8, 13.0, 3.8, 3, 0.45);
        }),
      ]),
    ],
    pictures: [{ x: 1.85, y: 1.85, w: 11.2, h: 12.0 }],
    title: { x: 15.2, y: 1.2, w: 11.4, h: 3.4, valign: 'bottom', size: 32 },
    body: { x: 15.2, y: 5.2, w: 11.4, h: 7.4, size: 20 },
  },
  {
    name: 'Zwei Spalten',
    bg: paper,
    shapes: [
      print(53, [
        Y((c) => {
          circle(c, 12.4, 4.55, 1.15);
          circle(c, 25.4, 4.55, 1.15);
        }),
        P((c) => {
          c.fillRect(1.8, 4.3, 11.6, 0.5);
          mark(c, 25.9, 2.1);
        }),
        B((c) => {
          c.fillRect(14.8, 4.3, 11.6, 0.5);
          mark(c, 25.9, 2.1);
        }),
      ]),
    ],
    title: { x: 1.8, y: 1.1, w: 22, h: 2.6, valign: 'bottom', size: 36 },
    body: [
      { x: 1.8, y: 5.7, w: 11.0, h: 8.6, size: 20 },
      { x: 14.8, y: 5.7, w: 11.0, h: 8.6, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: paper,
    shapes: [
      print(67, [
        Y((c) => circle(c, 8.9, 7.9, 6.0)),
        P((c) => {
          circle(c, 15.0, 3.9, 2.5);
          fade(c, 16.8, 12.3, 9.8, 2.05, 0.9, 0.05);
        }),
        B((c) => {
          outline(c, 9.25, 8.2, 6.0, 0.16);
          lines(c, 16.8, 12.3, 9.8, 5, 0.47, 0.16);
        }),
      ]),
    ],
    title: {
      x: 3.4,
      y: 4.4,
      w: 11,
      h: 7,
      valign: 'middle',
      align: 'center',
      size: 112,
      sample: '68 %',
    },
    body: {
      x: 16.8,
      y: 6.6,
      w: 9.8,
      h: 5.0,
      size: 22,
      sample: 'weniger Farbe als im Vierfarbdruck, bei doppelter Wirkung.',
    },
  },
  {
    name: 'Zitat',
    bg: paper,
    shapes: [
      print(79, [
        Y((c) => circle(c, 27.4, 7.6, 5.2)),
        P((c) => {
          comma(c, 3.3, 3.9, 1.05);
          comma(c, 6.1, 3.9, 1.05);
          circle(c, 23.6, 12.4, 1.7);
        }),
        B((c) => {
          comma(c, 3.5, 3.95, 1.05);
          comma(c, 6.3, 3.95, 1.05);
          c.fillRect(2.2, 11.75, 3.2, 0.2);
        }),
      ]),
    ],
    body: {
      x: 2.2,
      y: 5.4,
      w: 19.4,
      h: 6.0,
      valign: 'middle',
      font: 'Bricolage Grotesque',
      bold: true,
      size: 34,
      lineHeight: 112,
      sample: 'Der schönste Fehler im Druck ist der, den man stehen lässt.',
    },
    subtitle: { x: 2.2, y: 12.3, w: 16, h: 1.8, sample: 'Ole Brandt, Drucker' },
  },
  {
    name: 'Bild',
    bg: paper,
    shapes: [
      print(83, [
        Y((c) => c.fillRect(1.7, 1.0, 23.6, 10.2)),
        P((c) => c.fillRect(2.7, 2.0, 23.6, 10.2)),
        B((c) => {
          wavy(c, 20.6, 13.4, 5.8, 4);
          mark(c, 1.9, 13.4);
        }),
      ]),
    ],
    pictures: [{ x: 2.2, y: 1.5, w: 23.6, h: 10.2 }],
    title: {
      x: 3.0,
      y: 12.4,
      w: 17,
      h: 2.0,
      valign: 'middle',
      size: 28,
      sample: 'Frisch von der Trommel',
    },
  },
  {
    name: 'Schluss',
    bg: paper,
    shapes: [
      print(97, [
        Y((c) => circle(c, 14, 16.4, 6.4)),
        P((c) => {
          circle(c, 14, 16.9, 4.0);
          mark(c, 2.3, 2.2);
        }),
        B((c) => {
          c.lineWidth = 0.2;
          c.lineCap = 'round';
          for (let i = 0; i < 13; i += 1) {
            const angle = Math.PI * (1.08 + (0.84 * i) / 12);
            c.beginPath();
            c.moveTo(14 + Math.cos(angle) * 7.0, 16.4 + Math.sin(angle) * 7.0);
            c.lineTo(14 + Math.cos(angle) * 8.2, 16.4 + Math.sin(angle) * 8.2);
            c.stroke();
          }
          mark(c, 2.3, 2.2);
        }),
      ]),
    ],
    title: {
      x: 4,
      y: 1.6,
      w: 20,
      h: 4.6,
      valign: 'bottom',
      align: 'center',
      size: 80,
      sample: 'Danke!',
    },
    subtitle: {
      x: 6,
      y: 6.3,
      w: 16,
      h: 1.6,
      align: 'center',
      sample: 'Die Farbe ist noch feucht – Fragen?',
    },
  },
];

const template: Template = {
  slug: 'risograph',
  name: 'Risograph',
  group: 'Designtrend',
  tags: ['Risograph', 'Riso', 'Druck', 'Schmuckfarben', 'Körnung', 'Zine', 'Werkstatt', 'Kultur'],
  description:
    'Wie vom Schablonendrucker: Pink, Blau und Gelb übereinander gedruckt, leicht versetzt, körnig auf hellem Papier.',
  palette: {
    bg: paper,
    text: navy,
    bg2: blush,
    text2: slate,
    accents: [pink, blue, yellow, violet, orange, green],
  },
  fonts: { head: 'Bricolage Grotesque', body: 'Karla' },
  text: {
    title: { font: 'Bricolage Grotesque', size: 44, color: blue, bold: true, lineHeight: 100 },
    subtitle: { font: 'Karla', size: 22, color: navy },
    body: { font: 'Karla', size: 22, color: navy, lineHeight: 124, paraSpace: 0.3 },
  },
  layouts,
};

export default template;
