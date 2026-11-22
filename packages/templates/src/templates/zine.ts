import { grain, halftone, jpeg, noise, paint, rng } from '../art';
import type { Box, Color, Layout, Picture, Shadow, Shape, Stroke, Template } from '../model';
import { PAGE } from '../model';
import { page, smoothPath } from '../shapes';

/*
 * Zine: a punk fanzine straight from the photocopier – hard black and white with toner grain,
 * specks and the lid's shadow, paper torn into strips and stuck down with tape, headlines on
 * cut-out strips lying askew, a marker's scribbles in one neon pink.
 */

const copy = '#eeeeea';
const toner = '#0d0d0d';
const pink = '#ff2e88';
const sheetWhite = '#fbfbf8';
const dust = '#d6d6d0';
const soot = '#4a4a4a';

const shout = 'Anton';
const marker = 'Permanent Marker';
const mono = 'Space Mono';

/** The copier's glass: uneven toner, streaks along the drum, the lid's shadow, specks, hairs. */
function glass(dark: boolean, seed: number): Picture {
  const surface = paint(PAGE, 1400 / PAGE.w);
  const { ctx, w, h } = surface;
  const [clouds, drum] = [noise(seed), noise(seed + 5)];
  const base = dark ? 16 : 238;
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [u, v] = [x / w, y / h];
      const cloud = clouds(x / 170, y / 170, 4) - 0.5;
      const streak = Math.max(0, drum(x / 9, 3, 2) - 0.62) * (0.5 + clouds(3, y / 300, 2));
      const lid = Math.max(0, 1 - Math.min(u, 1 - v * 1.2 + 0.2) / 0.05) ** 1.6;
      const value = dark
        ? base + cloud * 46 + streak * 70 + Math.max(0, cloud) * 40
        : base + cloud * 20 - streak * 60 - lid * 150;
      const i = (y * w + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value - (dark ? 0 : 3);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  grain(surface, dark ? 0.13 : 0.11, seed + 1);
  const random = rng(seed + 2);
  ctx.fillStyle = dark ? '#f2f2f2' : '#0a0a0a';
  for (let i = 0; i < 1500; i += 1) {
    const size = random() < 0.92 ? random.range(0.4, 1.3) : random.range(1.5, 3.4);
    ctx.globalAlpha = random.range(0.25, 0.9);
    ctx.beginPath();
    ctx.ellipse(random() * w, random() * h, size, size * random.range(0.5, 1), random() * 3, 0, 7);
    ctx.fill();
  }
  ctx.strokeStyle = dark ? '#dddddd' : '#111111';
  for (let i = 0; i < 7; i += 1) {
    const [x, y] = [random() * w, random() * h];
    ctx.globalAlpha = random.range(0.25, 0.6);
    ctx.lineWidth = random.range(0.5, 1.1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + random.range(-60, 60),
      y + random.range(-60, 60),
      x + random.range(-110, 110),
      y + random.range(-110, 110),
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return jpeg(surface, 72);
}

const light: Shape = { t: 'image', ...page, src: glass(false, 31) };
const dark: Shape = { t: 'image', ...page, src: glass(true, 47) };

const lifted: Shadow = { dx: 0.1, dy: 0.14, blur: 0.18, color: '#000000', opacity: 0.4 };

/**
 * A piece of paper: torn where `torn` names its edges (t, r, b, l), cut straight elsewhere,
 * lying turned by `rotate`.
 */
function scrap(
  box: Box,
  fill: Color,
  seed: number,
  options: { rotate?: number; torn?: string; shadow?: boolean; rough?: number } = {},
): Shape {
  const random = rng(seed);
  const torn = options.torn ?? 'tb';
  const rough = (options.rough ?? 0.13) * 100;
  const [w, h] = [box.w * 100, box.h * 100];
  const points: [number, number][] = [];
  const edge = (
    name: string,
    length: number,
    at: (along: number, inward: number) => [number, number],
  ) => {
    if (!torn.includes(name)) {
      points.push(at(0, 0));
      return;
    }
    const steps = Math.max(4, Math.round(length / 22));
    for (let i = 0; i < steps; i += 1) {
      points.push(at((i / steps) * length, random() * rough * (random() < 0.15 ? 1.8 : 1)));
    }
  };
  edge('t', w, (along, inward) => [along, inward]);
  edge('r', h, (along, inward) => [w - inward, along]);
  edge('b', w, (along, inward) => [w - along, h - inward]);
  edge('l', h, (along, inward) => [inward, h - along]);
  return {
    t: 'path',
    ...box,
    vb: [Math.round(w), Math.round(h)],
    d: `${points
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${Math.round(x)} ${Math.round(y)}`)
      .join(' ')} Z`,
    fill,
    rotate: options.rotate,
    shadow: options.shadow === false ? undefined : lifted,
  };
}

/** A strip of tape: a little see-through, its ends cut with the teeth of the dispenser. */
function tape(cx: number, cy: number, w: number, rotate: number, color: Color = pink): Shape {
  const h = 0.95;
  const teeth = 6;
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= teeth * 2; i += 1) {
    const y = Math.round((i / (teeth * 2)) * h * 100);
    left.push(`${i % 2 === 0 ? 0 : 7} ${y}`);
    right.push(`${Math.round(w * 100) - (i % 2 === 0 ? 0 : 7)} ${y}`);
  }
  return {
    t: 'path',
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    vb: [Math.round(w * 100), Math.round(h * 100)],
    d: `M${left.join(' L')} L${right.reverse().join(' L')} Z`,
    fill: { t: 'solid', color, opacity: 0.86 },
    rotate,
  };
}

const pen = (color: Color, width = 0.16): Stroke => ({
  color,
  width,
  cap: 'round',
  join: 'round',
});

/** A marker line through points of the page. */
const drawn = (points: readonly (readonly [number, number])[], stroke: Stroke): Shape => ({
  t: 'path',
  ...page,
  vb: [2800, 1575],
  d: smoothPath(
    points.map(([x, y]) => [x * 100, y * 100] as const),
    false,
  ),
  fill: null,
  stroke,
});

/** A ring drawn twice round, never closing where it began. */
function loop(cx: number, cy: number, rx: number, ry: number, seed: number, stroke: Stroke): Shape {
  const random = rng(seed);
  const count = 30;
  return drawn(
    Array.from({ length: count }, (_, index) => {
      const angle = -2.2 + (index / (count - 1)) * Math.PI * 4.3;
      const wander = 1 + (random() - 0.5) * 0.09 + (index / count) * 0.07;
      return [cx + Math.cos(angle) * rx * wander, cy + Math.sin(angle) * ry * wander] as const;
    }),
    stroke,
  );
}

/** Back and forth under something: a marker's underline. */
function scrawl(x: number, y: number, w: number, seed: number, stroke: Stroke, passes = 3): Shape {
  const random = rng(seed);
  const points: [number, number][] = [];
  for (let pass = 0; pass < passes; pass += 1) {
    const forth = pass % 2 === 0;
    const [from, to] = forth ? [x, x + w] : [x + w * 0.96, x + w * 0.08];
    for (let i = 0; i <= 3; i += 1) {
      points.push([
        from + ((to - from) * i) / 3,
        y + pass * 0.24 + (random() - 0.5) * 0.14 - (forth ? 0.05 : -0.05) * i,
      ]);
    }
  }
  return drawn(points, stroke);
}

/** A star in one stroke, as drawn in a margin. */
function scratchStar(cx: number, cy: number, r: number, turn: number, stroke: Stroke): Shape {
  const pts = Array.from({ length: 6 }, (_, index) => {
    const angle = ((turn + index * 144) * Math.PI) / 180;
    return `${index === 0 ? 'M' : 'L'}${Math.round((cx + Math.cos(angle) * r) * 100)} ${Math.round((cy + Math.sin(angle) * r) * 100)}`;
  });
  return { t: 'path', ...page, vb: [2800, 1575], d: pts.join(' '), fill: null, stroke };
}

/** An arrow with a bend, its head two quick strokes. */
function arrow(
  from: readonly [number, number],
  bend: readonly [number, number],
  to: readonly [number, number],
  stroke: Stroke,
): Shape[] {
  const angle = Math.atan2(to[1] - bend[1], to[0] - bend[0]);
  const barb = (turn: number): [number, number] => [
    to[0] - Math.cos(angle + turn) * 0.9,
    to[1] - Math.sin(angle + turn) * 0.9,
  ];
  return [
    drawn([from, bend, to], stroke),
    drawn([barb(0.55), to], stroke),
    drawn([barb(-0.55), to], stroke),
  ];
}

/** A cross of two strokes. */
const cross = (cx: number, cy: number, r: number, stroke: Stroke): Shape[] => [
  drawn(
    [
      [cx - r, cy - r * 0.9],
      [cx + r * 0.1, cy + r * 0.1],
      [cx + r, cy + r],
    ],
    stroke,
  ),
  drawn(
    [
      [cx + r * 0.9, cy - r],
      [cx - r * 0.1, cy + r * 0.05],
      [cx - r, cy + r * 0.95],
    ],
    stroke,
  ),
];

/** A dot screen gone coarse in the copier, fading across its box. */
const screen = (box: Box, color: Color, tone: (u: number, v: number) => number): Shape => ({
  t: 'image',
  ...box,
  src: halftone({ size: box, color, cell: 0.3, angle: 30, tone, px: 44 }),
});

const glyph = (
  text: string,
  x: number,
  y: number,
  size: number,
  color: Color,
  font: string,
  rotate = 0,
): Shape => ({
  t: 'text',
  x,
  y,
  w: 4,
  h: size * 0.0353 * 1.5,
  text,
  font,
  size,
  color,
  rotate,
  nowrap: true,
  lineHeight: 100,
});

/**
 * A picture for the preview as the copier leaves it: a street of blocks under a white sun, only
 * black and white, the greys broken into grit.
 */
function xerox(seed: number): Picture {
  const surface = paint({ w: 16, h: 11 }, 56);
  const { ctx, w, h } = surface;
  const random = rng(seed * 23 + 7);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#3c3c3c');
  sky.addColorStop(0.7, '#b4b4b4');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(w * random.range(0.25, 0.75), h * 0.33, h * 0.19, 0, Math.PI * 2);
  ctx.fill();
  for (const [base, value] of [
    [0.55, 120],
    [0.72, 0],
  ] as const) {
    for (let x = -20; x < w;) {
      const width = random.range(w * 0.05, w * 0.13);
      const top = h * (base - random.range(0, 0.22));
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      ctx.fillRect(x, top, width, h);
      if (value === 0) {
        ctx.fillStyle = '#ffffff';
        for (let wy = top + 8; wy < h - 10; wy += 16) {
          for (let wx = x + 6; wx < x + width - 8; wx += 12) {
            if (random() < 0.3) ctx.fillRect(wx, wy, 5, 7);
          }
        }
      }
      x += width + (random() < 0.2 ? random.range(4, 16) : 0);
    }
  }
  const image = ctx.getImageData(0, 0, w, h);
  const field = noise(seed + 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const grit = (random() - 0.5) * 150 + (field(x / 40, y / 40, 3) - 0.5) * 90;
      const value = image.data[i]! + grit > 128 ? 240 : 14;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
    }
  }
  ctx.putImageData(image, 0, 0);
  return jpeg(surface, 70);
}

const black = pen(toner, 0.14);
const neon = pen(pink, 0.2);

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: copy,
    shapes: [
      light,
      screen({ x: 17, y: 0, w: 11, h: 9 }, toner, (u, v) => (u - 0.25) * 0.9 - v * 0.55),
      scrap({ x: 0.9, y: 2.7, w: 20.4, h: 8.2 }, toner, 3, { rotate: -2, torn: 'trb' }),
      tape(1.9, 3.3, 4.2, -38),
      tape(20.6, 2.6, 4.2, 32),
      scrap({ x: 2.4, y: 11.45, w: 15.4, h: 2 }, sheetWhite, 8, { rotate: 1.5, torn: 'lr' }),
      scratchStar(24, 10.6, 2.2, -92, neon),
      ...arrow([25.4, 5.2], [24.6, 7.4], [22, 7.6], black),
      ...cross(25.3, 3.2, 0.8, pen(toner, 0.2)),
    ],
    title: {
      x: 2.3,
      y: 3.5,
      w: 17.6,
      h: 6.7,
      valign: 'middle',
      sample: 'Kein Bock\nauf leise',
    },
    subtitle: {
      x: 3.2,
      y: 11.6,
      w: 14,
      h: 1.7,
      valign: 'middle',
      sample: 'Heft 7, kopiert und geklammert',
    },
  },
  {
    name: 'Abschnitt',
    bg: toner,
    shapes: [
      dark,
      glyph('2', 17.2, -4.2, 520, '#262626', shout, 6),
      scrap({ x: 1.4, y: 4.2, w: 18, h: 5.6 }, sheetWhite, 12, { rotate: 2, torn: 'tlb' }),
      tape(18.9, 4.9, 4, -40),
      tape(1.5, 10, 3.4, -30),
      scrawl(2.6, 11.2, 9.5, 4, neon),
      ...cross(24.4, 12.2, 0.9, pen('#f0f0f0', 0.18)),
    ],
    title: {
      x: 2.6,
      y: 4.7,
      w: 15.8,
      h: 4.6,
      valign: 'middle',
      font: marker,
      upper: false,
      size: 50,
      lineHeight: 96,
      color: toner,
      sample: 'Teil zwei:\nLaut werden',
    },
    subtitle: {
      x: 2.6,
      y: 12.3,
      w: 18,
      h: 1.5,
      color: '#f2f2f2',
      sample: 'Drei Akkorde reichen völlig',
    },
  },
  {
    name: 'Inhalt',
    bg: copy,
    shapes: [
      light,
      scrap({ x: 1.5, y: 4.3, w: 21.6, h: 10.3 }, sheetWhite, 21, { rotate: 0.6, torn: 'b' }),
      scrap({ x: -0.6, y: 0.9, w: 18.6, h: 2.9 }, toner, 22, { rotate: -1.4, torn: 'r' }),
      tape(21.6, 4.5, 4.2, 28),
      tape(1.5, 14.5, 3.6, -24),
      scratchStar(25.4, 2.6, 1.3, -80, neon),
      ...arrow([26.2, 7.2], [25.2, 9.2], [23.7, 9.6], black),
      loop(25.6, 12.4, 1.1, 0.9, 5, neon),
    ],
    title: {
      x: 1.8,
      y: 1.05,
      w: 15.6,
      h: 2.6,
      valign: 'middle',
      size: 36,
      sample: 'So macht man ein Heft',
    },
    body: {
      x: 2.7,
      y: 5.2,
      w: 19.4,
      h: 8.6,
      sample: [
        'Schreib auf, was dich nervt',
        'Schneide aus, was dir gefällt',
        'Klebe alles schief zusammen',
        'Kopiere es, bis der Toner leer ist',
        'Falte, klammere, zähle nicht nach',
        'Verteile es an alle, die du magst',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: copy,
    shapes: [
      light,
      { t: 'rect', x: 1.3, y: 1.3, w: 12, h: 12.4, fill: toner, rotate: -1.6, shadow: lifted },
      tape(1.6, 1.7, 4, -42),
      tape(13.1, 13.2, 4, -38),
      scrap({ x: 13.9, y: 1.3, w: 14.8, h: 3.3 }, toner, 31, { rotate: 1.4, torn: 'l' }),
      scrawl(15, 5.3, 8, 6, neon, 2),
      ...cross(25.6, 13.4, 0.7, black),
    ],
    pictures: [{ x: 1.8, y: 1.8, w: 11, h: 11.4 }],
    title: {
      x: 15,
      y: 1.65,
      w: 11.6,
      h: 2.6,
      valign: 'middle',
      size: 34,
      sample: 'Die Stadt gehört uns',
    },
    body: {
      x: 15,
      y: 6.5,
      w: 11.6,
      h: 7.6,
      size: 18,
      sample: [
        'Proberaum im alten Kiosk',
        'Konzert im Hinterhof',
        'Eintritt gegen Spende',
        'Bring deine Leute mit',
      ],
    },
  },
  {
    name: 'Zwei Spalten',
    bg: copy,
    shapes: [
      light,
      { t: 'rect', x: 1.3, y: 1.55, w: 19.6, h: 1.5, fill: pink, rotate: -1.2 },
      scrap({ x: 1.3, y: 4.5, w: 12, h: 9.9 }, sheetWhite, 41, { rotate: -1.3, torn: 'rb' }),
      scrap({ x: 14.7, y: 4.3, w: 12, h: 9.9 }, dust, 42, { rotate: 1.1, torn: 'tl' }),
      tape(3, 4.5, 3.8, -30),
      tape(24.9, 4.4, 3.8, 34),
      ...cross(13.85, 9.4, 0.7, pen(toner, 0.2)),
    ],
    title: {
      x: 1.8,
      y: 0.9,
      w: 24.4,
      h: 2.8,
      valign: 'middle',
      font: marker,
      upper: false,
      size: 36,
      lineHeight: 100,
      color: toner,
      sample: 'Geht klar oder geht gar nicht',
    },
    body: [
      {
        x: 2.4,
        y: 5.7,
        w: 9.8,
        h: 7.8,
        size: 18,
        sample: ['Selber machen', 'Fehler drinlassen', 'Laut sein dürfen'],
      },
      {
        x: 15.9,
        y: 5.5,
        w: 9.8,
        h: 7.8,
        size: 18,
        sample: ['Um Erlaubnis fragen', 'Alles glattbügeln', 'Auf später warten'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: toner,
    shapes: [
      dark,
      screen({ x: 16, y: 0, w: 12, h: 9 }, '#f2f2f2', (u, v) => (u - 0.3) * 0.8 - v * 0.6),
      loop(8.4, 5.3, 8, 4.6, 9, pen(pink, 0.24)),
      scrap({ x: 9.6, y: 10.4, w: 17.4, h: 3.9 }, sheetWhite, 51, { rotate: -1.6, torn: 'lt' }),
      tape(10, 10.9, 3.8, -36),
    ],
    title: {
      x: 1.8,
      y: 1.4,
      w: 15,
      h: 8,
      valign: 'middle',
      align: 'center',
      size: 180,
      sample: '50',
    },
    body: {
      x: 10.8,
      y: 10.85,
      w: 15.2,
      h: 3,
      valign: 'middle',
      bold: true,
      size: 19,
      lineHeight: 120,
      sample: 'Hefte reichen, damit eine ganze Stadt davon redet.',
    },
  },
  {
    name: 'Zitat',
    bg: copy,
    shapes: [
      light,
      scrap({ x: 2.4, y: 2.3, w: 23.2, h: 8.9 }, sheetWhite, 61, { rotate: -1, torn: 'tb' }),
      glyph('“', 1.1, -0.6, 250, pink, marker, -6),
      tape(24.8, 2.4, 4, 36),
      scrap({ x: 11.4, y: 11.9, w: 15.4, h: 2 }, toner, 62, { rotate: 1.6, torn: 'l' }),
      scrawl(4.2, 12.4, 5, 7, neon, 2),
    ],
    body: {
      x: 4.6,
      y: 4.2,
      w: 19.4,
      h: 6.2,
      valign: 'middle',
      bold: true,
      size: 26,
      lineHeight: 126,
      sample: 'Wenn es keiner druckt, dann drucken wir es eben selbst.',
    },
    subtitle: {
      x: 12.4,
      y: 12.05,
      w: 13.6,
      h: 1.7,
      valign: 'middle',
      color: '#f2f2f2',
      sample: 'Rike, Bass und Schere',
    },
  },
  {
    name: 'Bild',
    bg: toner,
    shapes: [
      dark,
      { t: 'rect', x: 1.7, y: 0.8, w: 24.6, h: 11.4, fill: sheetWhite, rotate: -0.7 },
      tape(2, 1.2, 4.2, -40),
      tape(26, 1, 4.2, 36),
      scrap({ x: 1, y: 12.25, w: 15.6, h: 2.6 }, pink, 71, {
        rotate: -1.8,
        torn: 'r',
        shadow: false,
      }),
      scratchStar(24.2, 13.6, 1.1, -85, pen('#f2f2f2', 0.14)),
    ],
    pictures: [{ x: 2.2, y: 1.3, w: 23.6, h: 10.4 }],
    title: {
      x: 1.8,
      y: 12.45,
      w: 14,
      h: 2.2,
      valign: 'middle',
      size: 32,
      color: toner,
      sample: 'Samstag, kurz nach zehn',
    },
  },
  {
    name: 'Schluss',
    bg: copy,
    shapes: [
      light,
      screen({ x: 0, y: 7.5, w: 11, h: 8.25 }, toner, (u, v) => (v - 0.35) * 0.9 - u * 0.6),
      { t: 'rect', x: 2.6, y: 5.9, w: 17.6, h: 2.5, fill: pink, rotate: -2.5 },
      scrap({ x: 8.6, y: 10.7, w: 18.6, h: 2.2 }, toner, 81, { rotate: 1.5, torn: 'l' }),
      tape(26.4, 10.9, 3.8, -40),
      scratchStar(23.6, 3.4, 1.9, -88, black),
      loop(23.6, 3.4, 2.9, 2.7, 3, neon),
      ...arrow([4.6, 12.6], [6, 13.3], [8, 12.2], black),
    ],
    title: {
      x: 2.6,
      y: 2.4,
      w: 19,
      h: 6.6,
      valign: 'middle',
      font: marker,
      upper: false,
      size: 100,
      lineHeight: 100,
      color: toner,
      sample: 'Tschüss!',
    },
    subtitle: {
      x: 9.8,
      y: 10.95,
      w: 16,
      h: 1.7,
      valign: 'middle',
      color: '#f2f2f2',
      sample: 'Kopier das und gib es weiter',
    },
  },
];

const template: Template = {
  slug: 'zine',
  name: 'Zine',
  group: 'Schwarzweiß',
  tags: ['Zine', 'Punk', 'Fanzine', 'Kopierer', 'schwarzweiß', 'Collage', 'laut', 'Neon', 'DIY'],
  description:
    'Wie ein Fanzine aus dem Kopierer: hartes Schwarzweiß mit Korn, gerissenes Papier, Klebeband und Neonpink.',
  palette: {
    bg: copy,
    text: toner,
    bg2: dust,
    text2: soot,
    accents: [pink, '#2a2a2a', '#8b8b86', '#b4b4ae', sheetWhite, '#6a6a66'],
  },
  fonts: { head: shout, body: mono },
  text: {
    title: { font: shout, size: 76, color: '#f4f4f4', upper: true, lineHeight: 80 },
    subtitle: { font: mono, size: 17, color: toner, bold: true },
    body: { font: mono, size: 19, color: toner, lineHeight: 122, paraSpace: 0.3 },
  },
  layouts,
  samplePictures: [xerox(1), xerox(2)],
};

export default template;
