import { mix } from '../art';
import type { Box, Fill, FillLike, Layout, Shape, Slot, Stroke, Template } from '../model';
import { columns } from '../shapes';

/*
 * Pitch: a start-up's deck – big confident type, white pages and a dark one, and one gradient
 * from violet to coral that only ever appears as a pill: a tag over a title, a giant capsule
 * behind a number, a slanted one leaving the page.
 */

const violet = '#6a35f2';
const coral = '#ff6a55';
const berry = mix(violet, coral, 0.5);
const night = '#140f2b';
const white = '#ffffff';
const haze = '#f3f0fb';
const ink = '#17122e';
const dusk = '#6b6682';
const lilac = '#b9a5ff';
const sun = '#ffc247';
const mint = '#2fcfa4';

const grad = (angle = 90): Fill => ({
  t: 'linear',
  angle,
  stops: [
    [0, violet],
    [0.55, berry],
    [1, coral],
  ],
});

const L = 1.5;
const R = 26.5;

/** A pill: a box rounded all the way. */
const pill = (
  box: Box,
  fill: FillLike,
  options: { rotate?: number; stroke?: Stroke } = {},
): Shape => ({
  t: 'rect',
  ...box,
  r: Math.min(box.w, box.h) / 2,
  fill,
  stroke: options.stroke,
  rotate: options.rotate,
});

/** The tag over a title. */
const tag = (x = L, y = 1.45): Shape => pill({ x, y, w: 2.5, h: 0.52 }, grad());

const title: Slot = { x: L, y: 2.3, w: 21.5, h: 3.4, valign: 'top' };

const cards = columns({ x: L, y: 6.1, w: R - L, h: 8.1 }, 2, 0.9);
const figures = columns({ x: L, y: 6.1, w: R - L, h: 8 }, 3, 0.8);

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: night,
    shapes: [
      pill({ x: 16.6, y: -3.6, w: 21, h: 6.4 }, null, {
        rotate: -28,
        stroke: { color: lilac, width: 0.04, opacity: 0.45 },
      }),
      pill({ x: 15.2, y: 3.4, w: 21, h: 6.6 }, grad(), { rotate: -28 }),
      pill({ x: 21.4, y: 12.3, w: 9, h: 1.5 }, null, {
        rotate: -28,
        stroke: { color: coral, width: 0.05 },
      }),
      tag(L, 1.6),
    ],
    title: {
      x: L,
      y: 3.6,
      w: 15.5,
      h: 6.9,
      size: 60,
      color: white,
      valign: 'bottom',
      lineHeight: 102,
      spacing: -1,
      sample: 'Strom, der\nmitdenkt',
    },
    subtitle: {
      x: L,
      y: 11.1,
      w: 12.5,
      h: 2.6,
      color: lilac,
      sample: 'Lumen Energy – Seed-Runde\nBerlin, Frühjahr 2027',
    },
  },
  {
    name: 'Abschnitt',
    bg: grad(60),
    shapes: [
      pill(
        { x: 13.5, y: -2.4, w: 20, h: 5.6 },
        { t: 'solid', color: white, opacity: 0.14 },
        { rotate: -28 },
      ),
      pill({ x: 17, y: 2.6, w: 20, h: 5.6 }, null, {
        rotate: -28,
        stroke: { color: white, width: 0.05, opacity: 0.6 },
      }),
      pill({ x: L, y: 1.6, w: 2.5, h: 0.52 }, white),
    ],
    title: {
      x: L,
      y: 5.4,
      w: 21,
      h: 6.4,
      size: 64,
      color: white,
      valign: 'bottom',
      lineHeight: 102,
      spacing: -1,
      sample: 'Das Problem',
    },
    subtitle: {
      x: L,
      y: 12.2,
      w: 18,
      h: 2,
      color: white,
      sample: 'Warum Haushalte heute zu viel für Strom zahlen',
    },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: [tag(), pill({ x: 22.6, y: 12.6, w: 10, h: 2.7 }, grad(), { rotate: -28 })],
    title: { ...title, sample: 'Unser Gerät verschiebt den Verbrauch in günstige Stunden' },
    body: {
      x: L,
      y: 6.1,
      w: 20.5,
      h: 8.1,
      sample: [
        'Steckt zwischen Zähler und Sicherungskasten',
        'Lernt in zwei Wochen, wann der Haushalt Strom braucht',
        'Lädt Auto und Speicher, wenn der Preis fällt',
        'Spart im Schnitt 31 % der Stromkosten',
        'Einbau in 40 Minuten durch Partnerbetriebe',
        'Abo ab 9 Euro im Monat, Gerät inklusive',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [
      tag(),
      { t: 'rect', x: 14.5, y: 2.5, w: 12, h: 11.75, r: 1.1, fill: grad(150) },
      { t: 'rect', x: 15.2, y: 1.5, w: 11.3, h: 12.05, fill: white },
    ],
    title: {
      ...title,
      w: 12.2,
      h: 3.8,
      size: 30,
      sample: 'Ein Gerät, das jede Wohnung versteht',
    },
    body: {
      x: L,
      y: 6.5,
      w: 12.2,
      h: 7.7,
      sample: [
        'Passt in jeden Zählerschrank',
        'Funkt über Mobilfunk, kein WLAN nötig',
        'Updates kommen über Nacht',
      ],
    },
    pictures: [{ x: 15.2, y: 1.5, w: 11.3, h: 12.05 }],
  },
  {
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      tag(),
      ...cards.map((box): Shape => ({ t: 'rect', ...box, r: 0.9, fill: haze })),
      pill({ x: cards[0]!.x + 0.9, y: 6.9, w: 1.7, h: 0.4 }, violet),
      pill({ x: cards[1]!.x + 0.9, y: 6.9, w: 1.7, h: 0.4 }, coral),
    ],
    title: { ...title, sample: 'Heute zahlen alle denselben Preis, morgen nur noch den besten' },
    body: cards.map((box, index) => ({
      x: box.x + 0.9,
      y: 7.8,
      w: box.w - 1.8,
      h: 5.8,
      sample:
        index === 0
          ? ['Fester Tarif, das ganze Jahr', 'Auto lädt um 18 Uhr', 'Speicher bleibt ungenutzt']
          : [
              'Preis wechselt jede Stunde',
              'Auto lädt um 3 Uhr nachts',
              'Speicher verkauft am Abend',
            ],
    })),
  },
  {
    name: 'Kennzahl',
    bg: night,
    shapes: [
      pill({ x: 0.4, y: 2.6, w: 17.6, h: 10.4 }, null, {
        stroke: { color: lilac, width: 0.04, opacity: 0.4 },
      }),
      pill({ x: L, y: 3.7, w: 15.4, h: 8.2 }, grad()),
      pill({ x: 18.6, y: 3.9, w: 1.7, h: 0.4 }, coral),
    ],
    title: {
      x: 2.4,
      y: 4.2,
      w: 13.6,
      h: 7.2,
      size: 104,
      color: white,
      align: 'center',
      valign: 'middle',
      lineHeight: 100,
      spacing: -2,
      sample: '31 %',
    },
    body: {
      x: 18.6,
      y: 4.9,
      w: 7.9,
      h: 7.6,
      size: 24,
      color: white,
      lineHeight: 126,
      sample: 'weniger Stromkosten im ersten Jahr, gemessen in 1.200 Haushalten',
    },
  },
  {
    name: 'Zitat',
    bg: white,
    shapes: [
      pill({ x: 21.2, y: 11.2, w: 12, h: 3 }, haze, { rotate: -28 }),
      pill({ x: 1.75, y: 1.5, w: 0.95, h: 2.5 }, grad(180), { rotate: 20 }),
      pill({ x: 3.25, y: 1.5, w: 0.95, h: 2.5 }, grad(180), { rotate: 20 }),
      { t: 'ellipse', x: L, y: 11.9, w: 1.5, h: 1.5, fill: grad(135) },
    ],
    body: {
      x: L,
      y: 4.5,
      w: 22.5,
      h: 6.8,
      size: 36,
      bold: true,
      lineHeight: 118,
      valign: 'middle',
      sample: 'Zum ersten Mal schaue ich gern auf meine Stromrechnung.',
    },
    subtitle: {
      x: 3.5,
      y: 11.9,
      w: 16,
      h: 1.5,
      valign: 'middle',
      color: dusk,
      sample: 'Aylin Demir, Pilotkundin aus Leipzig',
    },
  },
  {
    name: 'Bild',
    bg: white,
    shapes: [
      pill({ x: 22.9, y: 12.85, w: 3.6, h: 0.9 }, grad()),
      pill({ x: 20.9, y: 12.85, w: 1.6, h: 0.9 }, null, { stroke: { color: lilac, width: 0.05 } }),
    ],
    pictures: [{ x: 0, y: 0, w: 28, h: 11.2 }],
    title: {
      x: L,
      y: 12,
      w: 18.5,
      h: 2.6,
      size: 28,
      valign: 'middle',
      sample: 'So sieht der Einbau aus',
    },
  },
  {
    name: 'Schluss',
    bg: white,
    shapes: [
      pill({ x: -6, y: 2.4, w: 28.5, h: 8.2 }, grad()),
      pill({ x: 20.2, y: 11.6, w: 10, h: 2.2 }, null, { stroke: { color: lilac, width: 0.05 } }),
      pill({ x: L, y: 3.55, w: 2.5, h: 0.52 }, white),
    ],
    title: {
      x: L,
      y: 4.3,
      w: 17,
      h: 5.4,
      size: 60,
      color: white,
      valign: 'middle',
      lineHeight: 102,
      spacing: -1,
      sample: 'Reden wir.',
    },
    subtitle: {
      x: L,
      y: 11.4,
      w: 16,
      h: 2.6,
      color: ink,
      sample: 'Mara Lindqvist, Gründerin\nmara@lumen-beispiel.de',
    },
  },
  {
    name: 'Drei Kennzahlen',
    bg: white,
    shapes: [
      tag(),
      ...figures.flatMap((box, index): Shape[] => [
        { t: 'rect', ...box, r: 1, fill: grad(150) },
        {
          t: 'rect',
          x: box.x + 0.09,
          y: box.y + 0.09,
          w: box.w - 0.18,
          h: box.h - 0.18,
          r: 0.92,
          fill: white,
        },
        pill(
          { x: box.x + box.w / 2 - 0.85, y: box.y + 1, w: 1.7, h: 0.4 },
          [violet, berry, coral][index]!,
        ),
      ]),
    ],
    title: { ...title, sample: 'Nach zwölf Monaten trägt sich das Modell' },
    body: figures.map((box, index) => ({
      x: box.x + 0.3,
      y: box.y + 1.8,
      w: box.w - 0.6,
      h: box.h - 2.6,
      size: 34,
      bold: true,
      align: 'center' as const,
      valign: 'middle' as const,
      lineHeight: 118,
      sample: ['4.800\nHaushalte', '1,9 Mio. €\nUmsatz', '2 %\nKündiger'][index]!,
    })),
  },
];

const template: Template = {
  slug: 'pitch',
  name: 'Pitch',
  group: 'Bereich',
  tags: ['Pitch', 'Start-up', 'Investoren', 'Gründung', 'Verlauf', 'mutig', 'Kennzahlen', 'modern'],
  description:
    'Pitch-Deck für Gründerinnen und Gründer: große Schrift, viel Weiß und ein Verlauf von Violett nach Koralle, der nur als Kapsel auftritt.',
  palette: {
    bg: white,
    text: ink,
    bg2: haze,
    text2: dusk,
    accents: [violet, coral, berry, lilac, sun, mint],
  },
  fonts: { head: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans' },
  text: {
    title: {
      font: 'Plus Jakarta Sans',
      size: 34,
      color: ink,
      bold: true,
      lineHeight: 108,
      spacing: -0.5,
    },
    subtitle: { font: 'Plus Jakarta Sans', size: 20, color: dusk, lineHeight: 128 },
    body: { font: 'Plus Jakarta Sans', size: 20, color: ink, lineHeight: 124, paraSpace: 0.34 },
  },
  layouts,
};

export default template;
