import { Path2D } from '@napi-rs/canvas';
import { darken, jpeg, lighten, paint, rgba, type Paint } from '../art';
import type { Box, Color, Layout, Picture, Shape, Template } from '../model';
import { page } from '../shapes';

/*
 * Clay: everything kneaded – inflated pastel balls, pills, rings and cubes with a soft light from
 * the upper left, coloured shadows under them, and thick white cushions the text rests on.
 */

const plum = '#3d3166';
const haze = '#7b709e';
const pink = '#ff9fc2';
const lilac = '#b59bff';
const sky = '#8ccfff';
const mint = '#86e2c0';
const butter = '#ffd772';
const coral = '#ff9d87';
const white = '#ffffff';
const ground = '#f2eaff';

interface Form {
  path: Path2D;
  box: Box;
  color: Color;
  rule?: 'evenodd' | 'nonzero';
  rotate?: number;
  /** A ball: lit from a point, with its gleam. */
  ball?: boolean;
  /** How thick it looks. */
  depth?: number;
  /** The colour its shadow takes (default: its own). */
  cast?: Color;
}

/** One kneaded form: its soft coloured shadow, its body, light and shade inside its rim. */
function form(surface: Paint, f: Form): void {
  const { ctx, px } = surface;
  const depth = f.depth ?? 1;
  const rule = f.rule ?? 'nonzero';
  const [cx, cy] = [f.box.x + f.box.w / 2, f.box.y + f.box.h / 2];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((f.rotate ?? 0) * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  ctx.save();
  ctx.shadowColor = rgba(darken(f.cast ?? f.color, 0.3), 0.42);
  ctx.shadowBlur = 0.95 * depth * px;
  ctx.shadowOffsetX = 0.3 * depth * px;
  ctx.shadowOffsetY = 0.6 * depth * px;
  ctx.fillStyle = f.color;
  ctx.fill(f.path, rule);
  ctx.restore();

  if (f.ball) {
    const r = f.box.w / 2;
    const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r * 1.05);
    body.addColorStop(0, lighten(f.color, 0.5));
    body.addColorStop(0.5, f.color);
    body.addColorStop(1, darken(f.color, 0.14));
    ctx.fillStyle = body;
  } else {
    const body = ctx.createLinearGradient(f.box.x, f.box.y, f.box.x + f.box.w, f.box.y + f.box.h);
    body.addColorStop(0, lighten(f.color, 0.3));
    body.addColorStop(0.55, f.color);
    body.addColorStop(1, darken(f.color, 0.08));
    ctx.fillStyle = body;
  }
  ctx.fill(f.path, rule);

  // Light and shade falling in over the rim: the shadow of everything outside the form.
  ctx.save();
  ctx.clip(f.path, rule);
  const outside = new Path2D();
  outside.rect(-60, -60, 150, 150);
  outside.addPath(f.path);
  const light = f.color === white;
  ctx.fillStyle = '#000000';
  ctx.shadowColor = rgba(darken(f.cast ?? f.color, light ? 0.25 : 0.4), light ? 0.3 : 0.5);
  ctx.shadowBlur = 0.6 * depth * px;
  ctx.shadowOffsetX = -0.28 * depth * px;
  ctx.shadowOffsetY = -0.4 * depth * px;
  ctx.fill(outside, 'evenodd');
  ctx.shadowColor = rgba('#ffffff', light ? 1 : 0.8);
  ctx.shadowBlur = 0.5 * depth * px;
  ctx.shadowOffsetX = 0.26 * depth * px;
  ctx.shadowOffsetY = 0.34 * depth * px;
  ctx.fill(outside, 'evenodd');
  ctx.restore();

  if (f.ball) {
    const r = f.box.w / 2;
    const [gx, gy] = [cx - r * 0.38, cy - r * 0.44];
    const gleam = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 0.34);
    gleam.addColorStop(0, 'rgba(255,255,255,0.8)');
    gleam.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gleam;
    ctx.fillRect(gx - r, gy - r, 2 * r, 2 * r);
  }
  ctx.restore();
}

const rounded = (box: Box, r: number): Path2D => {
  const path = new Path2D();
  const radius = Math.min(r, box.w / 2, box.h / 2);
  const [x, y, w, h] = [box.x, box.y, box.w, box.h];
  path.moveTo(x + radius, y);
  path.arcTo(x + w, y, x + w, y + h, radius);
  path.arcTo(x + w, y + h, x, y + h, radius);
  path.arcTo(x, y + h, x, y, radius);
  path.arcTo(x, y, x + w, y, radius);
  path.closePath();
  return path;
};

/** What a scene is kneaded from. */
function kit(surface: Paint) {
  return {
    ball: (cx: number, cy: number, r: number, color: Color) => {
      const path = new Path2D();
      path.arc(cx, cy, r, 0, Math.PI * 2);
      form(surface, {
        path,
        box: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r },
        color,
        ball: true,
        depth: Math.min(1.3, 0.45 + r * 0.3),
      });
    },
    ring: (cx: number, cy: number, r: number, tube: number, color: Color, rotate = 0) => {
      const path = new Path2D();
      path.arc(cx, cy, r, 0, Math.PI * 2);
      path.closePath();
      path.moveTo(cx + r - tube, cy);
      path.arc(cx, cy, r - tube, 0, Math.PI * 2);
      path.closePath();
      form(surface, {
        path,
        box: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r },
        color,
        rule: 'evenodd',
        rotate,
        depth: Math.min(1.2, 0.35 + tube * 0.5),
      });
    },
    pill: (box: Box, color: Color, rotate = 0) =>
      form(surface, {
        path: rounded(box, Math.min(box.w, box.h) / 2),
        box,
        color,
        rotate,
        depth: 0.45 + Math.min(box.w, box.h) * 0.25,
      }),
    cube: (box: Box, color: Color, rotate = 0) =>
      form(surface, {
        path: rounded(box, box.w * 0.28),
        box,
        color,
        rotate,
        depth: 0.45 + box.w * 0.2,
      }),
    /** A white cushion for text; its shadow takes the ground's colour. */
    cushion: (box: Box, cast: Color, r = 1.3, color: Color = white) =>
      form(surface, { path: rounded(box, r), box, color, cast, depth: 1.25 }),
    disc: (cx: number, cy: number, r: number, cast: Color) => {
      const path = new Path2D();
      path.arc(cx, cy, r, 0, Math.PI * 2);
      form(surface, {
        path,
        box: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r },
        color: white,
        cast,
        depth: 1.4,
      });
    },
  };
}

/** A page ground: a pastel sky and what lies on it. */
function scene(top: Color, bottom: Color, knead: (k: ReturnType<typeof kit>) => void): Shape {
  const surface = paint(page, 1600 / 28);
  const { ctx, px } = surface;
  ctx.scale(px, px);
  const air = ctx.createLinearGradient(0, 0, 28, 15.75);
  air.addColorStop(0, top);
  air.addColorStop(1, bottom);
  ctx.fillStyle = air;
  ctx.fillRect(0, 0, 28, 15.75);
  knead(kit(surface));
  const src: Picture = jpeg(surface, 84);
  return { t: 'image', ...page, src };
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: ground,
    shapes: [
      scene('#f6f0ff', '#dfd0ff', (k) => {
        k.pill({ x: 15.4, y: 2.0, w: 6.2, h: 2.4 }, mint, -24);
        k.ring(23.5, 4.4, 3.0, 1.2, lilac);
        k.ball(20.3, 9.3, 3.5, pink);
        k.cube({ x: 22.8, y: 10.2, w: 3.6, h: 3.6 }, butter, 14);
        k.ball(16.3, 13.0, 1.2, sky);
        k.ball(26.4, 8.4, 0.7, coral);
        k.cushion({ x: 1.8, y: 11.3, w: 12.8, h: 2.2 }, lilac, 1.1);
      }),
    ],
    title: {
      x: 2.0,
      y: 2.4,
      w: 13.4,
      h: 8.2,
      valign: 'bottom',
      size: 66,
      sample: 'Weich\ngedacht',
    },
    subtitle: { x: 2.7, y: 11.5, w: 11.2, h: 1.8, valign: 'middle', sample: 'Ideen zum Anfassen' },
  },
  {
    name: 'Abschnitt',
    bg: '#ffe6ee',
    shapes: [
      scene('#fff0f4', '#ffd0df', (k) => {
        k.ring(5.6, 7.9, 6.2, 2.6, pink);
        k.ball(5.6, 7.9, 2.3, butter);
        k.ball(11.9, 2.4, 1.0, mint);
        k.cube({ x: 23.5, y: 1.5, w: 2.7, h: 2.7 }, sky, 18);
        k.pill({ x: 20.4, y: 12.4, w: 5.6, h: 1.9 }, lilac, -12);
      }),
    ],
    title: { x: 13.8, y: 3.8, w: 12.6, h: 5.2, valign: 'bottom', size: 52, sample: 'Zweiter Teil' },
    subtitle: { x: 13.8, y: 9.3, w: 12.4, h: 2.2, sample: 'Jetzt wird geknetet' },
  },
  {
    name: 'Inhalt',
    bg: '#e6f4ff',
    shapes: [
      scene('#eef8ff', '#cfe6ff', (k) => {
        k.cushion({ x: 1.6, y: 4.0, w: 20.4, h: 10.3 }, sky);
        k.ring(25.0, 2.4, 1.6, 0.66, butter);
        k.ball(24.6, 7.1, 2.0, coral);
        k.pill({ x: 23.6, y: 9.9, w: 2.4, h: 4.6 }, mint, 14);
        k.ball(22.0, 4.2, 0.75, lilac);
      }),
    ],
    title: { x: 2.2, y: 1.0, w: 20, h: 2.6, valign: 'middle', size: 36 },
    body: {
      x: 2.7,
      y: 4.9,
      w: 18.2,
      h: 8.6,
      sample: [
        'Runde Formen wirken freundlich',
        'Weiche Schatten geben Tiefe',
        'Pastell beruhigt das Auge',
        'Ein Kissen trägt den Text',
        'Wenig Kanten, viel Luft',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: '#e2f7ee',
    shapes: [
      scene('#edfbf4', '#c6ecd9', (k) => {
        k.cushion({ x: 1.6, y: 5.0, w: 11.8, h: 9.3 }, mint);
        k.cushion({ x: 14.4, y: 1.5, w: 12.1, h: 12.8 }, mint);
        k.ball(13.4, 4.4, 0.8, butter);
        k.ball(13.85, 13.9, 1.15, pink);
      }),
    ],
    pictures: [{ x: 15.05, y: 2.15, w: 10.8, h: 11.5 }],
    title: { x: 2.0, y: 1.2, w: 11.4, h: 3.4, valign: 'middle', size: 32 },
    body: { x: 2.6, y: 5.8, w: 9.9, h: 7.8, size: 20 },
  },
  {
    name: 'Zwei Spalten',
    bg: '#fff6dc',
    shapes: [
      scene('#fffaea', '#ffe9b8', (k) => {
        k.cushion({ x: 1.6, y: 4.2, w: 12.1, h: 10.1 }, butter);
        k.cushion({ x: 14.3, y: 4.2, w: 12.1, h: 10.1 }, butter);
        k.ball(2.5, 4.5, 1.0, lilac);
        k.ball(15.2, 4.5, 1.0, pink);
        k.pill({ x: 22.3, y: 1.3, w: 4.0, h: 1.6 }, mint, -10);
      }),
    ],
    title: { x: 2.0, y: 0.9, w: 19.6, h: 2.6, valign: 'middle', size: 36 },
    body: [
      { x: 2.6, y: 6.0, w: 10.2, h: 7.6, size: 20 },
      { x: 15.3, y: 6.0, w: 10.2, h: 7.6, size: 20 },
    ],
  },
  {
    name: 'Kennzahl',
    bg: '#e9deff',
    shapes: [
      scene('#f1e8ff', '#d2c0ff', (k) => {
        k.cube({ x: 23.3, y: 1.4, w: 2.7, h: 2.7 }, sky, -14);
        k.disc(8.6, 7.9, 5.7, lilac);
        k.ball(13.4, 3.0, 1.5, pink);
        k.cushion({ x: 15.6, y: 5.5, w: 10.8, h: 4.8 }, lilac, 1.6);
        k.ring(22.4, 12.7, 1.7, 0.7, butter);
        k.ball(14.4, 13.2, 0.9, mint);
        k.ball(2.5, 13.5, 1.0, coral);
      }),
    ],
    title: {
      x: 3.4,
      y: 4.4,
      w: 10.4,
      h: 7,
      valign: 'middle',
      align: 'center',
      size: 100,
      color: '#7a55f0',
      sample: '92 %',
    },
    body: {
      x: 16.5,
      y: 6.0,
      w: 9.0,
      h: 3.8,
      valign: 'middle',
      size: 21,
      sample: 'fühlen sich nach dem Workshop sicherer im Thema.',
    },
  },
  {
    name: 'Zitat',
    bg: '#ffe9e2',
    shapes: [
      scene('#fff2ec', '#ffd3c6', (k) => {
        k.cushion({ x: 2.4, y: 2.2, w: 23.2, h: 8.6 }, coral, 1.9);
        k.disc(6.4, 11.9, 0.75, coral);
        k.disc(4.9, 13.3, 0.45, coral);
        k.pill({ x: 3.2, y: 1.0, w: 1.4, h: 2.5 }, lilac, 20);
        k.pill({ x: 5.0, y: 1.0, w: 1.4, h: 2.5 }, lilac, 20);
        k.ball(25.2, 11.2, 1.6, mint);
        k.ball(22.8, 13.5, 0.7, butter);
      }),
    ],
    body: {
      x: 4.0,
      y: 3.2,
      w: 20,
      h: 6.6,
      valign: 'middle',
      align: 'center',
      font: 'Fredoka',
      size: 36,
      lineHeight: 120,
      sample: 'Was sich gut anfühlt, bleibt auch im Kopf.',
    },
    subtitle: {
      x: 8.0,
      y: 11.9,
      w: 14,
      h: 1.8,
      valign: 'middle',
      sample: 'Lena Sommer, Trainerin',
    },
  },
  {
    name: 'Bild',
    bg: '#e6f4ff',
    shapes: [
      scene('#eef6ff', '#cddfff', (k) => {
        k.cushion({ x: 1.6, y: 1.2, w: 24.8, h: 11.3 }, sky);
        k.cushion({ x: 2.6, y: 11.6, w: 14.2, h: 2.8 }, sky, 1.4);
        k.ball(25.3, 13.2, 1.4, pink);
        k.ring(21.7, 13.7, 1.0, 0.42, butter);
        k.ball(19.3, 13.6, 0.6, lilac);
      }),
    ],
    pictures: [{ x: 2.25, y: 1.85, w: 23.5, h: 9.55 }],
    title: {
      x: 3.5,
      y: 11.9,
      w: 12.6,
      h: 2.2,
      valign: 'middle',
      size: 28,
      sample: 'Ein Bild sagt es weicher',
    },
  },
  {
    name: 'Schluss',
    bg: '#ffe3ee',
    shapes: [
      scene('#ffe6ef', '#e2d4ff', (k) => {
        k.pill({ x: 9.6, y: 1.2, w: 4.6, h: 1.6 }, lilac, -10);
        k.ring(23.6, 4.0, 2.2, 0.9, mint);
        k.cube({ x: 2.2, y: 10.6, w: 3.0, h: 3.0 }, butter, -16);
        k.cushion({ x: 5.0, y: 4.4, w: 18, h: 6.4 }, pink, 3.2);
        k.ball(4.8, 4.3, 2.0, pink);
        k.ball(24.4, 11.6, 1.6, sky);
        k.ball(20.0, 2.2, 0.7, coral);
      }),
    ],
    title: {
      x: 6.4,
      y: 4.8,
      w: 15.2,
      h: 5.6,
      valign: 'middle',
      align: 'center',
      size: 72,
      sample: 'Danke!',
    },
    subtitle: {
      x: 6,
      y: 11.6,
      w: 16,
      h: 1.8,
      valign: 'middle',
      align: 'center',
      sample: 'Schön, dass ihr da wart',
    },
  },
];

const template: Template = {
  slug: 'clay',
  name: 'Clay',
  group: 'Designtrend',
  tags: ['Clay', 'Claymorphism', '3D', 'weich', 'Pastell', 'freundlich', 'verspielt', 'Workshop'],
  description:
    'Wie aus Knete geformt: aufgeblasene Pastellkugeln, Ringe und Pillen mit weichen farbigen Schatten und dicken weißen Kissen für den Text.',
  palette: {
    bg: ground,
    text: plum,
    bg2: white,
    text2: haze,
    accents: [pink, lilac, sky, mint, butter, coral],
  },
  fonts: { head: 'Fredoka', body: 'Nunito' },
  text: {
    title: { font: 'Fredoka', size: 44, color: plum, bold: true, lineHeight: 102 },
    subtitle: { font: 'Nunito', size: 22, color: haze, bold: true },
    body: { font: 'Nunito', size: 22, color: plum, lineHeight: 124, paraSpace: 0.3 },
  },
  layouts,
};

export default template;
