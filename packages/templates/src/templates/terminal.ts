import type { SKRSContext2D } from '@napi-rs/canvas';
import { paint, rng, stencil } from '../art';
import type { Box, Color, Layout, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page } from '../shapes';

/*
 * Terminal: a text screen – phosphor green and amber on near-black, one monospace, scanlines and a
 * little bloom, prompt chevrons, a block cursor, frames set from dashes and plus signs.
 */

const black = '#06100a';
const deep = '#030805';
const pane = '#0e2016';
const green = '#3dff74';
const soft = '#b9f7c9';
const dim = '#4fae6c';
const amber = '#ffb000';
const cyan = '#5ce1e6';
const red = '#ff5f56';
const violet = '#d77bff';
const mono = 'JetBrains Mono';

/** Scanlines for the whole page: dark rows, soft-edged, hardly any bytes. */
const scan = (() => {
  const surface = paint(PAGE, 40);
  const { ctx, w, h, px } = surface;
  const period = 0.11 * px;
  for (let y = 0; y < h; y += 1) {
    const alpha = 0.26 * (0.5 + 0.5 * Math.sin((y / period) * Math.PI * 2));
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, y, w, 1);
  }
  return stencil(surface, '#000000', 32);
})();

/** The screen: a tube lit a little more in its middle, darker at the rim, with scanlines. */
const screen = (glow: Color = '#0d2416', cx = 0.5, cy = 0.5): Shape[] => [
  {
    t: 'rect',
    ...page,
    fill: {
      t: 'radial',
      cx,
      cy,
      stops: [
        [0, glow],
        [0.6, black],
        [1, deep],
      ],
    },
  },
  { t: 'image', ...page, src: scan },
];

/** The bloom under something bright: what `draw` paints (in cm inside `box`), blurred. */
function halo(
  box: Box,
  color: Color,
  draw: (ctx: SKRSContext2D) => void,
  blur = 0.55,
  passes = 2,
): Shape {
  const pad = blur * 3;
  const surface = paint({ w: box.w + pad * 2, h: box.h + pad * 2 }, 22);
  const { ctx, px } = surface;
  ctx.scale(px, px);
  ctx.translate(pad, pad);
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * px;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < passes; i += 1) draw(ctx);
  return {
    t: 'image',
    x: box.x - pad,
    y: box.y - pad,
    w: box.w + pad * 2,
    h: box.h + pad * 2,
    src: stencil(surface, color, 64),
  };
}

/** A block with its bloom – the cursor, a bar, a selection. */
const lit = (box: Box, color: Color, blur = 0.5): Shape[] => [
  halo(box, color, (ctx) => ctx.fillRect(0, 0, box.w, box.h), blur),
  { t: 'rect', ...box, fill: color },
];

/** The prompt chevron, `h` high, glowing. */
function chevron(x: number, y: number, h: number, color: Color, weight = 0.26): Shape[] {
  const w = h * 0.62;
  const t = h * weight;
  const pts: [number, number][] = [
    [0, 0],
    [t, 0],
    [w, h / 2],
    [t, h],
    [0, h],
    [w - t, h / 2],
  ];
  return [
    halo({ x, y, w, h }, color, (ctx) => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fill();
    }),
    { t: 'poly', fill: color, pts: pts.map(([px, py]) => [x + px, y + py] as const) },
  ];
}

const plus = (cx: number, cy: number, color: Color, size = 0.2, width = 0.05): Shape[] => [
  { t: 'line', x1: cx - size, y1: cy, x2: cx + size, y2: cy, stroke: { color, width } },
  { t: 'line', x1: cx, y1: cy - size, x2: cx, y2: cy + size, stroke: { color, width } },
];

/** A frame as typed: dashes along, bars down, a plus in each corner. */
function frame(box: Box, color: Color, width = 0.05, double = false): Shape[] {
  const gap = 0.42;
  const [l, t, r, b] = [box.x, box.y, box.x + box.w, box.y + box.h];
  const along = { color, width, dash: [0.3, 0.16] as const };
  const down = { color, width, dash: [0.42, 0.2] as const };
  const shapes: Shape[] = [
    { t: 'line', x1: l + gap, y1: t, x2: r - gap, y2: t, stroke: along },
    { t: 'line', x1: l + gap, y1: b, x2: r - gap, y2: b, stroke: along },
    { t: 'line', x1: l, y1: t + gap, x2: l, y2: b - gap, stroke: down },
    { t: 'line', x1: r, y1: t + gap, x2: r, y2: b - gap, stroke: down },
    ...plus(l, t, color, 0.2, width),
    ...plus(r, t, color, 0.2, width),
    ...plus(l, b, color, 0.2, width),
    ...plus(r, b, color, 0.2, width),
  ];
  if (double) {
    const d = 0.16;
    shapes.push(
      { t: 'line', x1: l + gap, y1: t + d, x2: r - gap, y2: t + d, stroke: along },
      { t: 'line', x1: l + gap, y1: b - d, x2: r - gap, y2: b - d, stroke: along },
    );
  }
  return shapes;
}

/** Lines of output that scrolled by: bars where words were, fainter the older. */
function scrolled(box: Box, lines: number, seed: number, color: Color = dim): Shape[] {
  const random = rng(seed);
  const pitch = box.h / lines;
  const shapes: Shape[] = [];
  for (let line = 0; line < lines; line += 1) {
    let x = box.x + (random() < 0.3 ? 0.9 : 0);
    const end = box.x + box.w * random.range(0.35, 1);
    const opacity = 0.1 + (0.3 * (line + 1)) / lines;
    while (x < end) {
      const w = Math.min(end - x, random.range(0.5, 2.6));
      shapes.push({
        t: 'rect',
        x,
        y: box.y + line * pitch,
        w,
        h: 0.2,
        fill: { t: 'solid', color, opacity },
      });
      x += w + 0.28;
    }
  }
  return shapes;
}

const glyph = (
  text: string,
  x: number,
  y: number,
  size: number,
  color: Color,
  w = 3,
  align: 'left' | 'center' | 'right' = 'left',
): Shape => ({
  t: 'text',
  x,
  y,
  w,
  h: (size / 28.35) * 1.5,
  text,
  font: mono,
  size,
  color,
  bold: true,
  align,
  valign: 'middle',
  nowrap: true,
});

/** The line at the foot of the screen, lit: a tab in amber, marks at its right end. */
const status = (tab: string, right: string): Shape[] => [
  { t: 'rect', x: 0, y: 14.75, w: 28, h: 1, fill: '#1c7a3c' },
  { t: 'rect', x: 0, y: 14.75, w: 3, h: 1, fill: amber },
  glyph(tab, 0, 14.8, 13, black, 3, 'center'),
  glyph(right, 21.6, 14.8, 13, '#d5ffe0', 5.2, 'right'),
];

const list = [
  'Ein Befehl, eine Aufgabe',
  'Klartext statt Klickwege',
  'Alles lässt sich wiederholen',
  'Fehler stehen im Protokoll',
  'Was läuft, bleibt in Ruhe',
];

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: black,
    shapes: [
      ...screen('#0f2a19', 0.4, 0.5),
      ...scrolled({ x: 2.2, y: 1.5, w: 13, h: 2.2 }, 5, 4),
      ...chevron(2.2, 5.35, 2.5, amber),
      ...lit({ x: 4.9, y: 11.55, w: 0.95, h: 1.7 }, green),
      ...status('1:~', '0 ▪ 100%'),
    ],
    title: {
      x: 4.8,
      y: 4.3,
      w: 21,
      h: 4.7,
      size: 50,
      valign: 'middle',
      sample: 'Systeme,\ndie laufen',
    },
    subtitle: {
      x: 4.8,
      y: 9.3,
      w: 21,
      h: 1.7,
      valign: 'middle',
      sample: 'Ein Bericht aus dem Maschinenraum',
    },
  },
  {
    name: 'Abschnitt',
    bg: black,
    shapes: [
      ...screen('#0b1f13', 0.5, 0.5),
      ...scrolled({ x: 2.2, y: 1.6, w: 17, h: 2.8 }, 6, 11),
      ...lit({ x: 0, y: 5.5, w: 28, h: 4.6 }, green, 0.8),
      { t: 'rect', x: 0, y: 5.5, w: 1.4, h: 4.6, fill: amber },
      glyph('#', 2.3, 6.35, 62, '#0b3d1c', 3),
      ...chevron(2.4, 11.52, 0.9, amber, 0.3),
      ...scrolled({ x: 20.5, y: 12.9, w: 5.3, h: 1.2 }, 3, 3),
    ],
    title: {
      x: 5.2,
      y: 5.7,
      w: 21,
      h: 4.2,
      size: 46,
      color: black,
      valign: 'middle',
      sample: 'Teil zwei:\nder Betrieb',
    },
    subtitle: {
      x: 3.6,
      y: 11.1,
      w: 20,
      h: 1.7,
      valign: 'middle',
      sample: 'Was nachts um drei passiert',
    },
  },
  {
    name: 'Inhalt',
    bg: black,
    shapes: [
      ...screen('#0b1f13', 0.3, 0.4),
      ...chevron(1.9, 1.62, 1.25, amber, 0.28),
      {
        t: 'line',
        x1: 1.9,
        y1: 3.75,
        x2: 24.4,
        y2: 3.75,
        stroke: { color: dim, width: 0.05, dash: [0.3, 0.16] },
      },
      // The scroll bar: a track of dots, the thumb a lit block.
      {
        t: 'line',
        x1: 25.85,
        y1: 1.6,
        x2: 25.85,
        y2: 13.7,
        stroke: { color: dim, width: 0.07, dash: [0.07, 0.24], opacity: 0.8 },
      },
      ...lit({ x: 25.6, y: 4.4, w: 0.5, h: 2.8 }, green, 0.35),
      ...status('2:~', '5 ▪ 40%'),
    ],
    title: {
      x: 3.4,
      y: 1.1,
      w: 21,
      h: 2.3,
      valign: 'middle',
      sample: 'Warum die Kommandozeile bleibt',
    },
    body: { x: 1.9, y: 4.5, w: 22.4, h: 9.5, sample: list },
  },
  {
    name: 'Text und Bild',
    bg: black,
    shapes: [
      ...screen('#0b1f13', 0.7, 0.5),
      ...frame({ x: 1.6, y: 1.5, w: 11.6, h: 12.75 }, amber, 0.06),
      ...lit({ x: 1.6, y: 14.6, w: 3.2, h: 0.22 }, amber, 0.3),
      ...chevron(14.9, 1.75, 1.1, green, 0.28),
      {
        t: 'line',
        x1: 14.9,
        y1: 4.45,
        x2: 26.2,
        y2: 4.45,
        stroke: { color: dim, width: 0.05, dash: [0.3, 0.16] },
      },
    ],
    pictures: [{ x: 2.2, y: 2.1, w: 10.4, h: 11.55 }],
    title: {
      x: 16.1,
      y: 1.1,
      w: 10.2,
      h: 3,
      size: 28,
      valign: 'middle',
      sample: 'Ein Blick auf den Rechner',
    },
    body: {
      x: 14.9,
      y: 5,
      w: 11.4,
      h: 9.2,
      size: 18,
      sample: ['Zwölf Jahre im Dienst', 'Kein einziger Ausfall', 'Wartung per Fernzugriff'],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: black,
    shapes: [
      ...screen('#0b1f13', 0.5, 0.6),
      // Two panes split by a bar, each with its number as a lit tab.
      { t: 'line', x1: 0, y1: 3.9, x2: 28, y2: 3.9, stroke: { color: dim, width: 0.06 } },
      { t: 'line', x1: 14, y1: 3.9, x2: 14, y2: 14.75, stroke: { color: dim, width: 0.06 } },
      { t: 'rect', x: 1.8, y: 3.9, w: 1.5, h: 0.85, fill: green },
      glyph('1', 1.8, 3.88, 14, black, 1.5, 'center'),
      { t: 'rect', x: 15.4, y: 3.9, w: 1.5, h: 0.85, fill: amber },
      glyph('2', 15.4, 3.88, 14, black, 1.5, 'center'),
      ...chevron(1.9, 1.5, 1.15, amber, 0.28),
      ...status('3:~', '2 ▪ 100%'),
    ],
    title: { x: 3.3, y: 0.9, w: 23, h: 2.4, valign: 'middle', sample: 'Vorher und nachher' },
    body: [
      {
        x: 1.8,
        y: 5.4,
        w: 11.2,
        h: 8.7,
        size: 18,
        sample: ['Handarbeit am Server', 'Wissen in drei Köpfen', 'Updates am Wochenende'],
      },
      {
        x: 15.4,
        y: 5.4,
        w: 11.2,
        h: 8.7,
        size: 18,
        sample: ['Ein Skript für alles', 'Wissen im Repository', 'Updates jeden Dienstag'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: black,
    shapes: [
      ...screen('#2a1c02', 0.3, 0.42),
      // A meter of blocks climbing to the right.
      ...Array.from({ length: 9 }, (_, i): Shape[] => {
        const h = 1.1 + i * 1.12;
        const box = { x: 17.2 + i * 1.02, y: 13 - h, w: 0.72, h };
        return i > 5
          ? lit(box, amber, 0.4)
          : [{ t: 'rect', ...box, fill: { t: 'solid', color: amber, opacity: 0.16 + i * 0.07 } }];
      }).flat(),
      {
        t: 'line',
        x1: 17.2,
        y1: 13.45,
        x2: 26.1,
        y2: 13.45,
        stroke: { color: amber, width: 0.05, dash: [0.3, 0.16] },
      },
      ...chevron(2.4, 10.55, 0.95, green, 0.3),
    ],
    title: {
      x: 2.2,
      y: 2.3,
      w: 15,
      h: 7.2,
      size: 120,
      color: amber,
      valign: 'middle',
      sample: '99,98',
    },
    body: {
      x: 3.7,
      y: 10.1,
      w: 12.6,
      h: 4,
      size: 20,
      sample: 'Prozent Verfügbarkeit im letzten Jahr – bei 41 Rechnern.',
    },
  },
  {
    name: 'Zitat',
    bg: black,
    shapes: [
      ...screen('#0f2a19', 0.5, 0.45),
      ...frame({ x: 1.7, y: 1.5, w: 24.6, h: 12.75 }, dim, 0.05, true),
      // Quoted as in a mail: a chevron before every line.
      ...Array.from({ length: 5 }, (_, i) =>
        chevron(3.3, 3.35 + i * 1.58, 0.95, amber, 0.3),
      ).flat(),
      { t: 'rect', x: 12.6, y: 12.02, w: 1.5, h: 0.14, fill: amber },
      ...lit({ x: 3.3, y: 11.55, w: 0.6, h: 1.05 }, green, 0.35),
    ],
    body: {
      x: 5,
      y: 2.9,
      w: 19.8,
      h: 8,
      size: 30,
      bold: true,
      color: green,
      lineHeight: 125,
      valign: 'middle',
      sample: 'Einfach heißt nicht leicht. Einfach heißt: Es bleibt nichts mehr wegzulassen.',
    },
    subtitle: {
      x: 14.5,
      y: 11.2,
      w: 10.6,
      h: 1.8,
      valign: 'middle',
      sample: 'Ada, Systembetreuerin',
    },
  },
  {
    name: 'Bild',
    bg: black,
    shapes: [
      ...screen('#0b1f13', 0.5, 0.5),
      // The least a window needs: a bar, three squares.
      { t: 'rect', x: 1.5, y: 1.2, w: 25, h: 0.8, fill: pane },
      { t: 'rect', x: 1.8, y: 1.45, w: 0.3, h: 0.3, fill: green },
      { t: 'rect', x: 2.35, y: 1.45, w: 0.3, h: 0.3, fill: amber },
      { t: 'rect', x: 2.9, y: 1.45, w: 0.3, h: 0.3, fill: dim },
      {
        t: 'rect',
        x: 1.5,
        y: 1.2,
        w: 25,
        h: 11.5,
        fill: null,
        stroke: { color: dim, width: 0.05 },
      },
      ...chevron(1.6, 13.5, 0.95, amber, 0.3),
      ...lit({ x: 25.9, y: 13.45, w: 0.6, h: 1.05 }, green, 0.35),
    ],
    pictures: [{ x: 1.5, y: 2, w: 25, h: 10.7 }],
    title: {
      x: 2.8,
      y: 13.05,
      w: 22.6,
      h: 1.85,
      size: 24,
      valign: 'middle',
      sample: 'Der Rechnerraum im Keller',
    },
  },
  {
    name: 'Schluss',
    bg: black,
    shapes: [
      ...screen('#123420', 0.5, 0.45),
      ...scrolled({ x: 1.8, y: 1.3, w: 9, h: 1.5 }, 4, 8),
      ...frame({ x: 4.6, y: 3.5, w: 18.8, h: 7 }, green, 0.07, true),
      ...plus(14, 3.5, green, 0.2, 0.07),
      ...plus(14, 10.5, green, 0.2, 0.07),
      ...chevron(8.1, 11.82, 0.9, amber, 0.3),
      ...lit({ x: 13.5, y: 13.6, w: 1, h: 0.3 }, green, 0.35),
      ...scrolled({ x: 19.4, y: 12.9, w: 6.8, h: 1.5 }, 4, 15),
    ],
    title: {
      x: 5.4,
      y: 4,
      w: 17.2,
      h: 6,
      size: 60,
      align: 'center',
      valign: 'middle',
      sample: 'exit 0',
    },
    subtitle: {
      x: 9.2,
      y: 11.4,
      w: 12,
      h: 1.7,
      valign: 'middle',
      sample: 'Danke. Noch Fragen?',
    },
  },
];

const template: Template = {
  slug: 'terminal',
  name: 'Terminal',
  group: 'Designtrend',
  tags: ['Terminal', 'Konsole', 'Code', 'Monospace', 'dunkel', 'Technik', 'Entwicklung', 'Retro'],
  description:
    'Ein Textbildschirm: Phosphorgrün und Bernstein auf Schwarz, Zeilenraster, Prompt und Blockcursor.',
  palette: {
    bg: black,
    text: soft,
    bg2: pane,
    text2: dim,
    accents: [green, amber, cyan, red, violet, '#eafff0'],
  },
  fonts: { head: mono, body: mono },
  text: {
    title: { font: mono, size: 32, color: green, bold: true, lineHeight: 108 },
    subtitle: { font: mono, size: 20, color: amber },
    body: { font: mono, size: 20, color: soft, lineHeight: 125, paraSpace: 0.42 },
  },
  layouts,
};

export default template;
