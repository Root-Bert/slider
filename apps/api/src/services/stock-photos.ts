import { and, eq, inArray } from 'drizzle-orm';
import {
  PROVIDER_LABELS,
  stockPhotoUrl,
  type ImageCredit,
  type PhotoProvider,
  type StockOrientation,
  type StockPhoto,
  type UploadedEditImage,
  type Viewer,
} from '@slider/shared';
import {
  aiProposals,
  comments,
  decks,
  type AiSlideChange,
  type StockPhotoRecord,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, notFound } from '../http/errors';
import { readBodyCapped } from '../sources/safe-fetch';
// From the modules, not `./edits`: its edit state asks this one whether photos can be searched.
import { storeEditImage } from './edits/images';
import { editTarget } from './edits/target';
import { effectiveKey, markKeyRefused } from './integration-keys';

/*
 * Stock photos from Unsplash or Pexels – whichever the workspace's integrations name (or the
 * instance's, or the server's `UNSPLASH_ACCESS_KEY`): the editor searches and picks one for a
 * picture frame, the AI picks one and offers two more (BER-183). Pexels asks for a credit too;
 * Unsplash's terms shape all of it:
 * - the Access Key stays here – the server searches for everyone;
 * - pictures shown are Unsplash's own addresses (hotlinked), the browser and the AI load them
 *   from there; only a photo that goes into a slide is fetched into the file;
 * - a photo put into a slide is reported to Unsplash's download endpoint once, when a person
 *   chose it: at once when picked in the editor, for the AI's choice when its thread is done or
 *   the file leaves Slider (download, saving to the cloud);
 * - every photo shown names its photographer and Unsplash, linked (`stockLink`), and the file
 *   keeps that credit as the frame's description.
 */

/** A photo service for the server; tests inject a fake (`deps.stockPhotos`). */
export interface StockPhotoSource {
  search(
    query: string,
    options: { orientation?: StockOrientation; perPage: number },
  ): Promise<StockPhotoRecord[]>;
  /** Photos at random, for a search not typed yet. */
  random(options: { orientation?: StockOrientation; count: number }): Promise<StockPhotoRecord[]>;
  photo(id: string): Promise<StockPhotoRecord | null>;
  /** A picture's bytes, from the service's image host. */
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

/** The service refused the key: the integration needs a new one. */
export class StockKeyRefused extends StockUnavailable {
  constructor(readonly provider: PhotoProvider) {
    super(
      `${PROVIDER_LABELS[provider]} hat den API-Key abgelehnt – vielleicht gelöscht oder falsch kopiert.`,
    );
  }
}

/** A picture's bytes from the image host of its service – no key needed. */
async function fetchPicture(url: string, host: string, fetchImpl: typeof fetch = fetch) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== host) {
    throw badRequest('Kein Foto dieses Dienstes.');
  }
  // No redirects: the host checked above is the one asked. Read capped, not whole first.
  const response = await fetchImpl(url, {
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
    if (response.status === 401) throw new StockKeyRefused('unsplash');
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

  async random(options: { orientation?: StockOrientation; count: number }) {
    const url = new URL(`${API}/photos/random`);
    url.searchParams.set('count', String(Math.min(30, options.count)));
    url.searchParams.set('content_filter', 'high');
    if (options.orientation) url.searchParams.set('orientation', options.orientation);
    const body = await this.call<UnsplashPhoto[]>(url.toString());
    return body.map(toRecord);
  }

  async photo(id: string) {
    return toRecord(await this.call<UnsplashPhoto>(`${API}/photos/${encodeURIComponent(id)}`));
  }

  picture(url: string) {
    return fetchPicture(url, IMAGE_HOST, this.fetchImpl);
  }

  async track(downloadLocation: string) {
    if (!downloadLocation.startsWith(`${API}/`)) return;
    await this.call(downloadLocation);
  }
}

const PEXELS_API = 'https://api.pexels.com/v1';
const PEXELS_IMAGE_HOST = 'images.pexels.com';

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  /** The photo's own page. */
  url: string;
  photographer: string;
  photographer_url: string;
  avg_color: string | null;
  alt: string | null;
  src: { original: string; medium: string };
}

const pexelsRecord = (photo: PexelsPhoto): StockPhotoRecord => ({
  id: String(photo.id),
  description: photo.alt || null,
  width: photo.width,
  height: photo.height,
  color: photo.avg_color,
  thumbUrl: photo.src.medium,
  // Its image host sizes and cuts on `w`, `h` and `fit=crop` as Unsplash's does.
  rawUrl: photo.src.original,
  credit: {
    name: photo.photographer,
    profileUrl: photo.photographer_url,
    photoUrl: photo.url,
    source: 'pexels',
  },
  // Pexels counts nothing: there is nothing to report.
  downloadLocation: '',
});

/** Pexels (pexels.com/api): a key per account, 200 requests an hour unless raised. */
export class PexelsSource implements StockPhotoSource {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: { Authorization: this.apiKey },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new StockUnavailable();
    });
    if (response.status === 401 || response.status === 403) throw new StockKeyRefused('pexels');
    if (response.status === 429) {
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
    const url = new URL(`${PEXELS_API}/search`);
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', String(options.perPage));
    if (options.orientation) {
      url.searchParams.set(
        'orientation',
        options.orientation === 'squarish' ? 'square' : options.orientation,
      );
    }
    const body = await this.call<{ photos: PexelsPhoto[] }>(url.toString());
    return body.photos.map(pexelsRecord);
  }

  /** Pexels has no photos at random: its curated ones, a page at random. */
  async random(options: { orientation?: StockOrientation; count: number }) {
    const url = new URL(`${PEXELS_API}/curated`);
    url.searchParams.set('per_page', String(Math.min(80, options.count)));
    url.searchParams.set('page', String(1 + Math.floor(Math.random() * 20)));
    const body = await this.call<{ photos: PexelsPhoto[] }>(url.toString());
    return body.photos.map(pexelsRecord);
  }

  async photo(id: string) {
    return pexelsRecord(
      await this.call<PexelsPhoto>(`${PEXELS_API}/photos/${encodeURIComponent(id)}`),
    );
  }

  picture(url: string) {
    return fetchPicture(url, PEXELS_IMAGE_HOST, this.fetchImpl);
  }

  async track() {}
}

/** A service for a key of the integrations – reached like the AI's (`deps.aiFetch` in tests). */
export function photoSourceFor(
  deps: Pick<AppDeps, 'aiFetch'>,
  provider: PhotoProvider,
  apiKey: string,
): StockPhotoSource {
  const { aiFetch } = deps;
  const fetchImpl: typeof fetch = aiFetch
    ? (input, init) => aiFetch(input instanceof Request ? input.url : String(input), init)
    : fetch;
  return provider === 'pexels'
    ? new PexelsSource(apiKey, fetchImpl)
    : new UnsplashSource(apiKey, fetchImpl);
}

/** Asks the service once with the key; its refusal as a 400 in German. */
export async function checkPhotoKey(
  deps: Pick<AppDeps, 'aiFetch'>,
  provider: PhotoProvider,
  apiKey: string,
): Promise<void> {
  try {
    await photoSourceFor(deps, provider, apiKey).search('office', { perPage: 1 });
  } catch (error) {
    if (error instanceof StockKeyRefused) throw badRequest(error.message);
    throw error;
  }
}

/** The photo service a workspace searches with, and the key it runs on (to mark it refused). */
export interface PhotoSource {
  source: StockPhotoSource;
  provider: PhotoProvider;
  /** `null`: a test's fake. */
  keyId: string | null;
}

/** Per stored key – a changed key is a new row, so a new service. */
const keySources = new Map<string, StockPhotoSource>();

/**
 * The workspace's photo service: its integration, else the instance's (the server's
 * `UNSPLASH_ACCESS_KEY` becomes one of those) – `null` when there is none, or the key in use was
 * refused.
 */
export async function photoSource(deps: AppDeps, workspaceId: string): Promise<PhotoSource | null> {
  if (deps.stockPhotos) return { source: deps.stockPhotos, provider: 'unsplash', keyId: null };
  const found = await effectiveKey(deps, workspaceId, 'photos');
  if (found.row) {
    if (found.row.error) return null;
    const provider = found.row.provider as PhotoProvider;
    let source = keySources.get(found.row.id);
    if (!source) {
      source = photoSourceFor(deps, provider, found.row.apiKey);
      keySources.set(found.row.id, source);
      if (keySources.size > MAX_CACHED) keySources.delete(keySources.keys().next().value!);
    }
    return { source, provider, keyId: found.row.id };
  }
  return null;
}

async function requireSource(deps: AppDeps, workspaceId: string): Promise<PhotoSource> {
  const source = await photoSource(deps, workspaceId);
  if (!source) throw notFound('Die Fotosuche ist in diesem Workspace nicht eingerichtet.');
  return source;
}

/** `load` on the service – a refused key is marked, so the settings say why photos stopped. */
async function asking<T>(deps: AppDeps, source: PhotoSource, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof StockKeyRefused && source.keyId) {
      await markKeyRefused(deps, source.keyId, error.message);
    }
    throw error;
  }
}

// Searches and photos seen lately: the same search (the AI's and then the person's) and a pick
// from a search cost the service nothing more. Kept per service – ids are only theirs.
const searches = new Map<string, { at: number; photos: Promise<StockPhotoRecord[]> }>();
const seen = new Map<string, StockPhotoRecord>();

const seenKey = (provider: PhotoProvider, id: string) => `${provider}|${id}`;

function remember(provider: PhotoProvider, photos: readonly StockPhotoRecord[]): void {
  for (const photo of photos) {
    const key = seenKey(provider, photo.id);
    seen.delete(key);
    seen.set(key, photo);
  }
  while (seen.size > MAX_CACHED) seen.delete(seen.keys().next().value as string);
}

/**
 * The photos `load` finds for what was asked (`key`), kept for a quarter hour: asked again
 * meanwhile – also while the first call is still on its way –, Unsplash is not asked again. The
 * oldest go once more are kept than {@link MAX_CACHED}; a call that failed is not kept.
 */
function cachedPhotos(
  deps: AppDeps,
  source: PhotoSource,
  asked: string,
  load: () => Promise<StockPhotoRecord[]>,
): Promise<StockPhotoRecord[]> {
  const key = `${source.keyId ?? source.provider}|${asked}`;
  const now = deps.clock.now().getTime();
  const cached = searches.get(key);
  if (cached && now - cached.at < SEARCH_TTL_MS) return cached.photos;
  const photos = asking(deps, source, load).then((found) => {
    remember(source.provider, found);
    return found;
  });
  searches.delete(key);
  searches.set(key, { at: now, photos });
  while (searches.size > MAX_CACHED) searches.delete(searches.keys().next().value as string);
  photos.catch(() => {
    if (searches.get(key)?.photos === photos) searches.delete(key);
  });
  return photos;
}

/** Photos for a search, best first. */
export async function searchPhotos(
  deps: AppDeps,
  workspaceId: string,
  query: string,
  { orientation, perPage = 24 }: { orientation?: StockOrientation; perPage?: number } = {},
): Promise<StockPhotoRecord[]> {
  const source = await requireSource(deps, workspaceId);
  const asked = query.trim();
  return cachedPhotos(
    deps,
    source,
    `search|${orientation ?? ''}|${perPage}|${asked.toLowerCase()}`,
    () => source.source.search(asked, { orientation, perPage }),
  );
}

/**
 * Photos at random – what the editor shows before anything is typed, each time a picture is
 * picked. Kept as long as a search, for each orientation: opening the panel again and again costs
 * Unsplash one call per quarter hour (a demo app has 50 an hour).
 */
export async function randomPhotos(
  deps: AppDeps,
  workspaceId: string,
  { orientation, count = 24 }: { orientation?: StockOrientation; count?: number } = {},
): Promise<StockPhotoRecord[]> {
  const source = await requireSource(deps, workspaceId);
  return cachedPhotos(deps, source, `random|${orientation ?? ''}|${count}`, () =>
    source.source.random({ orientation, count }),
  );
}

/** A photo by its id, of the workspace's service. */
export async function findPhoto(
  deps: AppDeps,
  workspaceId: string,
  id: string,
): Promise<StockPhotoRecord> {
  const source = await requireSource(deps, workspaceId);
  const known = seen.get(seenKey(source.provider, id));
  if (known) return known;
  const photo = await asking(deps, source, () => source.source.photo(id));
  if (!photo) throw notFound('Dieses Foto gibt es nicht (mehr).');
  remember(source.provider, [photo]);
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
  const url = stockPhotoUrl(photo, PICTURE_WIDTH, aspect);
  // From the image host of the service it came from – whichever the workspace uses now.
  const bytes = await (deps.stockPhotos
    ? deps.stockPhotos.picture(url)
    : fetchPicture(url, photo.credit.source === 'pexels' ? PEXELS_IMAGE_HOST : IMAGE_HOST));
  const stored = await storeEditImage(deps, deckId, bytes, photo.credit);
  return { ...stored, bytes, credit: photo.credit };
}

/**
 * Tells Unsplash a photo was used – with the workspace's Unsplash key, if it still searches
 * there; a failure only costs the count, never the edit.
 */
export async function trackPhoto(
  deps: AppDeps,
  workspaceId: string,
  photo: StockPhotoRecord,
): Promise<void> {
  if ((photo.credit.source ?? 'unsplash') !== 'unsplash' || !photo.downloadLocation) return;
  try {
    const source = await photoSource(deps, workspaceId);
    if (source?.provider === 'unsplash') await source.source.track(photo.downloadLocation);
  } catch (error) {
    deps.log.warn(`Unsplash download of ${photo.id} not reported`, error);
  }
}

// ── The editor ───────────────────────────────────────────────────────────

/** `GET /decks/:id/stock/photos` – for who may edit the deck; without a query, photos at random. */
export async function searchForDeck(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  query: string,
  orientation: StockOrientation | undefined,
): Promise<StockPhoto[]> {
  const { deck } = await editTarget(deps, viewer, deckId);
  // Nothing typed in a workspace without a photo source: nothing to show – no error, as before
  // photos at random came (the editor asks before anything is typed).
  if (!query.trim() && !(await photoSource(deps, deck.workspaceId))) return [];
  const photos = query.trim()
    ? await searchPhotos(deps, deck.workspaceId, query, { orientation })
    : await randomPhotos(deps, deck.workspaceId, { orientation });
  return photos.map(toStockPhoto);
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
  const photo = await findPhoto(deps, deck.workspaceId, photoId);
  const { imageId, width, height } = await fetchPhoto(deps, deck.id, photo, aspect);
  await trackPhoto(deps, deck.workspaceId, photo);
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
  const [deck] = await deps.db
    .select({ workspaceId: decks.workspaceId })
    .from(decks)
    .where(eq(decks.id, deckId));
  const source = deck && (await photoSource(deps, deck.workspaceId));
  if (!deck || source?.provider !== 'unsplash') return;
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
    for (const photo of due) await trackPhoto(deps, deck.workspaceId, photo);
  }
}
