import type { Point, Rect } from '@slider/shared';

/*
 * A picture put on a slide from outside – pasted (⌘V) or dropped from the desktop – as a new
 * picture element (`addImage`), uploaded first like one picked with „Datei“.
 */

/** The formats LibreOffice and every browser show (as the server takes them). */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** At most this share of the slide's width and height. */
const MAX_SHARE = 0.6;
/** A picture's pixels as they are shown at 100 % (96 per inch) – small ones are not blown up. */
const CM_PER_PX = 2.54 / 96;

/** The pictures among files pasted or dropped. */
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
  return files.filter((file) => IMAGE_TYPES.has(file.type));
}

/** Whether a drag brings files (their kinds are known only on the drop). */
export const bringsFiles = (data: DataTransfer | null): boolean =>
  !!data && [...data.types].includes('Files');

/**
 * A picture on the system's clipboard, read on ⌘V where the browser sends no paste (Safari with
 * nothing to type in focused) – it may ask first; `null` without one or when refused.
 */
export async function readClipboardImage(): Promise<File | null> {
  try {
    const items = (await navigator.clipboard?.read?.()) ?? [];
    for (const item of items) {
      const type = item.types.find((kind) => IMAGE_TYPES.has(kind));
      if (!type) continue;
      const blob = await item.getType(type);
      return new File([blob], `bild.${type.slice('image/'.length)}`, { type });
    }
  } catch {
    // Refused, or nothing readable: nothing to put in.
  }
  return null;
}

/**
 * Where a picture of `image`'s pixels goes on a page of `page` (cm): its own proportions, at
 * most 60 % of the slide either way and never larger than its pixels, centred on `at` (the
 * slide's middle) and inside the slide.
 */
export function imageBox(
  image: { width: number; height: number },
  page: { width: number; height: number },
  at: Point = { x: 0.5, y: 0.5 },
): Rect {
  const width = Math.max(1, image.width) * CM_PER_PX;
  const height = Math.max(1, image.height) * CM_PER_PX;
  const scale = Math.min(1, (MAX_SHARE * page.width) / width, (MAX_SHARE * page.height) / height);
  const w = (width * scale) / page.width;
  const h = (height * scale) / page.height;
  const inside = (centre: number, size: number) =>
    Math.min(1 - size, Math.max(0, centre - size / 2));
  return { x: inside(at.x, w), y: inside(at.y, h), w, h };
}
