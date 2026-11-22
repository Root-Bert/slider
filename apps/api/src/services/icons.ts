import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { loadImage } from '../import/load-image';
import type { OdpImage } from '@slider/odp';
import {
  iconSvg,
  iconsOfSet,
  searchIcons,
  type IconKind,
  type IconSetFile,
  type LibraryIcon,
} from '@slider/shared/icons';

/*
 * Slider's symbols for the AI – the sets the editor's „Symbol einfügen“ offers, read from the same
 * files (`apps/web/src/features/icons/sets`, copied into the image), searched alike, and drawn here
 * as the editor draws them: a PNG of the symbol in one colour, kept in the file with which symbol
 * it is (so the editor offers other colours and symbols for it).
 */

const SETS = fileURLToPath(new URL('../../../web/src/features/icons/sets/', import.meta.url));
const FILES = ['phosphor.json', 'carbon-pictograms.json'];
/** Pixels on the longer side – the editor's `ICON_PX`. */
const ICON_PX = 1024;
/** Symbols one search shows the AI, and their size on the sheet it sees. */
const SHOWN = 24;
const CELL = 72;
const COLUMNS = 8;

let loading: Promise<LibraryIcon[]> | null = null;

/** Both sets, read once. */
function library(): Promise<LibraryIcon[]> {
  loading ??= Promise.all(
    FILES.map(async (file) => JSON.parse(await readFile(SETS + file, 'utf8')) as IconSetFile),
  ).then(
    (files) => files.flatMap(iconsOfSet),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The symbol with this id (`phosphor/leaf`), if there is one. */
export async function iconById(id: string): Promise<LibraryIcon | undefined> {
  return (await library()).find((icon) => icon.id === id);
}

/**
 * The symbols for a search, best first – and a picture of them in a grid, in order (row by row),
 * for the AI to choose by look.
 */
export async function findIcons(
  query: string,
  kind?: IconKind,
): Promise<{ icons: LibraryIcon[]; sheet: Uint8Array | null }> {
  const icons = searchIcons(await library(), query, kind ?? 'all').slice(0, SHOWN);
  if (icons.length === 0) return { icons, sheet: null };
  const rows = Math.ceil(icons.length / COLUMNS);
  const canvas = createCanvas(Math.min(icons.length, COLUMNS) * CELL, rows * CELL);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await Promise.all(
    icons.map(async (icon, at) => {
      const image = await loadImage(Buffer.from(iconSvg(icon, '#111827', CELL - 20)));
      const x = (at % COLUMNS) * CELL + (CELL - image.width) / 2;
      const y = Math.floor(at / COLUMNS) * CELL + (CELL - image.height) / 2;
      context.drawImage(image, x, y);
    }),
  );
  return { icons, sheet: new Uint8Array(await canvas.encode('png')) };
}

/** The symbol in `color` as a picture for the file – the editor's `iconPng`, with its symbol. */
export async function iconPicture(icon: LibraryIcon, color: string): Promise<OdpImage> {
  const image = await loadImage(Buffer.from(iconSvg(icon, color, ICON_PX)));
  const canvas = createCanvas(image.width || ICON_PX, image.height || ICON_PX);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    bytes: new Uint8Array(await canvas.encode('png')),
    mediaType: 'image/png',
    width: canvas.width,
    height: canvas.height,
    symbol: { id: icon.id, label: icon.label, color: color.toLowerCase() },
  };
}

/**
 * `bytes` cut to `aspect` (width / height) around its middle, as a frame filled by it shows it –
 * a JPEG unless the picture has see-through parts (PNG, WebP, GIF stay PNG).
 */
export async function coverPicture(
  bytes: Uint8Array,
  mediaType: string,
  aspect: number,
): Promise<OdpImage> {
  const image = await loadImage(Buffer.from(bytes));
  const wide = image.width / image.height > aspect;
  const width = Math.round(wide ? image.height * aspect : image.width);
  const height = Math.round(wide ? image.height : image.width / aspect);
  const canvas = createCanvas(Math.max(1, width), Math.max(1, height));
  canvas
    .getContext('2d')
    .drawImage(
      image,
      Math.round((image.width - width) / 2),
      Math.round((image.height - height) / 2),
      width,
      height,
      0,
      0,
      width,
      height,
    );
  const jpeg = mediaType === 'image/jpeg';
  return {
    bytes: new Uint8Array(await (jpeg ? canvas.encode('jpeg', 90) : canvas.encode('png'))),
    mediaType: jpeg ? 'image/jpeg' : 'image/png',
    width: canvas.width,
    height: canvas.height,
  };
}
