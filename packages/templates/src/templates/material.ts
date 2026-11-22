import type { Box, Color, Layout, Shape, Template } from '../model';
import { disc } from '../shapes';

/*
 * Material: paper and ink. White sheets lie on a grey table and cast soft shadows the higher
 * they float; a bar of the primary colour heads the page, one round button in the accent colour
 * floats over a seam. Everything sits on a grid of 0.4 cm.
 */

const primary = '#3b4cc0';
const deep = '#2a3794';
const tint = '#c8cef6';
const accent = '#ff4f6e';
const amber = '#ffb31a';
const teal = '#00a591';
const sky = '#2aa5ee';
const ground = '#eceef2';
const ink = '#1f2330';
const quiet = '#5c6272';
const white = '#ffffff';

/** A sheet of paper `level` high over the table. */
const sheet = (box: Box, level = 1, fill: Color = white, r = 0.12): Shape => ({
  t: 'rect',
  ...box,
  r,
  fill,
  shadow: { dx: 0, dy: 0.08 + level * 0.08, blur: 0.2 + level * 0.2, opacity: 0.3 },
});

/** A field of the primary colour that casts a shadow as an app bar does. */
const field = (box: Box, fill: Color = primary): Shape => ({
  t: 'rect',
  ...box,
  fill,
  shadow: { dx: 0, dy: 0.12, blur: 0.4, opacity: 0.32 },
});

type Sign = 'plus' | 'arrow' | 'quote' | 'none';

/** The floating round button. */
const fab = (cx: number, cy: number, r: number, sign: Sign = 'plus', fill = accent): Shape[] => [
  {
    t: 'ellipse',
    x: cx - r,
    y: cy - r,
    w: r * 2,
    h: r * 2,
    fill,
    shadow: { dx: 0, dy: 0.22, blur: 0.55, opacity: 0.38 },
  },
  ...(sign === 'plus'
    ? ([
        { t: 'rect', x: cx - r * 0.4, y: cy - r * 0.06, w: r * 0.8, h: r * 0.12, fill: white },
        { t: 'rect', x: cx - r * 0.06, y: cy - r * 0.4, w: r * 0.12, h: r * 0.8, fill: white },
      ] satisfies Shape[])
    : sign === 'arrow'
      ? ([
          {
            t: 'path',
            x: cx - r * 0.45,
            y: cy - r * 0.45,
            w: r * 0.9,
            h: r * 0.9,
            vb: [100, 100],
            d: 'M8 50 L88 50 M54 14 L90 50 L54 86',
            fill: null,
            stroke: { color: white, width: r * 0.12, cap: 'butt', join: 'miter' },
          },
        ] satisfies Shape[])
      : sign === 'quote'
        ? ([
            {
              t: 'text',
              x: cx - r,
              y: cy - r * 0.62,
              w: r * 2,
              h: r * 2,
              text: '“',
              font: 'Roboto',
              bold: true,
              size: r * 62,
              color: white,
              align: 'center',
              valign: 'top',
            },
          ] satisfies Shape[])
        : []),
];

/** Rings of touch spreading from a point, a shade lighter than the field. */
const ripple = (cx: number, cy: number, radii: readonly number[]): Shape[] =>
  radii.map((r) => disc(cx, cy, r, { t: 'solid', color: white, opacity: 0.06 }));

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: ground,
    shapes: [
      field({ x: 0, y: 0, w: 28, h: 10 }),
      ...ripple(23.2, 2.4, [3.2, 6, 9.2]),
      // The field's lower edge again, so that the rings end at it.
      { t: 'rect', x: 0, y: 10.02, w: 28, h: 5.73, fill: ground },
      { t: 'rect', x: 0, y: 0, w: 28, h: 0.8, fill: deep },
      sheet({ x: 2.4, y: 8.4, w: 16.8, h: 4.4 }, 3),
      { t: 'rect', x: 3.6, y: 9.6, w: 1.6, h: 0.16, fill: accent },
      ...fab(22.4, 10, 1.4, 'arrow'),
    ],
    title: {
      x: 2.4,
      y: 1.6,
      w: 18.4,
      h: 6,
      valign: 'middle',
      sample: 'Papier, Tinte\nund ein Raster',
    },
    subtitle: {
      x: 3.6,
      y: 10,
      w: 14.4,
      h: 2.4,
      valign: 'middle',
      sample: 'Gestaltungsrichtlinien für alle Produkte, Stand Herbst',
    },
  },
  {
    name: 'Abschnitt',
    bg: primary,
    shapes: [
      ...ripple(22.4, 12, [4.8, 8.8, 13.2, 18]),
      { t: 'rect', x: 0, y: 0, w: 28, h: 0.8, fill: deep },
      { t: 'rect', x: 2.4, y: 4.4, w: 2.4, h: 0.8, r: 0.4, fill: amber },
      ...fab(22.4, 12, 2.4, 'arrow'),
    ],
    title: {
      x: 2.4,
      y: 5.6,
      w: 16.8,
      h: 4.8,
      size: 48,
      valign: 'top',
      sample: 'Bewegung\ngibt Bedeutung',
    },
    subtitle: {
      x: 2.4,
      y: 10.8,
      w: 14.4,
      h: 2,
      color: tint,
      sample: 'Wie Übergänge erklären, was passiert',
    },
  },
  {
    name: 'Inhalt',
    bg: ground,
    shapes: [
      field({ x: 0, y: 0, w: 28, h: 3.6 }),
      { t: 'rect', x: 0, y: 0, w: 28, h: 0.8, fill: deep },
      sheet({ x: 2.4, y: 4.8, w: 23.2, h: 9.6 }, 1),
      ...fab(23.6, 3.6, 1, 'plus'),
    ],
    title: {
      x: 2.4,
      y: 0.9,
      w: 19.2,
      h: 2.6,
      size: 32,
      valign: 'middle',
      sample: 'Die Grundsätze der Oberfläche',
    },
    body: {
      x: 3.2,
      y: 5.4,
      w: 21.6,
      h: 8.6,
      sample: [
        'Flächen verhalten sich wie Papier',
        'Schatten zeigen, was oben liegt',
        'Farbe führt zur wichtigsten Handlung',
        'Abstände folgen einem festen Raster',
        'Bewegung beginnt dort, wo man tippt',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: ground,
    shapes: [
      sheet({ x: 1.6, y: 1.6, w: 24.8, h: 12.4 }, 2),
      { t: 'rect', x: 1.6, y: 1.6, w: 11.6, h: 12.4, fill: tint },
      ...fab(23.6, 14, 1, 'plus'),
      { t: 'rect', x: 15.2, y: 5.5, w: 1.6, h: 0.16, fill: accent },
    ],
    pictures: [{ x: 1.6, y: 1.6, w: 11.6, h: 12.4 }],
    title: {
      x: 15.2,
      y: 2.2,
      w: 10,
      h: 3.1,
      size: 28,
      color: ink,
      valign: 'bottom',
      sample: 'Bilder tragen die Karte',
    },
    body: {
      x: 15.2,
      y: 6.1,
      w: 10.2,
      h: 7.3,
      size: 19,
      sample: [
        'Das Bild füllt die Karte bis zum Rand',
        'Text steht ruhig daneben',
        'Ein Knopf, eine Handlung',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: ground,
    shapes: [
      field({ x: 0, y: 0, w: 28, h: 6.4 }),
      { t: 'rect', x: 0, y: 0, w: 28, h: 0.8, fill: deep },
      sheet({ x: 2.4, y: 4.4, w: 11.2, h: 9.8 }, 2),
      sheet({ x: 14.4, y: 4.4, w: 11.2, h: 9.8 }, 2),
      { t: 'rect', x: 2.4, y: 4.4, w: 11.2, h: 0.24, fill: amber },
      { t: 'rect', x: 14.4, y: 4.4, w: 11.2, h: 0.24, fill: teal },
    ],
    title: {
      x: 2.4,
      y: 1.1,
      w: 23.2,
      h: 2.9,
      size: 32,
      valign: 'middle',
      sample: 'Zwei Wege, ein Raster',
    },
    body: [
      {
        x: 3.2,
        y: 5.4,
        w: 9.6,
        h: 8.2,
        size: 19,
        sample: ['Am Telefon: eine Spalte', 'Knopf unten rechts', 'Leiste bleibt schmal'],
      },
      {
        x: 15.2,
        y: 5.4,
        w: 9.6,
        h: 8.2,
        size: 19,
        sample: ['Am Schreibtisch: zwei Spalten', 'Karten nebeneinander', 'Leiste wird zur Bühne'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: ground,
    shapes: [
      field({ x: 0, y: 0, w: 28, h: 7.6 }),
      ...ripple(8.4, 7.6, [7.2, 10.4]),
      { t: 'rect', x: 0, y: 7.62, w: 28, h: 8.13, fill: ground },
      { t: 'rect', x: 0, y: 0, w: 28, h: 0.8, fill: deep },
      sheet({ x: 10.4, y: 4.4, w: 15.2, h: 7.2 }, 2),
      ...fab(8.4, 8, 5.2, 'none'),
      // What the number is of: a track with its share filled.
      { t: 'rect', x: 15.2, y: 10.2, w: 8.8, h: 0.24, r: 0.12, fill: tint },
      { t: 'rect', x: 15.2, y: 10.2, w: 6, h: 0.24, r: 0.12, fill: primary },
    ],
    title: {
      x: 3.6,
      y: 5.2,
      w: 9.6,
      h: 5.6,
      size: 84,
      align: 'center',
      valign: 'middle',
      sample: '68 %',
    },
    body: {
      x: 15.2,
      y: 5,
      w: 9.4,
      h: 4.8,
      size: 21,
      valign: 'middle',
      sample: 'aller Nutzer finden den Knopf jetzt ohne zu suchen.',
    },
  },
  {
    name: 'Zitat',
    bg: ground,
    shapes: [
      field({ x: 0, y: 0, w: 9.6, h: 15.75 }),
      ...ripple(0, 15.75, [5.6, 9.6]),
      { t: 'rect', x: 9.62, y: 0, w: 18.38, h: 15.75, fill: ground },
      sheet({ x: 4.8, y: 2.4, w: 20.8, h: 10.8 }, 4),
      ...fab(4.8, 4.4, 1.4, 'quote'),
      disc(8.4, 11, 0.8, tint),
      disc(8.4, 10.76, 0.28, primary),
      {
        t: 'ellipse',
        kind: 'cut',
        start: 0,
        end: 180,
        x: 7.86,
        y: 11.14,
        w: 1.08,
        h: 1.0,
        fill: primary,
      },
    ],
    body: {
      x: 7.6,
      y: 3.2,
      w: 16.8,
      h: 6.4,
      font: 'Roboto',
      size: 30,
      color: ink,
      lineHeight: 122,
      valign: 'middle',
      sample: 'Eine gute Oberfläche erklärt sich mit jeder Bewegung selbst.',
    },
    subtitle: {
      x: 9.8,
      y: 10.2,
      w: 14.4,
      h: 1.6,
      valign: 'middle',
      sample: 'Jonas Reuter, Produktgestaltung',
    },
  },
  {
    name: 'Bild',
    bg: ground,
    shapes: [
      { t: 'rect', x: 0, y: 0, w: 28, h: 0.8, fill: primary },
      sheet({ x: 2.4, y: 1.6, w: 23.2, h: 12.8 }, 3),
      { t: 'rect', x: 2.4, y: 1.6, w: 23.2, h: 10, fill: tint },
      ...fab(23.2, 13, 0.9, 'plus'),
    ],
    pictures: [{ x: 2.4, y: 1.6, w: 23.2, h: 10 }],
    title: {
      x: 3.6,
      y: 11.8,
      w: 17.6,
      h: 2.4,
      size: 26,
      color: ink,
      valign: 'middle',
      sample: 'Die Karte im Einsatz',
    },
  },
  {
    name: 'Schluss',
    bg: primary,
    shapes: [
      ...ripple(14, 7.6, [4.4, 8, 12, 16.4]),
      { t: 'rect', x: 0, y: 0, w: 28, h: 0.8, fill: deep },
      sheet({ x: 7.2, y: 10, w: 13.6, h: 2.4 }, 3, white, 0.16),
      ...fab(22.4, 11.2, 1.2, 'arrow'),
    ],
    title: {
      x: 3.2,
      y: 3.2,
      w: 21.6,
      h: 5.6,
      size: 64,
      align: 'center',
      valign: 'middle',
      sample: 'Vielen Dank',
    },
    subtitle: {
      x: 7.6,
      y: 10.2,
      w: 12.8,
      h: 2,
      color: primary,
      bold: true,
      align: 'center',
      valign: 'middle',
      sample: 'Fragen und Rückmeldungen',
    },
  },
];

const template: Template = {
  slug: 'material',
  name: 'Material',
  group: 'Designtrend',
  tags: ['Material', 'Karten', 'Schatten', 'Raster', 'App', 'Produkt', 'sachlich', 'Technik'],
  description:
    'Papier und Tinte: weiße Karten mit weichem Schatten auf grauem Grund, eine farbige Kopfleiste und ein runder Knopf in der Akzentfarbe.',
  palette: {
    bg: ground,
    text: ink,
    bg2: white,
    text2: quiet,
    accents: [primary, accent, amber, teal, sky, deep],
  },
  fonts: { head: 'Roboto', body: 'Roboto' },
  text: {
    title: { font: 'Roboto', size: 54, color: white, lineHeight: 108 },
    subtitle: { font: 'Roboto', size: 20, color: quiet, lineHeight: 125 },
    body: { font: 'Roboto', size: 21, color: ink, lineHeight: 125, paraSpace: 0.4 },
  },
  layouts,
};

export default template;
