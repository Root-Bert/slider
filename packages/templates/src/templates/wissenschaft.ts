import type { Box, Color, FillLike, Layout, Shape, Slot, Stroke, Template } from '../model';
import { disc, ring, smoothPath } from '../shapes';

/*
 * Wissenschaft: an academic talk – sober pages with a slim wine-red stripe at the left, serif
 * headings, and the drawing tools of a paper as ornament: axes with their ticks, a dotted grid,
 * a curve through measured points. Figures get an axis at their side and room for a caption.
 */

const wine = '#7a1f33';
const ground = '#f3f3ef';
const white = '#ffffff';
const ink = '#1e2328';
const slate = '#5a626b';
const fog = '#e4e5e0';
const blue = '#27496d';
const ochre = '#c48a2c';
const sage = '#6f8f7b';
const line = '#a9aeb2';
const teal = '#2c6e73';

const L = 1.7;
const R = 26.5;

const ln = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Color,
  width = 0.025,
): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: { color, width },
});

/** The stripe every page carries at its left edge. */
const stripe = (color: Color = wine): Shape => ({
  t: 'rect',
  x: 0,
  y: 0,
  w: 0.34,
  h: 15.75,
  fill: color,
});

/** An axis: a line with a tick every `step`, every fifth a little longer. `side` is where they point. */
function axis(
  x: number,
  y: number,
  length: number,
  options: { vertical?: boolean; step?: number; color?: Color; side?: 1 | -1; width?: number } = {},
): Shape[] {
  const { vertical = false, step = 0.5, color = ink, side = 1, width = 0.03 } = options;
  const shapes: Shape[] = [
    vertical ? ln(x, y, x, y + length, color, width) : ln(x, y, x + length, y, color, width),
  ];
  const count = Math.round(length / step);
  for (let index = 0; index <= count; index += 1) {
    const at = index * step;
    const reach = (index % 5 === 0 ? 0.22 : 0.11) * side;
    shapes.push(
      vertical
        ? ln(x, y + length - at, x + reach, y + length - at, color, 0.02)
        : ln(x + at, y, x + at, y + reach, color, 0.02),
    );
  }
  return shapes;
}

/** A dotted grid: rows of dots `step` apart. */
function dotGrid(box: Box, step: number, color: Color, size = 0.06): Shape[] {
  const shapes: Shape[] = [];
  for (let y = box.y; y <= box.y + box.h + 0.001; y += step) {
    shapes.push({
      t: 'line',
      x1: box.x,
      y1: y,
      x2: box.x + box.w + 0.02,
      y2: y,
      stroke: { color, width: size, dash: [0.01, step - 0.01], cap: 'round' },
    });
  }
  return shapes;
}

/** A curve through page points (centimetres), smooth, as a line or a filled area. */
const curve = (
  points: readonly (readonly [number, number])[],
  stroke: Stroke | null,
  fill: FillLike = null,
  closed = false,
): Shape => ({
  t: 'path',
  x: 0,
  y: 0,
  w: 28,
  h: 15.75,
  vb: [2800, 1575],
  d: `${smoothPath(
    points.map(([x, y]) => [x * 100, y * 100] as const),
    false,
  )}${closed ? ' Z' : ''}`,
  fill,
  stroke,
});

const sample = (from: number, to: number, steps: number, f: (x: number) => number) =>
  Array.from({ length: steps + 1 }, (_, index): [number, number] => {
    const x = from + ((to - from) * index) / steps;
    return [x, f(x)];
  });

const bell = (centre: number, sigma: number, height: number, base: number) => (x: number) =>
  base - height * Math.exp(-((x - centre) ** 2) / (2 * sigma ** 2));

/** The head of a content page: the title's axis and the footer's hairline. */
const frame = (): Shape[] => [
  stripe(),
  ...axis(L, 4.2, R - L, { color: ink }),
  ln(L, 14.35, R, 14.35, line, 0.02),
  { t: 'rect', x: L, y: 14.35, w: 1.2, h: 0.06, fill: wine },
];

const title: Slot = { x: L, y: 1.1, w: 22.5, h: 2.85, valign: 'bottom' };

/** The plot of the title page: two distributions over a dotted grid, and what was measured. */
function plot(): Shape[] {
  const [x0, x1, top, base] = [15.4, 26.5, 2.4, 11.4];
  const first = bell(19.2, 1.25, 6.6, base);
  const second = bell(22.6, 1.7, 4.4, base);
  const marks = [16.2, 17.3, 18.1, 18.8, 19.4, 20, 20.7, 21.6, 22.5, 23.4, 24.3, 25.4];
  const off = [0.25, -0.3, 0.35, -0.2, 0.3, -0.35, 0.2, 0.4, -0.25, 0.3, -0.2, 0.15];
  return [
    ...dotGrid({ x: x0 + 0.5, y: top + 0.5, w: x1 - x0 - 0.5, h: base - top - 1 }, 0.5, line, 0.05),
    curve(
      [[16, base], ...sample(16, 22.4, 26, first), [22.4, base]],
      null,
      { t: 'solid', color: wine, opacity: 0.1 },
      true,
    ),
    curve(sample(x0, x1, 40, second), { color: blue, width: 0.05, dash: [0.22, 0.14] }),
    curve(sample(x0, x1, 44, first), { color: wine, width: 0.07, cap: 'round', join: 'round' }),
    ...marks.map((x, index) =>
      ring(x, Math.min(base - 0.3, first(x) + off[index]!), 0.11, { color: ink, width: 0.025 }),
    ),
    ln(19.2, first(19.2), 19.2, base, wine, 0.02),
    ...axis(x0, base, x1 - x0, { color: ink }),
    ...axis(x0, top, base - top, { vertical: true, side: -1, color: ink }),
  ];
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: ground,
    shapes: [
      stripe(),
      ...plot(),
      { t: 'rect', x: L, y: 9.2, w: 1.2, h: 0.06, fill: wine },
      ln(L, 14.35, R, 14.35, line, 0.02),
    ],
    title: {
      x: L,
      y: 2.4,
      w: 12.6,
      h: 6.4,
      size: 32,
      valign: 'bottom',
      lineHeight: 106,
      sample: 'Bodenfeuchte und Ertrag von Winterweizen bei früher Trockenheit',
    },
    subtitle: {
      x: L,
      y: 9.7,
      w: 12.6,
      h: 3.4,
      sample:
        'Dr. Katharina Voss, Institut für Pflanzenbau\nJahrestagung, Göttingen, 4. Oktober 2027',
    },
  },
  {
    name: 'Abschnitt',
    bg: wine,
    shapes: [
      ...dotGrid({ x: 14, y: 1.6, w: 12.5, h: 6.5 }, 0.5, '#b06a79', 0.05),
      ...axis(L, 9.6, R - L, { color: white }),
      ln(19, 3.2, 19, 9.6, white, 0.02),
      disc(19, 9.6, 0.24, ochre),
      curve(
        sample(14, 26.5, 30, (x) => 9.3 - 5.6 / (1 + Math.exp(-(x - 19) * 0.9))),
        { color: '#e3c3ca', width: 0.05 },
      ),
    ],
    title: {
      x: L,
      y: 3,
      w: 12,
      h: 6.1,
      size: 42,
      color: white,
      valign: 'bottom',
      lineHeight: 112,
      sample: 'Material\nund Methoden',
    },
    subtitle: {
      x: L,
      y: 10.4,
      w: 14,
      h: 2.6,
      color: '#ecd5da',
      sample: 'Feldversuch an drei Standorten, 2023 bis 2026',
    },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: frame(),
    title: { ...title, sample: 'Frühe Trockenheit senkt den Ertrag stärker als späte' },
    body: {
      x: L,
      y: 4.9,
      w: 23,
      h: 8.9,
      sample: [
        'Drei Standorte, vier Jahre, 144 Parzellen',
        'Trockenstress im Schossen: Ertrag minus 23 %',
        'Trockenstress in der Kornfüllung: minus 9 %',
        'Effekt bleibt nach Kontrolle der Bodenart bestehen',
        'Sorten mit tiefer Wurzel verlieren halb so viel',
        'Bewässerung im Schossen gleicht den Verlust fast aus',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [
      ...frame(),
      ...axis(14.6, 4.9, 7.6, { vertical: true, side: -1, step: 0.4 }),
      ...axis(14.6, 12.5, 11.9, { step: 0.4 }),
      { t: 'rect', x: 14.9, y: 13.2, w: 0.7, h: 0.06, fill: wine },
    ],
    title: { ...title, sample: 'Der Bodenwassergehalt erklärt zwei Drittel der Streuung' },
    body: {
      x: L,
      y: 4.9,
      w: 11.6,
      h: 8.9,
      sample: [
        'Messung in 30 und 60 cm Tiefe',
        'Lineares Modell, R² = 0,67',
        'Residuen ohne erkennbare Struktur',
      ],
    },
    pictures: [{ x: 14.9, y: 4.9, w: 11.6, h: 7.3 }],
  },
  {
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      ...frame(),
      {
        t: 'line',
        x1: 14.1,
        y1: 5,
        x2: 14.1,
        y2: 13.6,
        stroke: { color: slate, width: 0.06, dash: [0.01, 0.29], cap: 'round' },
      },
      disc(L + 0.14, 5.2, 0.14, wine),
      ring(15.14, 5.2, 0.13, { color: wine, width: 0.04 }),
    ],
    title: { ...title, sample: 'Zwei Hypothesen erklären den Befund unterschiedlich gut' },
    body: [
      {
        x: L,
        y: 5.8,
        w: 11.4,
        h: 7.9,
        sample: [
          'H1: Wassermangel begrenzt die Kornzahl',
          'Gestützt durch alle drei Standorte',
          'Effektstärke d = 0,8',
        ],
      },
      {
        x: 15,
        y: 5.8,
        w: 11.4,
        h: 7.9,
        sample: [
          'H2: Hitze verkürzt die Kornfüllung',
          'Nur am Standort Süd nachweisbar',
          'Effektstärke d = 0,3',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: ground,
    shapes: [
      stripe(),
      ...dotGrid({ x: 16.5, y: 2, w: 10, h: 7 }, 0.5, line, 0.05),
      curve(
        [[16.6, 9.6], ...sample(16.6, 26.4, 30, bell(21.5, 1.5, 6.4, 9.6)), [26.4, 9.6]],
        null,
        { t: 'solid', color: wine, opacity: 0.12 },
        true,
      ),
      curve(sample(16.6, 26.4, 36, bell(21.5, 1.5, 6.4, 9.6)), { color: wine, width: 0.06 }),
      {
        t: 'line',
        x1: 21.5,
        y1: 3.2,
        x2: 21.5,
        y2: 9.6,
        stroke: { color: ink, width: 0.025, dash: [0.14, 0.12] },
      },
      ...axis(L, 9.6, R - L, { color: ink }),
      { t: 'rect', x: 19.7, y: 9.56, w: 3.6, h: 0.09, fill: wine },
      ln(19.7, 9.38, 19.7, 9.82, wine, 0.06),
      ln(23.3, 9.38, 23.3, 9.82, wine, 0.06),
      disc(21.5, 9.6, 0.24, wine),
      ln(L, 14.35, R, 14.35, line, 0.02),
    ],
    title: {
      x: L,
      y: 2.2,
      w: 14.6,
      h: 6.9,
      size: 112,
      color: wine,
      valign: 'bottom',
      lineHeight: 100,
      sample: '−23 %',
    },
    body: {
      x: L,
      y: 10.5,
      w: 16,
      h: 3.5,
      sample:
        'Kornertrag bei Trockenstress im Schossen\n95-%-Konfidenzintervall: −27 bis −19 %, n = 144',
    },
  },
  {
    name: 'Zitat',
    bg: ground,
    shapes: [
      stripe(),
      {
        t: 'text',
        x: 1.5,
        y: 1.75,
        w: 3.4,
        h: 4,
        text: '“',
        font: 'Literata',
        size: 150,
        color: wine,
        valign: 'top',
        lineHeight: 100,
      },
      ...axis(5, 10.7, 12, { color: ink }),
      ...dotGrid({ x: 20.5, y: 11.4, w: 6, h: 2.5 }, 0.5, line, 0.05),
      ln(L, 14.35, R, 14.35, line, 0.02),
    ],
    body: {
      x: 5,
      y: 2,
      w: 20.5,
      h: 8.2,
      font: 'Literata',
      size: 30,
      italic: true,
      lineHeight: 130,
      valign: 'middle',
      sample:
        'Ein Experiment ist eine Frage an die Natur. Die Kunst liegt darin, sie so zu stellen, dass die Antwort eindeutig ausfällt.',
    },
    subtitle: {
      x: 5,
      y: 11.3,
      w: 15,
      h: 1.8,
      sample: 'Einführungsvorlesung, Wintersemester 2026',
    },
  },
  {
    name: 'Bild',
    bg: white,
    shapes: [
      stripe(),
      ...axis(2.5, 1.3, 10.2, { vertical: true, side: -1 }),
      ...axis(2.5, 11.8, 24, {}),
      { t: 'rect', x: 2.8, y: 12.65, w: 1.2, h: 0.06, fill: wine },
      ln(L, 14.35, R, 14.35, line, 0.02),
    ],
    pictures: [{ x: 2.8, y: 1.3, w: 23.7, h: 10.2 }],
    title: {
      x: 2.8,
      y: 12.8,
      w: 23,
      h: 1.4,
      font: 'IBM Plex Sans',
      size: 18,
      color: slate,
      valign: 'middle',
      sample: 'Abb. 3: Versuchsfeld Reinshof nach vier Wochen ohne Regen',
    },
  },
  {
    name: 'Schluss',
    bg: ground,
    shapes: [
      stripe(),
      ...dotGrid({ x: L + 0.5, y: 9.4, w: R - L - 0.5, h: 4 }, 0.5, line, 0.05),
      ...axis(L, 11.4, R - L, { color: ink }),
      curve(
        sample(L, R, 90, (x) => 11.4 - 2.3 * Math.exp(-(x - L) * 0.17) * Math.cos((x - L) * 1.25)),
        { color: wine, width: 0.07, cap: 'round', join: 'round' },
      ),
      { t: 'rect', x: L, y: 5.5, w: 1.2, h: 0.06, fill: wine },
    ],
    title: {
      x: L,
      y: 1.6,
      w: 20,
      h: 3.6,
      size: 44,
      valign: 'bottom',
      sample: 'Vielen Dank',
    },
    subtitle: {
      x: L,
      y: 5.9,
      w: 16,
      h: 2.4,
      sample: 'Fragen und Diskussion\nkatharina.voss@uni-beispiel.de',
    },
  },
];

const template: Template = {
  slug: 'wissenschaft',
  name: 'Wissenschaft',
  group: 'Bereich',
  tags: [
    'Wissenschaft',
    'Forschung',
    'Vortrag',
    'Universität',
    'Tagung',
    'sachlich',
    'Serifen',
    'Abbildung',
  ],
  description:
    'Für den Vortrag auf der Tagung: nüchterne Seiten mit weinrotem Streifen, Serifen in den Titeln, Achsen und Punktraster als Ornament.',
  palette: {
    bg: white,
    text: ink,
    bg2: fog,
    text2: slate,
    accents: [wine, blue, ochre, sage, teal, line],
  },
  fonts: { head: 'Literata', body: 'IBM Plex Sans' },
  text: {
    title: { font: 'Literata', size: 28, color: ink, lineHeight: 114 },
    subtitle: { font: 'IBM Plex Sans', size: 18, color: slate, lineHeight: 130 },
    body: { font: 'IBM Plex Sans', size: 20, color: ink, lineHeight: 122, paraSpace: 0.32 },
  },
  layouts,
};

export default template;
