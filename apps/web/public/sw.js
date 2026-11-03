/*
 * Slider offline (service worker). What was open once opens again without a connection: the app
 * itself, the decks' slides and what the viewer and editor load about a deck. Online everything
 * comes from the server as before – the network first, the stored copy only when it cannot be
 * reached. Edits made offline wait in the browser's outbox (`editing/outbox.ts`), not here.
 *
 * Kept per browser profile and dropped with the signed-in account: on logout (the page deletes
 * the caches itself, `forgetOffline`), when the session is gone (`/api/me` answers 401) and when
 * another account signs in (its `/api/me` names someone else).
 */

const VERSION = 1;
const SHELL = `slider-shell-v${VERSION}`;
const FILES = `slider-files-v${VERSION}`;
const API = `slider-api-v${VERSION}`;
const CACHES = [SHELL, FILES, API];
/** Kept at most per cache, the oldest dropped first. */
const LIMITS = { [SHELL]: 300, [FILES]: 2000, [API]: 300 };
/** The app's HTML: every client-side route is this one page. */
const APP_HTML = '/index.html';
/** Who the stored answers belong to (`/api/me`). */
const OWNER = '/__slider-owner';

/**
 * Reads the viewer and editor need about decks, offline too. Nothing that changes an account,
 * nothing of the instance's administration, no live stream.
 */
const API_READS = new RegExp(
  '^/api/(me|legal|auth/providers' +
    '|decks' +
    '|decks/[^/]+' +
    '|decks/[^/]+/(edit|slides|comments|people|status|master|access|storage|deleted-slides|ai/proposals|revisions/[^/]+/diff)' +
    '|workspaces/[^/]+/(fonts|folders|masters|members))$',
);

/**
 * Pictures the editor asks for by POST (the slide without a text to type it over, an element's
 * cutout, a slide taken apart): drawn by the server from the deck as it is, kept by their URL – so
 * a text seen before can be typed in offline, over the slide as it was last drawn.
 */
const EDIT_PICTURES =
  /^\/api\/decks\/[^/]+\/edit\/(elements\/[^/]+\/(background|cutout)|slides\/[^/]+\/layers)$/;

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('slider-') && !CACHES.includes(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** Drops everything of the account: its answers and its decks' files. */
async function forget() {
  await Promise.all([caches.delete(API), caches.delete(FILES)]);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'POST' && EDIT_PICTURES.test(url.pathname)) {
    // Cache Storage keeps GETs only: kept under the URL as one.
    event.respondWith(networkFirst(request, API, new Request(url.href)));
    return;
  }
  if (request.method !== 'GET' || request.headers.has('range')) return;
  if (request.mode === 'navigate') {
    // A download (`/api/…/file`, a signed `/files` link) is no page of the app.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return;
    event.respondWith(networkFirst(request, SHELL, new Request(APP_HTML), { html: true }));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL));
  } else if (url.pathname.startsWith('/files/')) {
    // Signed links name the same file anew each time: kept by its path alone.
    event.respondWith(networkFirst(request, FILES, new Request(url.origin + url.pathname)));
  } else if (API_READS.test(url.pathname)) {
    const me = url.pathname === '/api/me';
    event.respondWith(networkFirst(request, API, new Request(url.href), { me }));
  } else if (url.pathname.startsWith('/fonts/') || url.pathname === '/favicon.svg') {
    event.respondWith(networkFirst(request, SHELL, new Request(url.origin + url.pathname)));
  }
});

/** Whether an answer may be stored: a whole, successful one the server lets be stored. */
const storable = (response) =>
  response.ok &&
  response.status === 200 &&
  response.type === 'basic' &&
  !/no-store/i.test(response.headers.get('cache-control') ?? '');

async function store(cacheName, key, response) {
  const cache = await caches.open(cacheName);
  await cache.put(key, response);
  scheduleTrim(cacheName);
}

/** After a put, a cache is trimmed once things calm down – not at each of a burst of answers. */
const TRIM_AFTER_MS = 5000;
/** Per cache: the trim waiting to run, and whether one runs (never two at once). */
const trims = new Map();

function scheduleTrim(cacheName) {
  const trim = trims.get(cacheName) ?? { timer: 0, running: false, again: false };
  trims.set(cacheName, trim);
  if (trim.running) {
    // Puts while it runs: once more after it.
    trim.again = true;
    return;
  }
  clearTimeout(trim.timer);
  trim.timer = setTimeout(() => void runTrim(cacheName, trim), TRIM_AFTER_MS);
}

/**
 * Drops the oldest answers beyond the cache's limit. The worker may be stopped before the timer
 * fires: then the next put trims – the limit is a bound kept loosely, not at every moment.
 */
async function runTrim(cacheName, trim) {
  trim.running = true;
  try {
    const cache = await caches.open(cacheName);
    // Whose answers they are is kept whatever else goes (`checkOwner`).
    const keys = (await cache.keys()).filter((kept) => new URL(kept.url).pathname !== OWNER);
    const limit = LIMITS[cacheName];
    for (const old of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(old);
  } catch {
    // Dropped meanwhile (logout, another account): nothing to trim.
  } finally {
    trim.running = false;
    if (trim.again) {
      trim.again = false;
      scheduleTrim(cacheName);
    }
  }
}

/**
 * A stored answer, marked as one (`X-Slider-Offline: 1`): the page tells it from the server's –
 * the editor's pictures, kept by their URL alone, may be of an earlier step of the deck.
 */
function fromStore(kept) {
  const headers = new Headers(kept.headers);
  headers.set('X-Slider-Offline', '1');
  return new Response(kept.body, { status: kept.status, statusText: kept.statusText, headers });
}

/** The server or a proxy in front of it down: its error page is no answer, the stored one is. */
const UNREACHABLE = new Set([502, 503, 504]);

/**
 * The server's answer, stored for later; without a connection – or, for the app's page and the
 * API's reads, with the server down behind its proxy (502–504) – the stored one (or the error).
 * `me`: the signed-in account's own answer – another account than the stored answers' drops them.
 * `html`: stored only when it is the app's page.
 */
async function networkFirst(request, cacheName, key, { me = false, html = false } = {}) {
  try {
    const response = await fetch(request);
    const isHtml = (response.headers.get('content-type') ?? '').startsWith('text/html');
    if (storable(response) && (!html || isHtml)) {
      // Copied before the page reads the answer.
      const copy = response.clone();
      const read = me ? response.clone() : null;
      const keep = async () => {
        if (read) await checkOwner(await read.json().catch(() => null));
        await store(cacheName, key, copy);
      };
      void keep().catch(() => {});
    } else if (me && response.status === 401) {
      // Signed out (elsewhere, or the session ran out): nothing of the account stays.
      void forget();
    } else if (
      (html || (cacheName === API && request.method === 'GET')) &&
      UNREACHABLE.has(response.status)
    ) {
      // Not the editor's pictures (POST): LibreOffice busy (503) is no reason for an older one.
      const kept = await caches.match(key, { cacheName });
      if (kept) return fromStore(kept);
    }
    return response;
  } catch (error) {
    const kept = await caches.match(key, { cacheName });
    if (kept) return fromStore(kept);
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const kept = await caches.match(request, { cacheName });
  if (kept) return kept;
  const response = await fetch(request);
  if (storable(response)) void store(cacheName, request, response.clone()).catch(() => {});
  return response;
}

/** The answers stored are this account's: another one's go first. */
async function checkOwner(me) {
  const id = me?.user?.id ?? me?.viewer?.author?.id ?? null;
  if (!id) return;
  const cache = await caches.open(SHELL);
  const known = await cache.match(OWNER);
  const owner = known ? await known.text() : null;
  if (owner === id) return;
  if (owner !== null) await forget();
  await cache.put(OWNER, new Response(id));
}
