import type { Point, Rect } from '@slider/shared';
import type { ClipboardContent } from './paste';

/*
 * A picture put on a slide from outside – pasted (⌘V) or dropped from the desktop – as a new
 * picture element (`addImage`), uploaded first like one picked with „Datei“.
 */

/** The formats LibreOffice and every browser show (as the server takes them). */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** At most this share of the slide's width and height. */
const MAX_SHARE = 0.6;
/** CSS pixels at 100 % (96 per inch) – a picture's are shown so, small ones not blown up. */
export const CM_PER_PX = 2.54 / 96;

const isImage = (type: string) => type.startsWith('image/');

/** The pictures among files pasted or dropped – any format (`shownImage` makes it one to keep). */
export function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...data.files];
  // Some browsers give a pasted picture only as an item.
  if (files.length === 0) {
    for (const item of data.items ?? []) {
      const file = item.kind === 'file' ? item.getAsFile() : null;
      if (file) files.push(file);
    }
  }
  return files.filter((file) => isImage(file.type));
}

/** Whether a drag brings files (their kinds are known only on the drop). */
export const bringsFiles = (data: DataTransfer | null): boolean =>
  !!data && [...data.types].includes('Files');

/**
 * `file` in a format every browser and LibreOffice show: as it is when it is one, else (HEIC,
 * TIFF, SVG, AVIF, BMP …) drawn by the browser into a PNG; `null` when the browser cannot read it.
 */
export async function shownImage(file: File): Promise<File | null> {
  if (IMAGE_TYPES.has(file.type)) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || 1;
    canvas.height = image.naturalHeight || 1;
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    if (!blob) return null;
    const name = file.name.replace(/\.[^.]*$/, '') || 'bild';
    return new File([blob], `${name}.png`, { type: 'image/png' });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The system's clipboard, read on ⌘V where the browser sends no paste (Safari with nothing to type
 * in focused) – it may ask first; empty when refused.
 */
export async function readClipboard(): Promise<ClipboardContent> {
  const content: ClipboardContent = { images: [], text: '', html: '' };
  try {
    const items = (await navigator.clipboard?.read?.()) ?? [];
    for (const item of items) {
      const type = item.types.find(isImage);
      if (type) {
        const blob = await item.getType(type);
        content.images.push(new File([blob], `bild.${type.slice('image/'.length)}`, { type }));
      }
      if (!content.text && item.types.includes('text/plain'))
        content.text = await (await item.getType('text/plain')).text();
      if (!content.html && item.types.includes('text/html'))
        content.html = await (await item.getType('text/html')).text();
    }
  } catch {
    // Refused, or nothing readable: nothing to put in.
  }
  return content;
}

/**
 * Where a picture of `image`'s pixels goes on a page of `page` (cm): its own proportions, at
 * most 60 % of the slide either way and never larger than its pixels, centred on `at` (the
 * slide's middle) and inside the slide. `longest` (cm) sets its longer side instead – an icon,
 * drawn larger than it goes on – still at most 60 %.
 */
export function imageBox(
  image: { width: number; height: number },
  page: { width: number; height: number },
  at: Point = { x: 0.5, y: 0.5 },
  longest?: number,
): Rect {
  const width = Math.max(1, image.width) * CM_PER_PX;
  const height = Math.max(1, image.height) * CM_PER_PX;
  const scale = Math.min(
    longest ? longest / Math.max(width, height) : 1,
    (MAX_SHARE * page.width) / width,
    (MAX_SHARE * page.height) / height,
  );
  return centredBox(at, (width * scale) / page.width, (height * scale) / page.height);
}

/** A box `w` × `h` (of the slide) centred on `at`, pushed inside the slide. */
export function centredBox(at: Point, w: number, h: number): Rect {
  const inside = (centre: number, size: number) =>
    Math.min(1 - size, Math.max(0, centre - size / 2));
  return { x: inside(at.x, w), y: inside(at.y, h), w, h };
}

/**
 * Several pictures put in at once (pasted, dropped), one after the other: the first at `at`, each
 * next `step` (of the slide's width) aside of the one before and as far down – the same length on
 * a page of `page` (cm). `true`: any went in.
 */
export async function insertEach(
  images: readonly File[],
  at: Point,
  step: number,
  page: { width: number; height: number },
  insert: (image: File, at: Point) => Promise<boolean>,
): Promise<boolean> {
  let ok = false;
  for (const [index, image] of images.entries()) {
    const aside = index * step;
    const down = (aside * page.width) / page.height;
    ok = (await insert(image, { x: at.x + aside, y: at.y + down })) || ok;
  }
  return ok;
}
