import { createHmac, timingSafeEqual } from 'node:crypto';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { DESKTOP_PAGE_COOKIE, DESKTOP_SECRET_HEADER } from '@slider/shared';
import { forbidden } from './errors';

/*
 * The desktop's local server (BER-201) signs its one person in without a login, so being able to
 * reach 127.0.0.1 must not be enough. A web page in any browser can: directly (a write, refused
 * by `sameOriginWrites`), or through DNS rebinding – its own host name made to point at
 * 127.0.0.1, where the browser counts it as same origin and lets it read the answers. So every
 * request has to
 *  - name this machine as its host (a rebound page names its own), and
 *  - carry the page cookie Electron puts into its browser session before it loads anything, or
 *    the app's secret (Electron itself). Another browser on this machine has neither.
 * The health check stays open: Electron waits on it, it tells nothing. `bearerPaths` (the MCP
 * server) take a bearer token instead – an AI app on this machine (Claude Code) has neither the
 * cookie nor the secret; its token, made on `/konto`, is checked by the route itself.
 */

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The page cookie's value: derived from the app's secret, so Electron can make the same one. */
export const desktopPageToken = (secret: string) =>
  createHmac('sha256', secret).update('desktop-page').digest('base64url');

const same = (given: string | undefined, expected: string) => {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Routes that take a path or hand out the server's token: Electron only – the app's secret, not
 * the page cookie (any page of the app has that).
 */
export function electronOnly(secret: string) {
  return createMiddleware(async (c, next) => {
    if (!same(c.req.header(DESKTOP_SECRET_HEADER), secret)) throw forbidden();
    await next();
  });
}

export function desktopGuard(
  secret: string,
  openPaths: readonly string[],
  bearerPaths: readonly string[] = [],
) {
  const token = desktopPageToken(secret);
  return createMiddleware(async (c, next) => {
    const host = (c.req.header('host') ?? new URL(c.req.url).host).replace(/:\d+$/, '');
    if (!LOCAL_HOSTS.has(host.toLowerCase())) throw forbidden('Nur auf diesem Computer.');
    if (openPaths.includes(c.req.path)) return next();
    if (bearerPaths.includes(c.req.path) && /^Bearer\s/i.test(c.req.header('authorization') ?? ''))
      return next();
    if (same(getCookie(c, DESKTOP_PAGE_COOKIE), token)) return next();
    if (same(c.req.header(DESKTOP_SECRET_HEADER), secret)) return next();
    throw forbidden('Diese Anfrage kommt nicht von der Slider-App und wurde abgelehnt.');
  });
}
