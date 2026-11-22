import { grain, jpeg, noise, paint } from '../art';
import type { Box, Color, Layout, Picture, Shape, Stroke, Template } from '../model';
import { PAGE } from '../model';
import { page, polygon, ring, star } from '../shapes';

/*
 * Blaupause: a drawing sheet from the engineering office – blueprint blue under a fine white
 * grid, machine parts in thin white line (rings with centre marks, dimension lines, section
 * hatching), a sheet frame and a title block. Condensed capitals and a typewriter mono.
 */

const blue = '#12408c';
const deep = '#0b2a63';
const white = '#ffffff';
const pale = '#bcd4f7';
const yellow = '#ffd34d';

/** The sheet: blue, a little uneven as a print is, with the minor and major grid. */
function sheet(): Picture {
  const surface = paint(PAGE);
  const { ctx, w, h, px } = surface;
  const glow = ctx.createRadialGradient(w * 0.45, h * 0.4, 0, w * 0.5, h * 0.5, w * 0.72);
  glow.addColorStop(0, '#1a51a6');
  glow.addColorStop(0.6, blue);
  glow.addColorStop(1, '#0c3174');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  // Clouds of the exposure.
  const field = noise(21);
  const image = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const shade = 1 + (field(x / 340, y / 340, 4) - 0.5) * 0.16;
      const i = (y * w + x) * 4;
      image.data[i] = image.data[i]! * shade;
      image.data[i + 1] = image.data[i + 1]! * shade;
      image.data[i + 2] = image.data[i + 2]! * shade;
    }
  }
  ctx.putImageData(image, 0, 0);
  const lines = (step: number, alpha: number, width: number) => {
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    for (let x = 0.6; x < PAGE.w; x += step) ctx.fillRect(Math.round(x * px), 0, width, h);
    for (let y = 0.375; y < PAGE.h; y += step) ctx.fillRect(0, Math.round(y * px), w, width);
  };
  lines(0.5, 0.055, 1);
  lines(2.5, 0.13, 2);
  grain(surface, 0.035, 4);
  return jpeg(surface, 80);
}

const ground: Shape = { t: 'image', ...page, src: sheet() };

const pen: Stroke = { color: white, width: 0.045 };
const fine: Stroke = { color: white, width: 0.025, opacity: 0.75 };
const centre: Stroke = { color: white, width: 0.025, dash: [0.55, 0.18], opacity: 0.7 };
const hidden: Stroke = { color: white, width: 0.03, dash: [0.16, 0.12], opacity: 0.8 };

const line = (x1: number, y1: number, x2: number, y2: number, stroke: Stroke = fine): Shape => ({
  t: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke,
});

/** An arrow head with its tip at a point, pointing along `angle` (degrees, 0 = right). */
function head(x: number, y: number, angle: number, color: Color = white, size = 0.34): Shape {
  const a = (angle * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const at = (along: number, across: number): [number, number] => [
    x + along * cos - across * sin,
    y + along * sin + across * cos,
  ];
  return { t: 'poly', fill: color, pts: [at(0, 0), at(-size, size * 0.2), at(-size, -size * 0.2)] };
}

/** A horizontal dimension: the measured length with arrows, its extension lines `reach` long. */
function dimH(x1: number, x2: number, y: number, reach: number, color: Color = white): Shape[] {
  const stroke: Stroke = { color, width: 0.025, opacity: color === white ? 0.8 : 1 };
  const over = reach > 0 ? 0.25 : -0.25;
  return [
    line(x1, y - reach, x1, y + over, stroke),
    line(x2, y - reach, x2, y + over, stroke),
    line(x1, y, x2, y, stroke),
    head(x1, y, 180, color),
    head(x2, y, 0, color),
  ];
}

/** A vertical dimension, its extension lines reaching `reach` to the left (or right if < 0). */
function dimV(x: number, y1: number, y2: number, reach: number, color: Color = white): Shape[] {
  const stroke: Stroke = { color, width: 0.025, opacity: color === white ? 0.8 : 1 };
  const over = reach > 0 ? 0.25 : -0.25;
  return [
    line(x - reach, y1, x + over, y1, stroke),
    line(x - reach, y2, x + over, y2, stroke),
    line(x, y1, x, y2, stroke),
    head(x, y1, 270, color),
    head(x, y2, 90, color),
  ];
}

/** Centre lines through a point, reaching past a circle of that radius. */
const cross = (cx: number, cy: number, r: number): Shape[] => [
  line(cx - r, cy, cx + r, cy, centre),
  line(cx, cy - r, cx, cy + r, centre),
];

const hatch: Stroke = { color: white, width: 0.022, opacity: 0.8 };

/** Section hatching over a box: lines at 45°, `step` apart. */
function hatchRect(box: Box, step: number): Shape[] {
  const shapes: Shape[] = [];
  const gap = step * Math.SQRT2;
  for (let c = gap * 0.6; c < box.w + box.h; c += gap) {
    // The line x + y = c inside the box (box coordinates, y down).
    const x1 = Math.min(c, box.w);
    const x2 = Math.max(0, c - box.h);
    shapes.push(line(box.x + x1, box.y + c - x1, box.x + x2, box.y + c - x2, hatch));
  }
  return shapes;
}

/** Section hatching over a ring between two radii. */
function hatchRing(cx: number, cy: number, outer: number, inner: number, step: number): Shape[] {
  const shapes: Shape[] = [];
  const s = Math.SQRT1_2;
  // Along (s, -s), `d` across.
  const at = (d: number, along: number): [number, number] => [
    cx + d * s + along * s,
    cy + d * s - along * s,
  ];
  for (let d = -outer + step * 0.6; d < outer; d += step) {
    const reach = Math.sqrt(outer * outer - d * d);
    const hole = Math.abs(d) < inner ? Math.sqrt(inner * inner - d * d) : 0;
    const parts: [number, number][] =
      hole > 0
        ? [
            [-reach, -hole],
            [hole, reach],
          ]
        : [[-reach, reach]];
    for (const [from, to] of parts) {
      const [a, b] = [at(d, from), at(d, to)];
      shapes.push(line(a[0], a[1], b[0], b[1], hatch));
    }
  }
  return shapes;
}

/** A flange seen from the front: rim, bolt circle with its holes, hub and bore. */
function flange(cx: number, cy: number, r: number, holes = 8): Shape[] {
  const bolt = r * 0.78;
  const shapes: Shape[] = [
    ring(cx, cy, r, pen),
    ring(cx, cy, r * 0.94, fine),
    ring(cx, cy, bolt, centre),
    ring(cx, cy, r * 0.52, pen),
    ring(cx, cy, r * 0.4, pen),
    ...hatchRing(cx, cy, r * 0.4, r * 0.2, 0.2),
    ring(cx, cy, r * 0.2, pen),
    ...cross(cx, cy, r + 0.7),
  ];
  for (let i = 0; i < holes; i += 1) {
    const a = ((i + 0.5) / holes) * Math.PI * 2;
    const [x, y] = [cx + Math.cos(a) * bolt, cy + Math.sin(a) * bolt];
    shapes.push(ring(x, y, r * 0.065, pen));
    shapes.push(
      line(x - r * 0.11, y, x + r * 0.11, y, fine),
      line(x, y - r * 0.11, x, y + r * 0.11, fine),
    );
  }
  return shapes;
}

/** A gear wheel: teeth round a rim, spokes' circle, hub. */
function gear(cx: number, cy: number, r: number, teeth = 28): Shape[] {
  return [
    star(cx, cy, r, r * 0.91, teeth, null, { stroke: { ...pen, join: 'round' } }),
    ring(cx, cy, r * 0.955, centre),
    ring(cx, cy, r * 0.8, pen),
    ring(cx, cy, r * 0.74, fine),
    ...Array.from({ length: 6 }, (_, i): Shape => {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      return ring(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, r * 0.13, pen);
    }),
    ring(cx, cy, r * 0.5, centre),
    ring(cx, cy, r * 0.26, pen),
    ring(cx, cy, r * 0.2, fine),
    ...hatchRing(cx, cy, r * 0.2, r * 0.1, 0.17),
    ring(cx, cy, r * 0.1, pen),
    ...cross(cx, cy, r + 0.7),
  ];
}

/** A stepped shaft seen from the side, some steps cut open (hatched). */
function shaft(
  x: number,
  cy: number,
  steps: readonly (readonly [length: number, height: number, cut?: boolean])[],
): Shape[] {
  const shapes: Shape[] = [];
  let at = x;
  for (const [length, height, cut] of steps) {
    shapes.push({
      t: 'rect',
      x: at,
      y: cy - height / 2,
      w: length,
      h: height,
      fill: null,
      stroke: pen,
    });
    if (cut) {
      // Cut open above and below the bore.
      const wall = height * 0.33;
      shapes.push(
        ...hatchRect({ x: at, y: cy - height / 2, w: length, h: wall }, 0.2),
        ...hatchRect({ x: at, y: cy + height / 2 - wall, w: length, h: wall }, 0.2),
        line(at, cy - height / 2 + wall, at + length, cy - height / 2 + wall, fine),
        line(at, cy + height / 2 - wall, at + length, cy + height / 2 - wall, fine),
      );
    }
    at += length;
  }
  shapes.push(line(x - 0.9, cy, at + 0.9, cy, centre));
  return shapes;
}

/** The sheet's frame with its zone ticks. */
function frame(): Shape[] {
  const [l, t, r, b] = [0.6, 0.6, PAGE.w - 0.6, PAGE.h - 0.6];
  const shapes: Shape[] = [
    {
      t: 'rect',
      x: l,
      y: t,
      w: r - l,
      h: b - t,
      fill: null,
      stroke: { color: white, width: 0.05, opacity: 0.9 },
    },
  ];
  for (let i = 1; i < 8; i += 1) {
    const x = l + ((r - l) * i) / 8;
    shapes.push(line(x, t - 0.28, x, t, fine), line(x, b, x, b + 0.28, fine));
  }
  for (let i = 1; i < 4; i += 1) {
    const y = t + ((b - t) * i) / 4;
    shapes.push(line(l - 0.28, y, l, y, fine), line(r, y, r + 0.28, y, fine));
  }
  return shapes;
}

/** A scale: a base line with short and long ticks over `length`. */
function ruler(x: number, y: number, length: number, tail = 0): Shape[] {
  const shapes: Shape[] = [line(x, y, x + length + tail, y, pen)];
  for (let i = 0; i <= Math.round(length / 0.5); i += 1) {
    const long = i % 5 === 0;
    shapes.push(line(x + i * 0.5, y, x + i * 0.5, y + (long ? 0.34 : 0.17), fine));
  }
  return shapes;
}

/** Crop marks at a box's corners. */
function corners(box: Box, gap = 0.18, arm = 0.7, stroke: Stroke = pen): Shape[] {
  const shapes: Shape[] = [];
  for (const [x, sx] of [
    [box.x - gap, -1],
    [box.x + box.w + gap, 1],
  ] as const) {
    for (const [y, sy] of [
      [box.y - gap, -1],
      [box.y + box.h + gap, 1],
    ] as const) {
      shapes.push(line(x, y, x - sx * arm, y, stroke), line(x, y, x, y - sy * arm, stroke));
      shapes.push(
        line(x + sx * 0.25, y, x + sx * 0.6, y, fine),
        line(x, y + sy * 0.25, x, y + sy * 0.6, fine),
      );
    }
  }
  return shapes;
}

/**
 * The title block: a framed field for a text with a column of small cells at its right, one
 * holding the projection symbol.
 */
function titleBlock(box: Box, cells = 2.6): Shape[] {
  const split = box.x + box.w - cells;
  const mid = box.y + box.h / 2;
  const [sx, sy] = [split + cells * 0.3, box.y + box.h * 0.75];
  return [
    { t: 'rect', ...box, fill: { t: 'solid', color: deep, opacity: 0.55 }, stroke: pen },
    {
      t: 'rect',
      x: box.x + 0.09,
      y: box.y + 0.09,
      w: box.w - 0.18,
      h: box.h - 0.18,
      fill: null,
      stroke: fine,
    },
    line(split, box.y, split, box.y + box.h, pen),
    line(split, mid, box.x + box.w, mid, fine),
    line(split + cells / 2, box.y, split + cells / 2, mid, fine),
    // First-angle symbol: a cone from the side, and from the front.
    {
      t: 'poly',
      fill: null,
      stroke: fine,
      pts: [
        [sx - 0.34, sy - 0.14],
        [sx + 0.2, sy - 0.26],
        [sx + 0.2, sy + 0.26],
        [sx - 0.34, sy + 0.14],
      ],
    },
    ring(sx + 0.95, sy, 0.26, fine),
    ring(sx + 0.95, sy, 0.13, fine),
    // Marks in the small cells.
    {
      t: 'rect',
      x: split + 0.28,
      y: box.y + 0.3,
      w: cells / 2 - 0.56,
      h: 0.09,
      fill: { t: 'solid', color: white, opacity: 0.6 },
    },
    {
      t: 'rect',
      x: split + cells / 2 + 0.28,
      y: box.y + 0.3,
      w: cells / 4,
      h: 0.09,
      fill: { t: 'solid', color: yellow, opacity: 0.9 },
    },
  ];
}

/** An item balloon: a circle with its number, and a leader running on from it. */
function balloon(cx: number, cy: number, glyph: string, toX: number): Shape[] {
  return [
    line(cx + 0.62, cy, toX, cy, fine),
    { t: 'ellipse', x: toX - 0.07, y: cy - 0.07, w: 0.14, h: 0.14, fill: white },
    {
      t: 'ellipse',
      x: cx - 0.62,
      y: cy - 0.62,
      w: 1.24,
      h: 1.24,
      fill: { t: 'solid', color: deep, opacity: 0.6 },
      stroke: pen,
    },
    {
      t: 'text',
      x: cx - 0.62,
      y: cy - 0.62,
      w: 1.24,
      h: 1.24,
      text: glyph,
      font: 'IBM Plex Mono',
      size: 18,
      bold: true,
      color: yellow,
      align: 'center',
      valign: 'middle',
    },
  ];
}

const shade = (opacity: number): Shape => ({
  t: 'rect',
  ...page,
  fill: { t: 'solid', color: deep, opacity },
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: blue,
    shapes: [
      ground,
      ...frame(),
      ...flange(20.9, 6.5, 4.7),
      ...dimH(16.2, 25.6, 12.6, 5.6),
      line(24.22, 3.18, 25.6, 1.8),
      line(25.6, 1.8, 26.6, 1.8),
      head(24.22, 3.18, 135),
      ...dimV(15.2, 4.05, 8.95, -1.6, yellow),
      ...titleBlock({ x: 1.8, y: 11.3, w: 12.6, h: 2.6 }),
    ],
    title: { x: 1.8, y: 2.6, w: 12.8, h: 7.8, valign: 'bottom', sample: 'Getriebe,\nneu gedacht' },
    subtitle: {
      x: 2.2,
      y: 11.5,
      w: 9.4,
      h: 2.2,
      valign: 'middle',
      sample: 'Konstruktionsbericht\nStand Frühjahr',
    },
  },
  {
    name: 'Abschnitt',
    bg: deep,
    shapes: [
      ground,
      shade(0.42),
      ...frame(),
      ...shaft(2.6, 11.2, [
        [2.4, 1.5],
        [3.4, 2.7, true],
        [6.6, 1.8],
        [3, 3.5, true],
        [4.2, 2.1],
        [2.2, 1.2],
      ]),
      ...dimH(2.6, 24.4, 13.9, 2),
      ...dimH(15, 18, 8.7, -0.7, yellow),
      ring(16.5, 11.2, 2.45, hidden),
      line(18.25, 9.5, 21.2, 6.9),
      ...balloon(21.65, 6.45, 'A', 22.27),
      line(1.8, 3, 1.8, 7.9, { color: yellow, width: 0.12 }),
    ],
    title: { x: 2.5, y: 2.4, w: 21, h: 3.9, valign: 'bottom', size: 76, sample: 'Der Antrieb' },
    subtitle: {
      x: 2.5,
      y: 6.5,
      w: 16,
      h: 1.5,
      sample: 'Welle, Lager und Gehäuse im Schnitt',
    },
  },
  {
    name: 'Inhalt',
    bg: blue,
    shapes: [ground, ...frame(), ...ruler(1.8, 3.55, 10, 14.4), ...gear(26.4, 13.6, 5.2)],
    title: {
      x: 1.8,
      y: 1.2,
      w: 22,
      h: 2.2,
      valign: 'middle',
      size: 42,
      sample: 'Was die Welle leisten muss',
    },
    body: {
      x: 1.8,
      y: 4.5,
      w: 19,
      h: 9.6,
      sample: [
        'Drehmoment bis 240 Nm ohne Spiel übertragen',
        'Zwei Lagersitze, beide geschliffen',
        'Passfeder nach Norm, keine Sonderteile',
        'Gewicht unter vier Kilogramm',
        'Montage mit einem Werkzeug',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: blue,
    shapes: [
      ground,
      ...frame(),
      ...ruler(1.8, 3.55, 5, 6.2),
      {
        t: 'rect',
        x: 14.5,
        y: 3.5,
        w: 11.2,
        h: 9.4,
        fill: { t: 'solid', color: deep, opacity: 0.6 },
        stroke: fine,
      },
      ...corners({ x: 14.5, y: 3.5, w: 11.2, h: 9.4 }),
      ...dimH(14.5, 25.7, 2.2, -1),
      ...dimV(26.7, 3.5, 12.9, 0.7),
      line(14.5, 13.9, 20.1, 13.9, centre),
    ],
    title: { x: 1.8, y: 1.2, w: 11.6, h: 2.2, valign: 'middle', size: 42, sample: 'Das Gehäuse' },
    body: {
      x: 1.8,
      y: 4.5,
      w: 11.4,
      h: 9.6,
      sample: [
        'Aus einem Stück gefräst',
        'Wandstärke sechs Millimeter',
        'Dichtfläche plan auf 0,02',
      ],
    },
    pictures: [{ x: 14.7, y: 3.7, w: 10.8, h: 9 }],
  },
  {
    name: 'Zwei Spalten',
    bg: blue,
    shapes: [
      ground,
      ...frame(),
      ...ruler(1.8, 3.55, 5, 19.4),
      line(14, 4.4, 14, 14.4, centre),
      ring(14, 4.4, 0.16, pen),
      ring(14, 14.4, 0.16, pen),
      ...balloon(2.42, 5.3, '1', 12.6),
      ...balloon(15.82, 5.3, '2', 26),
    ],
    title: {
      x: 1.8,
      y: 1.2,
      w: 24,
      h: 2.2,
      valign: 'middle',
      size: 42,
      sample: 'Gegossen oder gefräst',
    },
    body: [
      {
        x: 1.8,
        y: 6.4,
        w: 11,
        h: 7.8,
        sample: ['Günstig ab 500 Stück', 'Form kostet sechs Wochen', 'Nacharbeit an den Sitzen'],
      },
      {
        x: 15.2,
        y: 6.4,
        w: 11,
        h: 7.8,
        sample: ['Sofort lieferbar', 'Jede Änderung über Nacht', 'Teurer je Stück'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: deep,
    shapes: [
      ground,
      shade(0.42),
      ...frame(),
      ...dimH(3.4, 24.6, 9.7, 7.2, yellow),
      line(3.4, 9.7, 3.4, 10.5, { color: yellow, width: 0.025 }),
      line(24.6, 9.7, 24.6, 10.5, { color: yellow, width: 0.025 }),
      ...ruler(3.4, 2.5, 21.2).map((shape) => shape),
      ring(3.4, 9.7, 0.12, { color: yellow, width: 0.03 }),
      ring(24.6, 9.7, 0.12, { color: yellow, width: 0.03 }),
    ],
    title: {
      x: 4,
      y: 3.2,
      w: 20,
      h: 6.3,
      valign: 'middle',
      align: 'center',
      size: 150,
      spacing: 2,
      sample: '0,02 mm',
    },
    body: {
      x: 5,
      y: 10.6,
      w: 18,
      h: 3.4,
      align: 'center',
      size: 20,
      color: pale,
      sample: 'So genau sitzt das Lager in seinem Sitz.\nEin Haar ist dreimal so dick.',
    },
  },
  {
    name: 'Zitat',
    bg: blue,
    shapes: [
      ground,
      ...frame(),
      ...corners({ x: 7.2, y: 2.4, w: 18.6, h: 7 }, 0, 1.3),
      ...dimV(5.9, 2.4, 9.4, -0.7, yellow),
      polygon(3.6, 11.9, 1.75, 6, null, { stroke: pen, rotate: 0 }),
      ring(3.6, 11.9, 1.5, fine),
      ring(3.6, 11.9, 0.95, pen),
      ring(3.6, 11.9, 0.8, hidden),
      ...cross(3.6, 11.9, 2.3),
      line(5.9, 9.4, 4.9, 10.75),
      head(4.9, 10.75, 126.5),
      ...titleBlock({ x: 13.4, y: 11.3, w: 12.4, h: 2.4 }),
    ],
    body: {
      x: 7.9,
      y: 2.8,
      w: 17.3,
      h: 6.2,
      valign: 'middle',
      font: 'Barlow Condensed',
      size: 44,
      lineHeight: 108,
      color: white,
      sample: '„Was sich nicht zeichnen lässt, lässt sich auch nicht bauen.“',
    },
    subtitle: {
      x: 13.8,
      y: 11.5,
      w: 9.2,
      h: 2,
      valign: 'middle',
      sample: 'Ines Hartmann\nKonstrukteurin',
    },
  },
  {
    name: 'Bild',
    bg: blue,
    shapes: [
      ground,
      ...frame(),
      {
        t: 'rect',
        x: 1.8,
        y: 1.6,
        w: 24.4,
        h: 9.9,
        fill: { t: 'solid', color: deep, opacity: 0.6 },
        stroke: fine,
      },
      ...corners({ x: 1.8, y: 1.6, w: 24.4, h: 9.9 }, 0.14, 0.6),
      ...titleBlock({ x: 10.2, y: 12.2, w: 16, h: 2.2 }),
      ...ruler(1.8, 13.1, 6.5),
    ],
    pictures: [{ x: 2, y: 1.8, w: 24, h: 9.5 }],
    title: {
      x: 10.6,
      y: 12.3,
      w: 12.8,
      h: 2,
      valign: 'middle',
      size: 25,
      sample: 'Prototyp auf dem Prüfstand',
    },
  },
  {
    name: 'Schluss',
    bg: deep,
    shapes: [
      ground,
      shade(0.3),
      ...frame(),
      ...gear(7.4, 7.9, 5),
      ...dimH(2.4, 12.4, 14.2, 6.2),
      line(10.94, 4.36, 12.6, 2.7),
      head(10.94, 4.36, 135),
      ...balloon(13.05, 2.25, 'Z', 13.67),
      ...titleBlock({ x: 14.6, y: 9.6, w: 11.6, h: 2.6 }),
    ],
    title: { x: 14.6, y: 3.6, w: 11.6, h: 5.4, valign: 'bottom', size: 88, sample: 'Danke.' },
    subtitle: {
      x: 15,
      y: 9.8,
      w: 8.4,
      h: 2.2,
      valign: 'middle',
      sample: 'Fragen zur Zeichnung?\nGern jetzt.',
    },
  },
];

const template: Template = {
  slug: 'blaupause',
  name: 'Blaupause',
  group: 'Bereich',
  tags: [
    'Blaupause',
    'Technik',
    'Ingenieur',
    'Konstruktion',
    'Raster',
    'Zeichnung',
    'blau',
    'Planung',
  ],
  description:
    'Ein Zeichenblatt aus dem Konstruktionsbüro: Blaupausenblau mit feinem Raster, Maschinenteile in weißer Linie, Maßlinien und Schriftfeld.',
  palette: {
    bg: blue,
    text: white,
    bg2: deep,
    text2: pale,
    accents: [yellow, '#ff8a66', '#72d6ff', '#9fe6b8', '#c9b8ff', '#e9f1fd'],
  },
  fonts: { head: 'Barlow Condensed', body: 'IBM Plex Mono' },
  text: {
    title: {
      font: 'Barlow Condensed',
      size: 68,
      color: white,
      bold: true,
      upper: true,
      lineHeight: 98,
      spacing: 1,
    },
    subtitle: { font: 'IBM Plex Mono', size: 16, color: pale, lineHeight: 125 },
    body: { font: 'IBM Plex Mono', size: 18, color: white, lineHeight: 130, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
