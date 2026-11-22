import { bubble, darken, grain, jpeg, lighten, paint, rgba, type Paint } from '../art';
import type { Color, Layout, Shape, Template } from '../model';
import { page } from '../shapes';

/*
 * Frutiger Aero: the optimism of the mid-2000s screen. Blue sky running into aqua, sunlight with
 * its flare, soft green hills, glossy see-through bubbles, and panes of glass with a white shine
 * across their upper half. All of it painted; the placeholders sit on the panes.
 */

const deep = '#0a56b8';
const sky = '#1b86de';
const aqua = '#39cfd9';
const pale = '#dff8ff';
const grass = '#73c92f';
const leaf = '#2f9d2c';
const sun = '#ffd84a';
const navy = '#0b3a66';
const slate = '#3d6385';
const white = '#ffffff';

interface Form {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
}

function trace(p: Paint, form: Form, shrink = 0): void {
  const { ctx, px } = p;
  const [x, y, w, h] = [
    form.x * px + shrink,
    form.y * px + shrink,
    form.w * px - shrink * 2,
    form.h * px - shrink * 2,
  ];
  const r = Math.max(0, Math.min((form.r ?? 99) * px - shrink, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The sky: colours from the top of the page to its bottom. */
function air(p: Paint, stops: readonly (readonly [number, Color])[]): void {
  const { ctx, w, h } = p;
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  for (const [at, color] of stops) fill.addColorStop(at, color);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
}

const DAY = [
  [0, deep],
  [0.5, sky],
  [0.8, '#6fd0f2'],
  [1, '#e6fbff'],
] as const;
const WATER = [
  [0, '#0a4fae'],
  [0.55, '#0f8fd0'],
  [1, '#43d6d2'],
] as const;
const MORNING = [
  [0, '#2f9de8'],
  [0.55, '#9fe2f6'],
  [1, '#f3feff'],
] as const;

/** Shafts of light fanning out from a point. */
function rays(p: Paint, cx: number, cy: number, from: number, to: number, count: number): void {
  const { ctx, px, w } = p;
  const step = (to - from) / count;
  for (let i = 0; i < count; i += 1) {
    const a = ((from + i * step) * Math.PI) / 180;
    const b = ((from + (i + 0.42) * step) * Math.PI) / 180;
    const reach = w * 1.2;
    const fill = ctx.createRadialGradient(cx * px, cy * px, 0, cx * px, cy * px, reach * 0.7);
    fill.addColorStop(0, 'rgba(255,255,255,0.22)');
    fill.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(cx * px, cy * px);
    ctx.lineTo(cx * px + Math.cos(a) * reach, cy * px + Math.sin(a) * reach);
    ctx.lineTo(cx * px + Math.cos(b) * reach, cy * px + Math.sin(b) * reach);
    ctx.closePath();
    ctx.fill();
  }
}

/** The sun in the lens: its glow, a streak, and ghosts along the line to (`tx`, `ty`). */
function flare(p: Paint, cx: number, cy: number, r: number, tx: number, ty: number): void {
  const { ctx, px } = p;
  const [x, y] = [cx * px, cy * px];
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * px);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.12, 'rgba(255,255,240,0.95)');
  glow.addColorStop(0.3, 'rgba(255,250,210,0.45)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - r * px, y - r * px, r * px * 2, r * px * 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.035);
  const streak = ctx.createRadialGradient(0, 0, 0, 0, 0, r * px * 2.2);
  streak.addColorStop(0, 'rgba(255,255,255,0.9)');
  streak.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = streak;
  ctx.beginPath();
  ctx.arc(0, 0, r * px * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const ghosts = [
    [0.28, 0.16, '#ffffff', 0.16],
    [0.45, 0.34, '#b8ffe9', 0.14],
    [0.62, 0.12, '#fff3a8', 0.22],
    [0.8, 0.5, '#bfe9ff', 0.12],
    [1, 0.24, '#ffffff', 0.14],
  ] as const;
  for (const [t, size, color, alpha] of ghosts) {
    const [gx, gy] = [x + (tx * px - x) * t, y + (ty * px - y) * t];
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.arc(gx, gy, size * r * px * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(color, alpha * 1.6);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** A soft hill line across the page, filled down to its bottom, with light on its ridge. */
function hill(
  p: Paint,
  base: number,
  amp: number,
  phase: number,
  top: Color,
  bottom: Color,
  waves = 1.3,
): void {
  const { ctx, px, w, h } = p;
  const at = (x: number) => {
    const t = (x / w) * Math.PI * 2;
    return (
      (base -
        amp * (Math.sin(t * waves + phase) * 0.7 + Math.sin(t * waves * 2.3 + phase * 2) * 0.3)) *
      px
    );
  };
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, at(x));
    ctx.lineTo(w, at(w));
    ctx.lineTo(w, h);
    ctx.closePath();
  };
  const fill = ctx.createLinearGradient(0, (base - amp) * px, 0, h);
  fill.addColorStop(0, top);
  fill.addColorStop(1, bottom);
  ctx.fillStyle = fill;
  outline();
  ctx.fill();
  // The ridge catches the light.
  ctx.save();
  outline();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = px * 0.5;
  ctx.shadowColor = 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = px * 0.5;
  ctx.beginPath();
  for (let x = -10; x <= w + 10; x += 6) ctx.lineTo(x, at(x) - px * 0.26);
  ctx.stroke();
  ctx.restore();
}

/** The meadow most pages stand on: two hills, the far one hazier. */
function meadow(p: Paint, base: number, phase = 0): void {
  hill(p, base - 0.9, 0.7, phase + 1.7, '#a5e06a', '#58b83a', 1.1);
  hill(p, base, 0.8, phase, grass, leaf, 1.4);
}

/** A ribbon of light sweeping across the sky. */
function swoosh(p: Paint, y: number, bend: number, thick: number, alpha = 0.3): void {
  const { ctx, px, w } = p;
  const fill = ctx.createLinearGradient(0, 0, w, 0);
  fill.addColorStop(0, 'rgba(255,255,255,0)');
  fill.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
  fill.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(-10, (y + bend) * px);
  ctx.bezierCurveTo(
    w * 0.3,
    (y - bend) * px,
    w * 0.6,
    (y + bend * 1.4) * px,
    w + 10,
    (y - bend) * px,
  );
  ctx.bezierCurveTo(
    w * 0.62,
    (y + bend * 1.4 + thick) * px,
    w * 0.32,
    (y - bend + thick * 2.2) * px,
    -10,
    (y + bend + thick * 0.3) * px,
  );
  ctx.closePath();
  ctx.fill();
}

/** Only the shadow of a form, on what lies outside it. */
function drop(p: Paint, form: Form, color = 'rgba(6,50,110,0.38)'): void {
  const { ctx, px, w, h } = p;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  trace(p, form);
  ctx.clip('evenodd');
  ctx.shadowColor = color;
  ctx.shadowBlur = px * 0.7;
  ctx.shadowOffsetY = px * 0.28;
  ctx.fillStyle = white;
  ctx.beginPath();
  trace(p, form);
  ctx.fill();
  ctx.restore();
}

/** The white shine across the upper part of a form. */
function shine(p: Paint, form: Form, strength = 0.6): void {
  const { ctx, px } = p;
  const [x, y, w, h] = [form.x * px, form.y * px, form.w * px, form.h * px];
  const reach = Math.min(h * 0.5, px * 2.6);
  ctx.save();
  ctx.beginPath();
  trace(p, form, 3);
  ctx.clip();
  const fill = ctx.createLinearGradient(0, y, 0, y + reach);
  fill.addColorStop(0, `rgba(255,255,255,${strength})`);
  fill.addColorStop(1, `rgba(255,255,255,${strength * 0.14})`);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + reach * 0.72);
  ctx.quadraticCurveTo(x + w / 2, y + reach * 1.25, x, y + reach * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A pane of glass: milky, see-through, with its shine and a white rim. */
function glass(p: Paint, form: Form, milk = 0.66): void {
  const { ctx, px } = p;
  drop(p, form);
  const body = ctx.createLinearGradient(0, form.y * px, 0, (form.y + form.h) * px);
  body.addColorStop(0, `rgba(255,255,255,${milk + 0.12})`);
  body.addColorStop(1, `rgba(240,252,255,${milk})`);
  ctx.fillStyle = body;
  ctx.beginPath();
  trace(p, form);
  ctx.fill();
  shine(p, form, 0.55);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = Math.max(2, px * 0.045);
  ctx.beginPath();
  trace(p, form, 1);
  ctx.stroke();
}

/** A glossy bar or button of one colour. */
function gloss(p: Paint, form: Form, color: Color): void {
  const { ctx, px } = p;
  drop(p, form);
  const body = ctx.createLinearGradient(0, form.y * px, 0, (form.y + form.h) * px);
  body.addColorStop(0, lighten(color, 0.22));
  body.addColorStop(0.5, color);
  body.addColorStop(0.52, darken(color, 0.1));
  body.addColorStop(1, lighten(color, 0.12));
  ctx.fillStyle = body;
  ctx.beginPath();
  trace(p, form);
  ctx.fill();
  shine(p, { ...form, h: form.h * 1.0 }, 0.5);
  ctx.strokeStyle = rgba(darken(color, 0.35), 0.8);
  ctx.lineWidth = 2;
  ctx.beginPath();
  trace(p, form, 1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  trace(p, form, 3);
  ctx.stroke();
}

/** A solid glossy ball – a button rather than a bubble. */
function orb(p: Paint, cx: number, cy: number, r: number, color: Color): void {
  const { ctx, px } = p;
  const [x, y, radius] = [cx * px, cy * px, r * px];
  ctx.save();
  ctx.shadowColor = 'rgba(6,50,110,0.4)';
  ctx.shadowBlur = radius * 0.35;
  ctx.shadowOffsetY = radius * 0.12;
  const body = ctx.createRadialGradient(x, y + radius * 0.55, radius * 0.05, x, y, radius);
  body.addColorStop(0, lighten(color, 0.42));
  body.addColorStop(0.55, color);
  body.addColorStop(1, darken(color, 0.38));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const light = ctx.createLinearGradient(0, y - radius, 0, y - radius * 0.1);
  light.addColorStop(0, 'rgba(255,255,255,0.92)');
  light.addColorStop(1, 'rgba(255,255,255,0.06)');
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.ellipse(x, y - radius * 0.52, radius * 0.7, radius * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(darken(color, 0.45), 0.55);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius - 1, 0, Math.PI * 2);
  ctx.stroke();
}

/** See-through bubbles: x, y, radius (centimetres) and colour each. */
function bubbles(p: Paint, list: readonly (readonly [number, number, number, Color?])[]): void {
  for (const [x, y, r, color] of list) {
    bubble(p.ctx, x * p.px, y * p.px, r * p.px, color ?? '#8fe6ff');
  }
}

function scene(draw: (p: Paint) => void, seed: number): Shape {
  const p = paint();
  draw(p);
  grain(p, 0.012, seed);
  return { t: 'image', ...page, src: jpeg(p, 82) };
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: sky,
    shapes: [
      scene((p) => {
        air(p, DAY);
        rays(p, 22.6, 3.4, 60, 200, 9);
        swoosh(p, 8.6, 1.2, 0.9, 0.34);
        swoosh(p, 10.2, -0.9, 0.5, 0.22);
        flare(p, 22.6, 3.4, 5.2, 9, 14);
        meadow(p, 13.9, 0.4);
        bubbles(p, [
          [20.2, 9.4, 2.1, '#7fe0ff'],
          [24.4, 11.2, 1.2, '#a8f08a'],
          [17.2, 11.8, 0.75],
          [25.6, 7.6, 0.6],
          [16.6, 8.6, 0.4, '#a8f08a'],
          [22.6, 12.9, 0.5],
        ]);
        glass(p, { x: 2, y: 9.1, w: 12.6, h: 2.1 }, 0.6);
      }, 1),
    ],
    title: {
      x: 2,
      y: 2,
      w: 15.4,
      h: 6.4,
      valign: 'bottom',
      sample: 'Ein klarer\nMorgen',
    },
    subtitle: {
      x: 2.9,
      y: 9.1,
      w: 11,
      h: 2.1,
      valign: 'middle',
      sample: 'Ausblick auf das neue Jahr',
    },
  },
  {
    name: 'Abschnitt',
    bg: sky,
    shapes: [
      scene((p) => {
        air(p, WATER);
        rays(p, 20, -3, 50, 140, 8);
        swoosh(p, 12.4, 1.1, 0.8, 0.22);
        bubbles(p, [
          [21.4, 7.6, 4.3, '#6fdcff'],
          [16.4, 12.6, 1.3, '#9df5c8'],
          [25.6, 2.4, 0.9],
          [17.2, 2.8, 0.55],
          [26.2, 13.2, 0.7, '#9df5c8'],
          [14.8, 9.6, 0.4],
          [23.4, 13.8, 0.35],
        ]);
        glass(p, { x: 2, y: 3.8, w: 15, h: 8.2, r: 1 }, 0.64);
        orb(p, 2.6, 4.3, 1, grass);
      }, 2),
    ],
    title: {
      x: 3.4,
      y: 5,
      w: 12.6,
      h: 4.2,
      size: 40,
      color: navy,
      valign: 'bottom',
      sample: 'Kapitel 2:\nFrischer Wind',
    },
    subtitle: {
      x: 3.4,
      y: 9.5,
      w: 12.6,
      h: 1.7,
      valign: 'top',
      sample: 'Was wir leichter machen',
    },
  },
  {
    name: 'Inhalt',
    bg: pale,
    shapes: [
      scene((p) => {
        air(p, MORNING);
        rays(p, 26, -2, 90, 170, 7);
        hill(p, 14.9, 0.5, 2.2, '#a5e06a', '#62bf3c', 1.2);
        bubbles(p, [
          [25.2, 12.6, 1.6, '#7fe0ff'],
          [1.6, 13.6, 1.1, '#a8f08a'],
          [26.8, 9.4, 0.6],
          [0.9, 5.4, 0.5],
        ]);
        gloss(p, { x: 1.8, y: 1.1, w: 24.4, h: 2.6 }, '#1877dc');
        orb(p, 3.1, 2.4, 0.72, grass);
        glass(p, { x: 1.8, y: 4.5, w: 24.4, h: 9.7, r: 0.9 }, 0.7);
      }, 3),
    ],
    title: {
      x: 4.3,
      y: 1.1,
      w: 21,
      h: 2.6,
      size: 30,
      valign: 'middle',
      sample: 'Was den Alltag leichter macht',
    },
    body: {
      x: 2.9,
      y: 5.3,
      w: 22.2,
      h: 8.3,
      sample: [
        'Alles Wichtige auf einen Blick',
        'Freundliche Farben statt grauer Menüs',
        'Hilfe, wo man sie braucht',
        'Daten wandern von selbst mit',
        'Ein Klick führt zurück zum Anfang',
      ],
    },
  },
  {
    name: 'Text und Bild',
    // Light, so that the bullets on the glass come out dark; the picture covers it.
    bg: pale,
    shapes: [
      scene((p) => {
        air(p, DAY);
        rays(p, 14, -4, 30, 150, 9);
        meadow(p, 14.2, 2.4);
        bubbles(p, [
          [14.3, 12.4, 1.2, '#7fe0ff'],
          [26.6, 1.6, 0.9],
          [14.6, 1.8, 0.5, '#a8f08a'],
          [26.4, 13.4, 0.7, '#a8f08a'],
        ]);
        glass(p, { x: 1.6, y: 1.5, w: 12, h: 12.3, r: 0.9 }, 0.7);
        // The picture's frame: white, glossy, a little thick.
        const frame = { x: 15, y: 2.3, w: 11.4, h: 10.3, r: 0.6 };
        drop(p, frame);
        p.ctx.fillStyle = white;
        p.ctx.beginPath();
        trace(p, frame);
        p.ctx.fill();
        p.ctx.strokeStyle = 'rgba(150,200,235,0.9)';
        p.ctx.lineWidth = 2;
        p.ctx.beginPath();
        trace(p, frame, 1);
        p.ctx.stroke();
      }, 4),
    ],
    title: {
      x: 2.7,
      y: 2.1,
      w: 9.9,
      h: 3.2,
      size: 27,
      color: navy,
      valign: 'middle',
      sample: 'Mehr Licht im Arbeitstag',
    },
    body: {
      x: 2.7,
      y: 5.6,
      w: 9.9,
      h: 7.6,
      size: 19,
      sample: ['Helle, offene Räume', 'Wege, die sich von selbst erklären', 'Pausen im Grünen'],
    },
    pictures: [{ x: 15.5, y: 2.8, w: 10.4, h: 9.3 }],
  },
  {
    name: 'Zwei Spalten',
    bg: pale,
    shapes: [
      scene((p) => {
        air(p, WATER);
        rays(p, 6, -4, 20, 110, 8);
        swoosh(p, 13.4, 0.9, 0.9, 0.25);
        bubbles(p, [
          [14, 14.2, 1.5, '#9df5c8'],
          [0.8, 9.2, 1.1],
          [27.2, 11.6, 1.3, '#6fdcff'],
          [22.8, 2, 0.6],
          [25, 2.9, 0.35],
        ]);
        glass(p, { x: 1.8, y: 4.4, w: 11.8, h: 9.8, r: 0.9 }, 0.7);
        glass(p, { x: 14.4, y: 4.4, w: 11.8, h: 9.8, r: 0.9 }, 0.7);
        orb(p, 13.3, 4.5, 0.8, '#1f8ae6');
        orb(p, 25.9, 4.5, 0.8, grass);
      }, 5),
    ],
    title: {
      x: 1.9,
      y: 1,
      w: 20,
      h: 2.8,
      size: 34,
      valign: 'middle',
      sample: 'Heute und morgen',
    },
    body: [
      {
        x: 2.8,
        y: 5.4,
        w: 9.8,
        h: 8.2,
        size: 19,
        sample: ['Viele einzelne Programme', 'Ablage auf dem eigenen Gerät', 'Updates von Hand'],
      },
      {
        x: 15.4,
        y: 5.4,
        w: 9.8,
        h: 8.2,
        size: 19,
        sample: [
          'Alles unter einem Dach',
          'Überall dieselben Daten',
          'Immer auf dem neuesten Stand',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: sky,
    shapes: [
      scene((p) => {
        air(p, MORNING);
        rays(p, 8.2, 7.4, 0, 360, 22);
        flare(p, 24.6, 2.2, 3.4, 12, 13);
        meadow(p, 14.3, 4.1);
        bubbles(p, [
          [15.6, 12.4, 0.9, '#7fe0ff'],
          [2, 2.6, 0.8],
          [13.9, 2.2, 0.5, '#a8f08a'],
          [25.8, 12.9, 1.1, '#a8f08a'],
        ]);
        orb(p, 8.2, 7.5, 5.4, '#1272d6');
        glass(p, { x: 15.4, y: 4.6, w: 10.8, h: 6.2, r: 0.9 }, 0.72);
      }, 6),
    ],
    title: {
      x: 3.4,
      y: 6,
      w: 9.6,
      h: 4.6,
      size: 80,
      align: 'center',
      valign: 'middle',
      sample: '98 %',
    },
    body: {
      x: 16.4,
      y: 5.1,
      w: 8.9,
      h: 5.2,
      size: 21,
      valign: 'middle',
      sample: 'unserer Kundinnen und Kunden würden uns weiterempfehlen.',
    },
  },
  {
    name: 'Zitat',
    bg: sky,
    shapes: [
      scene((p) => {
        air(p, DAY);
        swoosh(p, 4, 1.4, 1.2, 0.3);
        rays(p, 28, 0, 100, 200, 8);
        meadow(p, 14.1, 5.3);
        bubbles(p, [
          [25.6, 1.9, 1.2, '#7fe0ff'],
          [1.6, 11.4, 0.9],
          [26.6, 10.4, 0.6, '#a8f08a'],
        ]);
        glass(p, { x: 3, y: 2.2, w: 22, h: 9.4, r: 1 }, 0.7);
        orb(p, 3.5, 2.8, 1.5, grass);
        gloss(p, { x: 13.4, y: 12.2, w: 11.6, h: 2 }, '#1877dc');
      }, 7),
      {
        t: 'text',
        x: 2,
        y: 2.0,
        w: 3,
        h: 3,
        text: '“',
        font: 'Open Sans',
        bold: true,
        size: 66,
        color: white,
        align: 'center',
        valign: 'top',
      },
    ],
    body: {
      x: 5.6,
      y: 3.6,
      w: 17.8,
      h: 7.2,
      size: 28,
      italic: true,
      color: navy,
      lineHeight: 125,
      valign: 'middle',
      sample: 'Technik ist dann gut, wenn sie sich anfühlt wie ein offenes Fenster.',
    },
    subtitle: {
      x: 14.2,
      y: 12.2,
      w: 10,
      h: 2,
      size: 18,
      color: white,
      align: 'center',
      valign: 'middle',
      sample: 'Clara Winter, Gründerin',
    },
  },
  {
    name: 'Bild',
    bg: sky,
    shapes: [
      scene((p) => {
        air(p, DAY);
        rays(p, 2, -3, 10, 100, 8);
        meadow(p, 13.6, 0.9);
        bubbles(p, [
          [2.4, 13.4, 1.2, '#7fe0ff'],
          [25.6, 13.6, 0.9, '#a8f08a'],
          [27, 12, 0.45],
        ]);
        const frame = { x: 1.8, y: 1.1, w: 24.4, h: 10.9, r: 0.6 };
        drop(p, frame);
        p.ctx.fillStyle = white;
        p.ctx.beginPath();
        trace(p, frame);
        p.ctx.fill();
        gloss(p, { x: 5, y: 12.6, w: 18, h: 2.2 }, '#1877dc');
      }, 8),
    ],
    pictures: [{ x: 2.25, y: 1.55, w: 23.5, h: 10 }],
    title: {
      x: 6,
      y: 12.6,
      w: 16,
      h: 2.2,
      size: 24,
      align: 'center',
      valign: 'middle',
      sample: 'Der neue Standort am See',
    },
  },
  {
    name: 'Schluss',
    bg: sky,
    shapes: [
      scene((p) => {
        air(p, DAY);
        rays(p, 14, 12.4, 180, 360, 16);
        flare(p, 14, 12.2, 6.4, 27, 4.4);
        meadow(p, 14.2, 3.2);
        bubbles(p, [
          [4.2, 10.2, 1.5, '#7fe0ff'],
          [23.6, 9.6, 1.9, '#a8f08a'],
          [6.6, 12.4, 0.6, '#a8f08a'],
          [21.2, 12.2, 0.7],
          [25.8, 5.4, 0.5],
          [2.4, 4.6, 0.6],
        ]);
        glass(p, { x: 8, y: 8.3, w: 12, h: 2.1 }, 0.66);
      }, 9),
    ],
    title: {
      x: 4,
      y: 2.2,
      w: 20,
      h: 5.4,
      size: 62,
      align: 'center',
      valign: 'middle',
      sample: 'Vielen Dank!',
    },
    subtitle: {
      x: 8.6,
      y: 8.3,
      w: 10.8,
      h: 2.1,
      align: 'center',
      valign: 'middle',
      sample: 'Auf gute Zusammenarbeit',
    },
  },
];

const template: Template = {
  slug: 'frutiger-aero',
  name: 'Frutiger Aero',
  group: 'Designtrend',
  tags: ['Frutiger Aero', 'Himmel', 'Glas', 'Blasen', 'frisch', 'optimistisch', 'Natur', 'Technik'],
  description:
    'Himmelblau bis Aqua, Sonnenlicht, grüne Hügel, glänzende Blasen und Glasflächen mit weißem Schein – die helle Zuversicht der 2000er.',
  palette: {
    bg: pale,
    text: navy,
    bg2: white,
    text2: slate,
    accents: [sky, grass, aqua, sun, deep, leaf],
  },
  fonts: { head: 'Varela Round', body: 'Open Sans' },
  text: {
    title: { font: 'Varela Round', size: 54, color: white, lineHeight: 106 },
    subtitle: { font: 'Open Sans', size: 20, color: navy },
    body: { font: 'Open Sans', size: 21, color: navy, lineHeight: 124, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
