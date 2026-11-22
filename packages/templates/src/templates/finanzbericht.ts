import type { Color, Layout, Shape, Slot, Template } from '../model';

/*
 * Finanzbericht: the pages of an annual report – deep green and warm grey on off-white, serif
 * headlines under a double rule as in a table of figures, and slender columns that rise.
 */

const green = '#103d2e';
const paper = '#f6f3ec';
const sand = '#ebe5d8';
const ink = '#1c2a24';
const grey = '#7d7568';
const stone = '#c9c0ae';
const brass = '#b08a4f';
const sage = '#7fa893';
const rust = '#9a4a35';
const pine = '#2a6b54';

const L = 1.5;
const R = 26.5;

const ln = (x1: number, y1: number, x2: number, y2: number, color: Color, width = 0.02): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: { color, width },
});

/** The rule over a table of figures: a strong line and a fine one under it. */
const doubleRule = (x: number, y: number, w: number, color: Color): Shape[] => [
  { t: 'rect', x, y, w, h: 0.09, fill: color },
  ln(x, y + 0.2, x + w, y + 0.2, color, 0.02),
];

/** Slender columns standing on a base line, the last one set apart. */
function bars(
  x: number,
  base: number,
  heights: readonly number[],
  width: number,
  pitch: number,
  fill: Color,
  last: Color,
  cap?: Color,
): Shape[] {
  return heights.flatMap((height, index): Shape[] => {
    const final = index === heights.length - 1;
    const box = { x: x + index * pitch, y: base - height, w: width, h: height };
    return [
      { t: 'rect', ...box, fill: final ? last : fill },
      ...(final && cap
        ? [{ t: 'rect', x: box.x, y: box.y - 0.2, w: width, h: 0.08, fill: cap } as Shape]
        : []),
    ];
  });
}

/** Heights of a long row of columns: growth with a dip or two, as real years have. */
const years = (count: number, low: number, high: number): number[] =>
  Array.from({ length: count }, (_, index) => {
    const share = index / (count - 1);
    const dip = [0, 0.12, -0.1, 0.05, -0.22, 0.1, 0, -0.08, 0.14, -0.3, 0.06][index % 11]!;
    return low + (high - low) * share ** 1.7 + dip * (0.4 + share * 1.6);
  });

/** The small mark of every page: five tiny columns on the footer's hairline. */
const mark = (color: Color, last: Color, line: Color): Shape[] => [
  ln(L, 14.4, R, 14.4, line, 0.02),
  ...bars(25.42, 14.4, [0.22, 0.34, 0.3, 0.48, 0.66], 0.1, 0.245, color, last),
];

const head = (x = L, w = R - L): Shape[] => doubleRule(x, 1.3, w, green);
const title: Slot = { x: L, y: 1.8, w: 22, h: 3.1, valign: 'top' };

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: paper,
    shapes: [
      ...doubleRule(L, 1.3, R - L, green),
      ln(L, 14.4, R, 14.4, green, 0.03),
      ...bars(L + 0.05, 14.4, years(21, 0.7, 7.4), 0.3, 1.233, stone, green, brass),
    ],
    title: {
      x: L,
      y: 2.1,
      w: 18,
      h: 5.2,
      size: 50,
      valign: 'top',
      lineHeight: 104,
      sample: 'Geschäftsbericht\n2026',
    },
    subtitle: {
      x: L,
      y: 7.6,
      w: 13,
      h: 2.2,
      sample: 'Nordhafen Holding AG\nBilanzpressekonferenz, 18. März 2027',
    },
  },
  {
    name: 'Abschnitt',
    bg: green,
    shapes: [
      ...Array.from({ length: 12 }, (_, index) =>
        ln(15.6, 1.5 + index * 1.08, R, 1.5 + index * 1.08, '#1f5340', 0.02),
      ),
      ...bars(17.2, 13.38, [2.1, 3.2, 2.8, 4.6, 5.5, 7.3, 9.6], 0.42, 1.38, pine, brass),
      ln(15.6, 13.38, R, 13.38, sage, 0.03),
      ...doubleRule(L, 9.6, 12.4, brass),
    ],
    title: {
      x: L,
      y: 3.6,
      w: 13,
      h: 5.6,
      size: 46,
      color: paper,
      valign: 'bottom',
      lineHeight: 106,
      sample: 'Ertragslage\nund Segmente',
    },
    subtitle: {
      x: L,
      y: 10.3,
      w: 12.4,
      h: 2.4,
      color: '#a9c4b6',
      sample: 'Wie sich Umsatz und Ergebnis im Berichtsjahr entwickelt haben',
    },
  },
  {
    name: 'Inhalt',
    bg: paper,
    shapes: [...head(), ...mark(stone, green, stone)],
    title: { ...title, sample: 'Das operative Ergebnis steigt im dritten Jahr in Folge' },
    body: {
      x: L,
      y: 5.4,
      w: 22.5,
      h: 8.4,
      sample: [
        'Umsatz wächst um 7,4 % auf 2,18 Mrd. Euro',
        'EBIT erreicht 196 Mio. Euro, die Marge 9,0 %',
        'Freier Cashflow deckt Dividende und Investitionen',
        'Nettoverschuldung sinkt auf das 1,6-Fache des EBITDA',
        'Eigenkapitalquote bei 41 % nach 38 % im Vorjahr',
        'Dividendenvorschlag: 1,45 Euro je Aktie',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: paper,
    shapes: [
      ...head(12.3, R - 12.3),
      ln(12.3, 14.4, R, 14.4, stone, 0.02),
      ...bars(25.42, 14.4, [0.22, 0.34, 0.3, 0.48, 0.66], 0.1, 0.245, stone, green),
    ],
    pictures: [{ x: 0, y: 0, w: 10.6, h: 15.75 }],
    title: {
      ...title,
      x: 12.3,
      w: 14.2,
      sample: 'Der neue Terminal Ost geht planmäßig in Betrieb',
    },
    body: {
      x: 12.3,
      y: 5.4,
      w: 14.2,
      h: 8.4,
      sample: [
        'Kapazität steigt um 1,1 Mio. Standardcontainer',
        'Investition von 310 Mio. Euro im Budget',
        'Volle Auslastung ab 2029 erwartet',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: paper,
    shapes: [
      ...head(),
      ...mark(stone, green, stone),
      { t: 'rect', x: L, y: 5.35, w: 11.8, h: 0.06, fill: green },
      { t: 'rect', x: 14.7, y: 5.35, w: 11.8, h: 0.06, fill: brass },
      ln(14.1, 5.35, 14.1, 13.7, stone, 0.02),
    ],
    title: { ...title, sample: 'Zwei Segmente tragen das Wachstum, eines bleibt zurück' },
    body: [
      {
        x: L,
        y: 5.9,
        w: 11.6,
        h: 7.8,
        sample: [
          'Logistik: Umsatz plus 11 %',
          'Marge erstmals zweistellig',
          'Auftragsbestand auf Rekordhöhe',
        ],
      },
      {
        x: 14.7,
        y: 5.9,
        w: 11.6,
        h: 7.8,
        sample: [
          'Hafenbetrieb: Umsatz plus 6 %',
          'Energiekosten belasten das Ergebnis',
          'Immobilien: Ertrag minus 3 %',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: sand,
    shapes: [
      ...Array.from({ length: 10 }, (_, index) =>
        ln(17.2, 2.4 + index * 1.2, R, 2.4 + index * 1.2, '#d8cfbd', 0.02),
      ),
      ...bars(17.75, 13.2, [2.3, 3.1, 2.7, 4.4, 6.2, 9.1], 0.62, 1.5, '#bdb29d', green, brass),
      ln(17.2, 13.2, R, 13.2, green, 0.04),
      ...doubleRule(L, 9.25, 14.2, green),
      ln(L, 14.4, 15.7, 14.4, stone, 0.02),
    ],
    title: {
      x: L,
      y: 2.2,
      w: 15,
      h: 6.8,
      size: 118,
      valign: 'bottom',
      lineHeight: 100,
      spacing: -1,
      sample: '9,0 %',
    },
    body: {
      x: L,
      y: 9.95,
      w: 13.6,
      h: 4,
      size: 22,
      lineHeight: 108,
      sample: 'EBIT-Marge im Geschäftsjahr 2026: der höchste Wert seit dem Börsengang',
    },
  },
  {
    name: 'Zitat',
    bg: paper,
    shapes: [
      ...doubleRule(5.6, 2.2, R - 5.6, green),
      {
        t: 'text',
        x: 1.3,
        y: 1.9,
        w: 4.4,
        h: 5,
        text: '“',
        font: 'Source Serif 4',
        size: 190,
        color: brass,
        valign: 'top',
        lineHeight: 100,
      },
      ln(5.6, 11.25, R, 11.25, green, 0.02),
      ...mark(stone, green, stone),
    ],
    body: {
      x: 5.6,
      y: 2.9,
      w: 19.6,
      h: 7.9,
      font: 'Source Serif 4',
      size: 30,
      italic: true,
      color: green,
      lineHeight: 128,
      valign: 'middle',
      sample: 'Wir investieren in den Jahren, in denen andere warten. Das zahlt sich jetzt aus.',
    },
    subtitle: {
      x: 5.6,
      y: 11.65,
      w: 19,
      h: 1.6,
      size: 16,
      upper: true,
      spacing: 1.4,
      sample: 'Dr. Henrike Albers, Vorsitzende des Vorstands',
    },
  },
  {
    name: 'Bild',
    bg: paper,
    shapes: [...doubleRule(L, 12.3, R - L, green), ...mark(stone, green, stone)],
    pictures: [{ x: L, y: 1.3, w: 25, h: 10.6 }],
    title: {
      x: L,
      y: 12.7,
      w: 22,
      h: 1.45,
      size: 22,
      valign: 'middle',
      sample: 'Terminal Ost, Blick auf die neue Kaimauer',
    },
  },
  {
    name: 'Schluss',
    bg: green,
    shapes: [
      ...doubleRule(L, 1.3, R - L, brass),
      ln(L, 14.4, R, 14.4, sage, 0.03),
      ...bars(L + 0.05, 14.4, years(21, 0.5, 5.6), 0.3, 1.233, pine, brass),
    ],
    title: {
      x: L,
      y: 2.1,
      w: 20,
      h: 3.2,
      size: 50,
      color: paper,
      valign: 'top',
      sample: 'Vielen Dank',
    },
    subtitle: {
      x: L,
      y: 5.4,
      w: 14,
      h: 2.4,
      color: '#a9c4b6',
      sample: 'Investor Relations\nir@nordhafen-beispiel.de',
    },
  },
];

const template: Template = {
  slug: 'finanzbericht',
  name: 'Finanzbericht',
  group: 'Bereich',
  tags: [
    'Finanzen',
    'Geschäftsbericht',
    'Bilanz',
    'Investoren',
    'seriös',
    'Grün',
    'Serifen',
    'Zahlen',
  ],
  description:
    'Wie ein Geschäftsbericht: Tiefgrün und warmes Grau auf gebrochenem Weiß, Serifen, feine Tabellenlinien und schlanke Säulen.',
  palette: {
    bg: paper,
    text: ink,
    bg2: sand,
    text2: grey,
    accents: [green, brass, sage, stone, rust, pine],
  },
  fonts: { head: 'Source Serif 4', body: 'Source Sans 3' },
  text: {
    title: { font: 'Source Serif 4', size: 30, color: green, lineHeight: 110 },
    subtitle: { font: 'Source Sans 3', size: 20, color: grey, lineHeight: 108 },
    body: { font: 'Source Sans 3', size: 20, color: ink, lineHeight: 104, paraSpace: 0.3 },
  },
  layouts,
};

export default template;
