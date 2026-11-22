import type { Box, Color, FillLike, Layout, Shape, Template } from '../model';

/*
 * Bento: the page as a lunch box – rounded cards of different sizes on a soft neutral ground,
 * each its own tint, precise gaps. What a slide says sits in cards; the small cards carry tiny
 * instruments: a ring, bars, a switch, a label.
 */

const ground = '#eeede8';
const ink = '#1c1c1e';
const white = '#ffffff';
const grey = '#6c6c72';
const sage = '#cfe2c6';
const sky = '#cddcf4';
const apricot = '#f8d3b6';
const lavender = '#ddd4f3';
const orange = '#ff5a2b';
const butter = '#f4e6a2';

const [M, GAP, R] = [1.2, 0.4, 0.75];
const CW = (28 - 2 * M - 3 * GAP) / 4;
const RH = (15.75 - 2 * M - 2 * GAP) / 3;

/** A box on the grid of four columns and three rows. */
const cell = (column: number, row: number, across = 1, down = 1): Box => ({
  x: M + column * (CW + GAP),
  y: M + row * (RH + GAP),
  w: across * CW + (across - 1) * GAP,
  h: down * RH + (down - 1) * GAP,
});
/** Columns from the grid, the height free. */
const span = (column: number, across: number, y: number, h: number): Box => ({
  x: M + column * (CW + GAP),
  y,
  w: across * CW + (across - 1) * GAP,
  h,
});
const pad = (box: Box, by: number, top = by): Box => ({
  x: box.x + by,
  y: box.y + top,
  w: box.w - 2 * by,
  h: box.h - top - by,
});

const card = (box: Box, fill: FillLike, r = R): Shape => ({ t: 'rect', ...box, r, fill });

/** A tiny label: a pill with a dot and a bar standing for its word. */
const label = (x: number, y: number, tone: Color, on: Color = ink, w = 2.1): Shape[] => [
  { t: 'rect', x, y, w, h: 0.62, r: 0.31, fill: tone },
  { t: 'ellipse', x: x + 0.2, y: y + 0.2, w: 0.22, h: 0.22, fill: on },
  {
    t: 'rect',
    x: x + 0.56,
    y: y + 0.25,
    w: w - 0.86,
    h: 0.12,
    r: 0.06,
    fill: on,
    opacity: 0.55,
  } as Shape,
];

/** A ring filled to a share. */
const gauge = (
  cx: number,
  cy: number,
  r: number,
  share: number,
  color: Color,
  track: Color,
): Shape[] => [
  {
    t: 'ellipse',
    x: cx - r,
    y: cy - r,
    w: 2 * r,
    h: 2 * r,
    fill: null,
    stroke: { color: track, width: r * 0.3 },
  },
  {
    t: 'ellipse',
    x: cx - r,
    y: cy - r,
    w: 2 * r,
    h: 2 * r,
    kind: 'arc',
    start: 90 - share * 360,
    end: 90,
    fill: null,
    stroke: { color, width: r * 0.3, cap: 'round' },
  },
];

/** Bars standing on the bottom of a box. */
const bars = (box: Box, heights: readonly number[], fill: (index: number) => FillLike): Shape[] => {
  const gap = box.w * 0.08;
  const w = (box.w - gap * (heights.length - 1)) / heights.length;
  return heights.map((height, index) => ({
    t: 'rect',
    x: box.x + index * (w + gap),
    y: box.y + box.h * (1 - height),
    w,
    h: box.h * height,
    r: Math.min(0.22, w / 2),
    fill: fill(index),
  }));
};

/** An arrow up right in a disc. */
const go = (cx: number, cy: number, r: number, fill: Color, color: Color): Shape[] => [
  { t: 'ellipse', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill },
  {
    t: 'line',
    x1: cx - r * 0.32,
    y1: cy + r * 0.32,
    x2: cx + r * 0.32,
    y2: cy - r * 0.32,
    stroke: { color, width: r * 0.14, cap: 'round' },
  },
  {
    t: 'path',
    x: cx - r * 0.2,
    y: cy - r * 0.36,
    w: r * 0.56,
    h: r * 0.56,
    vb: [10, 10],
    d: 'M0 0 L10 0 L10 10',
    fill: null,
    stroke: { color, width: r * 0.14, cap: 'round', join: 'round' },
  },
];

const toggle = (x: number, y: number, w: number, fill: Color, knob: Color = white): Shape[] => [
  { t: 'rect', x, y, w, h: w * 0.52, r: w * 0.26, fill },
  { t: 'ellipse', x: x + w * 0.54, y: y + w * 0.07, w: w * 0.38, h: w * 0.38, fill: knob },
];

/** A grid of small dots, some lit. */
const beads = (
  box: Box,
  across: number,
  down: number,
  fill: Color,
  lit: Color,
  every = 4,
): Shape[] => {
  const size = Math.min(box.w / (across * 1.6), box.h / (down * 1.6));
  const shapes: Shape[] = [];
  for (let row = 0; row < down; row += 1)
    for (let column = 0; column < across; column += 1)
      shapes.push({
        t: 'ellipse',
        x: box.x + (column * (box.w - size)) / (across - 1),
        y: box.y + (row * (box.h - size)) / (down - 1),
        w: size,
        h: size,
        fill: (row * across + column * 3 + row) % every === 0 ? lit : fill,
      });
  return shapes;
};

const numeral = (box: Box, text: string, size: number, color: Color): Shape => ({
  t: 'text',
  ...box,
  text,
  font: 'Geist',
  bold: true,
  size,
  color,
  align: 'left',
  valign: 'bottom',
  spacing: -2,
  nowrap: true,
});

const layouts: Layout[] = [
  (() => {
    const [main, sub, a, b, c] = [
      cell(0, 0, 3, 2),
      cell(0, 2, 2),
      cell(2, 2),
      cell(3, 0),
      cell(3, 1, 1, 2),
    ];
    return {
      name: 'Titel',
      bg: ground,
      shapes: [
        card(main, white),
        ...label(main.x + 0.8, main.y + 0.8, ground),
        ...label(main.x + 3.1, main.y + 0.8, orange, white, 1.5),
        card(sub, ink),
        card(a, orange),
        ...go(a.x + a.w / 2, a.y + a.h / 2, 1.25, white, ink),
        card(b, lavender),
        ...gauge(b.x + b.w / 2, b.y + b.h / 2 + 0.1, 1.25, 0.68, ink, white),
        card(c, sage),
        ...label(c.x + 0.6, c.y + 0.6, white),
        ...bars(pad(c, 0.7, 2.6), [0.38, 0.55, 0.47, 0.78, 1], (index) =>
          index === 4 ? ink : white,
        ),
      ],
      title: {
        ...pad(main, 0.8, 1.9),
        valign: 'bottom',
        size: 56,
        sample: 'Alles an\nseinem Platz',
      },
      subtitle: {
        ...pad(sub, 0.8, 0.6),
        valign: 'middle',
        color: white,
        sample: 'Quartalsbericht in zwölf Kacheln',
      },
    } satisfies Layout;
  })(),
  (() => {
    const [num, small, main, tag] = [cell(0, 0, 1, 2), cell(0, 2), cell(1, 0, 3, 3), cell(3, 0)];
    return {
      name: 'Abschnitt',
      bg: ground,
      shapes: [
        card(num, apricot),
        ...label(num.x + 0.6, num.y + 0.6, white),
        numeral(pad(num, 0.6), '02', 96, ink),
        card(small, sky),
        ...toggle(small.x + 0.7, small.y + 0.7, 2.1, ink),
        ...toggle(small.x + 0.7, small.y + 2.35, 2.1, white, sky),
        ...go(small.x + small.w - 1.5, small.y + small.h / 2, 0.85, white, ink),
        card(main, ink),
        ...label(main.x + 0.9, main.y + 0.9, '#3a3a3e', white),
        ...gauge(tag.x + tag.w - 2.1, tag.y + 2.1, 1.05, 0.4, orange, '#3a3a3e'),
        {
          t: 'rect',
          x: main.x + 0.9,
          y: main.y + main.h - 3.05,
          w: 1.6,
          h: 0.16,
          r: 0.08,
          fill: orange,
        },
      ],
      title: {
        x: main.x + 0.9,
        y: main.y + 3.4,
        w: main.w - 1.8,
        h: main.h - 6.9,
        valign: 'bottom',
        size: 54,
        color: white,
        sample: 'Der Stand der Dinge',
      },
      subtitle: {
        x: main.x + 0.9,
        y: main.y + main.h - 2.6,
        w: main.w - 1.8,
        h: 1.8,
        color: '#c9c9cf',
        sample: 'Was läuft, was hakt, was kommt',
      },
    } satisfies Layout;
  })(),
  (() => {
    const top = 2.9;
    const [head, chip, main, a, b] = [
      span(0, 3, M, top),
      span(3, 1, M, top),
      span(0, 3, M + top + GAP, 15.75 - 2 * M - top - GAP),
      span(3, 1, M + top + GAP, 5.1),
      span(3, 1, M + top + GAP + 5.1 + GAP, 15.75 - 2 * M - top - 2 * GAP - 5.1),
    ];
    return {
      name: 'Inhalt',
      bg: ground,
      shapes: [
        card(head, white),
        card(chip, orange),
        ...go(chip.x + chip.w - 1.55, chip.y + chip.h / 2, 0.85, white, ink),
        ...label(chip.x + 0.6, chip.y + 0.6, white),
        card(main, white),
        card(a, lavender),
        ...label(a.x + 0.6, a.y + 0.6, white),
        ...gauge(a.x + a.w / 2, a.y + a.h / 2 + 0.45, 1.35, 0.72, ink, white),
        card(b, sage),
        ...bars(pad(b, 0.7, 0.9), [0.3, 0.5, 0.42, 0.7, 1], (index) => (index === 4 ? ink : white)),
      ],
      title: { ...pad(head, 0.8, 0.3), h: top - 0.6, valign: 'middle', size: 34 },
      body: {
        ...pad(main, 0.8, 0.7),
        sample: [
          'Jede Kachel trägt genau einen Gedanken',
          'Große Kacheln für das Wichtige',
          'Kleine für Zahlen und Zeichen',
          'Gleiche Abstände halten alles zusammen',
          'Farbe ordnet, sie schmückt nicht',
        ],
      },
    } satisfies Layout;
  })(),
  (() => {
    const top = 3.6;
    const [head, main, frame] = [
      span(0, 2, M, top),
      span(0, 2, M + top + GAP, 15.75 - 2 * M - top - GAP),
      cell(2, 0, 2, 3),
    ];
    return {
      name: 'Text und Bild',
      bg: ground,
      shapes: [card(head, butter), card(main, white), card(frame, white)],
      title: { ...pad(head, 0.8, 0.3), h: top - 0.6, valign: 'middle', size: 30 },
      body: { ...pad(main, 0.8, 0.7), size: 20 },
      pictures: [pad(frame, 0.45)],
    } satisfies Layout;
  })(),
  (() => {
    const top = 2.9;
    const rest = 15.75 - 2 * M - top - GAP;
    const [head, chip, left, right] = [
      span(0, 3, M, top),
      span(3, 1, M, top),
      span(0, 2, M + top + GAP, rest),
      span(2, 2, M + top + GAP, rest),
    ];
    return {
      name: 'Zwei Spalten',
      bg: ground,
      shapes: [
        card(head, white),
        card(chip, ink),
        ...toggle(chip.x + 0.7, chip.y + 0.9, 2.1, orange),
        ...gauge(chip.x + chip.w - 1.5, chip.y + chip.h / 2, 0.75, 0.6, white, '#3a3a3e'),
        card(left, sky),
        ...label(left.x + 0.8, left.y + 0.7, white),
        card(right, sage),
        ...label(right.x + 0.8, right.y + 0.7, white),
      ],
      title: { ...pad(head, 0.8, 0.3), h: top - 0.6, valign: 'middle', size: 34 },
      body: [
        { ...pad(left, 0.8, 1.8), size: 20 },
        { ...pad(right, 0.8, 1.8), size: 20 },
      ],
    } satisfies Layout;
  })(),
  (() => {
    const [main, text, a, tall] = [cell(0, 0, 3, 2), cell(0, 2, 2), cell(2, 2), cell(3, 0, 1, 3)];
    return {
      name: 'Kennzahl',
      bg: ground,
      shapes: [
        card(main, orange),
        ...label(main.x + 0.8, main.y + 0.8, white),
        ...go(main.x + main.w - 2.0, main.y + 2.0, 1.1, white, ink),
        card(text, white),
        card(a, butter),
        ...gauge(a.x + a.w / 2, a.y + a.h / 2, 1.2, 0.73, ink, white),
        card(tall, ink),
        ...label(tall.x + 0.6, tall.y + 0.6, '#3a3a3e', white),
        ...bars(pad(tall, 0.7, 2.2), [0.22, 0.34, 0.5, 0.73, 1], (index) =>
          index === 4 ? orange : '#3a3a3e',
        ),
      ],
      title: {
        x: main.x + 0.8,
        y: main.y + 2.2,
        w: main.w - 1.6,
        h: main.h - 2.7,
        valign: 'bottom',
        size: 150,
        color: white,
        spacing: -3,
        sample: '73 %',
      },
      body: {
        ...pad(text, 0.8, 0.5),
        valign: 'middle',
        size: 20,
        sample: 'der Aufgaben sind in dieser Woche erledigt worden.',
      },
    } satisfies Layout;
  })(),
  (() => {
    const [mark, small, main, who, c] = [
      cell(0, 0),
      cell(0, 1, 1, 2),
      cell(1, 0, 3, 2),
      cell(1, 2, 2),
      cell(3, 2),
    ];
    return {
      name: 'Zitat',
      bg: ground,
      shapes: [
        card(mark, orange),
        {
          t: 'text',
          x: mark.x + 0.6,
          y: mark.y - 1.4,
          w: mark.w - 1.2,
          h: mark.h + 1.6,
          text: '“',
          font: 'Geist',
          bold: true,
          size: 170,
          color: white,
          valign: 'top',
          nowrap: true,
        },
        card(small, lavender),
        ...label(small.x + 0.6, small.y + 0.6, white),
        ...beads(pad(small, 0.8, 2.2), 5, 7, white, ink, 5),
        card(main, white),
        card(who, butter),
        { t: 'ellipse', x: who.x + 0.8, y: who.y + who.h / 2 - 1.05, w: 2.1, h: 2.1, fill: ink },
        {
          t: 'ellipse',
          x: who.x + 1.45,
          y: who.y + who.h / 2 - 0.65,
          w: 0.8,
          h: 0.8,
          fill: butter,
        },
        {
          t: 'ellipse',
          x: who.x + 1.15,
          y: who.y + who.h / 2 + 0.3,
          w: 1.4,
          h: 1.4,
          kind: 'cut',
          start: 0,
          end: 180,
          fill: butter,
        },
        card(c, sage),
        ...go(c.x + c.w / 2, c.y + c.h / 2, 1.2, white, ink),
      ],
      body: {
        ...pad(main, 1.0, 0.8),
        valign: 'middle',
        font: 'Geist',
        size: 34,
        lineHeight: 116,
        sample: 'Ordnung ist kein Käfig. Sie ist der Grund, warum man etwas wiederfindet.',
      },
      subtitle: {
        x: who.x + 3.4,
        y: who.y + 0.6,
        w: who.w - 4.1,
        h: who.h - 1.2,
        valign: 'middle',
        color: ink,
        sample: 'Jonas Reiter, Leitung Betrieb',
      },
    } satisfies Layout;
  })(),
  (() => {
    const bottom = 3.2;
    const [frame, cap, a, b] = [
      span(0, 4, M, 15.75 - 2 * M - bottom - GAP),
      span(0, 2, 15.75 - M - bottom, bottom),
      span(2, 1, 15.75 - M - bottom, bottom),
      span(3, 1, 15.75 - M - bottom, bottom),
    ];
    return {
      name: 'Bild',
      bg: ground,
      shapes: [
        card(frame, white),
        card(cap, white),
        card(a, sky),
        ...label(a.x + 0.6, a.y + 0.6, white),
        ...bars(
          { x: a.x + 0.7, y: a.y + 1.5, w: a.w - 1.4, h: bottom - 2.1 },
          [0.4, 0.7, 0.55, 1, 0.8, 0.6],
          (index) => (index === 3 ? ink : white),
        ),
        card(b, orange),
        ...go(b.x + b.w - 1.5, b.y + bottom / 2, 0.9, white, ink),
        ...toggle(b.x + 0.7, b.y + bottom / 2 - 0.55, 2.1, white, orange),
      ],
      pictures: [pad(frame, 0.45)],
      title: {
        ...pad(cap, 0.8, 0.3),
        valign: 'middle',
        size: 28,
        sample: 'Ein Blick in die Werkstatt',
      },
    } satisfies Layout;
  })(),
  (() => {
    const top = 3.0;
    const rest = 15.75 - 2 * M - top - GAP;
    const [a, b, c, d, main, side] = [
      span(0, 1, M, top),
      span(1, 1, M, top),
      span(2, 1, M, top),
      span(3, 1, M, top),
      span(0, 3, M + top + GAP, rest),
      span(3, 1, M + top + GAP, rest),
    ];
    return {
      name: 'Schluss',
      bg: ground,
      shapes: [
        card(a, sage),
        ...gauge(a.x + 1.7, a.y + top / 2, 0.85, 1, ink, white),
        ...label(a.x + 3.2, a.y + top / 2 - 0.31, white),
        card(b, butter),
        ...bars(
          { x: b.x + 0.7, y: b.y + 0.7, w: b.w - 1.4, h: top - 1.4 },
          [0.35, 0.5, 0.65, 0.8, 1],
          (index) => (index === 4 ? ink : white),
        ),
        card(c, lavender),
        ...toggle(c.x + 0.7, c.y + top / 2 - 0.55, 2.1, ink),
        ...go(c.x + c.w - 1.5, c.y + top / 2, 0.85, white, ink),
        card(d, sky),
        ...beads({ x: d.x + 0.8, y: d.y + 0.75, w: d.w - 1.6, h: top - 1.5 }, 8, 3, white, ink, 5),
        card(main, ink),
        ...label(main.x + 0.9, main.y + 0.9, '#3a3a3e', white),
        card(side, orange),
        ...go(side.x + side.w - 1.6, side.y + 1.6, 0.9, white, ink),
      ],
      title: {
        x: main.x + 0.9,
        y: main.y + 2.0,
        w: main.w - 1.8,
        h: main.h - 2.8,
        valign: 'bottom',
        size: 80,
        color: white,
        sample: 'Danke.',
      },
      subtitle: {
        x: side.x + 0.7,
        y: side.y + 3.0,
        w: side.w - 1.4,
        h: side.h - 3.7,
        valign: 'bottom',
        color: white,
        size: 20,
        sample: 'Fragen gern jetzt oder per Nachricht',
      },
    } satisfies Layout;
  })(),
];

const template: Template = {
  slug: 'bento',
  name: 'Bento',
  group: 'Designtrend',
  tags: ['Bento', 'Kacheln', 'Raster', 'aufgeräumt', 'Produkt', 'Bericht', 'modern', 'ruhig'],
  description:
    'Ein Raster aus runden Kacheln auf ruhigem Grund: jede Kachel eine Farbe, ein Gedanke, genaue Abstände.',
  palette: {
    bg: ground,
    text: ink,
    bg2: white,
    text2: grey,
    accents: [orange, sage, sky, apricot, lavender, butter],
  },
  fonts: { head: 'Geist', body: 'Geist' },
  text: {
    title: { font: 'Geist', size: 40, color: ink, bold: true, lineHeight: 102, spacing: -0.5 },
    subtitle: { font: 'Geist', size: 22, color: grey },
    body: { font: 'Geist', size: 22, color: ink, lineHeight: 124, paraSpace: 0.3 },
  },
  layouts,
};

export default template;
