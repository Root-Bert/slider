import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { grain, jpeg, mesh, rgba } from '../art';
import type { Color, Layout, Shape, Template } from '../model';
import { page } from '../shapes';

/*
 * Glasmorphismus: sheets of frosted glass over glowing colour. LibreOffice cannot blur what lies
 * behind a shape, so every pane is painted into the page's picture – the ground blurred where
 * the pane is, a little lighter, with a thin bright rim – and the placeholders sit exactly on
 * the panes.
 */

const night = '#17104a';
const magenta = '#e23a9c';
const violet = '#6d3ff2';
const blue = '#1f7df5';
const cyan = '#1fc7d9';
const orange = '#ff8c3f';
const rose = '#ff9fca';
const white = '#ffffff';
const mist = '#d9d2f7';

interface Cloud {
  x: number;
  y: number;
  r: number;
  color: Color;
  alpha?: number;
}
/** A sharp ball of colour behind the glass (centimetres). */
interface Orb {
  x: number;
  y: number;
  r: number;
  from: Color;
  to: Color;
}
/** A pane of glass (centimetres); `circle` takes `w` as its diameter. */
interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  rotate?: number;
  circle?: boolean;
  /** How milky it is, 0 … 1. */
  milk?: number;
  /** A dark veil for panes that carry much text. */
  veil?: number;
}

function trace(ctx: SKRSContext2D, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(-w / 2 + radius, -h / 2);
  ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, radius);
  ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, radius);
  ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, radius);
  ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, radius);
  ctx.closePath();
}

/** The page's picture: clouds, balls, and the panes of glass over them. */
function scene(
  clouds: readonly Cloud[],
  orbs: readonly Orb[],
  panes: readonly Pane[],
  seed = 1,
): Shape {
  const surface = mesh(night, clouds);
  const { ctx, w, h, px } = surface;
  for (const orb of orbs) {
    const [x, y, r] = [orb.x * px, orb.y * px, orb.r * px];
    const fill = ctx.createLinearGradient(x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7);
    fill.addColorStop(0, orb.from);
    fill.addColorStop(1, orb.to);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // What the glass shows: all of it out of focus. Drawn a little larger so that the blur finds
  // colour beyond the page's edge.
  const frosted = createCanvas(w, h);
  const soft = frosted.getContext('2d');
  soft.fillStyle = night;
  soft.fillRect(0, 0, w, h);
  soft.filter = `blur(${Math.round(px * 0.75)}px)`;
  soft.drawImage(surface.canvas, -w * 0.04, -h * 0.04, w * 1.08, h * 1.08);
  soft.drawImage(surface.canvas, -w * 0.04, -h * 0.04, w * 1.08, h * 1.08);

  for (const pane of panes) {
    const [pw, ph] = [pane.w * px, (pane.circle ? pane.w : pane.h) * px];
    const radius = pane.circle ? pw / 2 : (pane.r ?? 0.8) * px;
    const place = () => {
      ctx.translate(
        (pane.x + pane.w / 2) * px,
        (pane.y + (pane.circle ? pane.w : pane.h) / 2) * px,
      );
      ctx.rotate(((pane.rotate ?? 0) * Math.PI) / 180);
    };
    // Its shadow on what lies behind.
    ctx.save();
    place();
    trace(ctx, pw, ph, radius);
    ctx.shadowColor = 'rgba(12,6,50,0.42)';
    ctx.shadowBlur = px * 0.9;
    ctx.shadowOffsetY = px * 0.35;
    ctx.fillStyle = night;
    ctx.fill();
    ctx.restore();
    // The glass.
    ctx.save();
    place();
    trace(ctx, pw, ph, radius);
    ctx.clip();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(frosted, 0, 0);
    ctx.restore();
    if (pane.veil) {
      ctx.fillStyle = rgba(night, pane.veil);
      ctx.fillRect(-pw, -ph, pw * 2, ph * 2);
    }
    ctx.fillStyle = rgba(white, pane.milk ?? 0.13);
    ctx.fillRect(-pw, -ph, pw * 2, ph * 2);
    // Light falling in from the upper left.
    const sheen = ctx.createLinearGradient(-pw / 2, -ph / 2, pw * 0.2, ph / 2);
    sheen.addColorStop(0, rgba(white, 0.2));
    sheen.addColorStop(0.55, rgba(white, 0.03));
    sheen.addColorStop(1, rgba(white, 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(-pw, -ph, pw * 2, ph * 2);
    ctx.restore();
    // The rim: bright where the light comes from.
    ctx.save();
    place();
    trace(ctx, pw - 2, ph - 2, radius);
    const rim = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
    rim.addColorStop(0, rgba(white, 0.85));
    rim.addColorStop(0.45, rgba(white, 0.28));
    rim.addColorStop(1, rgba(white, 0.12));
    ctx.strokeStyle = rim;
    ctx.lineWidth = Math.max(2, px * 0.035);
    ctx.stroke();
    ctx.restore();
  }
  grain(surface, 0.022, seed);
  return { t: 'image', ...page, src: jpeg(surface, 80) };
}

const ball = (x: number, y: number, r: number, from: Color, to: Color): Orb => ({
  x,
  y,
  r,
  from,
  to,
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: night,
    shapes: [
      scene(
        [
          { x: 0.78, y: 0.25, r: 0.5, color: magenta },
          { x: 0.15, y: 0.9, r: 0.45, color: blue },
          { x: 0.5, y: 0.55, r: 0.4, color: violet, alpha: 0.8 },
          { x: 1, y: 1, r: 0.3, color: orange, alpha: 0.6 },
        ],
        [
          ball(21.2, 5.2, 4.2, orange, magenta),
          ball(3.4, 13.6, 2.2, cyan, blue),
          ball(25.2, 13.2, 1.1, rose, violet),
        ],
        [
          { x: 2, y: 2.6, w: 18.4, h: 10.4, r: 1 },
          { x: 21.6, y: 10.2, w: 3, h: 3, circle: true, milk: 0.2 },
        ],
        1,
      ),
    ],
    title: {
      x: 3.4,
      y: 3.4,
      w: 15.6,
      h: 6,
      valign: 'middle',
      sample: 'Klarheit\nhinter Glas',
    },
    subtitle: {
      x: 3.4,
      y: 9.9,
      w: 15.6,
      h: 2.2,
      valign: 'top',
      sample: 'Produktvision für das kommende Jahr',
    },
  },
  {
    name: 'Abschnitt',
    bg: night,
    shapes: [
      scene(
        [
          { x: 0.85, y: 0.5, r: 0.55, color: violet },
          { x: 0.7, y: 1, r: 0.4, color: blue, alpha: 0.8 },
          { x: 0.0, y: 0.0, r: 0.3, color: magenta, alpha: 0.5 },
        ],
        [
          ball(17.6, 4.6, 3.1, magenta, violet),
          ball(24.4, 11.6, 2.5, cyan, blue),
          ball(15.4, 12.6, 0.9, orange, magenta),
        ],
        [
          { x: 15, y: 2.4, w: 11, h: 11, circle: true, milk: 0.16 },
          { x: 2, y: 10.6, w: 11.6, h: 2.2, r: 1.1 },
        ],
        2,
      ),
    ],
    title: {
      x: 2,
      y: 3.4,
      w: 12.6,
      h: 6.6,
      size: 46,
      valign: 'bottom',
      sample: 'Zweitens:\nTiefe durch Schichten',
    },
    subtitle: {
      x: 2.8,
      y: 10.6,
      w: 10.4,
      h: 2.2,
      size: 20,
      valign: 'middle',
      sample: 'Was vorn liegt, was dahinter',
    },
  },
  {
    name: 'Inhalt',
    bg: night,
    shapes: [
      scene(
        [
          { x: 1, y: 0.1, r: 0.45, color: magenta, alpha: 0.85 },
          { x: 0.1, y: 1, r: 0.5, color: violet },
          { x: 0.55, y: 0.6, r: 0.4, color: blue, alpha: 0.7 },
        ],
        [ball(24.6, 3.4, 2.5, orange, magenta), ball(2.2, 13.4, 2, violet, blue)],
        [{ x: 1.8, y: 4, w: 24.4, h: 10.3, r: 0.9, veil: 0.12 }],
        3,
      ),
    ],
    title: {
      x: 1.9,
      y: 1,
      w: 19.6,
      h: 2.6,
      size: 34,
      valign: 'middle',
      sample: 'Woran man gutes Glas erkennt',
    },
    body: {
      x: 3,
      y: 4.9,
      w: 22,
      h: 8.6,
      sample: [
        'Der Hintergrund bleibt farbig und bewegt',
        'Flächen sind milchig, nie ganz deckend',
        'Ein heller Rand trennt Scheibe und Grund',
        'Schrift steht in klarem Weiß',
        'Wenige Schichten, deutlich gestaffelt',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: night,
    shapes: [
      scene(
        [
          { x: 0.1, y: 0.15, r: 0.5, color: blue },
          { x: 0.95, y: 0.85, r: 0.5, color: magenta, alpha: 0.85 },
          { x: 0.55, y: 0.4, r: 0.35, color: violet, alpha: 0.8 },
        ],
        [ball(13.8, 2.6, 2.1, cyan, blue), ball(14.6, 13.2, 1.5, magenta, violet)],
        [
          { x: 1.6, y: 1.6, w: 12.4, h: 12.55, r: 0.9, veil: 0.1 },
          { x: 15, y: 2.6, w: 11.4, h: 10.55, r: 0.7, milk: 0.2 },
        ],
        4,
      ),
    ],
    title: {
      x: 2.8,
      y: 2.3,
      w: 10.2,
      h: 3.3,
      size: 28,
      valign: 'middle',
      sample: 'Ein Bild hinter der Scheibe',
    },
    body: {
      x: 2.8,
      y: 5.9,
      w: 10.2,
      h: 7.6,
      size: 19,
      sample: [
        'Die Scheibe rahmt das Motiv',
        'Farbe scheint an den Rändern durch',
        'Text bleibt ruhig lesbar',
      ],
    },
    pictures: [{ x: 15.55, y: 3.15, w: 10.3, h: 9.45 }],
  },
  {
    name: 'Zwei Spalten',
    bg: night,
    shapes: [
      scene(
        [
          { x: 0.5, y: 0.6, r: 0.5, color: violet },
          { x: 0.0, y: 0.3, r: 0.4, color: blue, alpha: 0.8 },
          { x: 1, y: 0.4, r: 0.4, color: magenta, alpha: 0.8 },
        ],
        [
          ball(14, 11.9, 2.7, magenta, orange),
          ball(26.6, 4.2, 1.6, cyan, blue),
          ball(1.2, 14.4, 1.4, rose, magenta),
        ],
        [
          { x: 1.8, y: 4.2, w: 11.7, h: 10.1, r: 0.9, veil: 0.2 },
          { x: 14.5, y: 4.2, w: 11.7, h: 10.1, r: 0.9, veil: 0.2 },
        ],
        5,
      ),
    ],
    title: {
      x: 1.9,
      y: 1.1,
      w: 24.2,
      h: 2.6,
      size: 34,
      valign: 'middle',
      sample: 'Matt oder klar',
    },
    body: [
      {
        x: 2.9,
        y: 5.1,
        w: 9.7,
        h: 8.4,
        size: 19,
        sample: ['Mattes Glas beruhigt', 'Gut für lange Texte', 'Hintergrund nur als Schimmer'],
      },
      {
        x: 15.6,
        y: 5.1,
        w: 9.7,
        h: 8.4,
        size: 19,
        sample: ['Klares Glas zeigt Tiefe', 'Gut für Zahlen und Titel', 'Hintergrund spielt mit'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: night,
    shapes: [
      scene(
        [
          { x: 0.2, y: 0.3, r: 0.5, color: magenta, alpha: 0.85 },
          { x: 0.9, y: 0.8, r: 0.5, color: blue },
          { x: 0.6, y: 0.2, r: 0.35, color: violet, alpha: 0.8 },
        ],
        [
          ball(5.6, 4.4, 3, orange, magenta),
          ball(22.6, 12, 2.7, cyan, violet),
          ball(13.6, 13.4, 1, rose, magenta),
        ],
        [
          { x: 4.4, y: 2.4, w: 21, h: 10.2, r: 1, rotate: -5, milk: 0.08 },
          { x: 2.2, y: 3.4, w: 23.6, h: 9.4, r: 1 },
        ],
        6,
      ),
      {
        t: 'rect',
        x: 14.3,
        y: 5.4,
        w: 0.05,
        h: 5.4,
        fill: { t: 'solid', color: white, opacity: 0.4 },
      },
    ],
    title: {
      x: 2.8,
      y: 4.6,
      w: 11.2,
      h: 7,
      size: 100,
      align: 'center',
      valign: 'middle',
      sample: '94 %',
    },
    body: {
      x: 15.3,
      y: 4.6,
      w: 9.4,
      h: 7,
      size: 22,
      valign: 'middle',
      sample: 'der Befragten finden sich auf der neuen Oberfläche sofort zurecht.',
    },
  },
  {
    name: 'Zitat',
    bg: night,
    shapes: [
      scene(
        [
          { x: 0.5, y: 0.0, r: 0.5, color: violet },
          { x: 0.0, y: 0.8, r: 0.45, color: magenta, alpha: 0.85 },
          { x: 1, y: 0.9, r: 0.45, color: blue, alpha: 0.85 },
        ],
        [
          ball(4.2, 4, 2.6, magenta, violet),
          ball(6.4, 13.2, 2.1, orange, magenta),
          ball(24.8, 3, 1.3, cyan, blue),
        ],
        [
          { x: 3.4, y: 2.4, w: 21.2, h: 9.2, r: 1.1 },
          { x: 2, y: 1.2, w: 3.6, h: 3.6, circle: true, milk: 0.24 },
          { x: 9.4, y: 12.3, w: 15.2, h: 2, r: 1 },
        ],
        7,
      ),
      {
        t: 'text',
        x: 2,
        y: 1.75,
        w: 3.6,
        h: 3.6,
        text: '“',
        font: 'Plus Jakarta Sans',
        bold: true,
        size: 84,
        color: white,
        align: 'center',
        valign: 'top',
      },
    ],
    body: {
      x: 5.4,
      y: 3.2,
      w: 17.6,
      h: 7.6,
      size: 32,
      bold: true,
      lineHeight: 120,
      valign: 'middle',
      sample: 'Durch Glas sieht man nicht weniger. Man sieht ruhiger.',
    },
    subtitle: {
      x: 10.2,
      y: 12.3,
      w: 13.6,
      h: 2,
      size: 20,
      align: 'right',
      valign: 'middle',
      sample: 'Elif Aydın, Leitung Gestaltung',
    },
  },
  {
    name: 'Bild',
    bg: night,
    shapes: [
      scene(
        [
          { x: 0.0, y: 0.0, r: 0.5, color: magenta, alpha: 0.85 },
          { x: 1, y: 1, r: 0.55, color: blue },
          { x: 0.6, y: 0.3, r: 0.35, color: violet, alpha: 0.8 },
        ],
        [ball(1.8, 2, 2.2, orange, magenta), ball(26.4, 13.6, 2.4, cyan, violet)],
        [{ x: 1.6, y: 1.2, w: 24.8, h: 13.35, r: 0.9, milk: 0.18 }],
        8,
      ),
    ],
    pictures: [{ x: 2.2, y: 1.8, w: 23.6, h: 10 }],
    title: {
      x: 2.6,
      y: 12,
      w: 22.8,
      h: 2.3,
      size: 26,
      valign: 'middle',
      sample: 'Die Oberfläche im Abendlicht',
    },
  },
  {
    name: 'Schluss',
    bg: night,
    shapes: [
      scene(
        [
          { x: 0.5, y: 0.5, r: 0.55, color: violet },
          { x: 0.1, y: 0.1, r: 0.4, color: blue, alpha: 0.8 },
          { x: 0.9, y: 0.95, r: 0.4, color: magenta, alpha: 0.85 },
        ],
        [
          ball(21.2, 4.2, 3.6, orange, magenta),
          ball(5, 11.8, 1.5, cyan, blue),
          ball(7.6, 3.6, 1.2, rose, violet),
        ],
        [
          { x: 4, y: 4.4, w: 20, h: 6.2, r: 1.1 },
          { x: 8, y: 11.7, w: 12, h: 2.1, r: 1.05, milk: 0.2 },
        ],
        9,
      ),
    ],
    title: {
      x: 5,
      y: 4.6,
      w: 18,
      h: 5.8,
      size: 60,
      align: 'center',
      valign: 'middle',
      sample: 'Danke',
    },
    subtitle: {
      x: 8.6,
      y: 11.7,
      w: 10.8,
      h: 2.1,
      size: 20,
      align: 'center',
      valign: 'middle',
      sample: 'Fragen? Gern jetzt.',
    },
  },
];

const template: Template = {
  slug: 'glasmorph',
  name: 'Glasmorphismus',
  group: 'Designtrend',
  tags: ['Glasmorphismus', 'Milchglas', 'Farbverlauf', 'leuchtend', 'dunkel', 'App', 'Technik'],
  description:
    'Scheiben aus Milchglas mit hellem Rand über leuchtenden, verschwommenen Farbwolken; weiße Schrift auf dem Glas.',
  palette: {
    bg: night,
    text: white,
    bg2: '#3b2b8f',
    text2: mist,
    accents: [magenta, violet, blue, cyan, orange, rose],
  },
  fonts: { head: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans' },
  text: {
    title: { font: 'Plus Jakarta Sans', size: 54, bold: true, color: white, lineHeight: 106 },
    subtitle: { font: 'Plus Jakarta Sans', size: 22, color: mist, lineHeight: 120 },
    body: {
      font: 'Plus Jakarta Sans',
      size: 21,
      color: white,
      lineHeight: 124,
      paraSpace: 0.38,
    },
  },
  layouts,
};

export default template;
