import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PAGE_THUMBNAIL_WIDTH } from './pdf-pages';

/** Pictures the canvas can decode; anything else stays as it is. */
const RASTER = /^image\/(png|jpeg|gif|webp|bmp)$/;
const IMAGE_TAG = /<image\b[^>]*>/g;
/** Below this the re-encode isn't worth it. */
const MIN_BYTES = 32 * 1024;
const WEBP_QUALITY = 85;

/**
 * The SVG preview as a thumbnail (BER-94): the SVG renderer embeds every picture at full size
 * (a 3 MB photo makes a 4 MB slide), but the minimap, filmstrip and deck cards show it at most
 * {@link PAGE_THUMBNAIL_WIDTH} px wide. So each embedded raster picture is scaled down to what
 * it covers at that width (sharp at 2× already included in the thumbnail width) and re-encoded
 * as WebP. Text and shapes stay vector – the browser renders them as before. Returns the input
 * unchanged when nothing got smaller.
 */
export async function svgThumbnail(svg: string): Promise<string> {
  const slideWidth = Number(/<svg\b[^>]*\bwidth="([\d.]+)"/.exec(svg)?.[1]);
  if (!slideWidth) return svg;
  const scale = PAGE_THUMBNAIL_WIDTH / slideWidth;
  if (scale >= 1) return svg;

  let changed = false;
  const parts: string[] = [];
  let last = 0;
  for (const match of svg.matchAll(IMAGE_TAG)) {
    const tag = match[0];
    const replaced = await shrinkImageTag(tag, scale);
    parts.push(svg.slice(last, match.index), replaced);
    last = match.index + tag.length;
    if (replaced !== tag) changed = true;
  }
  if (!changed) return svg;
  parts.push(svg.slice(last));
  return parts.join('');
}

async function shrinkImageTag(tag: string, scale: number): Promise<string> {
  const href = /\bhref="data:([^;"]+);base64,([^"]+)"/.exec(tag);
  const width = Number(/\bwidth="([\d.]+)"/.exec(tag)?.[1]);
  const height = Number(/\bheight="([\d.]+)"/.exec(tag)?.[1]);
  if (!href || !width || !height) return tag;
  const [, mimeType = '', base64 = ''] = href;
  if (!RASTER.test(mimeType) || base64.length * 0.75 < MIN_BYTES) return tag;
  try {
    const image = await loadImage(Buffer.from(base64, 'base64'));
    // Pixels the picture covers in the thumbnail, keeping its own aspect ratio (the tag may
    // stretch it with preserveAspectRatio="none"; the new picture is stretched the same way).
    const targetWidth = Math.max(1, Math.ceil(width * scale));
    const targetHeight = Math.max(1, Math.ceil(height * scale));
    const factor = Math.max(targetWidth / image.width, targetHeight / image.height);
    if (factor >= 0.8) return tag;
    const canvas = createCanvas(
      Math.max(1, Math.round(image.width * factor)),
      Math.max(1, Math.round(image.height * factor)),
    );
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = Buffer.from(await canvas.encode('webp', WEBP_QUALITY)).toString('base64');
    if (encoded.length >= base64.length) return tag;
    return tag.replace(href[0], `href="data:image/webp;base64,${encoded}"`);
  } catch {
    // Undecodable picture: the thumbnail keeps it as it is.
    return tag;
  }
}
