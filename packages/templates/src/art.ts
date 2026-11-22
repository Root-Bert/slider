import { deflateSync } from 'node:zlib';
import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Box, Color, Picture } from './model';
import { PAGE } from './model';

/*
 * Pictures made by rule, not taken from anywhere: textures, dot screens, brush fields, glossy
 * bubbles. Every one comes from a seed, so the same spec draws the same picture. Whole-page
 * grounds are JPEGs (small), anything see-through a PNG.
 */

/** Pixels per centimetre of a whole-page picture: 1920 px across the page. */
export const PX = 1920 / PAGE.w;

/** A random source that gives the same numbers for the same seed (mulberry32). */
export function rng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, {
    /** A number between `min` and `max`. */
    range: (min: number, max: number) => min + next() * (max - min),
    /** A whole number from `min` to `max`, both included. */
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    /** Roughly bell-shaped round 0, within ±1. */
    bell: () => (next() + next() + next()) / 1.5 - 1,
  });
}
export type Rng = ReturnType<typeof rng>;

export const rgb = (hex: Color): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
export const hex = (r: number, g: number, b: number): Color =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
/** `a` mixed with `b`: 0 all `a`, 1 all `b`. */
export const mix = (a: Color, b: Color, t: number): Color => {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
};
export const lighten = (color: Color, t: number) => mix(color, '#ffffff', t);
export const darken = (color: Color, t: number) => mix(color, '#000000', t);
export const rgba = (color: Color, alpha: number) => {
  const [r, g, b] = rgb(color);
  return `rgba(${r},${g},${b},${alpha})`;
};
/** Perceived lightness, 0 … 1. */
export const luma = (color: Color) => {
  const [r, g, b] = rgb(color);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** Smooth noise over the plane, 0 … 1, the same for the same seed. */
export function noise(seed: number) {
  const random = rng(seed);
  const table = Array.from({ length: 512 }, () => random());
  const at = (x: number, y: number) => table[((x & 255) + (y & 255) * 57) & 511]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const single = (x: number, y: number) => {
    const [xi, yi] = [Math.floor(x), Math.floor(y)];
    const [tx, ty] = [smooth(x - xi), smooth(y - yi)];
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * tx;
    const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * tx;
    return top + (bottom - top) * ty;
  };
  /** `octaves` layers, each finer and fainter. */
  return (x: number, y: number, octaves = 4) => {
    let [sum, weight, total] = [0, 1, 0];
    for (let i = 0; i < octaves; i += 1) {
      sum += single(x * 2 ** i, y * 2 ** i) * weight;
      total += weight;
      weight /= 2;
    }
    return sum / total;
  };
}

export interface Paint {
  canvas: Canvas;
  ctx: SKRSContext2D;
  /** Pixels. */
  w: number;
  h: number;
  /** Pixels per centimetre. */
  px: number;
}

/** A canvas for a box of that size in centimetres (default: the page). */
export function paint(size: { w: number; h: number } = PAGE, px = PX): Paint {
  const [w, h] = [Math.round(size.w * px), Math.round(size.h * px)];
  const canvas = createCanvas(w, h);
  return { canvas, ctx: canvas.getContext('2d'), w, h, px };
}

export const jpeg = (surface: Paint | Canvas, quality = 88): Picture => ({
  bytes: new Uint8Array(
    ('canvas' in surface ? surface.canvas : surface).toBuffer('image/jpeg', quality),
  ),
  mime: 'image/jpeg',
});
export const png = (surface: Paint | Canvas): Picture => ({
  bytes: new Uint8Array(('canvas' in surface ? surface.canvas : surface).toBuffer('image/png')),
  mime: 'image/png',
});

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * What is drawn in one colour (dots, a wash, a stencil) as a small PNG: only how see-through
 * each pixel is counts, kept in `levels` steps – a palette picture, a quarter of the usual size
 * or less. The colours drawn are ignored; all of it comes out in `color`.
 */
export function stencil(surface: Paint, color: Color, levels = 16): Picture {
  const { ctx, w, h } = surface;
  const data = ctx.getImageData(0, 0, w, h).data;
  const rows = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      rows[y * (w + 1) + 1 + x] = Math.round((data[(y * w + x) * 4 + 3]! / 255) * (levels - 1));
    }
  }
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  header.set([8, 3, 0, 0, 0], 8);
  const [r, g, b] = rgb(color);
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', header),
    chunk(
      'PLTE',
      Uint8Array.from({ length: levels * 3 }, (_, i) => [r, g, b][i % 3]!),
    ),
    chunk(
      'tRNS',
      Uint8Array.from({ length: levels }, (_, i) => Math.round((i / (levels - 1)) * 255)),
    ),
    chunk('IDAT', new Uint8Array(deflateSync(rows, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return { bytes, mime: 'image/png' };
}

/** Film grain over everything drawn so far: `amount` 0 … 1 of light and dark specks. */
export function grain(surface: Paint, amount = 0.08, seed = 1, mono = true): void {
  const { ctx, w, h } = surface;
  const random = rng(seed);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const strength = amount * 255;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const shift = (random() - 0.5) * strength;
    data[i] = data[i]! + (mono ? shift : (random() - 0.5) * strength);
    data[i + 1] = data[i + 1]! + (mono ? shift : (random() - 0.5) * strength);
    data[i + 2] = data[i + 2]! + (mono ? shift : (random() - 0.5) * strength);
  }
  ctx.putImageData(image, 0, 0);
}

/** A paper ground: its colour, clouded a little, with grain. */
export function paper(
  color: Color,
  options: { size?: { w: number; h: number }; clouds?: number; grain?: number; seed?: number } = {},
): Picture {
  const surface = paint(options.size);
  const { ctx, w, h } = surface;
  const field = noise(options.seed ?? 7);
  const clouds = options.clouds ?? 0.06;
  const [r, g, b] = rgb(color);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const shade = 1 + (field(x / 260, y / 260, 5) - 0.5) * 2 * clouds;
      const i = (y * w + x) * 4;
      image.data[i] = r * shade;
      image.data[i + 1] = g * shade;
      image.data[i + 2] = b * shade;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  grain(surface, options.grain ?? 0.05, (options.seed ?? 7) + 1);
  return jpeg(surface, 86);
}

/**
 * A dot screen as printed: dots on a turned grid, each as large as `tone` (0 none … 1 full) says
 * at its place (`u`, `v` 0 … 1 across the box). See-through between the dots.
 */
export function halftone(options: {
  size?: { w: number; h: number };
  color: Color;
  /** Dot distance in centimetres. */
  cell?: number;
  angle?: number;
  tone: (u: number, v: number) => number;
  /** Squares or lines instead of dots. */
  mark?: 'dot' | 'square' | 'line';
  /** Pixels per centimetre; the default keeps a whole-page screen near 150 kB. */
  px?: number;
}): Picture {
  const surface = paint(options.size, options.px ?? 52);
  const { ctx, w, h, px } = surface;
  const cell = (options.cell ?? 0.32) * px;
  const angle = ((options.angle ?? 45) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  ctx.fillStyle = options.color;
  const reach = Math.ceil(Math.hypot(w, h) / cell) + 2;
  for (let row = -reach; row <= reach; row += 1) {
    for (let column = -reach; column <= reach; column += 1) {
      const x = w / 2 + (column * cos - row * sin) * cell;
      const y = h / 2 + (column * sin + row * cos) * cell;
      if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
      const tone = Math.min(1, Math.max(0, options.tone(x / w, y / h)));
      if (tone <= 0.02) continue;
      if (options.mark === 'square') {
        const side = cell * Math.sqrt(tone);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillRect(-side / 2, -side / 2, side, side);
        ctx.restore();
      } else if (options.mark === 'line') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillRect(-cell / 2 - 0.5, (-cell * tone) / 2, cell + 1, cell * tone);
        ctx.restore();
      } else {
        // A dot covering `tone` of its cell; past ~0.78 dots merge, as on paper.
        ctx.beginPath();
        ctx.arc(x, y, cell * Math.sqrt(tone / Math.PI) * 1.02, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return stencil(surface, options.color);
}

/**
 * A field of brush strokes, as a painter lays them: `count` short strokes, each in the colour
 * `colorAt` gives for its place, turned along `flow` (radians at a place), a little unsteady.
 */
export function brushField(options: {
  size?: { w: number; h: number };
  ground: Color;
  count?: number;
  /** Stroke length and width in centimetres. */
  length?: number;
  width?: number;
  colorAt: (u: number, v: number, random: Rng) => Color;
  flow?: (u: number, v: number) => number;
  seed?: number;
  /** How much each stroke's colour wanders, 0 … 1. */
  jitter?: number;
  opacity?: number;
  /** Round dabs instead of strokes (pointillism). */
  dabs?: boolean;
}): Paint {
  const surface = paint(options.size);
  const { ctx, w, h, px } = surface;
  const random = rng(options.seed ?? 3);
  ctx.fillStyle = options.ground;
  ctx.fillRect(0, 0, w, h);
  const length = (options.length ?? 0.9) * px;
  const width = (options.width ?? 0.22) * px;
  const jitter = options.jitter ?? 0.12;
  const count = options.count ?? 9000;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i += 1) {
    const [u, v] = [random(), random()];
    const [r, g, b] = rgb(options.colorAt(u, v, random));
    const wander = () => (random() - 0.5) * 255 * jitter;
    const shade = wander();
    const color = `rgba(${Math.round(r + shade + wander() / 2)},${Math.round(g + shade + wander() / 2)},${Math.round(b + shade + wander() / 2)},${options.opacity ?? 0.9})`;
    const [x, y] = [u * w, v * h];
    if (options.dabs) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, width * random.range(0.7, 1.15), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const angle = (options.flow?.(u, v) ?? 0) + random.bell() * 0.35;
    const reach = length * random.range(0.6, 1.25);
    const bend = random.bell() * reach * 0.25;
    const [dx, dy] = [(Math.cos(angle) * reach) / 2, (Math.sin(angle) * reach) / 2];
    ctx.strokeStyle = color;
    ctx.lineWidth = width * random.range(0.6, 1.3);
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.quadraticCurveTo(x - Math.sin(angle) * bend, y + Math.cos(angle) * bend, x + dx, y + dy);
    ctx.stroke();
  }
  return surface;
}

/** Soft colour clouds running into each other (a mesh gradient): each blob a colour at a place. */
export function mesh(
  ground: Color,
  blobs: readonly { x: number; y: number; r: number; color: Color; alpha?: number }[],
  options: { size?: { w: number; h: number }; grain?: number; seed?: number } = {},
): Paint {
  const surface = paint(options.size);
  const { ctx, w, h } = surface;
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);
  for (const blob of blobs) {
    const [x, y, r] = [blob.x * w, blob.y * h, blob.r * w];
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, rgba(blob.color, blob.alpha ?? 0.9));
    gradient.addColorStop(0.5, rgba(blob.color, (blob.alpha ?? 0.9) * 0.45));
    gradient.addColorStop(1, rgba(blob.color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
  if (options.grain) grain(surface, options.grain, options.seed ?? 5);
  return surface;
}

/** A watercolour wash: a soft-edged, uneven stain of one colour on see-through ground. */
export function wash(options: {
  size: { w: number; h: number };
  color: Color;
  seed?: number;
  /** How ragged its edge is, 0 … 1. */
  ragged?: number;
  alpha?: number;
}): Picture {
  const surface = paint(options.size, PX);
  const { ctx, w, h } = surface;
  const field = noise(options.seed ?? 11);
  const [r, g, b] = rgb(options.color);
  const ragged = options.ragged ?? 0.5;
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [u, v] = [(x / w) * 2 - 1, (y / h) * 2 - 1];
      // Inside an ellipse whose rim the noise pushes in and out.
      const rim = 1 - Math.hypot(u, v) - (field(x / 90, y / 90, 4) - 0.5) * ragged;
      const body = Math.min(1, Math.max(0, rim * 7));
      // Pigment gathers at the edge and in pools.
      const pool = 0.62 + field(x / 200 + 9, y / 200 + 9, 3) * 0.5 + (rim < 0.12 ? 0.18 : 0);
      const i = (y * w + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255 * body * Math.min(1, pool) * (options.alpha ?? 0.85);
    }
  }
  ctx.putImageData(image, 0, 0);
  return stencil(surface, options.color, 64);
}

/** A glossy ball as on early-2000s screens: lit from above, see-through, with its highlight. */
export function bubble(ctx: SKRSContext2D, x: number, y: number, r: number, color: Color): void {
  const body = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.05, x, y, r);
  body.addColorStop(0, rgba(lighten(color, 0.75), 0.75));
  body.addColorStop(0.55, rgba(color, 0.55));
  body.addColorStop(1, rgba(darken(color, 0.25), 0.8));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // The window's reflection on its upper half.
  const shine = ctx.createLinearGradient(x, y - r, x, y);
  shine.addColorStop(0, 'rgba(255,255,255,0.85)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.45, r * 0.62, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // Light gathered at the bottom.
  const glow = ctx.createRadialGradient(x, y + r * 0.7, 0, x, y + r * 0.7, r * 0.6);
  glow.addColorStop(0, 'rgba(255,255,255,0.45)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * A stand-in for a photo in the preview, made from the template's colours: a soft landscape of
 * layered hills under a sky – enough to judge how a picture sits in the layout.
 */
export function samplePicture(
  box: Pick<Box, 'w' | 'h'>,
  colors: readonly Color[],
  seed = 1,
): Picture {
  const px = Math.min(PX, 1600 / box.w);
  const surface = paint(box, px);
  const { ctx, w, h } = surface;
  const random = rng(seed * 7919 + 13);
  const [sky, far, mid, near, sun] = [
    colors[seed % colors.length]!,
    colors[(seed + 1) % colors.length]!,
    colors[(seed + 2) % colors.length]!,
    colors[(seed + 3) % colors.length]!,
    colors[(seed + 4) % colors.length]!,
  ];
  const air = ctx.createLinearGradient(0, 0, 0, h);
  air.addColorStop(0, mix(sky, '#ffffff', 0.15));
  air.addColorStop(1, mix(sky, '#ffffff', 0.7));
  ctx.fillStyle = air;
  ctx.fillRect(0, 0, w, h);
  const side = Math.min(w, h);
  ctx.fillStyle = rgba(lighten(sun, 0.35), 0.95);
  ctx.beginPath();
  ctx.arc(w * random.range(0.25, 0.75), h * random.range(0.25, 0.42), side * 0.13, 0, Math.PI * 2);
  ctx.fill();
  const field = noise(seed + 40);
  [far, mid, near].forEach((color, layer) => {
    const base = h * (0.52 + layer * 0.15);
    const height = h * (0.2 - layer * 0.035);
    ctx.fillStyle = mix(color, sky, 0.45 - layer * 0.2);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      ctx.lineTo(x, base - field(x / (w * 0.5) + layer * 7, layer * 3, 4) * height);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  });
  grain(surface, 0.035, seed);
  return jpeg(surface, 84);
}

/** A picture cut to fill a box of that shape (as „Füllen“ does), as a JPEG. */
export async function cover(picture: Picture, box: Pick<Box, 'w' | 'h'>): Promise<Picture> {
  const image = await loadImage(Buffer.from(picture.bytes));
  const px = Math.min(PX, 1600 / box.w);
  const surface = paint(box, px);
  const scale = Math.max(surface.w / image.width, surface.h / image.height);
  const [w, h] = [image.width * scale, image.height * scale];
  surface.ctx.drawImage(image, (surface.w - w) / 2, (surface.h - h) / 2, w, h);
  return jpeg(surface, 84);
}
