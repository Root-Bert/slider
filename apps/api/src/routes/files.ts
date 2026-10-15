import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import { forbidden, notFound } from '../http/errors';
import { contentTypeForKey, isValidKey } from '../storage/blob-storage';
import { verifyFileUrl } from '../storage/file-urls';

/** SVG renders must never run script, even when opened directly. */
const SVG_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/**
 * Serves blobs at `/files/<key>?exp=…&sig=…` (BER-94). The API hands out these signed links
 * only after its own access check, so no session lookup here; without a valid, unexpired
 * signature there is nothing to see.
 */
export function filesRoutes(deps: AppDeps) {
  return new Hono().get('/*', async (c) => {
    const key = c.req.path.replace(/^\/files\//, '');
    if (!isValidKey(key)) throw notFound();
    const validFor = verifyFileUrl(key, c.req.query('exp'), c.req.query('sig'));
    if (validFor === null) throw forbidden('Dieser Link ist abgelaufen oder ungültig.');
    const data = await deps.storage.get(key);
    if (!data) throw notFound();

    const contentType = contentTypeForKey(key);
    c.header('Content-Type', contentType);
    // Keys are content-unique, but the link expires: cache no longer than it is valid.
    c.header('Cache-Control', `private, max-age=${validFor}, immutable`);
    if (contentType === 'image/svg+xml') c.header('Content-Security-Policy', SVG_CSP);
    return c.body(data);
  });
}
