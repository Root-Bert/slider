import { rng } from '../art';
import type { Box, Color, Layout, Shape, Slot, Template } from '../model';
import { columns } from '../shapes';

/*
 * Beratung: the consultant's page – a full-sentence message at the top left over a thin rule, a
 * footer zone under a hairline, and small squares that count: done, here, still to come. No
 * pictures as decoration, one signal colour.
 */

const navy = '#0b1f3f';
const signal = '#f2542d';
const white = '#ffffff';
const mist = '#eef1f6';
const slate = '#51607a';
const steel = '#2c4a7c';
const sky = '#8fa6c9';
const hair = '#c3cad6';
const teal = '#1f8a8a';
const sand = '#d9b66a';

const L = 1.5;
const R = 26.5;

const sq = (x: number, y: number, size: number, fill: Color): Shape => ({
  t: 'rect',
  x,
  y,
  w: size,
  h: size,
  fill,
});
const ln = (x1: number, y1: number, x2: number, y2: number, color: Color, width = 0.03): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: { color, width },
});

/** The tracker: squares in a row (or a column) – those done, the one we are at, those to come. */
function tracker(
  x: number,
  y: number,
  count: number,
  at: number,
  options: {
    size?: number;
    gap?: number;
    vertical?: boolean;
    done?: Color;
    todo?: Color;
    fromRight?: boolean;
  } = {},
): Shape[] {
  const size = options.size ?? 0.24;
  const pitch = size + (options.gap ?? 0.14);
  const start = options.fromRight ? x - (count * pitch - (pitch - size)) : x;
  return Array.from({ length: count }, (_, index) => {
    const fill =
      index < at ? (options.done ?? navy) : index === at ? signal : (options.todo ?? hair);
    return options.vertical
      ? sq(x, y + index * pitch, size, fill)
      : sq(start + index * pitch, y, size, fill);
  });
}

/** The head of a content page: the rule under the message, the tracker, the footer's hairline. */
const frame = (at: number): Shape[] => [
  ...tracker(R, 0.95, 9, at, { fromRight: true }),
  ln(L, 3.95, R, 3.95, navy, 0.03),
  { t: 'rect', x: L, y: 3.9, w: 1.7, h: 0.1, fill: signal },
  ln(L, 14.35, R, 14.35, hair, 0.02),
  sq(L, 14.72, 0.2, navy),
];

const message: Slot = { x: L, y: 1.45, w: 21.5, h: 2.25, valign: 'bottom' };

/** Columns of squares rising to the right: a chart built from the tracker's squares. */
function staircase(x: number, base: number, count: number, tall: number): Shape[] {
  const random = rng(7);
  const [size, pitch] = [0.42, 0.62];
  const shapes: Shape[] = [];
  for (let column = 0; column < count; column += 1) {
    const share = column / (count - 1);
    const height = Math.max(
      1,
      Math.round(1 + share ** 1.35 * (tall - 2) + random.range(-0.9, 1.1)),
    );
    for (let row = 0; row < height; row += 1) {
      const top = row === height - 1;
      const fill = top
        ? column === count - 1
          ? signal
          : sky
        : row % 5 === 4
          ? '#254272'
          : '#1a3260';
      shapes.push(sq(x + column * pitch, base - (row + 1) * pitch, size, fill));
    }
  }
  return shapes;
}

/** A band of squares, a few of them lit: a field of data at rest. */
function band(x: number, y: number, across: number, down: number): Shape[] {
  const random = rng(21);
  const [size, pitch] = [0.42, 0.62];
  const shapes: Shape[] = [];
  for (let row = 0; row < down; row += 1) {
    for (let column = 0; column < across; column += 1) {
      const roll = random();
      const fill = roll > 0.965 ? signal : roll > 0.86 ? sky : roll > 0.55 ? '#254272' : '#1a3260';
      shapes.push(sq(x + column * pitch, y + row * pitch, size, fill));
    }
  }
  return shapes;
}

/** A column's head: as many squares as its place in the row, over its rule. */
const columnHead = (box: Box, index: number): Shape[] => [
  ...Array.from({ length: index + 1 }, (_, i) =>
    sq(box.x + i * 0.4, box.y, 0.26, i === index ? signal : navy),
  ),
  ln(box.x, box.y + 0.62, box.x + box.w, box.y + 0.62, navy, 0.03),
];

const columnSamples = [
  [
    'Markt wächst um 6 % pro Jahr',
    'Zwei neue Wettbewerber seit 2024',
    'Preise bleiben unter Druck',
  ],
  ['Eigenmarke trägt 31 % der Marge', 'Lieferzeiten halbiert', 'Service als Abgrenzung'],
  ['Sortiment straffen', 'Onlinekanal ausbauen', 'Einkauf bündeln'],
];

function columnLayout(name: string, count: number, at: number, title: string): Layout {
  const boxes = columns({ x: L, y: 4.75, w: R - L, h: 8.9 }, count, count === 2 ? 1.4 : 1);
  return {
    name,
    bg: white,
    shapes: [...frame(at), ...boxes.flatMap(columnHead)],
    title: { ...message, sample: title },
    body: boxes.map((box, index) => ({
      x: box.x,
      y: box.y + 1.05,
      w: box.w,
      h: box.h - 1.05,
      size: count === 2 ? 20 : 18,
      sample: columnSamples[(index + 3 - count) % 3]!,
    })),
  };
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: navy,
    shapes: [
      ...tracker(L, 1.5, 9, 0, { done: white, todo: steel }),
      ...staircase(17.3, 13.45, 15, 15),
      ln(L, 10.55, 15.6, 10.55, sky, 0.03),
      { t: 'rect', x: L, y: 10.5, w: 1.7, h: 0.1, fill: signal },
      ln(L, 14.35, R, 14.35, steel, 0.02),
    ],
    title: {
      x: L,
      y: 4.2,
      w: 15,
      h: 6,
      size: 40,
      color: white,
      valign: 'bottom',
      lineHeight: 106,
      sample: 'Wachstumsstrategie\n2027 bis 2030',
    },
    subtitle: {
      x: L,
      y: 11,
      w: 14,
      h: 2.4,
      color: sky,
      sample: 'Abschlusspräsentation für den Vorstand\nHamburg, 12. März 2027',
    },
  },
  {
    name: 'Abschnitt',
    bg: white,
    shapes: [
      { t: 'rect', x: 0, y: 0, w: 8.4, h: 15.75, fill: navy },
      ...tracker(3.85, 3.2, 9, 2, {
        size: 0.7,
        gap: 0.37,
        vertical: true,
        done: white,
        todo: steel,
      }),
      ln(10.4, 9.25, R, 9.25, navy, 0.03),
      { t: 'rect', x: 10.4, y: 9.2, w: 1.7, h: 0.1, fill: signal },
      ln(10.4, 14.35, R, 14.35, hair, 0.02),
    ],
    title: {
      x: 10.4,
      y: 3.2,
      w: 16,
      h: 5.7,
      size: 44,
      valign: 'bottom',
      lineHeight: 106,
      sample: 'Wo wir heute\nGeld verlieren',
    },
    subtitle: {
      x: 10.4,
      y: 9.7,
      w: 16,
      h: 2.4,
      sample: 'Befunde aus 42 Interviews und der Analyse von drei Geschäftsjahren',
    },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: frame(3),
    title: {
      ...message,
      sample:
        'Der Onlinekanal wächst doppelt so schnell wie der Markt und trägt 2030 ein Drittel bei',
    },
    body: {
      x: L,
      y: 4.7,
      w: 23.5,
      h: 9,
      sample: [
        'Umsatz online seit 2023 um 18 % pro Jahr gestiegen, Markt um 9 %',
        'Jede zweite Neukundin kommt über die App',
        'Retourenquote sinkt mit jedem Kauf, ab dem dritten unter 12 %',
        'Filialen bleiben wichtig: 40 % holen ihre Bestellung dort ab',
        'Engpass ist die Logistik, nicht die Nachfrage',
        'Empfehlung: Lager Süd bis Ende 2028 in Betrieb nehmen',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [...frame(4), sq(14.55, 13.1, 0.26, signal)],
    title: {
      ...message,
      sample: 'Das neue Lager Süd halbiert die Lieferzeit für mehr als die Hälfte der Kundschaft',
    },
    body: {
      x: L,
      y: 4.7,
      w: 12,
      h: 9,
      sample: [
        'Standort an der A 8, 14 Hektar',
        'Lieferung am nächsten Tag bis Wien und Zürich',
        'Investition 48 Mio. Euro, Rückfluss nach sechs Jahren',
      ],
    },
    pictures: [{ x: 14.55, y: 4.7, w: 11.95, h: 8.2 }],
  },
  columnLayout(
    'Zwei Spalten',
    2,
    5,
    'Der Markt wächst, doch die Marge entsteht an anderer Stelle als bisher',
  ),
  {
    name: 'Kennzahl',
    // Navy beneath, so that bullets in the panel come out light.
    bg: navy,
    shapes: [
      { t: 'rect', x: 0, y: 0, w: 16.6, h: 15.75, fill: white },
      ...tracker(L, 1.5, 9, 6),
      { t: 'rect', x: L, y: 10.3, w: 1.7, h: 0.1, fill: signal },
      ln(L, 10.35, 15.1, 10.35, navy, 0.03),
      ...tracker(L, 10.95, 22, 14, { size: 0.42, gap: 0.2, todo: mist }),
      ln(L, 14.35, 15.1, 14.35, hair, 0.02),
      ln(18.1, 14.35, R, 14.35, steel, 0.02),
      sq(18.1, 3.4, 0.42, signal),
    ],
    title: {
      x: L,
      y: 3.4,
      w: 14.6,
      h: 6.6,
      size: 124,
      valign: 'bottom',
      lineHeight: 100,
      spacing: -2,
      sample: '+38 %',
    },
    body: {
      x: 18.1,
      y: 4.4,
      w: 8.4,
      h: 9.2,
      size: 24,
      color: white,
      lineHeight: 110,
      sample: 'mehr Deckungsbeitrag je Bestellung, sobald Kundinnen die App nutzen',
    },
  },
  {
    name: 'Zitat',
    bg: mist,
    shapes: [
      { t: 'rect', x: L, y: 1.5, w: 2.6, h: 2.6, fill: signal },
      { t: 'rect', x: 2.2, y: 2.25, w: 0.5, h: 1.1, fill: white },
      { t: 'rect', x: 2.9, y: 2.25, w: 0.5, h: 1.1, fill: white },
      {
        t: 'poly',
        fill: white,
        pts: [
          [2.2, 3.35],
          [2.7, 3.35],
          [2.2, 3.75],
        ],
      },
      {
        t: 'poly',
        fill: white,
        pts: [
          [2.9, 3.35],
          [3.4, 3.35],
          [2.9, 3.75],
        ],
      },
      ln(5.6, 10.85, R, 10.85, navy, 0.03),
      { t: 'rect', x: 5.6, y: 10.8, w: 1.7, h: 0.1, fill: signal },
      ...tracker(R, 14.72, 9, 7, { fromRight: true }),
      ln(L, 14.35, R, 14.35, hair, 0.02),
    ],
    body: {
      x: 5.6,
      y: 1.3,
      w: 20.4,
      h: 9,
      size: 32,
      bold: true,
      lineHeight: 108,
      valign: 'middle',
      sample: 'Wir haben nicht zu wenige Ideen. Wir haben zu viele Projekte, die niemand beendet.',
    },
    subtitle: {
      x: 5.6,
      y: 11.25,
      w: 20,
      h: 1.8,
      sample: 'Leiterin Produktion, Interview im Januar 2027',
    },
  },
  {
    name: 'Bild',
    bg: white,
    shapes: [
      ln(L, 12.75, R, 12.75, navy, 0.03),
      { t: 'rect', x: L, y: 12.7, w: 1.7, h: 0.1, fill: signal },
      ...tracker(R, 13.45, 9, 8, { fromRight: true }),
      ln(L, 14.35, R, 14.35, hair, 0.02),
      sq(L, 14.72, 0.2, navy),
    ],
    pictures: [{ x: L, y: 1.5, w: 25, h: 10.75 }],
    title: {
      x: L,
      y: 12.9,
      w: 20,
      h: 1.3,
      size: 20,
      valign: 'middle',
      sample: 'Lager Süd: Baufortschritt im Februar 2027',
    },
  },
  {
    name: 'Schluss',
    bg: navy,
    shapes: [
      ...tracker(L, 1.5, 9, 8, { done: white, todo: steel }),
      ln(L, 7.75, 15.6, 7.75, sky, 0.03),
      { t: 'rect', x: L, y: 7.7, w: 1.7, h: 0.1, fill: signal },
      ...band(L, 11.3, 41, 4),
    ],
    title: {
      x: L,
      y: 2.6,
      w: 20,
      h: 4.8,
      size: 48,
      color: white,
      valign: 'bottom',
      lineHeight: 106,
      sample: 'Die nächsten 100 Tage\nentscheiden',
    },
    subtitle: {
      x: L,
      y: 8.2,
      w: 18,
      h: 2.4,
      color: sky,
      sample: 'Dr. Miriam Köster, Partnerin\nmiriam.koester@beispiel.de',
    },
  },
  columnLayout(
    'Drei Spalten',
    3,
    5,
    'Drei Hebel sichern das Ergebnis: Sortiment, Onlinekanal und Einkauf',
  ),
];

const template: Template = {
  slug: 'beratung',
  name: 'Beratung',
  group: 'Bereich',
  tags: [
    'Beratung',
    'Strategie',
    'Management',
    'sachlich',
    'Navy',
    'Analyse',
    'Vorstand',
    'Bericht',
  ],
  description:
    'Die Seite der Beratung: eine Aussage als ganzer Satz oben links, feine Linien, Tiefblau und eine Signalfarbe.',
  palette: {
    bg: white,
    text: navy,
    bg2: mist,
    text2: slate,
    accents: [signal, steel, sky, teal, sand, hair],
  },
  fonts: { head: 'Public Sans', body: 'Source Sans 3' },
  text: {
    title: { font: 'Public Sans', size: 26, color: navy, bold: true, lineHeight: 110 },
    subtitle: { font: 'Source Sans 3', size: 20, color: slate, lineHeight: 108 },
    body: { font: 'Source Sans 3', size: 20, color: navy, lineHeight: 106, paraSpace: 0.3 },
  },
  layouts,
};

export default template;
