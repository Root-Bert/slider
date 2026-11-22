import { jpeg, paint, rng } from '../art';
import type { Box, Color, Layout, Picture, Shape, Template } from '../model';

/*
 * Boulevard: the front page of a tabloid – headlines that shout, set tight on red and yellow
 * bars and black boxes, everything a little askew, underlined twice, with an exclamation mark
 * as its ornament.
 */

const white = '#ffffff';
const black = '#0b0b0b';
const red = '#e2001a';
const yellow = '#ffe500';
const deep = '#a80013';
const grey = '#3c3c3c';

const display = 'Anton';
const sans = 'Roboto Condensed';

/** A bar leaning as the page's bars do; larger than what it holds, so text stays on it. */
const bar = (box: Box, fill: Color, rotate = -2): Shape => ({ t: 'rect', ...box, fill, rotate });

/** A glyph as ornament. */
const glyph = (
  text: string,
  box: Box,
  size: number,
  color: Color,
  rotate = 0,
  font = display,
): Shape => ({
  t: 'text',
  ...box,
  text,
  font,
  size,
  color,
  rotate,
  align: 'center',
  valign: 'middle',
  nowrap: true,
  lineHeight: 100,
});

/** The two strokes of a marker under a headline. */
const underline = (x: number, y: number, w: number, color: Color, rotate = -2): Shape[] => [
  { t: 'rect', x, y, w, h: 0.26, fill: color, rotate },
  { t: 'rect', x: x + 0.5, y: y + 0.48, w: w * 0.62, h: 0.16, fill: color, rotate },
];

/**
 * A snapshot for the preview, as a tabloid crops it: a face-sized sun, a skyline and flash-hard
 * light in few flat tones – red sky, black roofs.
 */
function snapshot(seed: number): Picture {
  const surface = paint({ w: 16, h: 12 }, 60);
  const { ctx, w, h } = surface;
  const random = rng(seed * 17 + 3);
  const warm = seed % 2 === 1;
  ctx.fillStyle = warm ? '#ffcf1a' : '#d9dee6';
  ctx.fillRect(0, 0, w, h);
  // Rays of a flash.
  ctx.fillStyle = warm ? '#ffb300' : '#c2c9d4';
  const [fx, fy] = [w * random.range(0.35, 0.65), h * 0.42];
  for (let i = 0; i < 18; i += 2) {
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(
      fx + Math.cos((i / 18) * Math.PI * 2) * w * 2,
      fy + Math.sin((i / 18) * Math.PI * 2) * w * 2,
    );
    ctx.lineTo(
      fx + Math.cos(((i + 1) / 18) * Math.PI * 2) * w * 2,
      fy + Math.sin(((i + 1) / 18) * Math.PI * 2) * w * 2,
    );
    ctx.fill();
  }
  ctx.fillStyle = warm ? red : '#f4f4f4';
  ctx.beginPath();
  ctx.arc(fx, fy, h * 0.24, 0, Math.PI * 2);
  ctx.fill();
  for (const [base, color] of [
    [0.62, warm ? '#7a0010' : '#6d7480'],
    [0.76, '#141414'],
  ] as const) {
    ctx.fillStyle = color;
    for (let x = -8; x < w;) {
      const width = random.range(w * 0.05, w * 0.14);
      const top = h * (base - random.range(0, 0.2));
      ctx.fillRect(x, top, width, h);
      if (random() < 0.4) ctx.fillRect(x + width * 0.4, top - h * 0.07, width * 0.12, h * 0.07);
      x += width;
    }
  }
  return jpeg(surface, 84);
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: white,
    shapes: [
      {
        t: 'poly',
        fill: red,
        pts: [
          [-1, -1],
          [21.4, -1],
          [18.6, 17],
          [-1, 17],
        ],
      },
      bar({ x: 19.2, y: -1.5, w: 2.2, h: 20 }, black, 8.8),
      glyph('!', { x: 20.2, y: 0.2, w: 7, h: 13 }, 380, black, 9),
      ...underline(1.7, 10.35, 12.6, white),
      bar({ x: -1, y: 12.15, w: 18.6, h: 2.3 }, yellow),
    ],
    title: {
      x: 1.7,
      y: 1.3,
      w: 17,
      h: 8.9,
      color: white,
      sample: 'Jetzt\nreicht’s!',
    },
    subtitle: {
      x: 1.7,
      y: 12.3,
      w: 16.2,
      h: 2,
      valign: 'middle',
      size: 22,
      sample: 'Die ganze Wahrheit in zehn Minuten',
    },
  },
  {
    name: 'Abschnitt',
    bg: yellow,
    shapes: [
      bar({ x: -2, y: 3.5, w: 27, h: 7.3 }, black, -3),
      bar({ x: 22.6, y: -3, w: 3, h: 24 }, red, 12),
      ...underline(1.9, 10.2, 9, red, -3),
      bar({ x: 1.3, y: 12, w: 13.4, h: 1.9 }, white, -3),
    ],
    title: {
      x: 1.9,
      y: 4,
      w: 19.4,
      h: 5.6,
      valign: 'middle',
      size: 66,
      color: white,
      sample: 'Teil zwei:\nDer Skandal',
    },
    subtitle: {
      x: 1.9,
      y: 11.95,
      w: 12.4,
      h: 1.6,
      valign: 'middle',
      sample: 'Was bisher niemand wusste',
    },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: [
      { t: 'rect', x: 24.7, y: 0, w: 3.3, h: 15.75, fill: red },
      glyph('!', { x: 24.2, y: 9.2, w: 4.3, h: 6.6 }, 170, white, 8),
      bar({ x: 0.9, y: 1.35, w: 21.4, h: 3 }, yellow, -1.5),
      { t: 'rect', x: 0, y: 1, w: 21.6, h: 3, fill: black },
      { t: 'rect', x: 1.7, y: 14.55, w: 21, h: 0.2, fill: black },
    ],
    title: {
      x: 1.7,
      y: 1,
      w: 19.4,
      h: 3,
      valign: 'middle',
      size: 38,
      color: white,
      sample: 'Sechs Dinge, die jeder wissen muss',
    },
    body: {
      x: 1.7,
      y: 5.1,
      w: 21.6,
      h: 9,
      size: 24,
      sample: [
        'Der Preis steigt schon ab Montag',
        'Wer jetzt wechselt, spart das Doppelte',
        'Die Frist endet früher als gedacht',
        'Drei Fehler kosten richtig Geld',
        'So einfach geht der Antrag wirklich',
        'Das sagt der Chef zum ersten Mal',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [
      { t: 'rect', x: 0, y: 0, w: 12.6, h: 15.75, fill: black },
      bar({ x: 12.6, y: 1.15, w: 16, h: 3.9 }, red, 0),
      { t: 'rect', x: 12.6, y: 5.05, w: 5.4, h: 0.5, fill: yellow },
      { t: 'rect', x: 14, y: 14.3, w: 12.4, h: 0.2, fill: black },
    ],
    pictures: [{ x: 0, y: 0, w: 12.1, h: 15.75 }],
    title: {
      x: 14,
      y: 1.15,
      w: 12.6,
      h: 3.9,
      valign: 'middle',
      size: 36,
      color: white,
      sample: 'Die Stadt steht kopf',
    },
    body: {
      x: 14,
      y: 6.3,
      w: 12.4,
      h: 7.7,
      sample: [
        'Tausende auf dem Rathausplatz',
        'Der Bürgermeister schweigt',
        'Jetzt reden die Nachbarn',
        'Morgen fällt die Entscheidung',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      { t: 'rect', x: 0, y: 4.6, w: 14, h: 11.15, fill: yellow },
      { t: 'rect', x: 26.9, y: 4.6, w: 1.1, h: 11.15, fill: red },
      { t: 'rect', x: 13.85, y: 4.6, w: 0.3, h: 11.15, fill: black },
      { t: 'rect', x: 0, y: 4.35, w: 28, h: 0.5, fill: black },
      { t: 'rect', x: 12.4, y: 3.4, w: 3.2, h: 3.2, fill: black, rotate: 45 },
      glyph('!', { x: 12.4, y: 3.25, w: 3.2, h: 3.4 }, 66, yellow),
      ...underline(1.7, 3.3, 7.4, red, 0),
    ],
    title: {
      x: 1.7,
      y: 0.6,
      w: 24.6,
      h: 2.6,
      valign: 'middle',
      size: 40,
      sample: 'Top oder Flop? Das Duell',
    },
    body: [
      {
        x: 1.7,
        y: 6.6,
        w: 10.6,
        h: 7.9,
        bold: true,
        sample: ['Schneller als alle anderen', 'Kostet fast nichts', 'Jeder will es haben'],
      },
      {
        x: 15.7,
        y: 6.6,
        w: 10.6,
        h: 7.9,
        bold: true,
        sample: ['Hält nur einen Sommer', 'Macht richtig Lärm', 'Keiner gibt es zu'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: black,
    shapes: [
      bar({ x: -2, y: 10.1, w: 32, h: 3.6 }, red, -2.5),
      bar({ x: 23.4, y: -3, w: 2.4, h: 9.4 }, yellow, 14),
      ...underline(1.8, 8.9, 11.4, white, -2.5),
    ],
    title: {
      x: 1.7,
      y: 1.5,
      w: 21,
      h: 8.3,
      valign: 'bottom',
      size: 200,
      color: yellow,
      sample: '73 %',
    },
    body: {
      x: 1.8,
      y: 10.35,
      w: 23.4,
      h: 2.9,
      valign: 'middle',
      bold: true,
      size: 26,
      color: white,
      sample: 'Lesern reicht die Schlagzeile. Den Rest glauben sie einfach.',
    },
  },
  {
    name: 'Zitat',
    bg: red,
    shapes: [
      bar({ x: 2.2, y: 2.2, w: 24.2, h: 9.5 }, black, -1.5),
      bar({ x: 1.6, y: 1.7, w: 24.2, h: 9.5 }, white, -1.5),
      glyph('“', { x: 0.4, y: 1.2, w: 6, h: 6 }, 230, yellow, -6),
      bar({ x: 12.6, y: 12.3, w: 13.8, h: 1.9 }, black, -1.5),
    ],
    body: {
      x: 3.4,
      y: 3,
      w: 20.6,
      h: 7.3,
      valign: 'middle',
      font: display,
      upper: true,
      size: 40,
      lineHeight: 118,
      sample: 'Ich habe nichts gewusst. Und das ist die volle Wahrheit!',
    },
    subtitle: {
      x: 13.2,
      y: 12.25,
      w: 12.6,
      h: 1.8,
      valign: 'middle',
      color: white,
      sample: 'Der Nachbar, exklusiv',
    },
  },
  {
    name: 'Bild',
    bg: black,
    shapes: [
      { t: 'rect', x: 0, y: 11.6, w: 28, h: 4.15, fill: red },
      { t: 'rect', x: 0, y: 11.35, w: 28, h: 0.5, fill: yellow },
      { t: 'rect', x: 22.5, y: 10.1, w: 3.6, h: 3.6, fill: yellow, rotate: 10 },
      glyph('!', { x: 22.5, y: 10, w: 3.6, h: 3.8 }, 78, black, 10),
    ],
    pictures: [{ x: 0, y: 0, w: 28, h: 11.35 }],
    title: {
      x: 1.7,
      y: 12.1,
      w: 20,
      h: 3,
      valign: 'middle',
      size: 40,
      color: white,
      sample: 'Hier fing alles an',
    },
  },
  {
    name: 'Schluss',
    bg: red,
    shapes: [
      glyph('!', { x: 17.6, y: -1.4, w: 9, h: 16 }, 500, deep, 10),
      bar({ x: -2, y: 10.9, w: 20.2, h: 2.5 }, yellow, -3),
      bar({ x: 16.2, y: 12.2, w: 14, h: 1.1 }, black, -3),
      ...underline(1.8, 9.5, 10.4, white, -3),
    ],
    title: {
      x: 1.7,
      y: 1.2,
      w: 20,
      h: 8,
      size: 120,
      color: white,
      sample: 'Danke!',
    },
    subtitle: {
      x: 1.8,
      y: 11.05,
      w: 15.4,
      h: 1.8,
      valign: 'middle',
      sample: 'Fragen? Sofort und ohne Gnade',
    },
  },
];

const template: Template = {
  slug: 'boulevard',
  name: 'Boulevard',
  group: 'Zeitung',
  tags: ['Boulevard', 'Schlagzeile', 'laut', 'rot', 'gelb', 'Zeitung', 'Pitch', 'Aufmerksamkeit'],
  description:
    'Wie die Titelseite eines Boulevardblatts: schreiende Schlagzeilen auf Rot, Gelb und Schwarz.',
  palette: {
    bg: white,
    text: black,
    bg2: yellow,
    text2: grey,
    accents: [red, deep, '#ff8a00', '#0050b4', '#d6d6d6', '#6f6f6f'],
  },
  fonts: { head: display, body: sans },
  text: {
    title: { font: display, size: 100, color: black, upper: true, lineHeight: 78 },
    subtitle: { font: sans, size: 24, color: black, bold: true, upper: true },
    body: { font: sans, size: 25, color: black, lineHeight: 118, paraSpace: 0.32 },
  },
  layouts,
  samplePictures: [snapshot(1), snapshot(2)],
};

export default template;
