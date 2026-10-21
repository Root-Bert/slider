import { createCanvas, loadImage } from '@napi-rs/canvas';
import { MAX_PDF_IMAGE_PIXELS, PAGE_THUMBNAIL_WIDTH } from './pdf-pages';

/** Pictures the canvas can decode; anything else stays as it is. */
const RASTER = /^image\/(png|jpeg|gif|webp|bmp)$/;
const IMAGE_TAG = /<image\b[^>]*>/g;
/** Below this the re-encode isn't worth it. */
const MIN_BYTES = 32 * 1024;
const WEBP_QUALITY = 85;
/**
 * Pictures with more pixels than this are left as they are, never decoded: the canvas decodes
 * them whole, so a small, highly compressed picture of huge dimensions in an uploaded deck would
 * take gigabytes of memory. Same bound as the pictures in PDF pages.
 */
const MAX_DECODE_PIXELS = MAX_PDF_IMAGE_PIXELS;
/**
 * Pixels decoded for one SVG at most; pictures past it stay as they are. A slide can repeat one
 * picture of {@link MAX_DECODE_PIXELS} hundreds of times (repeats of the same picture at the same
 * size are decoded once anyway).
 */
const MAX_SVG_DECODE_PIXELS = 4 * MAX_DECODE_PIXELS;

interface ShrinkState {
  /** New href (or null: keep the tag) by base64 data, then by target size. */
  done: Map<string, Map<string, string | null>>;
  pixelsLeft: number;
}

/**
 * The SVG preview for a given pixel width (BER-94): the SVG renderer embeds every picture at
 * full size (a 3 MB photo makes a 4 MB slide), but the minimap, filmstrip and deck cards show it
 * at most {@link PAGE_THUMBNAIL_WIDTH} px wide, the full slide at most `PAGE_IMAGE_WIDTH` – like
 * the PDF pages. So each embedded raster picture is scaled down to what it covers at `width`
 * (sharp at 2× already included in those widths) and re-encoded as WebP. Text and shapes stay
 * vector – the browser renders them as before. Returns the input unchanged when nothing got
 * smaller.
 */
export async function svgThumbnail(svg: string, width = PAGE_THUMBNAIL_WIDTH): Promise<string> {
  const slideWidth = Number(/<svg\b[^>]*\bwidth="([\d.]+)"/.exec(svg)?.[1]);
  if (!slideWidth) return svg;
  const scale = width / slideWidth;

  const state: ShrinkState = { done: new Map(), pixelsLeft: MAX_SVG_DECODE_PIXELS };
  let changed = false;
  const parts: string[] = [];
  let last = 0;
  for (const match of svg.matchAll(IMAGE_TAG)) {
    const tag = match[0];
    const replaced = await shrinkImageTag(tag, scale, state);
    parts.push(svg.slice(last, match.index), replaced);
    last = match.index + tag.length;
    if (replaced !== tag) changed = true;
  }
  if (!changed) return svg;
  parts.push(svg.slice(last));
  return parts.join('');
}

async function shrinkImageTag(tag: string, scale: number, state: ShrinkState): Promise<string> {
  const href = /\bhref="data:([^;"]+);base64,([^"]+)"/.exec(tag);
  const width = Number(/\bwidth="([\d.]+)"/.exec(tag)?.[1]);
  const height = Number(/\bheight="([\d.]+)"/.exec(tag)?.[1]);
  if (!href || !width || !height) return tag;
  const [, mimeType = '', base64 = ''] = href;
  if (!RASTER.test(mimeType) || base64.length * 0.75 < MIN_BYTES) return tag;
  // Pixels the picture covers in the thumbnail, keeping its own aspect ratio (the tag may
  // stretch it with preserveAspectRatio="none"; the new picture is stretched the same way).
  const targetWidth = Math.max(1, Math.ceil(width * scale));
  const targetHeight = Math.max(1, Math.ceil(height * scale));
  const target = `${targetWidth}x${targetHeight}`;
  const sizes = state.done.get(base64) ?? new Map<string, string | null>();
  state.done.set(base64, sizes);
  let shrunk = sizes.get(target);
  if (shrunk === undefined) {
    shrunk = await shrinkPicture(base64, targetWidth, targetHeight, state);
    sizes.set(target, shrunk);
  }
  return shrunk === null ? tag : tag.replace(href[0], `href="${shrunk}"`);
}

/** The data URI of the picture scaled down to cover the target size, or null to keep it. */
async function shrinkPicture(
  base64: string,
  targetWidth: number,
  targetHeight: number,
  state: ShrinkState,
): Promise<string | null> {
  try {
    const bytes = Buffer.from(base64, 'base64');
    // Only pictures whose header names a size within bounds are decoded.
    const size = rasterSize(bytes);
    if (!size || size.width * size.height > MAX_DECODE_PIXELS) return null;
    if (size.width * size.height > state.pixelsLeft) return null;
    state.pixelsLeft -= size.width * size.height;
    const image = await loadImage(bytes);
    const factor = Math.max(targetWidth / image.width, targetHeight / image.height);
    if (factor >= 0.8) return null;
    const canvas = createCanvas(
      Math.max(1, Math.round(image.width * factor)),
      Math.max(1, Math.round(image.height * factor)),
    );
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = Buffer.from(await canvas.encode('webp', WEBP_QUALITY)).toString('base64');
    if (encoded.length >= base64.length) return null;
    return `data:image/webp;base64,${encoded}`;
  } catch {
    // Undecodable picture: the thumbnail keeps it as it is.
    return null;
  }
}

/**
 * Width and height a PNG, JPEG, GIF, WebP or BMP declares in its header, read without decoding
 * it; `null` for anything else or a header cut short.
 */
export function rasterSize(bytes: Uint8Array): { width: number; height: number } | null {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => data.toString('latin1', start, end);
  try {
    // PNG: signature, then the IHDR chunk.
    if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && ascii(12, 16) === 'IHDR') {
      return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    if (data.length >= 10 && ascii(0, 4) === 'GIF8') {
      return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
    }
    if (data.length >= 26 && ascii(0, 2) === 'BM') {
      // BITMAPCOREHEADER (12 bytes) has 16-bit sizes, every later header 32-bit ones.
      if (data.readUInt32LE(14) === 12) {
        return { width: data.readUInt16LE(18), height: data.readUInt16LE(20) };
      }
      return { width: Math.abs(data.readInt32LE(18)), height: Math.abs(data.readInt32LE(22)) };
    }
    if (data.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
      const chunk = ascii(12, 16);
      if (chunk === 'VP8 ') {
        return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        const bits = data.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') {
        return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
      }
      return null;
    }
    if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) return jpegSize(data);
  } catch {
    // A header cut short.
  }
  return null;
}

/** The size in a JPEG's start-of-frame segment. */
function jpegSize(data: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1] ?? 0;
    // Fill bytes, and markers without a length (TEM, RSTn).
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > data.length) return null;
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
    }
    // Start of scan or end of image before any frame header.
    if (marker === 0xda || marker === 0xd9) return null;
    offset += 2 + data.readUInt16BE(offset + 2);
  }
  return null;
}
