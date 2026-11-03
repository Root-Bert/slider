import { createHash } from 'node:crypto';
import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { BackdropWork, OdpDocument } from '@slider/odp';
import { coverCrop, gradientPixels, type FillLayer } from '@slider/shared';
import type { AppDeps } from '../../deps';
import { fontSubstituteFor } from '../../import/libreoffice';
import { rasterizePdf } from '../../import/pdf-pages';
import { blobKeys } from '../../storage/blob-storage';
import { drawingFonts, type DrawingFonts } from '../workspace-fonts';
import { openFile, type EditTarget } from './target';

/*
 * The backdrop blur (frosted glass, `ElementEffects.backdrop`) baked into an element's fill.
 * LibreOffice has no such effect, and slides are always LibreOffice's picture – so the step that
 * changes what an element shows through (its place, the slide under it, its layers, the blur)
 * bakes it anew before it is committed: the slide under the element drawn by LibreOffice
 * (`OdpDocument.blankElement`), the element's part of it blurred, its layers painted over that,
 * the picture its fill (`OdpDocument.bakeBackdrop`). One step holds the edit and the baking, so
 * undo takes both back. Without LibreOffice, or when it fails, the step goes in as it is and the
 * element keeps its fill unblurred until a later step bakes it.
 */

/** Longest side of a baked fill, in pixels (as the editor's pictures of layers). */
const MAX_SIDE = 1600;
/** Most elements baked in one step (each one over another baked after the one under it). */
const MAX_BAKES = 8;
/** A picture's pixel on the slide as on a screen: 1/96 inch (as LibreOffice tiles pictures). */
const CM_PER_PX = 2.54 / 96;
/** The blur's standard deviation in the pixels it is worked out in – larger ones on a smaller copy. */
const WORKING_SIGMA = 6;
const JPEG_QUALITY = 92;

/**
 * Bakes the backdrop of every element of `bytes` whose picture is stale ({@link
 * OdpDocument.backdropWork}), bottom first. The file and document afterwards, or `null` when
 * nothing was baked.
 */
export async function bakeBackdrops(
  deps: AppDeps,
  target: EditTarget,
  bytes: Uint8Array,
  document?: OdpDocument,
): Promise<{ bytes: Uint8Array; document: OdpDocument } | null> {
  let doc = document ?? (await openFile(bytes));
  if (doc.backdropWork().length === 0) return null;
  const failed = new Set<string>();
  let fonts: DrawingFonts | null = null;
  let changed = false;
  for (let round = 0; round < MAX_BAKES; round += 1) {
    const work = doc.backdropWork().find((item) => !failed.has(item.elementId));
    if (!work) break;
    try {
      let backdrop: Uint8Array | null = null;
      if (work.radius > 0) {
        fonts ??= await drawingFonts(deps, target.deck.workspaceId);
        backdrop = await drawBackdrop(deps, target, bytes, work, fonts);
        if (!backdrop) {
          failed.add(work.elementId);
          continue;
        }
      }
      const picture = await bakePicture(doc, work, backdrop);
      doc.bakeBackdrop(work.elementId, picture, work.source);
      bytes = await doc.toBytes();
      // Read anew: the next element is found and drawn from the file as it now is.
      doc = await openFile(bytes);
      changed = true;
    } catch (error) {
      deps.log.warn(`Deck ${target.deck.id}: backdrop of ${work.elementId} not baked`, error);
      failed.add(work.elementId);
    }
  }
  return changed ? { bytes, document: doc } : null;
}

/**
 * The slide under the element as LibreOffice draws it (JPEG, the slide's full width), stored by
 * what it shows – an element only moved, resized or blurred otherwise is baked from the one
 * drawn before. `null`: no LibreOffice here.
 */
async function drawBackdrop(
  deps: AppDeps,
  target: EditTarget,
  bytes: Uint8Array,
  work: BackdropWork,
  fonts: DrawingFonts,
): Promise<Uint8Array | null> {
  const toPdf = deps.rendering?.renderers.libreOfficePdf;
  if (!toPdf?.pages) return null;
  const id = createHash('sha256')
    .update(`backdrop\n${work.backdrop}\n${fonts.fingerprint}`)
    .digest('hex')
    .slice(0, 32);
  const key = blobKeys.slideBackground(target.deck.id, target.revision.id, id);
  const stored = await deps.storage.get(key);
  if (stored) return stored;
  const copy = await openFile(bytes);
  copy.embedFonts(await fonts.faces(copy.fontFamilies()));
  if (!copy.blankElement(work.elementId)) return null;
  const drawing = await copy.toDrawingBytes([work.pageIndex], fontSubstituteFor(fonts.families));
  const pdf = await toPdf.pages(drawing, [work.pageIndex + 1], {
    priority: 'interactive',
    key: `${target.revision.id}:${id}`,
    prepared: true,
  });
  const drawn: { image?: Uint8Array } = {};
  await rasterizePdf(
    pdf,
    async (page) => {
      drawn.image = page.image;
    },
    { expectedPages: 1, picture: 'backdrop', interactive: true },
  );
  if (!drawn.image) return null;
  await deps.storage.put(key, drawn.image);
  return drawn.image;
}

/**
 * The element's fill as one picture: the slide under it (`backdrop`, `null`: none) blurred, its
 * edges continued past the slide's, and its layers painted over that. `null`: no picture needed
 * (no backdrop, its layers one colour or gradient). LibreOffice stretches a picture fill over the
 * shape's upright bounds on the slide – neither turned nor mirrored with it (LO 26.8, tested) – so
 * a turned element's backdrop is that part of the slide, as it lies.
 */
async function bakePicture(
  document: OdpDocument,
  work: BackdropWork,
  backdrop: Uint8Array | null,
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  const shown = work.fills.filter((layer) => layer.visible);
  if (!backdrop) {
    const native = shown.length === 0 || (shown.length === 1 && shown[0]?.type !== 'image');
    if (native) return null;
  }
  const box = backdrop ? uprightBounds(work.box, work.rotation) : work.box;
  const scale = MAX_SIDE / Math.max(box.w, box.h, 0.01);
  const width = Math.max(1, Math.round(box.w * scale));
  const height = Math.max(1, Math.round(box.h * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (backdrop) {
    const page = document.pageSize();
    const image = await loadImage(Buffer.from(backdrop));
    const blurred = blurredBackdrop(image, page, box, work.radius, scale);
    context.drawImage(blurred.canvas, 0, 0, blurred.width, blurred.height, 0, 0, width, height);
  }
  for (const layer of shown) await paintLayer(context, document, layer, width, height, scale);
  if (backdrop) {
    return {
      bytes: new Uint8Array(await canvas.encode('jpeg', JPEG_QUALITY)),
      mediaType: 'image/jpeg',
    };
  }
  const { data } = context.getImageData(0, 0, width, height);
  let opaque = true;
  for (let i = 3; i < data.length && opaque; i += 4) opaque = data[i] === 255;
  return opaque
    ? { bytes: new Uint8Array(await canvas.encode('jpeg', JPEG_QUALITY)), mediaType: 'image/jpeg' }
    : { bytes: new Uint8Array(await canvas.encode('png')), mediaType: 'image/png' };
}

/**
 * The element's part of the slide's picture, blurred by its radius: worked out on a copy small
 * enough that the blur is {@link WORKING_SIGMA} pixels there (a larger blur hides the detail lost),
 * `box` (cm) plus a margin as wide as the blur reaches – read past the slide's edge from its
 * edge – then blurred and cut to the box.
 */
function blurredBackdrop(
  image: Image,
  page: { width: number; height: number },
  box: CmRect,
  /** Points. */
  radius: number,
  /** Pixels of the baked picture per cm. */
  scale: number,
) {
  const sigmaAtScale = ((radius * 2.54) / 72) * scale;
  const shrink = Math.min(1, WORKING_SIGMA / Math.max(sigmaAtScale, 0.01));
  /** Pixels of the working copy per cm. */
  const k = scale * shrink;
  const sigma = sigmaAtScale * shrink;
  // The slide as small as worked in (smoothed: no detail sampled at random).
  const slideWidth = Math.max(1, Math.round(page.width * k));
  const slideHeight = Math.max(1, Math.round(page.height * k));
  const slide = createCanvas(slideWidth, slideHeight);
  const slideContext = slide.getContext('2d');
  slideContext.imageSmoothingEnabled = true;
  slideContext.imageSmoothingQuality = 'high';
  slideContext.drawImage(image, 0, 0, slideWidth, slideHeight);
  const source = slideContext.getImageData(0, 0, slideWidth, slideHeight).data;

  const width = Math.max(1, Math.round(box.w * k));
  const height = Math.max(1, Math.round(box.h * k));
  const pad = Math.ceil(sigma * 3) + 1;
  const outerWidth = width + 2 * pad;
  const outerHeight = height + 2 * pad;
  const pixels = new Float32Array(outerWidth * outerHeight * 3);
  const sx = box.w / width;
  const sy = box.h / height;
  for (let row = 0; row < outerHeight; row += 1) {
    for (let column = 0; column < outerWidth; column += 1) {
      const x = (box.x + (column - pad + 0.5) * sx) * k - 0.5;
      const y = (box.y + (row - pad + 0.5) * sy) * k - 0.5;
      sampleClamped(source, slideWidth, slideHeight, x, y, pixels, (row * outerWidth + column) * 3);
    }
  }
  gaussianBlur(pixels, outerWidth, outerHeight, sigma);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const out = context.createImageData(width, height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const from = ((row + pad) * outerWidth + column + pad) * 3;
      const to = (row * width + column) * 4;
      out.data[to] = pixels[from]!;
      out.data[to + 1] = pixels[from + 1]!;
      out.data[to + 2] = pixels[from + 2]!;
      out.data[to + 3] = 255;
    }
  }
  context.putImageData(out, 0, 0);
  return { canvas, width, height };
}

interface CmRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The upright bounds of a box turned `rotation` degrees about its centre. */
function uprightBounds(box: CmRect, rotation: number): CmRect {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const w = box.w * cos + box.h * sin;
  const h = box.w * sin + box.h * cos;
  return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
}

/** The colour at `x`, `y` (pixels, between them), the edge's past the edge – into `out` at `at`. */
function sampleClamped(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  out: Float32Array,
  at: number,
): void {
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  for (let c = 0; c < 3; c += 1) {
    const top =
      source[(y0 * width + x0) * 4 + c]! * (1 - fx) + source[(y0 * width + x1) * 4 + c]! * fx;
    const bottom =
      source[(y1 * width + x0) * 4 + c]! * (1 - fx) + source[(y1 * width + x1) * 4 + c]! * fx;
    out[at + c] = top * (1 - fy) + bottom * fy;
  }
}

/** Widths of three box blurs that together blur as a Gaussian of `sigma` (Kovesi). */
function boxesFor(sigma: number): number[] {
  const n = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower -= 1;
  const upper = lower + 2;
  const m = Math.round(
    (12 * sigma * sigma - n * lower * lower - 4 * n * lower - 3 * n) / (-4 * lower - 4),
  );
  return Array.from({ length: n }, (_, i) => (i < m ? lower : upper));
}

/** Blurs RGB pixels (3 per pixel) in place as a Gaussian of `sigma`, the edges continued. */
export function gaussianBlur(
  pixels: Float32Array,
  width: number,
  height: number,
  sigma: number,
): void {
  if (sigma <= 0) return;
  const scratch = new Float32Array(pixels.length);
  for (const size of boxesFor(sigma)) {
    const radius = (size - 1) / 2;
    if (radius < 1) continue;
    boxPass(pixels, scratch, width, height, radius, true);
    boxPass(scratch, pixels, width, height, radius, false);
  }
}

/** One box blur of `radius` along rows (`horizontal`) or columns, from `from` into `to`. */
function boxPass(
  from: Float32Array,
  to: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): void {
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const step = horizontal ? 3 : width * 3;
  const size = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const start = horizontal ? line * width * 3 : line * 3;
    for (let c = 0; c < 3; c += 1) {
      const at = (i: number) => from[start + Math.min(length - 1, Math.max(0, i)) * step + c]!;
      let sum = 0;
      for (let i = -radius; i <= radius; i += 1) sum += at(i);
      for (let i = 0; i < length; i += 1) {
        to[start + i * step + c] = sum / size;
        sum += at(i + radius + 1) - at(i - radius);
      }
    }
  }
}

/** Paints a fill layer over the whole picture, as the editor bakes it (`bake-fills.ts`). */
async function paintLayer(
  context: SKRSContext2D,
  document: OdpDocument,
  layer: FillLayer,
  width: number,
  height: number,
  /** Pixels of the picture per cm of the element. */
  scale: number,
): Promise<void> {
  context.globalAlpha = layer.opacity;
  if (layer.type === 'solid') {
    context.fillStyle = layer.color;
    context.fillRect(0, 0, width, height);
  } else if (layer.type === 'gradient') {
    const painted = createCanvas(width, height);
    const paint = painted.getContext('2d');
    const image = paint.createImageData(width, height);
    image.data.set(gradientPixels(layer, width, height));
    paint.putImageData(image, 0, 0);
    context.drawImage(painted, 0, 0);
  } else {
    const bytes = await document.picture(layer.src);
    if (bytes) {
      const picture = await loadImage(Buffer.from(bytes));
      if (layer.fit === 'tile') {
        const tile = createCanvas(
          Math.max(1, Math.round(picture.width * CM_PER_PX * scale)),
          Math.max(1, Math.round(picture.height * CM_PER_PX * scale)),
        );
        tile.getContext('2d').drawImage(picture, 0, 0, tile.width, tile.height);
        const pattern = context.createPattern(tile, 'repeat');
        context.fillStyle = pattern;
        context.fillRect(0, 0, width, height);
      } else if (layer.fit === 'stretch') {
        context.drawImage(picture, 0, 0, width, height);
      } else if (layer.fit === 'fill') {
        // Its part shown as a picture element's (`coverCrop`), as the editor bakes it.
        const crop = coverCrop(
          picture.width / Math.max(1, picture.height),
          width / height,
          layer.focus,
        );
        const { width: sw, height: sh } = picture;
        context.drawImage(
          picture,
          crop.x * sw,
          crop.y * sh,
          crop.w * sw,
          crop.h * sh,
          0,
          0,
          width,
          height,
        );
      } else {
        const fit = Math.min(width / picture.width, height / picture.height);
        const w = picture.width * fit;
        const h = picture.height * fit;
        context.drawImage(picture, (width - w) / 2, (height - h) / 2, w, h);
      }
    }
  }
  context.globalAlpha = 1;
}
