import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import type { LinkPreview } from '@slider/shared';
import type { AppDeps } from '../deps';
import { loadImage } from '../import/load-image';
import { dnsLookup, readBodyCapped, safeFetch, type FetchLike } from '../sources/safe-fetch';
import { DAY_MS } from './retention-rules';
import { requireRole } from './workspaces/roles';

/*
 * A link's card under a message in Sender: the page's own title, description, site name and
 * picture (`og:` / `twitter:` tags, else `<title>` and its description). Read by Slider's server
 * with the address alone – no cookie, no name, never from the browser – every hop through
 * `safeFetch` (https, public addresses, capped); only the start of the page is read, the picture
 * is drawn anew as a JPEG (never handed on as it came). Kept by address in the blob store for
 * everyone who writes it: found for {@link FOUND_DAYS}, none for {@link MISSING_DAYS}; one nobody
 * asked for in {@link KEEP_DAYS} goes (`sweepLinkPreviews`, the retention job).
 */

const FOUND_DAYS = 7;
const MISSING_DAYS = 1;
const KEEP_DAYS = 30;
/** The head of a page is in its first bytes; the rest is not read. */
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Pixels an image may unpack to before it is not drawn (a small file can unpack to GBs). */
const MAX_IMAGE_PIXELS = 40_000_000;
/** The picture's width: sharp in the card on a doubled screen. */
const IMAGE_WIDTH = 640;
/** A picture this wide (px) and this much wider than tall fills the card's banner (1.91 : 1). */
const WIDE_MIN_WIDTH = 400;
const WIDE_MIN_RATIO = 1.4;
/** One lookup at most (the page, its picture); what takes longer counts as none. */
const LOOKUP_TIMEOUT_MS = 10_000;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 300;

const PREFIX = 'link-previews/';
const keyOf = (url: string) => `${PREFIX}${createHash('sha256').update(url).digest('base64url')}`;

/** What is kept of an address: when it was looked up and what was found (`null`: nothing). */
interface Kept {
  at: number;
  preview: LinkPreview | null;
}

/** An address a card may be made of: https, no login in it, not this instance's own pages. */
export function previewableUrl(deps: Pick<AppDeps, 'config'>, raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (raw.length > 2000) return null;
  try {
    if (url.host === new URL(deps.config.webOrigin).host) return null;
  } catch {
    // No address of its own configured: nothing to leave out.
  }
  return url;
}

const running = new Map<string, Promise<LinkPreview | null>>();

/**
 * `GET /workspaces/:id/link-preview?url=`: the card of an address written in a message, kept or
 * looked up now; `null` when there is none (no title, not a page, refused, too slow).
 * `mayLookUp` is asked only before a lookup that is not kept yet – false: `null`, nothing kept.
 */
export async function linkPreview(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  raw: string,
  mayLookUp: () => boolean,
): Promise<LinkPreview | null> {
  await requireRole(deps.db, workspaceId, userId);
  const url = previewableUrl(deps, raw);
  if (!url) return null;
  const written = raw.trim();
  const key = keyOf(written);
  const kept = await readKept(deps, key);
  if (kept) {
    const keep = (kept.preview ? FOUND_DAYS : MISSING_DAYS) * DAY_MS;
    if (deps.clock.now().getTime() - kept.at < keep) return kept.preview;
  }
  const already = running.get(key);
  if (already) return already;
  if (!mayLookUp()) return null;
  const run = (async () => {
    const found = await withTimeout(lookUp(deps, url, written, key), LOOKUP_TIMEOUT_MS).catch(
      () => null,
    );
    const entry: Kept = { at: deps.clock.now().getTime(), preview: found };
    await deps.storage.put(`${key}.json`, new TextEncoder().encode(JSON.stringify(entry)));
    if (!found?.image) await deps.storage.delete(`${key}.jpg`).catch(() => undefined);
    return found;
  })().finally(() => running.delete(key));
  running.set(key, run);
  return run;
}

/** The picture of an address's card, as kept with it; `null` when it has none. */
export async function linkPreviewImage(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  raw: string,
): Promise<Uint8Array | null> {
  await requireRole(deps.db, workspaceId, userId);
  if (!previewableUrl(deps, raw)) return null;
  return deps.storage.get(`${keyOf(raw.trim())}.jpg`);
}

/** Drops what was looked up more than {@link KEEP_DAYS} ago, with its picture. */
export async function sweepLinkPreviews(deps: AppDeps): Promise<void> {
  const before = deps.clock.now().getTime() - KEEP_DAYS * DAY_MS;
  for (const key of await deps.storage.list(PREFIX)) {
    if (!key.endsWith('.json')) continue;
    const base = key.slice(0, -'.json'.length);
    const kept = await readKept(deps, base);
    if (kept && kept.at >= before) continue;
    await deps.storage.delete(key);
    await deps.storage.delete(`${base}.jpg`).catch(() => undefined);
  }
}

async function readKept(deps: AppDeps, key: string): Promise<Kept | null> {
  const bytes = await deps.storage.get(`${key}.json`);
  if (!bytes) return null;
  try {
    const kept = JSON.parse(new TextDecoder().decode(bytes)) as Kept;
    return typeof kept.at === 'number' ? kept : null;
  } catch {
    return null;
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const network = (deps: AppDeps) => ({
  fetch: (deps.linkPreviews?.fetch ?? globalThis.fetch) as FetchLike,
  lookup: deps.linkPreviews?.lookup ?? dnsLookup,
});

async function lookUp(
  deps: AppDeps,
  url: URL,
  written: string,
  key: string,
): Promise<LinkPreview | null> {
  const { response, url: final } = await safeFetch(
    url,
    { ...network(deps), maxBytes: MAX_PAGE_BYTES },
    {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de,en;q=0.8',
        'User-Agent': 'Slider (link previews)',
      },
    },
  );
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!response.ok || !/text\/html|application\/xhtml\+xml/.test(type)) {
    await response.body?.cancel();
    return null;
  }
  const html = decode(await readStart(response, MAX_PAGE_BYTES), type);
  const page = readPage(html);
  if (!page.title) return null;
  const picture = page.image ? await pictureOf(deps, page.image, final) : null;
  if (picture) await deps.storage.put(`${key}.jpg`, picture.bytes);
  return {
    url: written,
    title: page.title,
    description: page.description,
    site: page.site ?? final.hostname.replace(/^www\./, ''),
    image: picture?.shape ?? null,
  };
}

/** The first `max` bytes of the body; the rest is left unread. */
async function readStart(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      // The head is all that is read.
      if (/<\/head>|<body[\s>]/i.test(new TextDecoder().decode(value))) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(Math.min(total, max));
  let at = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.byteLength - at);
    bytes.set(part, at);
    at += part.byteLength;
    if (at >= bytes.byteLength) break;
  }
  return bytes;
}

/** The page's text in the charset its header or its `<meta charset>` names (else UTF-8). */
function decode(bytes: Uint8Array, contentType: string): string {
  const named =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(
      new TextDecoder('latin1').decode(bytes.subarray(0, 4096)),
    )?.[1];
  try {
    return new TextDecoder(named ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  euro: '€',
  copy: '©',
  reg: '®',
  middot: '·',
};

/** Text as a page writes it in an attribute or its title: entities read, spaces made one. */
function plain(text: string, max: number): string | null {
  const read = text
    .replace(/&#x([0-9a-f]+);/gi, (all, hex: string) => codePoint(parseInt(hex, 16)) ?? all)
    .replace(/&#(\d+);/g, (all, dec: string) => codePoint(Number(dec)) ?? all)
    .replace(/&([a-z]+);/gi, (all, name: string) => entities[name] ?? all)
    .replace(/\s+/g, ' ')
    .trim();
  if (!read) return null;
  return read.length > max ? `${read.slice(0, max - 1).trimEnd()}…` : read;
}

function codePoint(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return null;
  return String.fromCodePoint(value);
}

/** An element's attributes, names in lower case. */
function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const name = match[1]?.toLowerCase();
    if (name) found.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return found;
}

/** What a page's head says of it. */
export function readPage(html: string): {
  title: string | null;
  description: string | null;
  site: string | null;
  image: string | null;
} {
  const head = html.slice(0, MAX_PAGE_BYTES);
  const meta = new Map<string, string>();
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const name = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    const content = attrs.get('content');
    if (name && content !== undefined && !meta.has(name)) meta.set(name, content);
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '';
  const first = (...names: string[]) => {
    for (const name of names) {
      const value = meta.get(name);
      if (value?.trim()) return value;
    }
    return '';
  };
  return {
    title: plain(first('og:title', 'twitter:title') || titleTag, MAX_TITLE),
    description: plain(
      first('og:description', 'twitter:description', 'description'),
      MAX_DESCRIPTION,
    ),
    site: plain(first('og:site_name', 'application-name'), MAX_TITLE),
    image:
      plain(
        first(
          'og:image:secure_url',
          'og:image',
          'og:image:url',
          'twitter:image',
          'twitter:image:src',
        ),
        2000,
      ) ?? null,
  };
}

/**
 * The page's picture, fetched and drawn anew as a JPEG at most {@link IMAGE_WIDTH} wide, and
 * whether it fills a banner: wide enough and at least {@link WIDE_MIN_WIDTH} px across.
 */
async function pictureOf(
  deps: AppDeps,
  raw: string,
  base: URL,
): Promise<{ bytes: Uint8Array; shape: 'wide' | 'small' } | null> {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  try {
    const { response } = await safeFetch(
      url,
      { ...network(deps), maxBytes: MAX_IMAGE_BYTES },
      { headers: { Accept: 'image/*', 'User-Agent': 'Slider (link previews)' } },
    );
    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    // An SVG may name other files and run its own parts: none is drawn here.
    if (!response.ok || !type.startsWith('image/') || type.includes('svg')) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readBodyCapped(response, MAX_IMAGE_BYTES);
    const image = await loadImage(bytes, MAX_IMAGE_PIXELS);
    if (!image.width || !image.height) return null;
    const scale = Math.min(1, IMAGE_WIDTH / image.width);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const wide = image.width >= WIDE_MIN_WIDTH && image.width / image.height >= WIDE_MIN_RATIO;
    return {
      bytes: new Uint8Array(await canvas.encode('jpeg', 82)),
      shape: wide ? 'wide' : 'small',
    };
  } catch {
    return null;
  }
}
