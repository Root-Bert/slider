import { grain, jpeg, noise, paint } from '../art';
import type { Layout, Picture, Shape, Template } from '../model';
import { disc } from '../shapes';

/*
 * Minimal: the quietest template. White, wide margins, small exact type, one hairline and one
 * dot per page – each time somewhere else, never more.
 */

const ink = '#111111';
const white = '#ffffff';
const grey = '#8a8a8a';

/** The margins everything hangs on. */
const L = 3.2;
const R = 24.8;
const T = 2.4;
const B = 13.35;

const hairline = (x1: number, y1: number, x2: number, y2: number): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: { color: ink, width: 0.02 },
});
const dot = (cx: number, cy: number): Shape => disc(cx, cy, 0.14, ink);

/** Fog over still water with a pale sun, or one dune's edge – grey stand-ins for a photo. */
function quiet(kind: 'water' | 'dune'): Picture {
  const surface = paint({ w: 28, h: 17.5 }, 56);
  const { ctx, w, h } = surface;
  const field = noise(kind === 'water' ? 4 : 9);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [u, v] = [x / w, y / h];
      let value: number;
      if (kind === 'water') {
        const horizon = 0.62;
        const haze = Math.exp(-Math.abs(v - horizon) * 9);
        value =
          v < horizon
            ? 214 + v * 30 + haze * 8
            : 188 - (v - horizon) * 70 + haze * 40 + (field(u * 14, v * 160, 3) - 0.5) * 10;
        const sun = Math.hypot((u - 0.68) * (w / h), v - 0.33);
        value += Math.max(0, 1 - sun / 0.075) ** 0.6 * 30 + Math.exp(-sun * 5) * 14;
      } else {
        const edge = 0.36 + Math.sin(u * 2.6 + 0.4) * 0.16 + u * 0.14;
        const soft = Math.min(1, Math.max(0, (v - edge) * 60));
        const lit = 226 - (v - edge) * 90 + (field(u * 3, v * 3, 3) - 0.5) * 8;
        const shadow = 150 + (v - edge) * 110;
        const turn = Math.min(1, Math.max(0, (u - 0.3) / 0.5));
        const side = lit + (shadow - lit) * turn * turn * (3 - 2 * turn);
        value = (236 - v * 26) * (1 - soft) + side * soft;
      }
      const i = (y * w + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = Math.max(0, Math.min(255, value));
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  grain(surface, 0.035, 3);
  return jpeg(surface, 86);
}

const layouts: Layout[] = [
  {
    // The title a little above the middle, the hairline far below, the dot where reading starts.
    name: 'Titel',
    bg: white,
    shapes: [dot(L + 0.14, 4.9), hairline(L, 12.1, R, 12.1)],
    title: {
      x: L - 0.08,
      y: 5.5,
      w: 17,
      h: 4.4,
      valign: 'top',
      size: 46,
      sample: 'Weniger,\naber besser',
    },
    subtitle: { x: L, y: 12.45, w: 16, h: 1, valign: 'top', sample: 'Ein Vortrag in zwölf Folien' },
  },
  {
    // Dot, line, word: the chapter stands at the end of a hairline on the page's middle.
    name: 'Abschnitt',
    bg: white,
    shapes: [dot(L + 0.14, 7.875), hairline(L + 0.14, 7.875, 12.6, 7.875)],
    title: { x: 13.4, y: 6.275, w: 11.4, h: 3.2, valign: 'middle', size: 34, sample: 'Zweitens' },
    subtitle: { x: 13.45, y: 9.2, w: 11.3, h: 1, valign: 'top', sample: 'Was bleiben darf' },
  },
  {
    // The hairline under the title across the measure; the dot closes it top right.
    name: 'Inhalt',
    bg: white,
    shapes: [hairline(L, 4.55, R, 4.55), dot(R - 0.14, 3.6)],
    title: { x: L - 0.05, y: T, w: 19, h: 1.9, valign: 'bottom', size: 26 },
    body: {
      x: L,
      y: 5.5,
      w: 18.4,
      h: 7.9,
      sample: [
        'Ein Gedanke je Folie',
        'Der Rand ist Teil der Aussage',
        'Grau für alles, was begleitet',
        'Eine Linie ordnet, zwei erklären sich',
        'Am Ende zählt, was fehlt',
      ],
    },
  },
  {
    // Text and picture share the page's lower edge; the hairline marks it under the text.
    name: 'Text und Bild',
    bg: white,
    shapes: [hairline(L, B, 12.6, B), dot(L + 0.14, T + 0.2)],
    title: { x: L - 0.05, y: 3.3, w: 9.6, h: 2.6, valign: 'bottom', size: 26 },
    body: {
      x: L,
      y: 6.5,
      w: 9.4,
      h: 6.3,
      sample: ['Ein Bild', 'Ein Satz dazu', 'Sonst nichts'],
    },
    pictures: [{ x: 14.6, y: T, w: 10.2, h: B - T }],
  },
  {
    // Two columns, each hung from its own piece of the hairline.
    name: 'Zwei Spalten',
    bg: white,
    shapes: [hairline(L, 5.6, 13.2, 5.6), hairline(14.8, 5.6, R, 5.6), dot(14.94, 4.9)],
    title: {
      x: L - 0.05,
      y: T,
      w: 19,
      h: 1.9,
      valign: 'bottom',
      size: 26,
      sample: 'Vorher, nachher',
    },
    body: [
      {
        x: L,
        y: 6.3,
        w: 9.8,
        h: 7,
        sample: ['Sieben Schriften', 'Vier Farben', 'Kein Rand'],
      },
      {
        x: 14.8,
        y: 6.3,
        w: 9.8,
        h: 7,
        sample: ['Eine Schrift', 'Schwarz und Grau', 'Viel Rand'],
      },
    ],
  },
  {
    // The number large and thin on the left; a short hairline, then what it means, in grey.
    name: 'Kennzahl',
    bg: white,
    shapes: [hairline(L, 9.9, L + 2.4, 9.9), dot(R - 0.14, T + 0.2)],
    title: {
      x: L - 0.25,
      y: 3.6,
      w: 18,
      h: 5.9,
      valign: 'bottom',
      size: 150,
      spacing: -5,
      sample: '92 %',
    },
    body: {
      x: L,
      y: 10.4,
      w: 11,
      h: 3,
      color: grey,
      sample: 'der Fläche bleiben frei. Der Rest hat etwas zu sagen.',
    },
  },
  {
    // The quote hangs from a vertical hairline; the dot ends it.
    name: 'Zitat',
    bg: white,
    shapes: [hairline(6.4, 4.4, 6.4, 10.1), dot(6.4, 10.5)],
    body: {
      x: 7.4,
      y: 4.2,
      w: 15.2,
      h: 6.1,
      valign: 'middle',
      size: 30,
      lineHeight: 128,
      sample: 'Vollkommen ist, wovon man nichts mehr wegnehmen kann.',
    },
    subtitle: { x: 7.45, y: 10.9, w: 15, h: 1, valign: 'top', sample: 'Notiz aus dem Atelier' },
  },
  {
    // The picture between the margins, its caption small beneath, the dot far right.
    name: 'Bild',
    bg: white,
    shapes: [dot(R - 0.14, 13)],
    pictures: [{ x: L, y: T, w: R - L, h: 9.6 }],
    title: {
      x: L - 0.03,
      y: 12.4,
      w: 18,
      h: 1.2,
      valign: 'middle',
      size: 18,
      sample: 'Morgen am See',
    },
  },
  {
    // The title page turned round: the hairline above, the last word low, the dot after it all.
    name: 'Schluss',
    bg: white,
    shapes: [hairline(L, 3.65, R, 3.65), dot(R - 0.14, B - 0.25)],
    title: {
      x: L - 0.08,
      y: 8.1,
      w: 17,
      h: 3.6,
      valign: 'bottom',
      size: 46,
      sample: 'Danke.',
    },
    subtitle: { x: L, y: 12.1, w: 16, h: 1, valign: 'top', sample: 'Fragen sind willkommen' },
  },
];

const template: Template = {
  slug: 'minimal',
  name: 'Minimal',
  group: 'Schwarzweiß',
  tags: [
    'Schwarzweiß',
    'minimal',
    'ruhig',
    'reduziert',
    'Weißraum',
    'elegant',
    'Architektur',
    'Design',
  ],
  description:
    'Die leiseste Vorlage: Weiß, weite Ränder, kleine genaue Schrift, eine Haarlinie und ein Punkt.',
  palette: {
    bg: white,
    text: ink,
    bg2: '#f5f5f3',
    text2: grey,
    accents: ['#3a3a3a', '#5f5f5f', '#b3b3b3', '#dadada', '#c2573f', '#2f4b5c'],
  },
  fonts: { head: 'Manrope', body: 'Manrope' },
  text: {
    title: { font: 'Manrope', size: 30, color: ink, lineHeight: 112, spacing: -0.5 },
    subtitle: { font: 'Manrope', size: 18, color: grey },
    body: { font: 'Manrope', size: 18, color: ink, lineHeight: 140, paraSpace: 0.38 },
  },
  layouts,
  samplePictures: [quiet('dune'), quiet('water')],
};

export default template;
