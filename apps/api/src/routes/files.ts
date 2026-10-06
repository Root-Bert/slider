import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import { notFound } from '../http/errors';
import { contentTypeForKey, isValidKey } from '../storage/blob-storage';

/** SVG renders must never run script, even when opened directly. */
const SVG_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/**
 * Serves blobs at `/files/<key>`.
 * TODO(BER-94): replace with short-lived signed URLs. Until then there is no session check:
 * every key contains a random UUID, so a URL is only known to someone who was shown it.
 */
export function filesRoutes(deps: AppDeps) {
  return new Hono().get('/*', async (c) => {
    const key = c.req.path.replace(/^\/files\//, '');
    if (!isValidKey(key)) throw notFound();
    const data = await deps.storage.get(key);
    if (!data) throw notFound();

    const contentType = contentTypeForKey(key);
    c.header('Content-Type', contentType);
    // Keys are content-unique: a changed file always gets a new key.
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    if (contentType === 'image/svg+xml') c.header('Content-Security-Policy', SVG_CSP);
    return c.body(data);
  });
}
