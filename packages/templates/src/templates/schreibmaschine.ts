import { grain, jpeg, noise, paint, rng } from '../art';
import type { Box, Layout, Picture, Shape, Stroke, Template } from '../model';
import { page, ring, smoothPath } from '../shapes';

/*
 * Schreibmaschine: a typed dossier. Off-white paper with grain, punched for the binder,
 * monospace throughout, index cards with tabs, photos held by a paper clip, a stamp's rings and
 * blacked-out bars – and one red pencil that underlines what matters.
 */

const paperTone = '#f1ece0';
const card = '#f8f5ec';
const ink = '#1d1c1a';
const desk = '#2b2a28';
const lead = '#5f5b53';
const line = '#b5ae9f';
const red = '#c8372d';

/** The sheet: paper clouded a little, fibres, grain. One picture for every page of the file. */
function sheetPicture(): Picture {
  const surface = paint(undefined, 50);
  const { ctx, w, h } = surface;
  const field = noise(19);
  const random = rng(5);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const shadeAt = 1 + (field(x / 210, y / 210, 5) - 0.5) * 0.09;
      const i = (y * w + x) * 4;
      image.data[i] = 241 * shadeAt;
      image.data[i + 1] = 236 * shadeAt;
      image.data[i + 2] = 224 * shadeAt;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  // Fibres.
  for (let i = 0; i < 900; i += 1) {
    const [x, y, a] = [random() * w, random() * h, random() * Math.PI];
    const length = random.range(4, 16);
    ctx.strokeStyle = `rgba(110,98,78,${random.range(0.04, 0.13)})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * length, y + Math.sin(a) * length);
    ctx.stroke();
  }
  grain(surface, 0.05, 8);
  return jpeg(surface, 80);
}
const sheet: Shape = { t: 'image', ...page, src: sheetPicture() };

const hair: Stroke = { color: line, width: 0.03 };
const typed: Stroke = { color: ink, width: 0.04 };

/** The two holes punched for the binder. */
const holes: Shape[] = [4.3, 11.45].flatMap((y): Shape[] => [
  {
    t: 'ellipse',
    x: 0.72,
    y: y - 0.4,
    w: 0.8,
    h: 0.8,
    fill: {
      t: 'linear',
      angle: 180,
      stops: [
        [0, '#1c1b1a'],
        [1, '#55524c'],
      ],
    },
    stroke: { color: '#cfc7b6', width: 0.03 },
  },
]);

/** What the red pencil does: a quick line, gone over twice. */
const pencil = (x: number, y: number, length: number, seed = 1): Shape[] => {
  const random = rng(seed);
  const stroke = (shift: number, opacity: number): Shape => ({
    t: 'path',
    x: x + shift,
    y: y + shift * 0.3,
    w: length - shift * 2.5,
    h: 0.16,
    vb: [1000, 100],
    d: smoothPath(
      [
        [0, 60],
        [180, random.range(0, 30)],
        [400, random.range(50, 90)],
        [620, random.range(10, 40)],
        [820, 100],
        [1000, 0],
      ],
      false,
    ),
    fill: null,
    stroke: { color: red, width: 0.09, cap: 'round', join: 'round', opacity },
  });
  return [stroke(0, 0.9), stroke(0.12, 0.55)];
};

/** A paper clip over an edge at (`x`, `y`): its top-left. */
const clip = (x: number, y: number, rotate = 0): Shape[] =>
  [
    { color: '#3f3d39', width: 0.11, shift: 0.03 },
    { color: '#a9a69e', width: 0.07, shift: 0 },
  ].map((wire): Shape => ({
    t: 'path',
    x: x + wire.shift,
    y: y + wire.shift,
    w: 0.82,
    h: 3.3,
    vb: [60, 255],
    d: 'M50 50 L50 210 Q50 255 25 255 Q0 255 0 210 L0 40 Q0 0 30 0 Q60 0 60 40 L60 190 Q60 222 39 222 Q18 222 18 195 L18 70',
    fill: null,
    stroke: { color: wire.color, width: wire.width, cap: 'round', join: 'round' },
    rotate,
  }));

/** A stamp without words: two rings and a star, pressed unevenly. */
const stamp = (cx: number, cy: number, r: number, opacity = 0.55): Shape[] => [
  ring(cx, cy, r, { color: ink, width: r * 0.075, opacity }),
  ring(cx, cy, r * 0.8, { color: ink, width: r * 0.022, opacity }),
  ring(cx, cy, r * 0.42, {
    color: ink,
    width: r * 0.03,
    opacity: opacity * 0.8,
    dash: [0.12, 0.1],
  }),
  {
    t: 'text',
    x: cx - r * 0.4,
    y: cy - r * 0.4,
    w: r * 0.8,
    h: r * 0.8,
    text: '★',
    font: 'DejaVu Sans',
    size: r * 13,
    color: '#55524c',
    align: 'center',
    valign: 'middle',
    pad: 0,
  },
];

/** A frame stamp: a doubled box set askew, bars where the words would be. */
const frameStamp = (x: number, y: number, w: number, h: number, rotate: number): Shape[] => [
  {
    t: 'rect',
    x,
    y,
    w,
    h,
    r: 0.12,
    fill: null,
    stroke: { color: ink, width: 0.11, opacity: 0.5 },
    rotate,
  },
  {
    t: 'rect',
    x: x + 0.22,
    y: y + 0.22,
    w: w - 0.44,
    h: h - 0.44,
    fill: null,
    stroke: { color: ink, width: 0.03, opacity: 0.5 },
    rotate,
  },
];

/** Words blacked out. */
const struck = (x: number, y: number, widths: readonly number[], h = 0.42): Shape[] => {
  let at = x;
  return widths.map((w): Shape => {
    const bar: Shape = { t: 'rect', x: at, y, w, h, fill: ink };
    at += w + 0.35;
    return bar;
  });
};

/** An index card with its tab, lying on the desk. */
const indexCard = (box: Box, tab: { x: number; w: number }, fill = card): Shape[] => [
  {
    t: 'rect',
    x: tab.x,
    y: box.y - 1.05,
    w: tab.w,
    h: 1.6,
    r: 0.18,
    fill,
    shadow: { dx: 0.05, dy: 0.08, blur: 0.2, color: '#000000', opacity: 0.4 },
  },
  {
    t: 'rect',
    ...box,
    fill,
    shadow: { dx: 0.06, dy: 0.1, blur: 0.25, color: '#000000', opacity: 0.45 },
  },
  { t: 'rect', x: tab.x + 0.02, y: box.y - 0.2, w: tab.w - 0.04, h: 0.5, fill },
];

/** Ruled lines across a box. */
const ruled = (box: Box, step: number, stroke: Stroke = hair): Shape[] =>
  Array.from({ length: Math.floor(box.h / step) + 1 }, (_, i): Shape => ({
    t: 'line',
    x1: box.x,
    y1: box.y + i * step,
    x2: box.x + box.w,
    y2: box.y + i * step,
    stroke,
  }));

/** A photo print: white border, soft shadow. */
const print = (box: Box): Shape => ({
  t: 'rect',
  ...box,
  fill: '#fbfaf6',
  shadow: { dx: 0.06, dy: 0.1, blur: 0.25, color: '#000000', opacity: 0.4 },
});

/** A grainy shore under a low sky, as from a file's photo – a grey stand-in. */
function evidence(seed: number): Picture {
  const surface = paint({ w: 28, h: 17.5 }, 56);
  const { ctx, w, h } = surface;
  const field = noise(seed);
  const horizon = h * (seed % 2 ? 0.56 : 0.44);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let value: number;
      if (y < horizon) {
        const cloud = field(x / 300, y / 120, 5);
        value = 205 - (y / horizon) * 30 + (cloud - 0.5) * 120;
      } else {
        const depth = (y - horizon) / (h - horizon);
        const ripple = field(x / (60 + depth * 260), y / (6 + depth * 30), 4);
        value = 120 - depth * 70 + (ripple - 0.5) * (60 + depth * 90);
      }
      // A far shore.
      const shore = horizon - h * 0.05 * field(x / 220 + 3, 1.5, 3) - h * 0.012;
      if (y > shore && y < horizon) value = 52;
      const i = (y * w + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = Math.max(0, Math.min(255, value));
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  // A jetty's posts.
  const random = rng(seed);
  ctx.fillStyle = 'rgba(20,20,20,0.92)';
  for (let i = 0; i < 6; i += 1) {
    const x = w * (0.12 + i * 0.07);
    const top = horizon + h * (0.03 + i * 0.012) + random.range(-4, 4);
    ctx.fillRect(x, top, w * 0.008, h * (0.08 + i * 0.03));
  }
  ctx.fillRect(w * 0.1, horizon + h * 0.06, w * 0.42, h * 0.012);
  const rim = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.75);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, w, h);
  grain(surface, 0.2, seed + 9);
  return jpeg(surface, 80);
}

const layouts: Layout[] = [
  {
    // The file's cover sheet: a form's head, the title typed large, a stamp, bars at the foot.
    name: 'Titel',
    bg: paperTone,
    shapes: [
      sheet,
      ...holes,
      { t: 'line', x1: 3.2, y1: 2.5, x2: 26.2, y2: 2.5, stroke: typed },
      { t: 'line', x1: 3.2, y1: 2.64, x2: 26.2, y2: 2.64, stroke: typed },
      ...[0, 1, 2].map((i): Shape => ({
        t: 'rect',
        x: 23.9 + i * 0.85,
        y: 1.35,
        w: 0.6,
        h: 0.6,
        fill: i === 1 ? ink : null,
        stroke: typed,
      })),
      ...struck(3.2, 1.45, [3.6, 1.8, 5.2]),
      ...stamp(22.3, 9.6, 2.5),
      ...pencil(3.3, 10.1, 9.6, 3),
      {
        t: 'line',
        x1: 3.2,
        y1: 13.6,
        x2: 26.2,
        y2: 13.6,
        stroke: { ...typed, dash: [0.18, 0.14] },
      },
    ],
    title: {
      x: 3.1,
      y: 3.6,
      w: 17.4,
      h: 6.2,
      valign: 'bottom',
      size: 60,
      lineHeight: 100,
      sample: 'Akte\nNordlicht',
    },
    subtitle: {
      x: 3.2,
      y: 10.8,
      w: 17,
      h: 1.6,
      valign: 'middle',
      sample: 'Zwischenbericht, vertraulich',
    },
  },
  {
    // The register: index cards on the desk, the front one names the section.
    name: 'Abschnitt',
    bg: desk,
    shapes: [
      ...indexCard({ x: 3.4, y: 3.2, w: 22.6, h: 10.4 }, { x: 18.4, w: 5.4 }, '#d9d2c1'),
      ...indexCard({ x: 2.8, y: 3.7, w: 22.6, h: 10.4 }, { x: 11, w: 5.4 }, '#e8e2d3'),
      ...indexCard({ x: 2.2, y: 4.2, w: 22.6, h: 10.4 }, { x: 3.2, w: 5.4 }),
      ...struck(3.9, 3.55, [2.2, 1.2], 0.3),
      ...ruled({ x: 3.4, y: 11.2, w: 20.2, h: 2 }, 0.95),
      ...pencil(3.5, 9.25, 7.4, 7),
    ],
    title: {
      x: 3.3,
      y: 5,
      w: 20,
      h: 4,
      valign: 'bottom',
      size: 50,
      sample: 'Teil B: Zeugen',
    },
    subtitle: { x: 3.4, y: 9.7, w: 19, h: 1.3, valign: 'middle', sample: 'Blatt 14 bis 31' },
  },
  {
    // A typed page: margin line, the heading underlined in red, a small stamp in the corner.
    name: 'Inhalt',
    bg: paperTone,
    shapes: [
      sheet,
      ...holes,
      { t: 'line', x1: 2.5, y1: 0, x2: 2.5, y2: 15.75, stroke: hair },
      { t: 'line', x1: 2.62, y1: 0, x2: 2.62, y2: 15.75, stroke: hair },
      ...pencil(3.3, 3.85, 8.2, 2),
      ...stamp(24.9, 2.5, 1.15, 0.45),
      {
        t: 'line',
        x1: 3.2,
        y1: 14.75,
        x2: 26.2,
        y2: 14.75,
        stroke: { ...hair, dash: [0.18, 0.14] },
      },
    ],
    title: { x: 3.1, y: 1.1, w: 19.6, h: 2.6, valign: 'bottom', size: 30 },
    body: {
      x: 3.2,
      y: 4.7,
      w: 22.8,
      h: 9.6,
      sample: [
        'Eingang der Meldung um 6.40 Uhr',
        'Drei Zeugen, zwei Versionen',
        'Das Protokoll weist eine Lücke auf',
        'Die Zahlen stimmen erst ab Blatt 9',
        'Empfehlung: Wiedervorlage in 14 Tagen',
      ],
    },
  },
  {
    // The note on the left, the photo clipped to the sheet on the right.
    name: 'Text und Bild',
    bg: paperTone,
    shapes: [
      sheet,
      ...holes,
      print({ x: 15.3, y: 2.1, w: 11, h: 11.6 }),
      ...clip(17, 0.9, 4),
      ...pencil(3.3, 4.75, 6.2, 5),
      ...struck(15.3, 14.25, [3.4, 1.6], 0.34),
    ],
    title: { x: 3.1, y: 1.1, w: 11.4, h: 3.5, valign: 'bottom', size: 28 },
    body: {
      x: 3.2,
      y: 5.6,
      w: 11.3,
      h: 8.7,
      size: 18,
      sample: ['Aufnahme vom Ufer', 'Blick nach Norden', 'Kein Boot am Steg'],
    },
    pictures: [{ x: 15.75, y: 2.55, w: 10.1, h: 10.1 }],
  },
  {
    // Two index cards side by side, the heading on a label above.
    name: 'Zwei Spalten',
    // A light page under a dark sheet: the bullets take their colour from the page.
    bg: card,
    shapes: [
      { t: 'rect', ...page, fill: desk },
      {
        t: 'rect',
        x: 1.6,
        y: 1.1,
        w: 24.8,
        h: 2.5,
        fill: paperTone,
        shadow: { dx: 0.05, dy: 0.08, blur: 0.2, color: '#000000', opacity: 0.4 },
      },
      ...indexCard({ x: 1.6, y: 5.5, w: 12, h: 9 }, { x: 2.4, w: 4.2 }),
      ...indexCard({ x: 14.4, y: 5.5, w: 12, h: 9 }, { x: 21.4, w: 4.2 }),
      ...struck(2.9, 4.86, [1.8, 0.9], 0.26),
      ...struck(21.9, 4.86, [0.9, 1.8], 0.26),
      { t: 'line', x1: 2.3, y1: 6.5, x2: 12.9, y2: 6.5, stroke: hair },
      { t: 'line', x1: 15.1, y1: 6.5, x2: 25.7, y2: 6.5, stroke: hair },
    ],
    title: {
      x: 2.2,
      y: 1.2,
      w: 23.6,
      h: 2.3,
      valign: 'middle',
      size: 30,
      sample: 'Aussage gegen Aussage',
    },
    body: [
      {
        x: 2.2,
        y: 6.9,
        w: 10.9,
        h: 7.3,
        size: 18,
        sample: ['Tür war verschlossen', 'Licht aus ab 22 Uhr', 'Niemand im Flur'],
      },
      {
        x: 15,
        y: 6.9,
        w: 10.9,
        h: 7.3,
        size: 18,
        sample: ['Tür stand offen', 'Licht bis Mitternacht', 'Schritte im Flur'],
      },
    ],
  },
  {
    // The figure typed huge and underlined twice in red; a frame stamp set askew behind it.
    name: 'Kennzahl',
    bg: paperTone,
    shapes: [
      sheet,
      ...holes,
      ...frameStamp(20.6, 1.7, 4.6, 2.2, -7),
      ...struck(21.15, 2.46, [2.1, 0.9], 0.3).map(
        (bar): Shape => ({ ...bar, rotate: -7 }) as Shape,
      ),
      ...pencil(3.3, 10.9, 12.6, 4),
      ...pencil(3.6, 11.3, 9.4, 6),
      {
        t: 'line',
        x1: 17.9,
        y1: 5.2,
        x2: 17.9,
        y2: 12.4,
        stroke: { ...typed, dash: [0.18, 0.14] },
      },
      ...ruled({ x: 18.8, y: 11.3, w: 7.4, h: 1 }, 0.95),
    ],
    title: {
      x: 3,
      y: 3.6,
      w: 14.6,
      h: 7.2,
      valign: 'bottom',
      size: 176,
      spacing: -8,
      sample: '312',
    },
    body: {
      x: 18.8,
      y: 5.3,
      w: 7.6,
      h: 5.6,
      size: 19,
      sample: 'Blatt Papier, um einen einzigen Satz zu belegen.',
    },
  },
  {
    // One sheet on the desk, set a little askew and clipped; the quote typed on it.
    name: 'Zitat',
    bg: desk,
    shapes: [
      {
        t: 'rect',
        x: 3.6,
        y: 1.5,
        w: 21.6,
        h: 12.6,
        fill: '#ddd6c5',
        rotate: 2.2,
        shadow: { dx: 0.06, dy: 0.1, blur: 0.25, color: '#000000', opacity: 0.4 },
      },
      {
        t: 'rect',
        x: 3.2,
        y: 1.6,
        w: 21.6,
        h: 12.6,
        fill: paperTone,
        rotate: -1,
        shadow: { dx: 0.06, dy: 0.1, blur: 0.25, color: '#000000', opacity: 0.45 },
      },
      ...clip(5.4, 0.55, -6),
      {
        t: 'text',
        x: 4.6,
        y: 2.3,
        w: 4,
        h: 2.6,
        text: '„',
        font: 'Space Mono',
        bold: true,
        size: 96,
        color: line,
        valign: 'top',
        pad: 0,
      },
      ...pencil(5.1, 10.75, 5.8, 9),
      ...stamp(21.2, 11, 1.5, 0.45),
    ],
    body: {
      x: 5,
      y: 4.3,
      w: 18.2,
      h: 6.1,
      valign: 'bottom',
      font: 'Space Mono',
      size: 28,
      lineHeight: 124,
      sample: 'Was nicht in der Akte steht, ist nicht passiert.',
    },
    subtitle: {
      x: 5.1,
      y: 11.3,
      w: 14,
      h: 1.4,
      valign: 'middle',
      sample: 'Notiz am Rand, Blatt 3',
    },
  },
  {
    // The photo as a print on the desk, clipped to its label.
    name: 'Bild',
    bg: desk,
    shapes: [
      {
        t: 'rect',
        x: 1.4,
        y: 12.1,
        w: 15.6,
        h: 2.7,
        fill: paperTone,
        rotate: -1.2,
        shadow: { dx: 0.05, dy: 0.08, blur: 0.2, color: '#000000', opacity: 0.4 },
      },
      print({ x: 2.2, y: 0.9, w: 23.6, h: 11.5 }),
      ...clip(22.6, 0.15, 5),
    ],
    pictures: [{ x: 2.65, y: 1.35, w: 22.7, h: 10.6 }],
    title: {
      x: 2.2,
      y: 12.7,
      w: 14.2,
      h: 1.9,
      valign: 'middle',
      size: 24,
      sample: 'Anlage 7: Steg am Morgen',
    },
  },
  {
    // The last sheet: the file closed, stamped twice, a line to sign on.
    name: 'Schluss',
    bg: paperTone,
    shapes: [
      sheet,
      ...holes,
      ...stamp(21.6, 6.6, 3.3, 0.6),
      ...frameStamp(17.6, 10, 6.4, 2.4, -9),
      ...struck(18.4, 10.95, [2.6, 1.6], 0.34).map(
        (bar): Shape => ({ ...bar, rotate: -9 }) as Shape,
      ),
      ...pencil(3.3, 8.75, 10.4, 8),
      { t: 'line', x1: 3.2, y1: 13.4, x2: 12.6, y2: 13.4, stroke: typed },
      {
        t: 'text',
        x: 3.1,
        y: 12.3,
        w: 1,
        h: 1.1,
        text: '×',
        font: 'Space Mono',
        size: 22,
        color: ink,
        valign: 'bottom',
        pad: 0,
      },
    ],
    title: {
      x: 3.1,
      y: 2.6,
      w: 15,
      h: 5.9,
      valign: 'bottom',
      size: 54,
      lineHeight: 100,
      sample: 'Akte\ngeschlossen',
    },
    subtitle: {
      x: 3.2,
      y: 9.4,
      w: 14,
      h: 1.6,
      valign: 'middle',
      sample: 'Rückfragen an die Registratur',
    },
  },
];

const template: Template = {
  slug: 'schreibmaschine',
  name: 'Schreibmaschine',
  group: 'Schwarzweiß',
  tags: [
    'Schwarzweiß',
    'Schreibmaschine',
    'Akte',
    'Dossier',
    'Papier',
    'Monospace',
    'Bericht',
    'Recherche',
  ],
  description:
    'Ein getipptes Dossier: gelochtes Papier mit Korn, Karteikarten, Büroklammer und Stempel, alles in Schreibmaschinenschrift, dazu ein roter Stift.',
  palette: {
    bg: paperTone,
    text: ink,
    bg2: '#e2dccc',
    text2: lead,
    accents: [desk, '#8a857a', line, '#d1cabb', red, card],
  },
  fonts: { head: 'Space Mono', body: 'IBM Plex Mono' },
  text: {
    title: { font: 'Space Mono', size: 44, color: ink, bold: true, lineHeight: 108 },
    subtitle: { font: 'IBM Plex Mono', size: 18, color: lead },
    body: { font: 'IBM Plex Mono', size: 19, color: ink, lineHeight: 130, paraSpace: 0.36 },
  },
  layouts,
  samplePictures: [evidence(3), evidence(6)],
};

export default template;
