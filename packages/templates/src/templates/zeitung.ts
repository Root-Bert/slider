import { jpeg, paint, paper, rng } from '../art';
import type { Box, Color, Layout, Picture, Shape, Template } from '../model';
import { page, rule } from '../shapes';

/*
 * Zeitung: a serious broadsheet – newsprint, a masthead's rules (thick over thin), column rules,
 * headlines in a bookish serif, black ink and one deep red. What looks like small print is
 * drawn as rules: decoration says nothing.
 */

const newsprint = '#efe9db';
const ink = '#1b1a18';
const red = '#8c1c13';
const shade = '#e2dac8';
const grey = '#5c574e';
const lead = '#aaa291';

const serif = 'Libre Baskerville';
const sans = 'Libre Franklin';

const L = 1.6;
const R = 26.4;
const W = R - L;

const ground: Shape = {
  t: 'image',
  ...page,
  src: paper(newsprint, { clouds: 0.045, grain: 0.07, seed: 21 }),
};

/** A masthead rule: thick over thin, or thin over thick. */
const double = (y: number, x = L, w = W, thickFirst = true, color: Color = ink): Shape[] => [
  { t: 'rect', x, y: thickFirst ? y : y + 0.14, w, h: 0.12, fill: color },
  rule(x, thickFirst ? y + 0.22 : y, w, color, 0.03),
];

const thin = (y: number, x = L, w = W) => rule(x, y, w, ink, 0.03);
const column = (x: number, y: number, h: number) => rule(x, y, h, ink, 0.03, true);

/** Small print as it looks from afar: lines of lead, the last one short. */
function greek(box: Box, seed: number, color: Color = lead): Shape[] {
  const random = rng(seed);
  const count = Math.floor(box.h / 0.34) + 1;
  return Array.from({ length: count }, (_, index): Shape => {
    const last = index === count - 1;
    const short = !last && random() < 0.16;
    return {
      t: 'rect',
      x: box.x,
      y: box.y + index * 0.34,
      w: box.w * (last ? random.range(0.35, 0.7) : short ? random.range(0.82, 0.95) : 1),
      h: 0.12,
      fill: color,
    };
  });
}

/** A lozenge, the printer's flower between two rules. */
const lozenge = (cx: number, cy: number, r: number, fill: Color): Shape => ({
  t: 'poly',
  fill,
  pts: [
    [cx, cy - r],
    [cx + r * 0.72, cy],
    [cx, cy + r],
    [cx - r * 0.72, cy],
  ],
});

/** The row under a masthead where the date would stand: rules only. */
const dateline = (y: number): Shape[] => [
  { t: 'rect', x: L, y: y - 0.06, w: 3.4, h: 0.12, fill: ink },
  { t: 'rect', x: L + 3.7, y: y - 0.06, w: 1.2, h: 0.12, fill: lead },
  lozenge(13.3, y, 0.2, ink),
  lozenge(14, y, 0.26, red),
  lozenge(14.7, y, 0.2, ink),
  { t: 'rect', x: R - 4.9, y: y - 0.06, w: 1.2, h: 0.12, fill: lead },
  { t: 'rect', x: R - 3.4, y: y - 0.06, w: 3.4, h: 0.12, fill: ink },
];

/**
 * A press photo for the preview: roofs before a pale sky, printed as a newspaper prints – a
 * coarse dot screen in black on the paper.
 */
function pressPhoto(seed: number): Picture {
  const size = { w: 16, h: 10 };
  const tone = paint(size, 20);
  const random = rng(seed * 31 + 5);
  {
    const { ctx, w, h } = tone;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#8d8d8d');
    sky.addColorStop(0.75, '#e6e6e6');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f6f6f6';
    ctx.beginPath();
    ctx.arc(w * random.range(0.2, 0.8), h * 0.3, h * 0.11, 0, Math.PI * 2);
    ctx.fill();
    for (const [base, dark] of [
      [0.5, 150],
      [0.62, 95],
      [0.76, 40],
    ] as const) {
      for (let x = -10; x < w;) {
        const width = random.range(w * 0.035, w * 0.1);
        const height = h * random.range(0.08, 0.32);
        const value = dark + random.range(-16, 16);
        ctx.fillStyle = `rgb(${value},${value},${value})`;
        ctx.fillRect(x, h * base - height + h * 0.2, width, h);
        if (random() < 0.3) {
          ctx.beginPath();
          ctx.moveTo(x, h * base - height + h * 0.2);
          ctx.lineTo(x + width / 2, h * base - height + h * 0.2 - width * 0.5);
          ctx.lineTo(x + width, h * base - height + h * 0.2);
          ctx.fill();
        }
        x += width + random.range(0, 3);
      }
    }
  }
  const data = tone.ctx.getImageData(0, 0, tone.w, tone.h).data;
  const dark = (u: number, v: number) => {
    const x = Math.min(tone.w - 1, Math.max(0, Math.round(u * tone.w)));
    const y = Math.min(tone.h - 1, Math.max(0, Math.round(v * tone.h)));
    return 1 - data[(y * tone.w + x) * 4]! / 255;
  };
  const print = paint(size, 80);
  const { ctx, w, h } = print;
  ctx.fillStyle = '#e9e3d4';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ink;
  const cell = 9;
  const reach = Math.ceil(Math.hypot(w, h) / cell);
  for (let row = -reach; row <= reach; row += 1) {
    for (let col = -reach; col <= reach; col += 1) {
      const x = w / 2 + ((col - row) * cell) / Math.SQRT2;
      const y = h / 2 + ((col + row) * cell) / Math.SQRT2;
      if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
      const amount = Math.min(1, dark(x / w, y / h) * 1.05);
      if (amount < 0.03) continue;
      ctx.beginPath();
      ctx.arc(x, y, cell * Math.sqrt(amount / Math.PI) * 1.05, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return jpeg(print, 82);
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: newsprint,
    shapes: [
      ground,
      ...double(1.1),
      ...dateline(1.85),
      thin(2.35),
      ...double(9.55, L, W, false),
      thin(11.75),
      ...[0, 1, 2, 3, 4].flatMap((index) => {
        const x = L + index * 5.08;
        return [
          ...(index === 2
            ? [
                {
                  t: 'rect',
                  x,
                  y: 12.15,
                  w: 4.48,
                  h: 2.16,
                  fill: { t: 'hatch', color: grey, distance: 0.09, angle: 45 },
                  stroke: { color: ink, width: 0.03 },
                } satisfies Shape,
              ]
            : greek({ x, y: 12.15, w: 4.48, h: 2.1 }, 40 + index)),
          ...(index > 0 ? [column(x - 0.3, 12.1, 2.3)] : []),
        ];
      }),
      { t: 'rect', x: L, y: 14.65, w: W, h: 0.12, fill: ink },
    ],
    title: {
      x: 2.2,
      y: 2.7,
      w: 23.6,
      h: 6.6,
      align: 'center',
      valign: 'middle',
      sample: 'Stadtrat beschließt\nden großen Umbau',
    },
    subtitle: {
      x: 4,
      y: 10.05,
      w: 20,
      h: 1.5,
      align: 'center',
      valign: 'middle',
      sample: 'Was sich ab Montag für alle ändert',
    },
  },
  {
    name: 'Abschnitt',
    bg: newsprint,
    shapes: [
      ground,
      ...double(1.1),
      thin(3.75),
      thin(3.95),
      { t: 'rect', x: 0, y: 4.25, w: 28, h: 6.1, fill: ink },
      { t: 'rect', x: 0, y: 4.25, w: 1, h: 6.1, fill: red },
      thin(10.65),
      thin(10.85),
      lozenge(14, 2.45, 0.3, red),
      rule(L, 2.45, 11.6, ink, 0.03),
      rule(14.8, 2.45, 11.6, ink, 0.03),
      { t: 'rect', x: L, y: 14.65, w: W, h: 0.12, fill: ink },
    ],
    title: {
      x: 2.6,
      y: 4.5,
      w: 22.8,
      h: 5.6,
      align: 'center',
      valign: 'middle',
      size: 46,
      color: newsprint,
      sample: 'Wirtschaft: Der Hafen\nwächst gegen den Trend',
    },
    subtitle: {
      x: 4,
      y: 11.4,
      w: 20,
      h: 2.2,
      align: 'center',
      sample: 'Zweiter Teil, Seiten 9 bis 16',
    },
  },
  {
    name: 'Inhalt',
    bg: newsprint,
    shapes: [
      ground,
      ...double(1.1),
      thin(4.85, L, 17.9),
      column(20, 1.75, 12.6),
      {
        t: 'rect',
        x: 20.6,
        y: 1.9,
        w: 5.8,
        h: 3.3,
        fill: { t: 'hatch', color: grey, distance: 0.09, angle: 45 },
        stroke: { color: ink, width: 0.03 },
      },
      { t: 'rect', x: 20.6, y: 5.75, w: 1.6, h: 0.14, fill: red },
      ...greek({ x: 20.6, y: 6.2, w: 5.8, h: 2.4 }, 3),
      rule(20.6, 9.35, 5.8, ink, 0.03),
      { t: 'rect', x: 20.6, y: 9.75, w: 1.6, h: 0.14, fill: ink },
      ...greek({ x: 20.6, y: 10.2, w: 5.8, h: 3.75 }, 4),
      { t: 'rect', x: L, y: 14.65, w: W, h: 0.12, fill: ink },
    ],
    title: {
      x: L,
      y: 1.7,
      w: 17.9,
      h: 2.9,
      valign: 'middle',
      size: 30,
      sample: 'Sechs Beschlüsse, die ab sofort gelten',
    },
    body: {
      x: L,
      y: 5.4,
      w: 17.9,
      h: 8.9,
      sample: [
        'Die Innenstadt wird bis zum Sommer autofrei',
        'Drei neue Linien verbinden Ost und West',
        'Der alte Markt bekommt sein Dach zurück',
        'Schulen öffnen ihre Höfe am Nachmittag',
        'Die Bibliothek bleibt bis Mitternacht offen',
        'Bezahlt wird aus dem Haushalt des Vorjahrs',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: newsprint,
    shapes: [
      ground,
      ...double(1.1),
      thin(4.55),
      column(15.1, 5, 9.35),
      { t: 'rect', x: 15.7, y: 13.05, w: 0.34, h: 0.34, fill: red },
      ...greek({ x: 16.35, y: 13.05, w: 10.05, h: 0.5 }, 9),
      { t: 'rect', x: L, y: 14.65, w: W, h: 0.12, fill: ink },
    ],
    pictures: [{ x: 15.7, y: 5.05, w: 10.7, h: 7.6 }],
    title: {
      x: L,
      y: 1.6,
      w: W,
      h: 2.7,
      valign: 'middle',
      size: 30,
      sample: 'Über den Dächern wird wieder gebaut',
    },
    body: {
      x: L,
      y: 5.05,
      w: 12.9,
      h: 9.2,
      size: 20,
      sample: [
        'Vierhundert Wohnungen am Hafen',
        'Baubeginn ist im kommenden Frühjahr',
        'Die Mieten bleiben zehn Jahre gebunden',
        'Anwohner reden von Anfang an mit',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: newsprint,
    shapes: [
      ground,
      ...double(1.1),
      rule(L, 4.55, 11.6, ink, 0.03),
      lozenge(14, 4.55, 0.26, red),
      rule(14.8, 4.55, 11.6, ink, 0.03),
      column(14, 5.3, 9.05),
      { t: 'rect', x: L, y: 5.3, w: 2.4, h: 0.14, fill: ink },
      { t: 'rect', x: 14.8, y: 5.3, w: 2.4, h: 0.14, fill: ink },
      { t: 'rect', x: L, y: 14.65, w: W, h: 0.12, fill: ink },
    ],
    title: {
      x: L,
      y: 1.6,
      w: W,
      h: 2.7,
      align: 'center',
      valign: 'middle',
      size: 30,
      sample: 'Was dafür spricht und was dagegen',
    },
    body: [
      {
        x: L,
        y: 5.95,
        w: 11.6,
        h: 8.3,
        size: 20,
        sample: [
          'Kürzere Wege für alle im Viertel',
          'Weniger Lärm an den Hauptstraßen',
          'Mehr Platz für Handel und Markt',
        ],
      },
      {
        x: 14.8,
        y: 5.95,
        w: 11.6,
        h: 8.3,
        size: 20,
        sample: [
          'Zwei Jahre Baustelle im Zentrum',
          'Höhere Kosten als zunächst geplant',
          'Lieferverkehr braucht neue Zeiten',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: newsprint,
    shapes: [
      ground,
      ...double(1.1),
      {
        t: 'rect',
        x: L,
        y: 2.05,
        w: W,
        h: 7.2,
        fill: { t: 'hatch', color: lead, distance: 0.1, angle: 45 },
      },
      { t: 'rect', x: 5.6, y: 2.05, w: 16.8, h: 7.2, fill: shade },
      column(5.6, 2.05, 7.2),
      column(22.4, 2.05, 7.2),
      thin(2.05),
      ...double(9.25, L, W, false),
      lozenge(14, 13.75, 0.26, red),
      rule(L, 13.75, 11.6, ink, 0.03),
      rule(14.8, 13.75, 11.6, ink, 0.03),
      { t: 'rect', x: L, y: 14.65, w: W, h: 0.12, fill: ink },
    ],
    title: {
      x: 5.8,
      y: 2.2,
      w: 16.4,
      h: 6.9,
      align: 'center',
      valign: 'middle',
      size: 140,
      color: red,
      lineHeight: 100,
      sample: '412',
    },
    body: {
      x: 4.4,
      y: 9.9,
      w: 19.2,
      h: 3.5,
      align: 'center',
      valign: 'middle',
      font: serif,
      italic: true,
      size: 22,
      lineHeight: 130,
      sample: 'neue Wohnungen entstehen bis zum Jahresende über den alten Speichern am Hafen.',
    },
  },
  {
    name: 'Zitat',
    bg: newsprint,
    shapes: [
      ground,
      ...double(1.1),
      { t: 'rect', x: 3.2, y: 2.6, w: 0.3, h: 10.6, fill: red },
      {
        t: 'text',
        x: 4.5,
        y: 1.5,
        w: 6,
        h: 5,
        text: '“',
        font: serif,
        bold: true,
        size: 170,
        color: ink,
        nowrap: true,
        lineHeight: 100,
      },
      rule(4.6, 11.55, 3.4, ink, 0.03),
      column(24.2, 2.6, 10.6),
      { t: 'rect', x: L, y: 14.65, w: W, h: 0.12, fill: ink },
    ],
    body: {
      x: 4.6,
      y: 5.1,
      w: 18.4,
      h: 6,
      font: serif,
      italic: true,
      size: 29,
      lineHeight: 132,
      sample: 'Eine Stadt ist nie fertig. Wer das beklagt, hat nicht verstanden, wozu sie da ist.',
    },
    subtitle: {
      x: 4.6,
      y: 11.9,
      w: 18.4,
      h: 1.3,
      font: sans,
      italic: false,
      bold: true,
      upper: true,
      spacing: 2,
      size: 13,
      color: grey,
      sample: 'Henrike Vossberg, Stadtbaurätin',
    },
  },
  {
    name: 'Bild',
    bg: newsprint,
    shapes: [
      ground,
      ...double(1.1),
      {
        t: 'rect',
        x: L,
        y: 1.85,
        w: W,
        h: 9.9,
        fill: null,
        stroke: { color: ink, width: 0.03 },
      },
      { t: 'rect', x: L, y: 12.55, w: 0.42, h: 0.42, fill: red },
      column(19.6, 12.2, 2),
      ...greek({ x: 20.2, y: 12.3, w: 6.2, h: 1.8 }, 12),
      { t: 'rect', x: L, y: 14.65, w: W, h: 0.12, fill: ink },
    ],
    pictures: [{ x: L + 0.15, y: 2, w: W - 0.3, h: 9.6 }],
    title: {
      x: 2.5,
      y: 12.1,
      w: 16.6,
      h: 2.3,
      valign: 'top',
      size: 22,
      lineHeight: 118,
      sample: 'Blick vom Rathausturm auf das neue Viertel am Hafen',
    },
  },
  {
    name: 'Schluss',
    bg: newsprint,
    shapes: [
      ground,
      ...double(1.1),
      ...dateline(1.85),
      thin(2.35),
      column(L, 2.35, 12.3),
      column(R, 2.35, 12.3),
      ...double(10.1, 9, 10, false),
      rule(L, 13.75, W, ink, 0.03),
      ...double(14.43, L, W, false),
    ],
    title: {
      x: 3,
      y: 3.3,
      w: 22,
      h: 6.4,
      align: 'center',
      valign: 'middle',
      size: 62,
      sample: 'Fortsetzung folgt',
    },
    subtitle: {
      x: 4,
      y: 10.75,
      w: 20,
      h: 2.4,
      align: 'center',
      sample: 'Fragen an die Redaktion sind erwünscht',
    },
  },
];

const template: Template = {
  slug: 'zeitung',
  name: 'Zeitung',
  group: 'Zeitung',
  tags: ['Zeitung', 'Presse', 'seriös', 'Nachrichten', 'Serife', 'Bericht', 'Politik', 'klassisch'],
  description:
    'Wie ein seriöses Blatt: Zeitungspapier, Kopflinien, Spaltenlinien, schwarze Schrift und ein tiefes Rot.',
  palette: {
    bg: newsprint,
    text: ink,
    bg2: shade,
    text2: grey,
    accents: [red, '#3a3936', lead, '#cdc4b0', '#2f4858', '#a8843c'],
  },
  fonts: { head: serif, body: sans },
  text: {
    title: { font: serif, size: 54, color: ink, bold: true, lineHeight: 112 },
    subtitle: { font: serif, size: 20, color: ink, italic: true, lineHeight: 120 },
    body: { font: sans, size: 21, color: ink, lineHeight: 126, paraSpace: 0.36 },
  },
  layouts,
  samplePictures: [pressPhoto(1), pressPhoto(2)],
};

export default template;
