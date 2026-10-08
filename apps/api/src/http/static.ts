import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createMiddleware } from 'hono/factory';
import { getMimeType } from 'hono/utils/mime';
import type { Logger } from '../logger';

/** Vite puts content-hashed files here; they never change, so browsers may keep them for a year. */
const HASHED_ASSETS = '/assets/';
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** `index.html` names the current hashed assets, so it must be revalidated on every load. */
const NO_CACHE = 'no-cache';

/**
 * Serves the built web app (`apps/web/dist`) from the API process, so one container is the whole
 * deployment. GET/HEAD only; `/api` and `/files` stay with the API. Unknown paths without a file
 * extension get `index.html` (client-side routes like `/d/:deck`); unknown files are 404.
 */
export function serveWebApp(distDir: string, excludedPrefixes: readonly string[], log: Logger) {
  const root = path.resolve(distDir);
  const indexFile = path.join(root, 'index.html');
  if (!existsSync(indexFile)) {
    log.warn(`No web app at ${root} (run \`bun run build\`); serving the API only.`);
    return createMiddleware(async (_c, next) => next());
  }

  return createMiddleware(async (c, next) => {
    const method = c.req.method;
    const pathname = c.req.path;
    if ((method !== 'GET' && method !== 'HEAD') || isExcluded(pathname, excludedPrefixes)) {
      return next();
    }

    const file = await existingFile(root, pathname);
    if (file) {
      const cache = pathname.startsWith(HASHED_ASSETS) ? IMMUTABLE : NO_CACHE;
      return sendFile(method, file, cache);
    }
    // `/assets/old-hash.js` after a deploy, `/favicon.png` typos, …: no HTML in place of a script.
    if (path.extname(pathname) !== '') return next();
    return sendFile(method, indexFile, NO_CACHE);
  });
}

function isExcluded(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** The file for a URL path inside `root`, or `null`; never escapes `root`. */
async function existingFile(root: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  if (!file.startsWith(root + path.sep)) return null;
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

async function sendFile(method: string, file: string, cacheControl: string): Promise<Response> {
  const body = await readFile(file);
  const headers = {
    'Content-Type': getMimeType(file) ?? 'application/octet-stream',
    'Content-Length': String(body.byteLength),
    'Cache-Control': cacheControl,
  };
  return new Response(method === 'HEAD' ? null : body, { status: 200, headers });
}
