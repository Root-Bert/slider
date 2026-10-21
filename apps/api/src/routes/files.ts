import { Hono } from 'hono';
import { deckAccess } from '../auth/access';
import { resolveViewer, unauthorized } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { forbidden, notFound } from '../http/errors';
import { contentTypeForKey, isValidKey } from '../storage/blob-storage';
import { verifyFileUrl } from '../storage/file-urls';

/** SVG renders must never run script, even when opened directly. */
const SVG_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/**
 * How long the browser keeps a deck's file without asking again: as long as a source check
 * holds (`ALLOWED_TTL_MS`), so a revocation there closes the browser cache as quickly too.
 */
const DECK_FILE_MAX_AGE_S = 5 * 60;

/**
 * Serves blobs at `/files/<key>?exp=…&sig=…` (BER-94). Without a valid, unexpired signature
 * there is nothing to see. A deck's files (`decks/<id>/…`: slides, thumbnails, originals)
 * additionally need a signed-in account that may view the deck right now, through the same
 * check as the deck itself, the source's included (`deckAccess`). So a link passed on opens
 * nothing, and a revocation in SharePoint or Nextcloud closes the files with the deck. Images
 * load same-origin, so the session cookie comes along. Workspace logos stay signature-only:
 * the invitation page shows them before anyone is signed in.
 */
export function filesRoutes(deps: AppDeps) {
  return new Hono().get('/*', async (c) => {
    const key = c.req.path.replace(/^\/files\//, '');
    if (!isValidKey(key)) throw notFound();
    const validFor = verifyFileUrl(key, c.req.query('exp'), c.req.query('sig'));
    if (validFor === null) throw forbidden('Dieser Link ist abgelaufen oder ungültig.');
    const deckId = /^decks\/([^/]+)\//.exec(key)?.[1];
    if (deckId) {
      const viewer = await resolveViewer(c, deps);
      if (!viewer) throw unauthorized();
      await deckAccess(deps, viewer, deckId, 'view');
    }

    const contentType = contentTypeForKey(key);
    // Keys are content-unique: after the access check, a cached copy is still the file.
    const etag = `"${key}"`;
    const cacheControl = deckId
      ? `private, max-age=${Math.min(validFor, DECK_FILE_MAX_AGE_S)}`
      : // The link expires: cache no longer than it is valid.
        `private, max-age=${validFor}, immutable`;
    if (deckId && c.req.header('If-None-Match') === etag) {
      c.header('Cache-Control', cacheControl);
      c.header('ETag', etag);
      return c.body(null, 304);
    }
    // Streamed: a big slide or original is never held in memory whole, once per viewer.
    const size = await deps.storage.size(key);
    if (size === null) throw notFound();
    // HEAD runs this GET route and drops the body unread: no file is opened for it.
    const head = c.req.method === 'HEAD';
    const data = head ? null : await deps.storage.stream(key);
    if (!head && !data) throw notFound();

    c.header('Content-Type', contentType);
    c.header('Cache-Control', cacheControl);
    if (deckId) c.header('ETag', etag);
    if (contentType === 'image/svg+xml') c.header('Content-Security-Policy', SVG_CSP);
    c.header('Content-Length', String(size));
    return data ? c.body(data) : c.body(null);
  });
}
