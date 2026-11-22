import carbonUrl from './sets/carbon-pictograms.json?url';
import phosphorUrl from './sets/phosphor.json?url';
import {
  iconSvg,
  iconsOfSet,
  type IconKind,
  type IconLibrary,
  type IconSetFile,
  type LibraryIcon,
} from '@slider/shared/icons';

export {
  fold,
  iconSvg,
  searchIcons,
  type IconFilter,
  type IconKind,
  type IconLibrary,
  type LibraryIcon,
} from '@slider/shared/icons';

/*
 * The symbols Slider brings along (Bibliothek → Symbole, „Symbol einfügen“ and a frame's „Symbol“
 * in the editor): Phosphor's icons (MIT) and IBM Carbon's pictograms (Apache 2.0), both free to
 * use without naming them. Built by `scripts/icon-sets.ts` into `sets/*.json` – loaded once, when
 * first shown, as files of their own (about 1 MB, cached for good); searched here, in German or
 * English. Each is one colour: drawn in the one picked.
 */

/** The kinds as their filters name them – the editor's symbol search and the library's. */
export const ICON_KINDS: readonly { value: IconKind; label: string }[] = [
  { value: 'icons', label: 'Icons' },
  { value: 'pictograms', label: 'Piktogramme' },
];

let loading: Promise<IconLibrary> | null = null;

/** Both sets, fetched once per page. */
export function loadIconLibrary(): Promise<IconLibrary> {
  loading ??= Promise.all(
    [phosphorUrl, carbonUrl].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Die Symbole ließen sich nicht laden.');
      return (await response.json()) as IconSetFile;
    }),
  ).then(
    (files) => ({
      icons: files.flatMap(iconsOfSet),
    }),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** Pixels on the longer side of an icon put on a slide: sharp up to the slide's width. */
export const ICON_PX = 1024;

/**
 * The icon as a PNG, `size` pixels on its longer side, clear around it – what goes on a slide (the
 * slides' file and LibreOffice draw a picture best as one).
 */
export async function iconPng(icon: LibraryIcon, color: string, size: number): Promise<File> {
  const image = new Image();
  image.src = `data:image/svg+xml,${encodeURIComponent(iconSvg(icon, color, size))}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || size;
  canvas.height = image.naturalHeight || size;
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
  if (!blob) throw new Error('Das Symbol ließ sich nicht zeichnen.');
  return new File([blob], `${icon.name}.png`, { type: 'image/png' });
}
