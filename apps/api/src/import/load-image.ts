import { loadImage as decode, type Image } from '@napi-rs/canvas';
import { imageSize } from './any-file';

/** A picture claiming more pixels than this is not decoded (a small file can unpack to GBs). */
export const MAX_DECODED_PIXELS = 120_000_000;

/**
 * `loadImage` for bytes that came from outside (an upload, a deck's file, a web address): the
 * header's size is checked first, since decoding takes four bytes a pixel – a 3 MB PNG of
 * 30 000 × 30 000 would take 3.6 GB and the process with it.
 */
export async function loadImage(bytes: Uint8Array): Promise<Image> {
  const size = imageSize(bytes);
  if (size && size.width * size.height > MAX_DECODED_PIXELS) {
    throw new Error('The picture has too many pixels to be read.');
  }
  const image = await decode(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (image.width * image.height > MAX_DECODED_PIXELS) {
    throw new Error('The picture has too many pixels to be read.');
  }
  return image;
}
