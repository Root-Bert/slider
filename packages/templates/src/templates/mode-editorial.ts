import { grain, jpeg, paint, rgba, rng } from '../art';
import type { Color, Layout, Picture, Shape, Template } from '../model';
import { rule } from '../shapes';

/*
 * Mode: a fashion magazine – a huge, thin serif cut by the page's edge (single letters as
 * ornament), black and white with one powder tone, pictures tall and bleeding, text small and
 * exact.
 */

const white = '#fbfaf8';
const black = '#0e0e0e';
const powder = '#e8d2c7';
const blush = '#dcbdaf';
const nude = '#b08a79';
const pale = '#f4ebe6';
const smoke = '#7b7572';

const serif = 'Cormorant Garamond';
const sans = 'Montserrat';

/** One letter as ornament: huge, to be cut by the page. */
const letter = (
  text: string,
  x: number,
  y: number,
  size: number,
  color: Color,
  italic = false,
): Shape => ({
  t: 'text',
  x,
  y,
  w: 4,
  h: size * 0.0353 * 1.3,
  text,
  font: serif,
  size,
  color,
  italic,
  nowrap: true,
  lineHeight: 100,
});

const hair = (x: number, y: number, length: number, color: Color = black, vertical = false) =>
  rule(x, y, length, color, 0.03, vertical);

/**
 * A studio picture for the preview: a paper backdrop running from light to shade, an arch in
 * powder and a tall dark form before it, its shadow on the floor – as still as a fashion plate.
 */
function plate(seed: number): Picture {
  const surface = paint({ w: 12, h: 18 }, 60);
  const { ctx, w, h } = surface;
  const random = rng(seed);
  const wall = ctx.createLinearGradient(0, 0, w, h);
  wall.addColorStop(0, seed % 2 ? '#e9e5e1' : '#d9d5d1');
  wall.addColorStop(1, seed % 2 ? '#b9b3ae' : '#8f8a86');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  // The floor.
  const floor = h * 0.8;
  const ground = ctx.createLinearGradient(0, floor, 0, h);
  ground.addColorStop(0, 'rgba(60,56,54,0.34)');
  ground.addColorStop(1, 'rgba(60,56,54,0.08)');
  ctx.fillStyle = ground;
  ctx.fillRect(0, floor, w, h - floor);
  // The arch.
  const [ax, aw] = [w * random.range(0.3, 0.42), w * 0.5];
  ctx.fillStyle = seed % 2 ? powder : pale;
  ctx.beginPath();
  ctx.moveTo(ax, floor);
  ctx.lineTo(ax, h * 0.36);
  ctx.arc(ax + aw / 2, h * 0.36, aw / 2, Math.PI, 0);
  ctx.lineTo(ax + aw, floor);
  ctx.closePath();
  ctx.fill();
  // The form: a long drape with a small head, leaning a little.
  const cx = w * random.range(0.42, 0.52);
  ctx.save();
  ctx.translate(cx, floor);
  ctx.rotate(random.range(-0.05, 0.05));
  ctx.fillStyle = 'rgba(40,36,34,0.22)';
  ctx.beginPath();
  ctx.ellipse(w * 0.16, 0, w * 0.3, h * 0.016, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#141313';
  ctx.beginPath();
  ctx.moveTo(-w * 0.2, 0);
  ctx.bezierCurveTo(-w * 0.14, -h * 0.2, -w * 0.02, -h * 0.34, -w * 0.045, -h * 0.5);
  ctx.bezierCurveTo(-w * 0.05, -h * 0.535, w * 0.05, -h * 0.535, w * 0.045, -h * 0.5);
  ctx.bezierCurveTo(w * 0.1, -h * 0.36, w * 0.09, -h * 0.16, w * 0.17, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.565, w * 0.042, h * 0.036, 0, 0, Math.PI * 2);
  ctx.fill();
  // A light fold down the drape.
  ctx.strokeStyle = rgba('#ffffff', 0.16);
  ctx.lineWidth = w * 0.006;
  ctx.beginPath();
  ctx.moveTo(-w * 0.01, -h * 0.46);
  ctx.bezierCurveTo(w * 0.02, -h * 0.3, -w * 0.04, -h * 0.15, -w * 0.06, 0);
  ctx.stroke();
  ctx.restore();
  // Light falling in from the upper left.
  const light = ctx.createRadialGradient(w * 0.1, h * 0.05, 0, w * 0.1, h * 0.05, h * 0.9);
  light.addColorStop(0, 'rgba(255,255,255,0.3)');
  light.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, w, h);
  grain(surface, 0.07, seed + 3);
  return jpeg(surface, 84);
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: white,
    shapes: [letter('M', -3.2, -6.4, 640, powder), hair(1.8, 12.35, 2.6)],
    pictures: [{ x: 17.4, y: 0, w: 10.6, h: 15.75 }],
    title: {
      x: 1.8,
      y: 5.4,
      w: 14.6,
      h: 6.3,
      upper: true,
      spacing: 5,
      size: 52,
      lineHeight: 104,
      sample: 'Die neue\nLinie',
    },
    subtitle: { x: 1.8, y: 12.75, w: 14.6, h: 1.3, sample: 'Herbst und Winter' },
  },
  {
    name: 'Abschnitt',
    bg: black,
    shapes: [letter('O', 12.6, -8.4, 760, powder), hair(1.8, 12.75, 2.6, powder)],
    title: {
      x: 1.8,
      y: 5.2,
      w: 13.4,
      h: 7,
      italic: true,
      size: 58,
      color: white,
      sample: 'Stoff und\nSchatten',
    },
    subtitle: { x: 1.8, y: 13.15, w: 13, h: 1.3, color: powder, sample: 'Kapitel zwei' },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: [
      { t: 'rect', x: 0, y: 0, w: 9.4, h: 15.75, fill: powder },
      letter('D', -4.6, 2.2, 470, blush),
      hair(11.4, 1.6, 14.8),
      hair(11.4, 14.25, 14.8),
    ],
    title: {
      x: 1.8,
      y: 1.4,
      w: 6.8,
      h: 7,
      valign: 'top',
      italic: true,
      size: 36,
      lineHeight: 100,
      sample: 'Was die Saison prägt',
    },
    body: {
      x: 11.4,
      y: 2.5,
      w: 14.8,
      h: 11.2,
      size: 20,
      sample: [
        'Lange Mäntel in gebrochenem Weiß',
        'Schultern weich, Taille betont',
        'Wolle trifft auf glatte Seide',
        'Schwarz bleibt die Grundfarbe',
        'Puder statt Rosa, matt statt Glanz',
        'Flache Schuhe zu jedem Abend',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [
      {
        t: 'rect',
        x: 3.5,
        y: -1,
        w: 9.2,
        h: 14.7,
        fill: null,
        stroke: { color: black, width: 0.03 },
      },
      { t: 'rect', x: 0, y: 13, w: 2.6, h: 2.75, fill: powder },
      hair(15, 6.05, 2.6),
    ],
    pictures: [{ x: 2.6, y: 0, w: 9.2, h: 13 }],
    title: {
      x: 15,
      y: 1.4,
      w: 11.2,
      h: 4.2,
      italic: true,
      size: 40,
      lineHeight: 100,
      sample: 'Ein Kleid aus einem Stück',
    },
    body: {
      x: 15,
      y: 6.7,
      w: 11.2,
      h: 7.6,
      sample: [
        'Geschnitten ohne eine Naht',
        'Vier Meter Stoff, ein Knoten',
        'Getragen offen oder gegürtet',
        'Gefertigt in kleiner Auflage',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      hair(14, 4.9, 9.4, black, true),
      {
        t: 'text',
        x: 2.6,
        y: 4.3,
        w: 9.8,
        h: 2.2,
        text: 'I',
        font: serif,
        size: 54,
        color: nude,
        align: 'center',
        lineHeight: 100,
      },
      {
        t: 'text',
        x: 15.6,
        y: 4.3,
        w: 9.8,
        h: 2.2,
        text: 'II',
        font: serif,
        size: 54,
        color: nude,
        align: 'center',
        lineHeight: 100,
      },
      { t: 'rect', x: 0, y: 15.25, w: 28, h: 0.5, fill: powder },
    ],
    title: {
      x: 2.6,
      y: 1.1,
      w: 22.8,
      h: 2.6,
      valign: 'middle',
      align: 'center',
      upper: true,
      spacing: 4,
      size: 32,
      sample: 'Atelier und Laufsteg',
    },
    body: [
      {
        x: 2.6,
        y: 7.1,
        w: 9.8,
        h: 7.2,
        sample: ['Monate der Arbeit', 'Zwölf Hände an einem Saum', 'Stille und Kreide'],
      },
      {
        x: 15.6,
        y: 7.1,
        w: 9.8,
        h: 7.2,
        sample: ['Neunzig Sekunden Licht', 'Ein Gang, ein Blick', 'Musik und Blitz'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: powder,
    shapes: [
      { t: 'ellipse', x: 17.2, y: -3.2, w: 15.6, h: 22.2, fill: pale },
      hair(1.8, 13.5, 2.6),
    ],
    title: {
      x: 1.8,
      y: 2.4,
      w: 15.2,
      h: 9.4,
      valign: 'bottom',
      size: 190,
      lineHeight: 90,
      sample: '94 %',
    },
    body: {
      x: 19.2,
      y: 4.6,
      w: 7.2,
      h: 6.6,
      valign: 'middle',
      sample: 'der Entwürfe entstehen von Hand, bevor ein Schnitt gezeichnet wird.',
    },
  },
  {
    name: 'Zitat',
    bg: white,
    shapes: [
      {
        t: 'text',
        x: 9,
        y: -2.6,
        w: 10,
        h: 9,
        text: '“',
        font: serif,
        size: 420,
        color: powder,
        align: 'center',
        nowrap: true,
        lineHeight: 100,
      },
      hair(12.7, 11.75, 2.6),
    ],
    body: {
      x: 3.6,
      y: 4.2,
      w: 20.8,
      h: 6.9,
      valign: 'middle',
      align: 'center',
      font: serif,
      italic: true,
      size: 40,
      lineHeight: 112,
      sample: 'Eleganz ist, was übrig bleibt, wenn man alles Laute weglässt.',
    },
    subtitle: {
      x: 3.6,
      y: 12.2,
      w: 20.8,
      h: 1.3,
      align: 'center',
      sample: 'Inès Morel, Schneiderin',
    },
  },
  {
    name: 'Bild',
    bg: white,
    shapes: [letter('E', 19.9, -7.6, 520, powder), hair(21, 9.8, 2.6)],
    pictures: [{ x: 0, y: 0, w: 19.4, h: 15.75 }],
    title: {
      x: 21,
      y: 10.2,
      w: 5.6,
      h: 4.2,
      valign: 'top',
      italic: true,
      size: 26,
      lineHeight: 104,
      sample: 'Mantel aus Wolle, offen getragen',
    },
  },
  {
    name: 'Schluss',
    bg: black,
    shapes: [
      letter('e', 15.8, -9.6, 760, '#1d1c1c', true),
      { t: 'rect', x: 0, y: 0, w: 0.7, h: 15.75, fill: powder },
      hair(2.6, 11.25, 2.6, powder),
    ],
    title: {
      x: 2.6,
      y: 4,
      w: 22,
      h: 6.6,
      upper: true,
      spacing: 8,
      size: 84,
      color: white,
      sample: 'Merci',
    },
    subtitle: { x: 2.6, y: 11.7, w: 18, h: 1.3, color: powder, sample: 'Bis zur nächsten Saison' },
  },
];

const template: Template = {
  slug: 'mode-editorial',
  name: 'Mode',
  group: 'Kunststil',
  tags: ['Mode', 'Magazin', 'elegant', 'schwarzweiß', 'Puder', 'Serife', 'Luxus', 'Lookbook'],
  description:
    'Wie ein Modemagazin: riesige feine Serifen im Anschnitt, Schwarz, Weiß und ein Puderton.',
  palette: {
    bg: white,
    text: black,
    bg2: powder,
    text2: smoke,
    accents: [nude, blush, pale, '#c9c4c0', '#4a4644', '#8c6f63'],
  },
  fonts: { head: serif, body: sans },
  text: {
    title: { font: serif, size: 64, color: black, lineHeight: 96 },
    subtitle: { font: sans, size: 13, color: black, upper: true, spacing: 4.5 },
    body: { font: sans, size: 18, color: black, lineHeight: 140, paraSpace: 0.42 },
  },
  layouts,
  samplePictures: [plate(1), plate(2), plate(3)],
};

export default template;
