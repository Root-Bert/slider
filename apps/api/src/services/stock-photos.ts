import { and, eq, inArray } from 'drizzle-orm';
import {
  stockPhotoUrl,
  type ImageCredit,
  type StockOrientation,
  type StockPhoto,
  type UploadedEditImage,
  type Viewer,
} from '@slider/shared';
import { aiProposals, comments, type AiSlideChange, type StockPhotoRecord } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, notFound } from '../http/errors';
import { readBodyCapped } from '../sources/safe-fetch';
import { editTarget, storeEditImage } from './edits';

/*
 * Stock photos from Unsplash: the editor searches and picks one for a picture frame, the AI
 * picks one and offers two more (BER-183). Unsplash's terms shape all of it:
 * - the Access Key stays here – the server searches for everyone;
 * - pictures shown are Unsplash's own addresses (hotlinked), the browser and the AI load them
 *   from there; only a photo that goes into a slide is fetched into the file;
 * - a photo put into a slide is reported to Unsplash's download endpoint once, when a person
 *   chose it: at once when picked in the editor, for the AI's choice when its thread is done or
 *   the file leaves Slider (download, saving to the cloud);
 * - every photo shown names its photographer and Unsplash, linked (`stockLink`), and the file
 *   keeps that credit as the frame's description.
 */

/** Unsplash for the server; tests inject a fake (`deps.stockPhotos`). */
export interface StockPhotoSource {
  search(
    query: string,
    options: { orientation?: StockOrientation; perPage: number },
  ): Promise<StockPhotoRecord[]>;
  photo(id: string): Promise<StockPhotoRecord | null>;
  /** A picture's bytes, from Unsplash's image host. */
  picture(url: string): Promise<Uint8Array>;
  /** Reports a photo as used (its `download_location`). */
  track(downloadLocation: string): Promise<void>;
}

const API = 'https://api.unsplash.com';
const IMAGE_HOST = 'images.unsplash.com';
/** How wide a photo goes into the file: sharp on a projector, small enough for the file. */
const PICTURE_WIDTH = 1920;
const MAX_PICTURE_BYTES = 15 * 1024 ** 2;
const SEARCH_TTL_MS = 15 * 60_000;
const MAX_CACHED = 500;

interface UnsplashPhoto {
  id: string;
  description: string | null;
  alt_description: string | null;
  width: number;
  height: number;
  color: string | null;
  urls: { raw: string; small: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}

const toRecord = (photo: UnsplashPhoto): StockPhotoRecord => ({
  id: photo.id,
  description: photo.description ?? photo.alt_description ?? null,
  width: photo.width,
  height: photo.height,
  color: photo.color,
  thumbUrl: photo.urls.small,
  rawUrl: photo.urls.raw,
  credit: { name: photo.user.name, profileUrl: photo.user.links.html, photoUrl: photo.links.html },
  downloadLocation: photo.links.download_location,
});

/** The photo as the browser and the API's answers see it: without Unsplash's tracking address. */
export const toStockPhoto = ({ downloadLocation: _, ...photo }: StockPhotoRecord): StockPhoto =>
  photo;

class StockUnavailable extends ApiError {
  constructor(message = 'Die Fotosuche ist gerade nicht erreichbar. Bitte gleich nochmal.') {
    super(503, 'source_unreachable', message);
  }
}

export class UnsplashSource implements StockPhotoSource {
  constructor(
    private readonly accessKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Client-ID ${this.accessKey}`, 'Accept-Version': 'v1' },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new StockUnavailable();
    });
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new ApiError(
        429,
        'rate_limited',
        'Die Fotosuche ist für diese Stunde ausgeschöpft. Bitte später nochmal.',
      );
    }
    if (response.status === 404) throw notFound('Dieses Foto gibt es nicht (mehr).');
    if (!response.ok) throw new StockUnavailable();
    return (await response.json()) as T;
  }

  async search(query: string, options: { orientation?: StockOrientation; perPage: number }) {
    const url = new URL(`${API}/search/photos`);
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', String(options.perPage));
    url.searchParams.set('content_filter', 'high');
    if (options.orientation) url.searchParams.set('orientation', options.orientation);
    const body = await this.call<{ results: UnsplashPhoto[] }>(url.toString());
    return body.results.map(toRecord);
  }

  async photo(id: string) {
    return toRecord(await this.call<UnsplashPhoto>(`${API}/photos/${encodeURIComponent(id)}`));
  }

  async picture(url: string) {
    if (new URL(url).hostname !== IMAGE_HOST) throw badRequest('Kein Foto von Unsplash.');
    // No redirects: the host checked above is the one asked. Read capped, not whole first.
    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(30_000),
      redirect: 'manual',
    }).catch(() => {
      throw new StockUnavailable();
    });
    if (!response.ok) throw new StockUnavailable();
    return readBodyCapped(response, MAX_PICTURE_BYTES).catch((error: unknown) => {
      // `readBodyCapped` throws an ApiError only for the size; else the download broke off.
      throw new StockUnavailable(error instanceof ApiError ? 'Das Foto ist zu groß.' : undefined);
    });
  }

  async track(downloadLocation: string) {
    if (!downloadLocation.startsWith(`${API}/`)) return;
    await this.call(downloadLocation);
  }
}

const sources = new WeakMap<object, StockPhotoSource>();

/** Unsplash for this server, or `null` when it has no Access Key. */
export function stockSource(
  deps: Pick<AppDeps, 'config' | 'stockPhotos'>,
): StockPhotoSource | null {
  if (deps.stockPhotos) return deps.stockPhotos;
  const config = deps.config.unsplash;
  if (!config) return null;
  let source = sources.get(config);
  if (!source) {
    source = new UnsplashSource(config.accessKey);
    sources.set(config, source);
  }
  return source;
}

function requireSource(deps: Pick<AppDeps, 'config' | 'stockPhotos'>): StockPhotoSource {
  const source = stockSource(deps);
  if (!source) throw notFound('Die Fotosuche ist auf diesem Server nicht eingerichtet.');
  return source;
}

// Searches and photos seen lately: the same search (the AI's and then the person's) and a pick
// from a search cost Unsplash nothing more.
const searches = new Map<string, { at: number; photos: StockPhotoRecord[] }>();
const seen = new Map<string, StockPhotoRecord>();

function remember(photos: readonly StockPhotoRecord[]): void {
  for (const photo of photos) {
    seen.delete(photo.id);
    seen.set(photo.id, photo);
  }
  while (seen.size > MAX_CACHED) seen.delete(seen.keys().next().value as string);
}

/** Photos for a search, best first. */
export async function searchPhotos(
  deps: Pick<AppDeps, 'config' | 'stockPhotos' | 'clock'>,
  query: string,
  { orientation, perPage = 24 }: { orientation?: StockOrientation; perPage?: number } = {},
): Promise<StockPhotoRecord[]> {
  const source = requireSource(deps);
  const key = `${query.trim().toLowerCase()}|${orientation ?? ''}|${perPage}`;
  const now = deps.clock.now().getTime();
  const cached = searches.get(key);
  if (cached && now - cached.at < SEARCH_TTL_MS) return cached.photos;
  const photos = await source.search(query.trim(), { orientation, perPage });
  searches.delete(key);
  searches.set(key, { at: now, photos });
  while (searches.size > MAX_CACHED) searches.delete(searches.keys().next().value as string);
  remember(photos);
  return photos;
}

/** A photo by its id. */
export async function findPhoto(
  deps: Pick<AppDeps, 'config' | 'stockPhotos'>,
  id: string,
): Promise<StockPhotoRecord> {
  const known = seen.get(id);
  if (known) return known;
  const photo = await requireSource(deps).photo(id);
  if (!photo) throw notFound('Dieses Foto gibt es nicht (mehr).');
  remember([photo]);
  return photo;
}

/**
 * A photo fetched for a slide – cut to `aspect` (the frame's width / height) when given – and
 * kept as an edit picture of the deck with its credit, ready for `replaceImage`.
 */
export async function fetchPhoto(
  deps: AppDeps,
  deckId: string,
  photo: StockPhotoRecord,
  aspect: number | null,
): Promise<UploadedEditImage & { bytes: Uint8Array; mediaType: string; credit: ImageCredit }> {
  const bytes = await requireSource(deps).picture(stockPhotoUrl(photo, PICTURE_WIDTH, aspect));
  const stored = await storeEditImage(deps, deckId, bytes, photo.credit);
  return { ...stored, bytes, credit: photo.credit };
}

/** Tells Unsplash a photo was used; a failure only costs the count, never the edit. */
export async function trackPhoto(deps: AppDeps, photo: StockPhotoRecord): Promise<void> {
  try {
    await requireSource(deps).track(photo.downloadLocation);
  } catch (error) {
    deps.log.warn(`Unsplash download of ${photo.id} not reported`, error);
  }
}

// ── The editor ───────────────────────────────────────────────────────────

/** `GET /decks/:id/stock/photos` – for who may edit the deck. */
export async function searchForDeck(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  query: string,
  orientation: StockOrientation | undefined,
): Promise<StockPhoto[]> {
  await editTarget(deps, viewer, deckId);
  if (!query.trim()) return [];
  return (await searchPhotos(deps, query, { orientation })).map(toStockPhoto);
}

/** `POST /decks/:id/stock/photos/:photoId`: a person picked it – it is used, Unsplash hears. */
export async function pickPhoto(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  photoId: string,
  aspect: number | null,
): Promise<UploadedEditImage> {
  const { deck } = await editTarget(deps, viewer, deckId);
  const photo = await findPhoto(deps, photoId);
  const { imageId, width, height } = await fetchPhoto(deps, deck.id, photo, aspect);
  await trackPhoto(deps, photo);
  return { imageId, width, height };
}

// ── The AI's photos ──────────────────────────────────────────────────────

/**
 * {@link reportChosenPhotos} after the answer: Unsplash's latency (up to its timeout per photo)
 * never holds up a save, a download or marking a thread done.
 */
export function reportChosenPhotosLater(
  deps: AppDeps,
  deckId: string,
  options: { rootCommentId?: string } = {},
): void {
  if (!stockSource(deps)) return;
  void reportChosenPhotos(deps, deckId, options).catch((error: unknown) =>
    deps.log.warn(`Unsplash downloads of deck ${deckId} not reported`, error),
  );
}

/**
 * Reports the photos the AI put in that are still unreported – of the deck's applied changes,
 * or only of those asked from the thread of `rootCommentId` – now that a person settled on them.
 */
export async function reportChosenPhotos(
  deps: AppDeps,
  deckId: string,
  { rootCommentId }: { rootCommentId?: string } = {},
): Promise<void> {
  if (!stockSource(deps)) return;
  let commentIds: string[] | null = null;
  if (rootCommentId) {
    const thread = await deps.db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.deckId, deckId), eq(comments.parentId, rootCommentId)));
    commentIds = [rootCommentId, ...thread.map((row) => row.id)];
  }
  const rows = await deps.db
    .select({ id: aiProposals.id, changes: aiProposals.changes, updatedAt: aiProposals.updatedAt })
    .from(aiProposals)
    .where(
      and(
        eq(aiProposals.deckId, deckId),
        eq(aiProposals.status, 'applied'),
        ...(commentIds ? [inArray(aiProposals.commentId, commentIds)] : []),
      ),
    );
  for (const row of rows) {
    const due: StockPhotoRecord[] = [];
    const changes: AiSlideChange[] = [];
    for (const change of row.changes) {
      const stock = change.stock;
      const chosen = stock?.candidates.find((photo) => photo.id === stock.chosenId);
      if (stock && chosen && !stock.reported.includes(chosen.id)) {
        due.push(chosen);
        changes.push({ ...change, stock: { ...stock, reported: [...stock.reported, chosen.id] } });
      } else {
        changes.push(change);
      }
    }
    if (due.length === 0) continue;
    // Marked first, and only if the row is as read (`changes` is encrypted, so its time tells):
    // each photo is reported once.
    const updatedAt = new Date(Math.max(deps.clock.now().getTime(), row.updatedAt.getTime() + 1));
    const claimed = await deps.db
      .update(aiProposals)
      .set({ changes, updatedAt })
      .where(and(eq(aiProposals.id, row.id), eq(aiProposals.updatedAt, row.updatedAt)))
      .returning({ id: aiProposals.id });
    if (claimed.length === 0) continue;
    for (const photo of due) await trackPhoto(deps, photo);
  }
}
