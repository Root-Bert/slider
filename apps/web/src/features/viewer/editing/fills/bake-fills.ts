import { API_PREFIX, coverCrop, type FillLayer } from '@slider/shared';
import { gradientBackground, paintGradient } from './gradient';

/*
 * A fill's layers drawn as one picture of the element's proportions – what the file shows when a
 * single colour or gradient cannot (pictures, more than one layer shown). Gradients run as
 * LibreOffice's do (`./gradient`).
 */

/** Longest side of the picture, in pixels. */
const MAX_SIDE = 1600;
/** A picture's pixel on the slide as on a screen: 1/96 inch. */
const CM_PER_PX = 2.54 / 96;

/** Pictures just uploaded for a layer, by their id: drawn from here until the file has them. */
const MAX_CACHED_PICTURES = 16;
const MAX_LOCAL_BYTES = 64 * 1024 * 1024;
const uploaded = new Map<string, { url: string; bytes: number }>();
const pictures = new Map<string, Promise<HTMLImageElement>>();
let localBytes = 0;

function forgetUpload(imageId: string) {
  const known = uploaded.get(imageId);
  if (!known) return;
  uploaded.delete(imageId);
  pictures.delete(known.url);
  localBytes -= known.bytes;
  URL.revokeObjectURL(known.url);
}

export function rememberUpload(imageId: string, file: Blob): void {
  forgetUpload(imageId);
  // The upload already exists on the server. Oversized/evicted local copies use that URL.
  if (file.size > MAX_LOCAL_BYTES) return;
  uploaded.set(imageId, { url: URL.createObjectURL(file), bytes: file.size });
  localBytes += file.size;
  while (uploaded.size > MAX_CACHED_PICTURES || localBytes > MAX_LOCAL_BYTES)
    forgetUpload(uploaded.keys().next().value!);
}

/** Where a layer's picture is drawn from: the file's, or one uploaded for the editor by its id. */
export const pictureUrl = (deckId: string, src: string): string => {
  const local = uploaded.get(src);
  if (local) {
    uploaded.delete(src);
    uploaded.set(src, local);
    return local.url;
  }
  return src.startsWith('Pictures/')
    ? `${API_PREFIX}/decks/${deckId}/edit/pictures?path=${encodeURIComponent(src)}`
    : `${API_PREFIX}/decks/${deckId}/edit/images/${encodeURIComponent(src)}`;
};

function loadPicture(url: string): Promise<HTMLImageElement> {
  let loading = pictures.get(url);
  if (loading) pictures.delete(url);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const picture = new Image();
      picture.onload = () => resolve(picture);
      picture.onerror = () => reject(new Error('Das Bild ließ sich nicht laden.'));
      picture.src = url;
    });
    const requested = loading;
    loading.catch(() => {
      if (pictures.get(url) === requested) pictures.delete(url);
    });
  }
  pictures.set(url, loading);
  while (pictures.size > MAX_CACHED_PICTURES) pictures.delete(pictures.keys().next().value!);
  return loading;
}

/** Where a picture goes in a `width` × `height` box: inside it or stretched. */
function placed(fit: 'fit' | 'stretch', picture: HTMLImageElement, width: number, height: number) {
  if (fit === 'stretch') return { x: 0, y: 0, w: width, h: height };
  const scale = Math.min(width / picture.naturalWidth, height / picture.naturalHeight);
  const w = picture.naturalWidth * scale;
  const h = picture.naturalHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

async function drawLayer(
  context: CanvasRenderingContext2D,
  layer: FillLayer,
  width: number,
  height: number,
  /** Pixels of the picture per cm of the element. */
  scale: number,
  deckId: string,
): Promise<void> {
  context.globalAlpha = layer.opacity;
  if (layer.type === 'solid') {
    context.fillStyle = layer.color;
    context.fillRect(0, 0, width, height);
  } else if (layer.type === 'gradient') {
    // Painted apart and laid on: a painted picture takes no opacity of its own.
    const painted = document.createElement('canvas');
    painted.width = width;
    painted.height = height;
    const paint = painted.getContext('2d');
    if (paint) {
      paintGradient(paint, layer, width, height);
      context.drawImage(painted, 0, 0);
    }
  } else {
    const picture = await loadPicture(pictureUrl(deckId, layer.src));
    if (layer.fit === 'tile') {
      // At its size on a screen, as LibreOffice tiles a picture.
      const tile = document.createElement('canvas');
      tile.width = Math.max(1, Math.round(picture.naturalWidth * CM_PER_PX * scale));
      tile.height = Math.max(1, Math.round(picture.naturalHeight * CM_PER_PX * scale));
      tile.getContext('2d')?.drawImage(picture, 0, 0, tile.width, tile.height);
      const pattern = context.createPattern(tile, 'repeat');
      if (pattern) {
        context.fillStyle = pattern;
        context.fillRect(0, 0, width, height);
      }
    } else if (layer.fit === 'fill') {
      // Its part shown as a picture element's (`coverCrop`): cut from it, laid over the box.
      const crop = coverCrop(
        picture.naturalWidth / Math.max(1, picture.naturalHeight),
        width / height,
        layer.focus,
      );
      const sw = picture.naturalWidth;
      const sh = picture.naturalHeight;
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
      const { x, y, w, h } = placed(layer.fit, picture, width, height);
      context.drawImage(picture, x, y, w, h);
    }
  }
  context.globalAlpha = 1;
}

/**
 * The layers shown (bottom first) drawn into a box `size` cm large: a JPEG when nothing of it is
 * see-through, else a PNG.
 */
export async function bakeFills(
  fills: readonly FillLayer[],
  size: { width: number; height: number },
  deckId: string,
): Promise<File> {
  const scale = MAX_SIDE / Math.max(size.width, size.height, 0.01);
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Der Browser kann nicht zeichnen.');
  for (const layer of fills) {
    if (layer.visible) await drawLayer(context, layer, width, height, scale, deckId);
  }
  const { data } = context.getImageData(0, 0, width, height);
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const type = opaque ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error('Das Bild ließ sich nicht erstellen.');
  return new File([blob], opaque ? 'fuellung.jpg' : 'fuellung.png', { type });
}

/** A layer as a CSS background (a swatch, a preview) in a box of `aspect`: its picture at `url`. */
export function layerBackground(
  layer: FillLayer,
  url: (src: string) => string,
  aspect = 1,
): string {
  if (layer.type === 'solid') return `linear-gradient(${layer.color}, ${layer.color})`;
  if (layer.type === 'gradient') return gradientBackground(layer, aspect);
  return `center / cover no-repeat url("${url(layer.src)}")`;
}
