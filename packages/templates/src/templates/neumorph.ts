import type { SKRSContext2D } from '@napi-rs/canvas';
import { darken, grain, jpeg, lighten, paint, rgba, type Paint } from '../art';
import type { Color, Layout, Shape, Template } from '../model';
import { page } from '../shapes';

/*
 * Neumorphismus: the whole page is one soft material. Panels are pushed out of it, wells pressed
 * into it – told only by a light from the upper left: a bright edge there, a shadow down right
 * (and the other way round inside a well). Painted, since a well's inner shadow is nothing a
 * presentation's shapes can do; the text stays dark and clear.
 */

const clay = '#e4e9f1';
const ink = '#2b3445';
const quiet = '#66728a';
const accent = '#5b6ef5';
const coral = '#ff7a8a';
const mint = '#3fc6b0';
const honey = '#f5b84b';
const stone = '#9aa7bd';
const lilac = '#8a63e8';

const LIGHT = 'rgba(255,255,255,0.95)';
const DARK = 'rgba(150,165,192,0.8)';

/** A rounded box in centimetres; without `r` its ends are round. */
interface Form {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
}
const circle = (cx: number, cy: number, r: number): Form => ({
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
});

function trace(p: Paint, form: Form): void {
  const { ctx, px } = p;
  const [x, y, w, h] = [form.x * px, form.y * px, form.w * px, form.h * px];
  const r = Math.min((form.r ?? 99) * px, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const cast = (ctx: SKRSContext2D, color: string, offset: number, blur: number) => {
  ctx.shadowColor = color;
  ctx.shadowOffsetX = offset;
  ctx.shadowOffsetY = offset;
  ctx.shadowBlur = blur;
};

/** Pushed out of the surface. */
function up(p: Paint, form: Form, depth = 1, fill?: Color): void {
  const { ctx, px } = p;
  const [d, blur] = [0.2 * depth * px, 0.46 * depth * px];
  const [x, y, w, h] = [form.x * px, form.y * px, form.w * px, form.h * px];
  const body = ctx.createLinearGradient(x, y, x + w, y + h);
  body.addColorStop(0, fill ? lighten(fill, 0.18) : lighten(clay, 0.32));
  body.addColorStop(1, fill ? darken(fill, 0.06) : darken(clay, 0.025));
  for (const [color, offset] of [
    [DARK, d],
    [LIGHT, -d],
  ] as const) {
    ctx.save();
    cast(ctx, color, offset, blur);
    ctx.fillStyle = clay;
    ctx.beginPath();
    trace(p, form);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  trace(p, form);
  ctx.fill();
}

/** Pressed into the surface. */
function down(p: Paint, form: Form, depth = 1, fill?: Color): void {
  const { ctx, px, w, h } = p;
  const [d, blur] = [0.16 * depth * px, 0.36 * depth * px];
  ctx.save();
  ctx.beginPath();
  trace(p, form);
  ctx.clip();
  ctx.fillStyle = fill ?? darken(clay, 0.03);
  ctx.fillRect(0, 0, w, h);
  for (const [color, offset] of [
    [fill ? rgba(darken(fill, 0.45), 0.7) : DARK, d],
    [fill ? rgba(lighten(fill, 0.5), 0.7) : LIGHT, -d],
  ] as const) {
    cast(ctx, color, offset, blur);
    ctx.fillStyle = clay;
    ctx.beginPath();
    ctx.rect(-w, -h, w * 3, h * 3);
    trace(p, form);
    ctx.fill('evenodd');
  }
  ctx.restore();
}

/** A small light that is on. */
function lamp(p: Paint, cx: number, cy: number, r: number, color: Color = accent): void {
  const { ctx, px } = p;
  ctx.save();
  ctx.shadowColor = rgba(color, 0.55);
  ctx.shadowBlur = r * px * 1.6;
  ctx.shadowOffsetY = r * px * 0.3;
  const fill = ctx.createLinearGradient((cx - r) * px, (cy - r) * px, (cx + r) * px, (cy + r) * px);
  fill.addColorStop(0, lighten(color, 0.3));
  fill.addColorStop(1, color);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx * px, cy * px, r * px, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A switch: a well with its knob, on or off. */
function toggle(p: Paint, x: number, y: number, w: number, on: boolean): void {
  const h = w * 0.52;
  down(p, { x, y, w, h }, 0.7, on ? accent : undefined);
  up(p, circle(on ? x + w - h / 2 : x + h / 2, y + h / 2, h * 0.36), 0.35);
}

/** A slider standing upright: its groove, how far it is filled, its knob. */
function fader(p: Paint, x: number, y: number, h: number, share: number, color: Color): void {
  const w = 0.5;
  down(p, { x: x - w / 2, y, w, h }, 0.6);
  const top = y + h * (1 - share);
  const { ctx, px } = p;
  ctx.fillStyle = color;
  ctx.beginPath();
  trace(p, { x: x - 0.11, y: top, w: 0.22, h: y + h - top - 0.14 });
  ctx.fill();
  up(p, circle(x, top, 0.62), 0.5);
  lamp(p, x, top, 0.14, color);
  void px;
}

/** An arc lit in the accent colour, clockwise from the top, in a groove of that radius. */
function arc(p: Paint, cx: number, cy: number, r: number, share: number, width: number): void {
  const { ctx, px } = p;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = width * px;
  const stroke = ctx.createLinearGradient(
    (cx - r) * px,
    (cy - r) * px,
    (cx + r) * px,
    (cy + r) * px,
  );
  stroke.addColorStop(0, lilac);
  stroke.addColorStop(1, accent);
  ctx.strokeStyle = stroke;
  ctx.shadowColor = rgba(accent, 0.45);
  ctx.shadowBlur = width * px * 1.2;
  ctx.beginPath();
  ctx.arc(cx * px, cy * px, r * px, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share);
  ctx.stroke();
  ctx.restore();
}

/** The page's picture: the surface with what `draw` pushes out of and into it. */
function surface(draw: (p: Paint) => void, seed: number): Shape {
  const p = paint();
  const { ctx, w, h } = p;
  const air = ctx.createLinearGradient(0, 0, w, h);
  air.addColorStop(0, lighten(clay, 0.12));
  air.addColorStop(1, darken(clay, 0.02));
  ctx.fillStyle = air;
  ctx.fillRect(0, 0, w, h);
  draw(p);
  grain(p, 0.014, seed);
  return { t: 'image', ...page, src: jpeg(p, 84) };
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: clay,
    shapes: [
      surface((p) => {
        // Four keys, one of them held down and lit.
        up(p, { x: 17, y: 2.6, w: 4.2, h: 4.2, r: 1.1 }, 1.1);
        down(p, { x: 22, y: 2.6, w: 4.2, h: 4.2, r: 1.1 }, 1.1);
        up(p, { x: 17, y: 7.6, w: 4.2, h: 4.2, r: 1.1 }, 1.1);
        up(p, { x: 22, y: 7.6, w: 4.2, h: 4.2, r: 1.1 }, 1.1);
        lamp(p, 24.1, 4.7, 0.5);
        down(p, circle(19.1, 4.7, 0.9), 0.6);
        up(p, circle(19.1, 9.7, 0.9), 0.5);
        down(p, { x: 23, y: 9.4, w: 2.2, h: 0.6 }, 0.5);
        down(p, { x: 2, y: 10.7, w: 13.4, h: 2.2 }, 0.8);
        toggle(p, 17, 12.7, 2.3, true);
        toggle(p, 20.2, 12.7, 2.3, false);
      }, 1),
    ],
    title: {
      x: 2,
      y: 2.6,
      w: 14,
      h: 7.4,
      size: 44,
      valign: 'bottom',
      sample: 'Weich wie\naus einem Guss',
    },
    subtitle: {
      x: 2.9,
      y: 10.7,
      w: 11.8,
      h: 2.2,
      valign: 'middle',
      sample: 'Bedienkonzept, zweiter Entwurf',
    },
  },
  {
    name: 'Abschnitt',
    bg: clay,
    shapes: [
      surface((p) => {
        up(p, { x: 2, y: 3.6, w: 16.4, h: 8.6, r: 1.4 }, 1.3);
        down(p, { x: 3.2, y: 4.8, w: 1.5, h: 1.5 }, 0.5);
        lamp(p, 3.95, 5.55, 0.26);
        fader(p, 21.2, 3.6, 8.6, 0.72, accent);
        fader(p, 23.4, 3.6, 8.6, 0.38, coral);
        fader(p, 25.6, 3.6, 8.6, 0.56, mint);
      }, 2),
    ],
    title: {
      x: 3.2,
      y: 6.3,
      w: 14.2,
      h: 3.6,
      size: 38,
      valign: 'top',
      sample: 'Teil zwei:\nLicht und Schatten',
    },
    subtitle: {
      x: 3.2,
      y: 10.1,
      w: 14,
      h: 1.5,
      valign: 'middle',
      sample: 'Woher die Tiefe kommt',
    },
  },
  {
    name: 'Inhalt',
    bg: clay,
    shapes: [
      surface((p) => {
        up(p, { x: 1.8, y: 4.1, w: 24.4, h: 10.1, r: 1.2 }, 1.2);
        toggle(p, 23.1, 1.55, 3.1, true);
      }, 3),
    ],
    title: {
      x: 1.9,
      y: 1,
      w: 20.4,
      h: 2.7,
      size: 32,
      valign: 'middle',
      sample: 'Fünf Regeln für weiche Flächen',
    },
    body: {
      x: 3,
      y: 4.9,
      w: 22,
      h: 8.6,
      sample: [
        'Grund und Element haben dieselbe Farbe',
        'Das Licht kommt immer von oben links',
        'Erhaben heißt: antippen',
        'Vertieft heißt: gedrückt oder Eingabe',
        'Eine einzige Farbe zeigt, was aktiv ist',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: clay,
    shapes: [
      surface((p) => {
        up(p, { x: 14.4, y: 1.7, w: 11.9, h: 12.35, r: 1.2 }, 1.2);
        down(p, { x: 15.1, y: 2.4, w: 10.5, h: 10.95, r: 0.7 }, 0.8);
        up(p, circle(2.75, 2.55, 0.75), 0.5);
        lamp(p, 2.75, 2.55, 0.22, coral);
      }, 4),
    ],
    title: {
      x: 4,
      y: 1.4,
      w: 9.4,
      h: 3.4,
      size: 27,
      valign: 'top',
      pad: [0.35, 0, 0, 0],
      sample: 'Ein Bild, in die Fläche gelegt',
    },
    body: {
      x: 1.9,
      y: 5.4,
      w: 11.4,
      h: 8.6,
      size: 19,
      sample: [
        'Der Rahmen hebt sich weich ab',
        'Das Bild liegt vertieft darin',
        'Text steht frei auf dem Grund',
      ],
    },
    pictures: [{ x: 15.5, y: 2.8, w: 9.7, h: 10.15 }],
  },
  {
    name: 'Zwei Spalten',
    bg: clay,
    shapes: [
      surface((p) => {
        up(p, { x: 1.8, y: 4.2, w: 11.8, h: 10, r: 1.2 }, 1.2);
        down(p, { x: 14.4, y: 4.2, w: 11.8, h: 10, r: 1.2 }, 1.2);
        up(p, circle(24.2, 2.4, 0.7), 0.5);
        down(p, circle(25.9, 2.4, 0.7), 0.5);
        lamp(p, 25.9, 2.4, 0.2);
      }, 5),
    ],
    title: {
      x: 1.9,
      y: 1.1,
      w: 21,
      h: 2.6,
      size: 32,
      valign: 'middle',
      sample: 'Erhaben und vertieft',
    },
    body: [
      {
        x: 2.9,
        y: 5.1,
        w: 9.8,
        h: 8.3,
        size: 19,
        sample: ['Tritt aus der Fläche', 'Schatten liegt außen', 'Lädt zum Drücken ein'],
      },
      {
        x: 15.5,
        y: 5.1,
        w: 9.8,
        h: 8.3,
        size: 19,
        sample: ['Sinkt in die Fläche', 'Schatten liegt innen', 'Zeigt: hier ist gewählt'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: clay,
    shapes: [
      surface((p) => {
        up(p, circle(8.2, 7.9, 6), 1.5);
        down(p, circle(8.2, 7.9, 5.2), 0.9);
        arc(p, 8.2, 7.9, 4.72, 0.72, 0.4);
        up(p, circle(8.2, 7.9, 4.2), 1);
        down(p, { x: 16.4, y: 4.6, w: 9.8, h: 6.6, r: 1.2 }, 1);
        up(p, circle(17.4, 12.9, 0.55), 0.4);
        up(p, circle(19, 12.9, 0.55), 0.4);
        down(p, circle(20.6, 12.9, 0.55), 0.4);
        lamp(p, 20.6, 12.9, 0.18);
      }, 6),
    ],
    title: {
      x: 4.3,
      y: 5.4,
      w: 7.8,
      h: 5,
      size: 72,
      align: 'center',
      valign: 'middle',
      sample: '72 %',
    },
    body: {
      x: 17.4,
      y: 5.2,
      w: 7.9,
      h: 5.4,
      size: 21,
      valign: 'middle',
      sample: 'weniger Fehlgriffe, seit jede Taste spürbar nachgibt.',
    },
  },
  {
    name: 'Zitat',
    bg: clay,
    shapes: [
      surface((p) => {
        down(p, { x: 3, y: 2.9, w: 22.6, h: 8.2, r: 1.4 }, 1.2);
        up(p, circle(3.6, 3.3, 1.6), 0.9);
        up(p, { x: 14.4, y: 12, w: 11.2, h: 2 }, 0.7);
        lamp(p, 15.5, 13, 0.2);
      }, 7),
      {
        t: 'text',
        x: 2,
        y: 2.15,
        w: 3.2,
        h: 3.2,
        text: '“',
        font: 'Poppins',
        bold: true,
        size: 72,
        color: accent,
        align: 'center',
        valign: 'top',
      },
    ],
    body: {
      x: 5.4,
      y: 3.5,
      w: 18.6,
      h: 7,
      font: 'Poppins',
      size: 29,
      lineHeight: 125,
      valign: 'middle',
      sample: 'Man soll eine Taste fühlen können, noch bevor man sie berührt.',
    },
    subtitle: {
      x: 16.2,
      y: 12,
      w: 8.8,
      h: 2,
      size: 18,
      valign: 'middle',
      sample: 'Ida Sommer, Entwicklung',
    },
  },
  {
    name: 'Bild',
    bg: clay,
    shapes: [
      surface((p) => {
        up(p, { x: 1.7, y: 1.3, w: 24.6, h: 11.1, r: 1.2 }, 1.3);
        down(p, { x: 2.4, y: 2, w: 23.2, h: 9.7, r: 0.7 }, 0.8);
        down(p, circle(22.6, 13.9, 0.42), 0.4);
        lamp(p, 22.6, 13.9, 0.16);
        up(p, circle(24, 13.9, 0.42), 0.35);
        up(p, circle(25.4, 13.9, 0.42), 0.35);
      }, 8),
    ],
    pictures: [{ x: 2.8, y: 2.4, w: 22.4, h: 8.9 }],
    title: {
      x: 1.9,
      y: 12.9,
      w: 19.4,
      h: 2,
      size: 26,
      valign: 'middle',
      sample: 'Das Bedienfeld im Tageslicht',
    },
  },
  {
    name: 'Schluss',
    bg: clay,
    shapes: [
      surface((p) => {
        down(p, circle(14, 6.5, 5.9), 1.4);
        up(p, circle(14, 6.5, 4.8), 1.4);
        arc(p, 14, 6.5, 5.35, 0.999, 0.14);
        up(p, { x: 8, y: 13.1, w: 12, h: 1.9 }, 0.7);
        up(p, circle(3.6, 6.7, 1.1), 0.7);
        down(p, circle(24.4, 6.7, 1.1), 0.7);
        lamp(p, 24.4, 6.7, 0.3, coral);
        lamp(p, 3.6, 6.7, 0.3, mint);
      }, 9),
    ],
    title: {
      x: 9.6,
      y: 4,
      w: 8.8,
      h: 5,
      size: 50,
      align: 'center',
      valign: 'middle',
      sample: 'Danke',
    },
    subtitle: {
      x: 8.6,
      y: 13.1,
      w: 10.8,
      h: 1.9,
      size: 18,
      align: 'center',
      valign: 'middle',
      sample: 'Fragen sind willkommen',
    },
  },
];

const template: Template = {
  slug: 'neumorph',
  name: 'Neumorphismus',
  group: 'Designtrend',
  tags: ['Neumorphismus', 'weich', 'hell', 'ruhig', 'Schatten', 'App', 'Bedienfeld', 'Technik'],
  description:
    'Alles aus einer weichen, hellen Fläche: Felder treten durch Licht oben links und Schatten unten rechts hervor oder sinken ein.',
  palette: {
    bg: clay,
    text: ink,
    bg2: '#d4dbe7',
    text2: quiet,
    accents: [accent, coral, mint, honey, stone, lilac],
  },
  fonts: { head: 'Poppins', body: 'Nunito' },
  text: {
    title: { font: 'Poppins', size: 50, bold: true, color: ink, lineHeight: 100 },
    subtitle: { font: 'Nunito', size: 20, bold: true, color: quiet },
    body: { font: 'Nunito', size: 21, bold: true, color: ink, lineHeight: 125, paraSpace: 0.4 },
  },
  layouts,
};

export default template;
