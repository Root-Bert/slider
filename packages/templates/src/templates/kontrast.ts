import { grain, jpeg, paint, rng } from '../art';
import type { Layout, Picture, Shape, Template } from '../model';

/*
 * Kontrast: nothing but black and white. Fields swap from layout to layout, type is as heavy as
 * it gets, a thick bar is the only mark. Static, monumental, no ornament.
 */

const black = '#000000';
const white = '#ffffff';
const W = 28;
const H = 15.75;

const field = (x: number, y: number, w: number, h: number, fill = black): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  fill,
});

/** Hard planes of concrete in raking light – a grey stand-in for a photo. */
function planes(seed: number): Picture {
  const surface = paint({ w: 28, h: 17.5 }, 56);
  const { ctx, w, h } = surface;
  const random = rng(seed);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, seed % 2 ? '#d9d9d9' : '#2a2a2a');
  sky.addColorStop(1, seed % 2 ? '#f4f4f4' : '#6a6a6a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const count = 7;
  for (let i = 0; i < count; i += 1) {
    const x = (i / count) * w * 1.15 - w * 0.1 + random.range(-0.03, 0.03) * w;
    const top = h * random.range(0.12, 0.62);
    const width = w * random.range(0.14, 0.26);
    const lean = w * random.range(-0.05, 0.09);
    const tone = Math.round(random.range(18, 235));
    const shade = ctx.createLinearGradient(x, top, x + width, h);
    shade.addColorStop(0, `rgb(${tone},${tone},${tone})`);
    const end = Math.max(0, tone - 70);
    shade.addColorStop(1, `rgb(${end},${end},${end})`);
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + lean, top);
    ctx.lineTo(x + lean + width, top + h * random.range(-0.08, 0.1));
    ctx.lineTo(x + width, h);
    ctx.closePath();
    ctx.fill();
    // The lit edge.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + lean, top);
    ctx.lineTo(x + lean + w * 0.006, top);
    ctx.lineTo(x + w * 0.006, h);
    ctx.closePath();
    ctx.fill();
  }
  // A hard shadow falling across everything.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.moveTo(w * 0.52, h);
  ctx.lineTo(w, h * 0.38);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  grain(surface, 0.1, seed + 3);
  return jpeg(surface, 82);
}

const bullets = [
  'Eine Aussage pro Folie',
  'Kein Schmuck, kein Verlauf, kein Zufall',
  'Die Fläche trägt, die Schrift spricht',
  'Was nicht nötig ist, fehlt',
  'Schwarz bleibt Schwarz',
];

const layouts: Layout[] = [
  {
    // Black above, a white foot.
    name: 'Titel',
    bg: black,
    shapes: [field(0, 11.35, W, H - 11.35, white), field(21.9, 12.75, 4.5, 1.6)],
    title: {
      x: 1.5,
      y: 1.3,
      w: 25,
      h: 9.5,
      valign: 'bottom',
      color: white,
      size: 96,
      sample: 'Klare\nKante',
    },
    subtitle: {
      x: 1.6,
      y: 12.3,
      w: 19,
      h: 2.5,
      valign: 'middle',
      sample: 'Ein Vortrag ohne Umwege',
    },
  },
  {
    // A black pillar left, the chapter on white.
    name: 'Abschnitt',
    bg: white,
    shapes: [field(0, 0, 8.4, H), field(10, 3.1, 16.4, 0.9)],
    title: {
      x: 9.9,
      y: 4.5,
      w: 16.7,
      h: 6.9,
      valign: 'top',
      size: 66,
      sample: 'Zweiter\nTeil',
    },
    subtitle: {
      x: 10,
      y: 11.9,
      w: 16.4,
      h: 2.2,
      valign: 'bottom',
      sample: 'Was bleibt, wenn alles weg ist',
    },
  },
  {
    // White page, the bar under the title, a black edge.
    name: 'Inhalt',
    bg: white,
    shapes: [field(0, 0, 1.1, H), field(2.6, 4.2, 23.8, 0.45)],
    title: { x: 2.5, y: 1.1, w: 24, h: 2.8, valign: 'bottom', size: 34 },
    body: { x: 2.6, y: 5.3, w: 23.6, h: 9.1, sample: bullets },
  },
  {
    // Text on white, the picture bleeding off on a black half.
    name: 'Text und Bild',
    bg: white,
    shapes: [field(14.6, 0, W - 14.6, H), field(1.6, 5.75, 4.2, 0.45)],
    title: { x: 1.5, y: 1.2, w: 12.3, h: 4.2, valign: 'bottom', size: 32 },
    body: {
      x: 1.6,
      y: 6.9,
      w: 11.8,
      h: 7.6,
      size: 20,
      sample: ['Links das Argument', 'Rechts der Beweis', 'Dazwischen nichts'],
    },
    pictures: [{ x: 15.8, y: 1.2, w: 12.2, h: 13.35 }],
  },
  {
    // A white head, then two columns in white on black, a bar between them.
    name: 'Zwei Spalten',
    bg: black,
    shapes: [field(0, 0, W, 4.6, white), field(13.78, 6, 0.45, 8.4, white)],
    title: { x: 1.5, y: 1, w: 25, h: 2.8, valign: 'bottom', size: 40, sample: 'Dafür und dagegen' },
    body: [
      {
        x: 1.6,
        y: 5.9,
        w: 11.2,
        h: 8.6,
        size: 20,
        color: white,
        sample: ['Klar auf den ersten Blick', 'Druckt überall gleich', 'Altert nicht'],
      },
      {
        x: 15.2,
        y: 5.9,
        w: 11.2,
        h: 8.6,
        size: 20,
        color: white,
        sample: ['Verzeiht keinen Fehler', 'Braucht starke Worte', 'Nichts lenkt ab'],
      },
    ],
  },
  {
    // The number alone on black; its meaning on a white slab.
    name: 'Kennzahl',
    bg: black,
    shapes: [field(18.9, 0, W - 18.9, H, white), field(20.3, 6.2, 6.1, 0.9)],
    title: {
      x: 1.2,
      y: 2.4,
      w: 17.6,
      h: 11,
      valign: 'middle',
      color: white,
      size: 176,
      spacing: -5,
      sample: '73 %',
    },
    body: {
      x: 20.3,
      y: 7.7,
      w: 6.4,
      h: 6.7,
      size: 20,
      bold: true,
      lineHeight: 118,
      sample: 'weniger Elemente.\nDieselbe Wirkung.',
    },
  },
  {
    // The quote in heavy type on white, who said it on a black foot.
    name: 'Zitat',
    bg: white,
    shapes: [field(0, 12.1, W, H - 12.1), field(1.6, 1.5, 6.4, 0.9)],
    body: {
      x: 1.5,
      y: 3,
      w: 24.5,
      h: 8.5,
      valign: 'middle',
      font: 'Archivo Black',
      size: 46,
      upper: true,
      lineHeight: 104,
      sample: 'Weglassen ist die härteste Form der Gestaltung.',
    },
    subtitle: {
      x: 1.6,
      y: 12.7,
      w: 24.8,
      h: 2.4,
      valign: 'middle',
      color: white,
      sample: 'Ida Brandt, Typografin',
    },
  },
  {
    // The picture edge to edge, its caption on black beneath.
    name: 'Bild',
    bg: black,
    shapes: [field(22.4, 13.05, 4, 0.9, white)],
    pictures: [{ x: 0, y: 0, w: W, h: 11.4 }],
    title: {
      x: 1.5,
      y: 11.8,
      w: 20,
      h: 3.4,
      valign: 'middle',
      color: white,
      size: 36,
      sample: 'Licht und Beton',
    },
  },
  {
    // The title page turned over: a white head, the last word on black.
    name: 'Schluss',
    bg: white,
    shapes: [field(0, 4.4, W, H - 4.4), field(1.6, 1.4, 4.5, 1.6)],
    title: {
      x: 1.5,
      y: 5,
      w: 25,
      h: 9.6,
      valign: 'bottom',
      color: white,
      size: 110,
      sample: 'Punkt.',
    },
    subtitle: {
      x: 7.2,
      y: 1.1,
      w: 19.2,
      h: 2.2,
      valign: 'middle',
      align: 'right',
      sample: 'Danke fürs Hinsehen',
    },
  },
];

const template: Template = {
  slug: 'kontrast',
  name: 'Kontrast',
  group: 'Schwarzweiß',
  tags: [
    'Schwarzweiß',
    'fett',
    'Typografie',
    'monumental',
    'hart',
    'Plakat',
    'Keynote',
    'Statement',
  ],
  description:
    'Reines Schwarz und Weiß: riesige fette Schrift, Flächen, die von Folie zu Folie tauschen, dicke Balken.',
  palette: {
    bg: white,
    text: black,
    bg2: '#ececec',
    text2: '#4a4a4a',
    accents: ['#1c1c1c', '#767676', '#a3a3a3', '#cdcdcd', '#d7301f', '#b9ad98'],
  },
  fonts: { head: 'Archivo Black', body: 'Archivo' },
  text: {
    title: { font: 'Archivo Black', size: 64, color: black, upper: true, lineHeight: 96 },
    subtitle: { font: 'Archivo', size: 24, color: black, bold: true },
    body: { font: 'Archivo', size: 24, color: black, lineHeight: 122, paraSpace: 0.42 },
  },
  layouts,
  samplePictures: [planes(4), planes(7)],
};

export default template;
