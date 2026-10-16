import { createMiddleware } from 'hono/factory';
import { forbidden } from './errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for cookie-authenticated writes. `SameSite=Lax` stops other sites, but not a sibling
 * subdomain (same site): it could auto-submit a `<form enctype="text/plain">` with a JSON-shaped
 * body, which `readJson` would parse. Browsers mark every write with `Sec-Fetch-Site` and
 * `Origin`, so a write is refused when either says it comes from somewhere other than the web
 * app. Requests carrying neither (curl, health checks, server-to-server) are no CSRF vector and
 * pass – the session cookie still has to authorize them.
 */
export function sameOriginWrites(webOrigin: string) {
  return createMiddleware(async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const site = c.req.header('sec-fetch-site');
    const origin = c.req.header('origin');
    // `same-origin`: the page itself (also behind the dev server's proxy or another host name).
    if (site === 'same-origin' || origin === webOrigin) return next();
    if (site === undefined && origin === undefined) return next();
    throw forbidden('Diese Anfrage kommt nicht von Slider und wurde abgelehnt.');
  });
}
