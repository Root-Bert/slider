import type { OdpDocument, OdpGuide, OdpSlide } from '@slider/odp';
import type { AppDeps } from '../../deps';
import { openFile, readFile } from './target';

/*
 * What a file's slides are, by its blob key – a key never names another file (`blobKeys.pptx`
 * is new for every step), so each file is read once while it is being edited, not on every
 * step and every look at the edit state.
 */

/** A file's slides as read – every one with its page id (`ensureIds`). */
export interface FileSlides {
  pageSize: ReturnType<OdpDocument['pageSize']>;
  slides: OdpSlide[];
  /**
   * Every page had its id written in the file before `ensureIds` – how steps pair the slides of
   * two files (`pairSlides`): by page, or for files from before page ids by position.
   */
  hadPageIds: boolean;
  /** Each slide's layout's own guides (`OdpDocument.layoutGuides`); `null`: its layout has none. */
  layoutGuides: (OdpGuide[] | null)[];
  /** The file's snap lines (`OdpDocument.guides`): a slide's guides when its layout has none. */
  snapLines: OdpGuide[];
}

/**
 * How many slides the remembered files hold together, the most recent kept: a slide's elements
 * are what weighs, so a few big decks take the room of many small ones. The file just read is
 * kept whatever its size.
 */
const CACHED_SLIDES = 4_000;
const cache = new Map<string, FileSlides>();
let cachedSlides = 0;

function remember(key: string, read: FileSlides): void {
  const known = cache.get(key);
  if (known) {
    cache.delete(key);
    cachedSlides -= known.slides.length;
  }
  cache.set(key, read);
  cachedSlides += read.slides.length;
  for (const [oldest, file] of cache) {
    if (cachedSlides <= CACHED_SLIDES || oldest === key) break;
    cache.delete(oldest);
    cachedSlides -= file.slides.length;
  }
}

/**
 * Describes an open file's slides – giving them their ids first (`ensureIds` writes them into
 * `document`) – and remembers it as the file at `key`, when it is stored as one.
 */
export async function describeFile(document: OdpDocument, key: string | null): Promise<FileSlides> {
  const hadPageIds = document.pageIds().every(Boolean);
  document.ensureIds();
  const read = {
    pageSize: document.pageSize(),
    slides: document.slides(),
    hadPageIds,
    layoutGuides: document.layoutGuides(),
    snapLines: await document.guides(),
  };
  if (key !== null) remember(key, read);
  return read;
}

/** The slides of the file at `key`, when it was described before. */
export function knownFileSlides(key: string | null): FileSlides | undefined {
  const known = key === null ? undefined : cache.get(key);
  // Recently used: the last to go.
  if (key !== null && known) remember(key, known);
  return known;
}

/** The slides of a stored file as read. */
export async function fileSlides(
  deps: Pick<AppDeps, 'storage'>,
  key: string | null,
): Promise<FileSlides> {
  return knownFileSlides(key) ?? describeFile(await openFile(await readFile(deps, key)), key);
}
