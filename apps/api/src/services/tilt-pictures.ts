import { createCanvas, loadImage } from '@napi-rs/canvas';
import { projected, TILT_DEPTH, type BoxTilt, type Rect } from '@slider/shared';

/*
 * An element tilted in depth drawn on the server – for the AI, which has no browser: the same
 * picture the editor bakes with WebGL (`bakeTilt` in the web app), its element's picture alone
 * turned about the element's centre and seen in perspective from `TILT_DEPTH` slide widths away.
 * Each pixel is looked up in the flat picture through the projective map between the picture
 * and the four corners it is seen at – perspective-correct across the whole picture, as the GPU.
 */

/** Largest side of a tilted picture, in pixels – smaller than the editor's: drawn by the CPU. */
const MAX_SIDE = 2048;

type Matrix = [number, number, number, number, number, number, number, number, number];

/**
 * The projective map of the unit square onto the quad `p` (top left, top right, bottom right,
 * bottom left), as a 3 × 3 matrix by rows (Heckbert).
 */
function squareToQuad(p: readonly { x: number; y: number }[]): Matrix {
  const [p0, p1, p2, p3] = p as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / det;
  const h = (dx1 * sy - sx * dy1) / det;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}

/** The inverse of a 3 × 3 matrix (its adjugate – the scale does not matter for a projective map). */
function inverted([a, b, c, d, e, f, g, h, i]: Matrix): Matrix {
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
}

/**
 * An element's picture alone (`bytes`, lying at `box` of the slide) tilted about the element's
 * centre (`centre`, of the slide), see-through around it: as a PNG, and where it lies on the
 * slide. `aspect`: the slide's width over its height.
 */
export async function bakeTilt({
  bytes,
  box,
  centre,
  tilt,
  aspect,
}: {
  bytes: Uint8Array;
  box: Rect;
  centre: { x: number; y: number };
  tilt: BoxTilt;
  aspect: number;
}): Promise<{ bytes: Uint8Array; box: Rect }> {
  const image = await loadImage(Buffer.from(bytes));
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  // In the picture's pixels: the slide as wide as it shows the element.
  const width = sourceWidth / box.w;
  const height = width / aspect;
  const depth = TILT_DEPTH * width;
  const cx = centre.x * width;
  const cy = centre.y * height;
  // Clockwise from the top left, as `squareToQuad` takes them.
  const corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ].map(([x, y]) => {
    const seen = projected(x! * width - cx, y! * height - cy, tilt, depth);
    return { x: cx + seen.x, y: cy + seen.y };
  });
  const left = Math.floor(Math.min(...corners.map((c) => c.x)));
  const top = Math.floor(Math.min(...corners.map((c) => c.y)));
  const right = Math.ceil(Math.max(...corners.map((c) => c.x)));
  const bottom = Math.ceil(Math.max(...corners.map((c) => c.y)));
  const scale = Math.min(1, MAX_SIDE / Math.max(right - left, bottom - top));
  const outWidth = Math.max(1, Math.round((right - left) * scale));
  const outHeight = Math.max(1, Math.round((bottom - top) * scale));

  const flat = createCanvas(sourceWidth, sourceHeight);
  const flatContext = flat.getContext('2d');
  flatContext.drawImage(image, 0, 0);
  const source = flatContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
  const canvas = createCanvas(outWidth, outHeight);
  const context = canvas.getContext('2d');
  const out = context.createImageData(outWidth, outHeight);
  const pixels = out.data;

  // From where a pixel is seen back to where it is in the flat picture (0–1 both ways).
  const [a, b, c, d, e, f, g, h, i] = inverted(squareToQuad(corners));
  const sample = new Float64Array(4);
  const read = (u: number, v: number) => {
    // Interpolated with its colour weighed by how opaque it is: no dark seams at the edge.
    const x = u * sourceWidth - 0.5;
    const y = v * sourceHeight - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    sample.fill(0);
    for (const [px, py, weight] of [
      [x0, y0, (1 - fx) * (1 - fy)],
      [x0 + 1, y0, fx * (1 - fy)],
      [x0, y0 + 1, (1 - fx) * fy],
      [x0 + 1, y0 + 1, fx * fy],
    ] as const) {
      if (weight === 0 || px < 0 || py < 0 || px >= sourceWidth || py >= sourceHeight) continue;
      const at = (py * sourceWidth + px) * 4;
      const alpha = (source[at + 3]! / 255) * weight;
      sample[0]! += source[at]! * alpha;
      sample[1]! += source[at + 1]! * alpha;
      sample[2]! += source[at + 2]! * alpha;
      sample[3]! += alpha;
    }
  };
  for (let row = 0; row < outHeight; row += 1) {
    const y = top + (row + 0.5) / scale;
    for (let column = 0; column < outWidth; column += 1) {
      const x = left + (column + 0.5) / scale;
      const w = g * x + h * y + i;
      const u = (a * x + b * y + c) / w;
      const v = (d * x + e * y + f) / w;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      read(u, v);
      const alpha = sample[3]!;
      if (alpha <= 0) continue;
      const at = (row * outWidth + column) * 4;
      pixels[at] = sample[0]! / alpha;
      pixels[at + 1] = sample[1]! / alpha;
      pixels[at + 2] = sample[2]! / alpha;
      pixels[at + 3] = alpha * 255;
    }
  }
  context.putImageData(out, 0, 0);
  return {
    bytes: new Uint8Array(await canvas.encode('png')),
    box: {
      x: left / width,
      y: top / height,
      w: (right - left) / width,
      h: (bottom - top) / height,
    },
  };
}
