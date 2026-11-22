import type { SKRSContext2D } from '@napi-rs/canvas';
import { jpeg, lighten, paint, rgba } from '../art';
import type { Box, Color, Layout, Shape, Template } from '../model';
import { page } from '../shapes';

/*
 * Neon: a city night – near-black walls, glass tubes in magenta, cyan and acid yellow whose light
 * spills over them (painted: wide blurred strokes under sharp bright ones), panels with cut
 * corners, hairlines and ticks as on an instrument.
 */

const night = '#08070f';
const wall = '#15132a';
const white = '#f4f2ff';
const mist = '#dcd9f2';
const quiet = '#9a96c2';
const magenta = '#ff2bd6';
const cyan = '#19f0ff';
const yellow = '#e9ff1f';
const violet = '#8a4dff';
const orange = '#ff7a1a';
const mint = '#2bff9a';

type Ctx = SKRSContext2D;
type Pt = readonly [number, number];
type Path = (ctx: Ctx) => void;

const run =
  (pts: readonly Pt[], closed = false): Path =>
  (ctx) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    if (closed) ctx.closePath();
  };
const arc =
  (cx: number, cy: number, r: number, from = 0, to = 360): Path =>
  (ctx) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, (from * Math.PI) / 180, (to * Math.PI) / 180);
  };

/** A lit glass tube along a path: its light on the wall, the glass, the hot core. */
function tube(ctx: Ctx, px: number, color: Color, path: Path, width = 0.16): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = color;
  for (const [blur, alpha, grow] of [
    [2.6, 0.5, 2.2],
    [1.1, 0.55, 1.6],
    [0.38, 0.7, 1.2],
  ] as const) {
    ctx.shadowBlur = blur * px;
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width * grow;
    path(ctx);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = lighten(color, 0.2);
  ctx.lineWidth = width;
  path(ctx);
  ctx.stroke();
  ctx.strokeStyle = lighten(color, 0.82);
  ctx.lineWidth = width * 0.42;
  path(ctx);
  ctx.stroke();
  ctx.restore();
}

/** The wall at night with what is lit on it; coordinates in cm. */
function ground(
  draw: (ctx: Ctx, px: number) => void,
  haze: readonly (readonly [number, number, number, Color])[] = [],
): Shape {
  const surface = paint();
  const { ctx, w, h, px } = surface;
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, w, h);
  ctx.scale(px, px);
  for (const [x, y, r, color] of haze) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, rgba(color, 0.2));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 28, 15.75);
  }
  // A faint dot raster, as on a circuit board.
  ctx.fillStyle = 'rgba(180,170,255,0.07)';
  for (let y = 0.5; y < 15.75; y += 0.75) {
    for (let x = 0.5; x < 28; x += 0.75) ctx.fillRect(x, y, 0.045, 0.045);
  }
  draw(ctx, px);
  const rim = ctx.createRadialGradient(14, 7.9, 9, 14, 7.9, 18);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, 28, 15.75);
  return { t: 'image', ...page, src: jpeg(surface, 80) };
}

/** A panel with two corners cut. */
const cut = (
  box: Box,
  c: number,
  stroke: Color,
  corners: 'tl-br' | 'tr-bl' = 'tl-br',
  opacity = 0.82,
): Shape => {
  const [l, t, r, b] = [box.x, box.y, box.x + box.w, box.y + box.h];
  return {
    t: 'poly',
    fill: { t: 'solid', color: wall, opacity },
    stroke: { color: stroke, width: 0.035, opacity: 0.7 },
    pts:
      corners === 'tl-br'
        ? [
            [l + c, t],
            [r, t],
            [r, b - c],
            [r - c, b],
            [l, b],
            [l, t + c],
          ]
        : [
            [l, t],
            [r - c, t],
            [r, t + c],
            [r, b],
            [l + c, b],
            [l, b - c],
          ],
  };
};

const hair = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = quiet,
  opacity = 0.6,
): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: { color, width: 0.03, opacity },
});

/** A scale: ticks along a line, every fifth longer. */
const scale = (x: number, y: number, count: number, step = 0.3, color = quiet): Shape[] => [
  hair(x, y, x + (count - 1) * step, y, color),
  ...Array.from({ length: count }, (_, i) =>
    hair(x + i * step, y, x + i * step, y - (i % 5 === 0 ? 0.32 : 0.16), color),
  ),
];

const cross = (cx: number, cy: number, color = quiet, size = 0.22): Shape[] => [
  hair(cx - size, cy, cx + size, cy, color, 0.9),
  hair(cx, cy - size, cx, cy + size, color, 0.9),
];

const list = [
  'Die Stadt schläft nicht, sie wechselt die Schicht',
  'Licht ist die billigste Architektur',
  'Jede Reklame war einmal eine Idee',
  'Nachts zählt, was von weitem lesbar ist',
  'Morgen früh sieht alles anders aus',
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: night,
    shapes: [
      ground(
        (ctx, px) => {
          tube(ctx, px, cyan, arc(22.3, 6.3, 3.5), 0.2);
          tube(
            ctx,
            px,
            yellow,
            run(
              [
                [22.3, 4.3],
                [24.1, 7.4],
                [20.5, 7.4],
              ],
              true,
            ),
            0.14,
          );
          tube(
            ctx,
            px,
            magenta,
            run(
              [
                [3, 2.5],
                [19.3, 2.5],
                [19.3, 10.9],
                [17.9, 12.3],
                [1.6, 12.3],
                [1.6, 3.9],
              ],
              true,
            ),
            0.2,
          );
          for (let i = 0; i < 4; i += 1) {
            tube(
              ctx,
              px,
              yellow,
              run([
                [21.2 + i * 1.1, 13.6],
                [22.2 + i * 1.1, 11.9],
              ]),
              0.11,
            );
          }
        },
        [
          [9, 7, 13, magenta],
          [23, 6, 9, cyan],
        ],
      ),
      ...scale(1.7, 14.3, 31),
      ...cross(26.4, 1.5, cyan),
      ...cross(26.4, 14.2, cyan),
    ],
    title: {
      x: 2.7,
      y: 3.2,
      w: 15.6,
      h: 5.9,
      size: 52,
      valign: 'middle',
      sample: 'Stadt\nunter Strom',
    },
    subtitle: {
      x: 2.7,
      y: 9.4,
      w: 15,
      h: 1.9,
      valign: 'middle',
      sample: 'Nachtschicht 2049 // Lagebild',
    },
  },
  {
    name: 'Abschnitt',
    bg: night,
    shapes: [
      ground(
        (ctx, px) => {
          tube(
            ctx,
            px,
            yellow,
            run([
              [21.4, 17],
              [29, 10.4],
            ]),
            0.14,
          );
          tube(
            ctx,
            px,
            cyan,
            run([
              [17.6, 17],
              [29, 7.1],
            ]),
            0.2,
          );
          tube(
            ctx,
            px,
            magenta,
            run([
              [13.4, 17],
              [29, 3.4],
            ]),
            0.26,
          );
          tube(
            ctx,
            px,
            magenta,
            run([
              [1.9, 3.7],
              [6.2, 3.7],
            ]),
            0.16,
          );
        },
        [
          [24, 12, 12, violet],
          [4, 4, 8, magenta],
        ],
      ),
      ...cross(1.9, 14.1, cyan),
      ...scale(2.6, 14.25, 16),
      hair(6.8, 3.7, 15.8, 3.7),
    ],
    title: {
      x: 1.8,
      y: 4.4,
      w: 15.4,
      h: 5.2,
      size: 50,
      valign: 'middle',
      sample: 'Sektor 02\nDas Netz',
    },
    subtitle: {
      x: 1.8,
      y: 9.9,
      w: 13,
      h: 1.7,
      valign: 'middle',
      sample: 'Wer liefert, wenn alle schlafen',
    },
  },
  {
    name: 'Inhalt',
    bg: night,
    shapes: [
      ground(
        (ctx, px) => {
          tube(
            ctx,
            px,
            magenta,
            run([
              [1.9, 3.75],
              [7.6, 3.75],
            ]),
            0.15,
          );
          tube(
            ctx,
            px,
            cyan,
            run([
              [23.8, 1.25],
              [26.5, 1.25],
              [26.5, 4],
            ]),
            0.15,
          );
          [0, 1, 2].forEach((i) =>
            tube(
              ctx,
              px,
              yellow,
              run([
                [25.1 + i * 0.7, 14.2],
                [25.1 + i * 0.7, 13.3 - i * 0.8],
              ]),
              0.12,
            ),
          );
        },
        [
          [4, 3, 9, magenta],
          [26, 13, 6, yellow],
        ],
      ),
      hair(8.2, 3.75, 23, 3.75),
      ...cross(1.9, 14.3),
    ],
    title: { x: 1.8, y: 1, w: 21, h: 2.4, valign: 'middle', sample: 'Was die Nacht verrät' },
    body: { x: 1.8, y: 4.5, w: 22, h: 9.5, sample: list },
  },
  {
    name: 'Text und Bild',
    bg: night,
    shapes: [
      ground(
        (ctx, px) => {
          tube(
            ctx,
            px,
            cyan,
            run([
              [14.9, 8.6],
              [14.9, 1.5],
              [26.7, 1.5],
              [26.7, 14.2],
              [19.4, 14.2],
            ]),
            0.17,
          );
          tube(
            ctx,
            px,
            magenta,
            run([
              [14.9, 10],
              [14.9, 14.2],
              [18, 14.2],
            ]),
            0.17,
          );
          tube(
            ctx,
            px,
            magenta,
            run([
              [1.9, 5.3],
              [5.6, 5.3],
            ]),
            0.14,
          );
        },
        [
          [21, 8, 11, cyan],
          [3, 5, 7, magenta],
        ],
      ),
      { t: 'rect', x: 15.4, y: 2, w: 10.8, h: 11.7, fill: wall },
      hair(6.2, 5.3, 13.4, 5.3),
    ],
    pictures: [{ x: 15.4, y: 2, w: 10.8, h: 11.7 }],
    title: {
      x: 1.8,
      y: 1.4,
      w: 12,
      h: 3.5,
      size: 30,
      valign: 'bottom',
      sample: 'Ein Viertel im Dauerlicht',
    },
    body: {
      x: 1.8,
      y: 6,
      w: 12,
      h: 8.2,
      size: 19,
      sample: ['3 400 Leuchtkörper', 'Kein Fenster ohne Schein', 'Strom aus dem Hafen'],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: night,
    shapes: [
      ground(
        (ctx, px) => {
          tube(
            ctx,
            px,
            magenta,
            run([
              [1.6, 8.6],
              [1.6, 5],
              [2.5, 4.1],
              [9.6, 4.1],
            ]),
            0.16,
          );
          tube(
            ctx,
            px,
            cyan,
            run([
              [26.4, 9.6],
              [26.4, 13.2],
              [25.5, 14.1],
              [18.4, 14.1],
            ]),
            0.16,
          );
          [0, 1].forEach((i) =>
            tube(
              ctx,
              px,
              yellow,
              run([
                [24.6 + i * 0.9, 1.6],
                [25.3 + i * 0.9, 2.3],
                [24.6 + i * 0.9, 3],
              ]),
              0.11,
            ),
          );
        },
        [
          [3, 6, 9, magenta],
          [25, 12, 9, cyan],
        ],
      ),
      cut({ x: 1.6, y: 4.1, w: 12, h: 10 }, 0.9, magenta),
      cut({ x: 14.4, y: 4.1, w: 12, h: 10 }, 0.9, cyan),
      ...cross(14, 3.3),
      ...cross(14, 14.9),
    ],
    title: { x: 1.8, y: 0.9, w: 22, h: 2.6, valign: 'middle', sample: 'Oben und unten' },
    body: [
      {
        x: 2.4,
        y: 5,
        w: 10.6,
        h: 8.4,
        size: 19,
        sample: ['Glasfassaden, Dachgärten', 'Leise Aufzüge', 'Licht nach Plan'],
      },
      {
        x: 15.2,
        y: 5,
        w: 10.6,
        h: 8.4,
        size: 19,
        sample: ['Garküchen, Werkstätten', 'Kabel über der Gasse', 'Licht nach Laune'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: night,
    shapes: [
      ground(
        (ctx, px) => {
          tube(ctx, px, cyan, arc(8.6, 7.9, 6.7, 140, 235), 0.12);
          tube(ctx, px, yellow, arc(8.6, 7.9, 6.7, -24, 24), 0.12);
          tube(ctx, px, magenta, arc(8.6, 7.9, 5.6, 38, 322), 0.24);
          tube(
            ctx,
            px,
            cyan,
            run([
              [16.7, 11.3],
              [21.4, 11.3],
            ]),
            0.13,
          );
        },
        [
          [8.6, 7.9, 12, magenta],
          [20, 11, 7, cyan],
        ],
      ),
      ...scale(16.7, 4.5, 26, 0.3, cyan),
      ...cross(26, 14.2),
      ...cross(1.6, 1.5),
    ],
    title: {
      x: 3.3,
      y: 4.9,
      w: 10.6,
      h: 6,
      size: 96,
      color: yellow,
      align: 'center',
      valign: 'middle',
      sample: '68 %',
    },
    body: {
      x: 16.7,
      y: 5,
      w: 9.6,
      h: 5.8,
      size: 24,
      color: white,
      valign: 'middle',
      sample: 'des Stroms fließen nach Mitternacht – in Licht, das niemand ausschaltet.',
    },
  },
  {
    name: 'Zitat',
    bg: night,
    shapes: [
      ground(
        (ctx, px) => {
          [0, 1].forEach((i) =>
            tube(
              ctx,
              px,
              magenta,
              run([
                [2.3 + i * 1.5, 4.3],
                [3.5 + i * 1.5, 1.7],
              ]),
              0.26,
            ),
          );
          tube(
            ctx,
            px,
            cyan,
            run([
              [2.3, 12.75],
              [10.6, 12.75],
            ]),
            0.14,
          );
          tube(ctx, px, yellow, arc(27.2, 15, 4.2, 170, 290), 0.14);
          tube(ctx, px, violet, arc(27.2, 15, 5.6, 170, 290), 0.1);
        },
        [
          [3, 3, 9, magenta],
          [27, 15, 9, violet],
        ],
      ),
      ...cross(26.3, 1.5, cyan),
    ],
    body: {
      x: 2.2,
      y: 4.9,
      w: 23,
      h: 6.9,
      size: 35,
      bold: true,
      color: white,
      lineHeight: 112,
      valign: 'middle',
      sample: 'Im Dunkeln sieht man nicht weniger. Man sieht nur das, was leuchtet.',
    },
    subtitle: {
      x: 11.3,
      y: 11.9,
      w: 11,
      h: 1.7,
      valign: 'middle',
      sample: 'Mika Tanne, Lichtplanerin',
    },
  },
  {
    name: 'Bild',
    bg: night,
    shapes: [
      ground(
        (ctx, px) => {
          tube(
            ctx,
            px,
            yellow,
            run([
              [1.15, 4.4],
              [1.15, 0.95],
              [5.6, 0.95],
            ]),
            0.15,
          );
          tube(
            ctx,
            px,
            cyan,
            run([
              [26.85, 9.2],
              [26.85, 12.65],
              [22.4, 12.65],
            ]),
            0.15,
          );
          tube(
            ctx,
            px,
            magenta,
            run([
              [1.75, 13.45],
              [1.75, 14.55],
            ]),
            0.16,
          );
        },
        [
          [2, 2, 8, yellow],
          [26, 12, 8, cyan],
        ],
      ),
      { t: 'rect', x: 1.6, y: 1.4, w: 24.8, h: 10.8, fill: wall },
      ...scale(19.2, 14.3, 25),
    ],
    pictures: [{ x: 1.6, y: 1.4, w: 24.8, h: 10.8 }],
    title: {
      x: 2.4,
      y: 13,
      w: 16,
      h: 2,
      size: 26,
      valign: 'middle',
      sample: 'Kreuzung Süd, 2 Uhr 40',
    },
  },
  {
    name: 'Schluss',
    bg: night,
    shapes: [
      ground(
        (ctx, px) => {
          tube(ctx, px, magenta, arc(25.4, 1.6, 4.6, 60, 200), 0.2);
          tube(ctx, px, yellow, arc(25.4, 1.6, 3.2, 60, 200), 0.11);
          tube(
            ctx,
            px,
            cyan,
            run([
              [-1, 10.7],
              [17.6, 10.7],
              [18.5, 8.6],
              [19.9, 13],
              [21.1, 9.5],
              [21.8, 10.7],
              [29, 10.7],
            ]),
            0.17,
          );
        },
        [
          [19, 10.5, 11, cyan],
          [25, 2, 9, magenta],
        ],
      ),
      ...scale(2.5, 14.3, 21),
      ...cross(1.7, 1.5, cyan),
    ],
    title: {
      x: 2.4,
      y: 3.3,
      w: 19,
      h: 6.4,
      size: 64,
      valign: 'bottom',
      sample: 'Licht aus.',
    },
    subtitle: {
      x: 2.4,
      y: 11.4,
      w: 14,
      h: 1.8,
      valign: 'middle',
      sample: 'Danke // Fragen willkommen',
    },
  },
];

const template: Template = {
  slug: 'neon',
  name: 'Neon',
  group: 'Designtrend',
  tags: ['Neon', 'Cyberpunk', 'Nacht', 'dunkel', 'Leuchtröhren', 'Technik', 'Gaming', 'Zukunft'],
  description:
    'Stadtnacht in Leuchtröhren: Magenta, Cyan und Giftgelb glühen auf fast schwarzem Grund, dazu kantige Felder und feine Skalen.',
  palette: {
    bg: night,
    text: white,
    bg2: wall,
    text2: quiet,
    accents: [magenta, cyan, yellow, violet, orange, mint],
  },
  fonts: { head: 'Titillium Web', body: 'Titillium Web' },
  text: {
    title: {
      font: 'Titillium Web',
      size: 34,
      color: white,
      bold: true,
      upper: true,
      spacing: 1.5,
      lineHeight: 100,
    },
    subtitle: { font: 'JetBrains Mono', size: 19, color: cyan },
    body: { font: 'Titillium Web', size: 22, color: mist, lineHeight: 118, paraSpace: 0.4 },
  },
  layouts,
};

export default template;
