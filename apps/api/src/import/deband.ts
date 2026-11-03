/*
 * LibreOffice draws every gradient as flat bands – at most one per two shades of its largest
 * colour change (and never more than 128, whatever `draw:gradient-step-count` says), even into a
 * PDF. A dark gradient of a few dozen shades turns into a dozen visible stripes. This finds those
 * stripes in a drawn page and smooths them over: along each row and each column, a run of flat
 * bands of about the same width whose colours step by a shade or two in a steady direction is
 * redrawn as the ramp between the bands' middles, dithered so 8 bits show no steps either.
 *
 * What is not such a staircase stays as it is: text, lines and pictures break a run (their
 * pixels differ more), a lone edge between two nearly equal areas (a card on a background) is not
 * enough bands, nested panels not bands of a width.
 */

/** Pixels a band is at least wide to count: shorter runs are the soft edges between bands. */
const MIN_BAND = 3;
/** Soft edge pixels allowed between two bands. */
const MAX_GAP = 3;
/** Largest change of a channel from one band to the next. */
const MAX_STEP = 4;
/** Bands in a row needed before they are taken for a gradient's. */
const MIN_BANDS = 4;
/** How much wider one band may be than the one before (a radial gradient's grow outwards). */
const MAX_RATIO = 1.6;
/** No interval yet (`span`). */
const NONE = 0xffff;

/**
 * Smooths LibreOffice's gradient bands in `rgba` (opaque pixels, `width` × `height`), in place.
 * The dither is the same for the same pixel: two drawings of a page differ only where they did.
 */
export function deband(rgba: Uint8ClampedArray, width: number, height: number): void {
  if (width < MIN_BAND * MIN_BANDS && height < MIN_BAND * MIN_BANDS) return;
  const source = new Uint8ClampedArray(rgba);
  // Pixels compared whole (a see-through one simply ends a band).
  const words = new Uint32Array(source.buffer, source.byteOffset, width * height);
  // Per pixel, the distance between the two bands' middles it was drawn between: the direction
  // that crosses the bands more squarely (a shorter interval) wins.
  const span = new Uint16Array(width * height).fill(NONE);
  const longest = Math.max(width, height);
  const scratch = new Scratch(Math.ceil(longest / MIN_BAND) + 1);
  for (let y = 0; y < height; y++) {
    smoothLine(source, words, rgba, span, scratch, y * width, 1, width, false);
  }
  for (let x = 0; x < width; x++)
    smoothLine(source, words, rgba, span, scratch, x, width, height, true);
}

/** The bands found along one line, reused from line to line. */
class Scratch {
  start: Int32Array;
  length: Int32Array;
  color: Int16Array;
  center: Float64Array;
  constructor(size: number) {
    this.start = new Int32Array(size);
    this.length = new Int32Array(size);
    this.color = new Int16Array(size * 3);
    this.center = new Float64Array(size);
  }
}

/**
 * One row or column: `n` pixels from pixel `first`, `stride` pixels apart. Reads `source`,
 * writes `target` where its interval is shorter than one written before (`onlyShorter`).
 */
function smoothLine(
  source: Uint8ClampedArray,
  words: Uint32Array,
  target: Uint8ClampedArray,
  span: Uint16Array,
  bands: Scratch,
  first: number,
  stride: number,
  n: number,
  onlyShorter: boolean,
): void {
  // The flat runs at least MIN_BAND long.
  let count = 0;
  let runStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && words[first + i * stride] === words[first + (i - 1) * stride]) continue;
    if (i - runStart >= MIN_BAND) {
      const at = (first + runStart * stride) * 4;
      bands.start[count] = runStart;
      bands.length[count] = i - runStart;
      bands.color[count * 3] = source[at] as number;
      bands.color[count * 3 + 1] = source[at + 1] as number;
      bands.color[count * 3 + 2] = source[at + 2] as number;
      count++;
    }
    runStart = i;
  }
  if (count < MIN_BANDS) return;

  let from = 0;
  for (let j = 1; j <= count; j++) {
    const fits =
      j < count &&
      linked(source, bands, j, first, stride) &&
      (j - 1 === from || similarSteps(bands.color, j)) &&
      (j - 2 <= from || ratioFits(bands.length[j - 1] as number, bands.length[j - 2] as number));
    if (fits) continue;
    if (j - from >= MIN_BANDS) ramp(target, span, bands, from, j - 1, first, stride, onlyShorter);
    // The band that broke off may start the next run (it may still be linked to the one before).
    from = j < count && linked(source, bands, j, first, stride) ? j - 1 : j;
  }
}

/** Band `j` follows band `j − 1` a small step on, only soft edge pixels between them. */
function linked(
  source: Uint8ClampedArray,
  bands: Scratch,
  j: number,
  first: number,
  stride: number,
) {
  const gapStart = (bands.start[j - 1] as number) + (bands.length[j - 1] as number);
  const gapEnd = bands.start[j] as number;
  if (gapEnd - gapStart > MAX_GAP) return false;
  let moved = false;
  for (let c = 0; c < 3; c++) {
    const before = bands.color[(j - 1) * 3 + c] as number;
    const after = bands.color[j * 3 + c] as number;
    if (Math.abs(after - before) > MAX_STEP) return false;
    if (after !== before) moved = true;
    const low = Math.min(before, after) - 1;
    const high = Math.max(before, after) + 1;
    for (let i = gapStart; i < gapEnd; i++) {
      const value = source[(first + i * stride) * 4 + c] as number;
      if (value < low || value > high) return false;
    }
  }
  return moved;
}

/** The step into band `j` is about the step into band `j − 1`. */
function similarSteps(color: Int16Array, j: number) {
  for (let c = 0; c < 3; c++) {
    const step = (color[j * 3 + c] as number) - (color[(j - 1) * 3 + c] as number);
    const before = (color[(j - 1) * 3 + c] as number) - (color[(j - 2) * 3 + c] as number);
    if (Math.abs(step - before) > 1) return false;
  }
  return true;
}

const ratioFits = (a: number, b: number) => Math.max(a, b) <= MAX_RATIO * Math.min(a, b);

/**
 * Bands `from` to `to` as the ramp between their middles. The outer two may be cut short (by the
 * shape's edge, by text) or be longer (a gradient's border): their middles are guessed from their
 * neighbours' width, and beyond them they stay flat.
 */
function ramp(
  target: Uint8ClampedArray,
  span: Uint16Array,
  bands: Scratch,
  from: number,
  to: number,
  first: number,
  stride: number,
  onlyShorter: boolean,
): void {
  const { start, length, color, center } = bands;
  for (let k = from + 1; k < to; k++) center[k] = (start[k] as number) + (length[k] as number) / 2;
  center[from] =
    (start[from] as number) + (length[from] as number) - (length[from + 1] as number) / 2;
  center[to] = (start[to] as number) + (length[to - 1] as number) / 2;
  let k = from;
  const end = Math.min(
    (start[to] as number) + (length[to] as number),
    Math.floor(center[to] as number) + 1,
  );
  for (
    let i = Math.max(start[from] as number, Math.ceil((center[from] as number) - 0.5));
    i < end;
    i++
  ) {
    const position = i + 0.5;
    while (k < to - 1 && position >= (center[k + 1] as number)) k++;
    const c0 = center[k] as number;
    const c1 = center[k + 1] as number;
    if (position < c0 || position > c1) continue;
    const interval = Math.max(1, Math.min(NONE - 1, Math.round(c1 - c0)));
    const pixel = first + i * stride;
    if (onlyShorter && interval >= (span[pixel] as number)) continue;
    span[pixel] = interval;
    const t = (position - c0) / (c1 - c0);
    const noise = dither(pixel);
    const at = pixel * 4;
    for (let c = 0; c < 3; c++) {
      const a = color[k * 3 + c] as number;
      const b = color[(k + 1) * 3 + c] as number;
      target[at + c] = Math.round(a + (b - a) * t + noise);
    }
  }
}

/** Triangular noise in (−1, 1), the same for the same pixel. */
function dither(pixel: number): number {
  let h = Math.imul(pixel ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h & 0xffff) + ((h >>> 16) & 0xffff)) / 65536 - 1;
}
