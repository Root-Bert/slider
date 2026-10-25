import { MAX_IMAGE_BYTES } from '@slider/shared';

/*
 * Images attached to a comment (BER-174): pasted from the clipboard (a screenshot) or picked as a
 * file. The API takes PNG up to `MAX_IMAGE_BYTES`, so whatever the browser can decode is drawn
 * once onto a canvas – scaled down to a sensible size, metadata gone – and sent as PNG.
 */

/** Longest side of an attached image in px – sharp on a big screen, a few MB as PNG at most. */
export const ATTACH_MAX_EDGE = 2400;
/** Smaller each round while the PNG is still too big. */
const SHRINK = 0.75;
const MAX_ROUNDS = 6;

export const NOT_AN_IMAGE = 'Dieses Bild konnte ich nicht lesen.';

/**
 * The images on the clipboard, if that is what was copied: screenshots, "copy image" or several
 * image files. Text that comes along (a spreadsheet's cells also carry a picture) wins – then it
 * is a normal paste.
 */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (!data || data.types.includes('text/plain')) return [];
  return [...data.files].filter((file) => file.type.startsWith('image/'));
}

const fitted = (width: number, height: number, factor: number) => {
  const scale = Math.min(1, ATTACH_MAX_EDGE / Math.max(width, height)) * factor;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

/** The image as PNG that fits what the API takes; throws {@link NOT_AN_IMAGE} if it can't. */
export async function imageToPng(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(NOT_AN_IMAGE);
  }
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error(NOT_AN_IMAGE);
    let factor = 1;
    for (let round = 0; round < MAX_ROUNDS; round++, factor *= SHRINK) {
      const { width, height } = fitted(bitmap.width, bitmap.height, factor);
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const png = await toBlob(canvas);
      if (!png) throw new Error(NOT_AN_IMAGE);
      if (png.size <= MAX_IMAGE_BYTES) return png;
    }
    throw new Error('Das Bild ist zu groß.');
  } finally {
    bitmap.close();
  }
}
