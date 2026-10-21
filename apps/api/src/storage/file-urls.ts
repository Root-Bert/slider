import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed, expiring links to blobs (BER-94): `/files/<key>?exp=<unix s>&sig=<hmac>`.
 * Whoever got a URL from the API was allowed to see the file then; the link stops working
 * a few hours later, so a leaked or remembered URL is no lasting way in. A deck's files also
 * need a session that may see the deck at that moment (`routes/files`). Works the same behind
 * a CDN, which only has to pass the query and the cookie through.
 *
 * Expiry is rounded to a window, so the same file gets the same URL for hours and the browser
 * cache keeps hitting: valid between {@link WINDOW_S} and twice that.
 */
const WINDOW_S = 6 * 60 * 60;

let signingKey: Buffer | null = null;

/** Called once by `createApp`; the key is derived, so it never equals the session secret. */
export function configureFileUrls(secret: string): void {
  signingKey = createHmac('sha256', secret).update('slider:file-urls:v1').digest();
}

function sign(key: string, exp: number): string {
  if (!signingKey) throw new Error('configureFileUrls() was not called');
  return createHmac('sha256', signingKey).update(`${key}\n${exp}`).digest('base64url').slice(0, 22);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function fileUrlAt(key: string, now: number): string {
  const exp = (Math.floor(now / WINDOW_S) + 2) * WINDOW_S;
  return `/files/${key}?exp=${exp}&sig=${sign(key, exp)}`;
}

export const fileUrl = (key: string) => fileUrlAt(key, nowSeconds());

/** Seconds the link stays valid, or `null` when it is forged, altered or expired. */
export function verifyFileUrl(
  key: string,
  exp: string | undefined,
  sig: string | undefined,
  now = nowSeconds(),
): number | null {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return null;
  const expires = Number(exp);
  if (expires <= now || expires > now + 2 * WINDOW_S) return null;
  const expected = Buffer.from(sign(key, expires));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return expires - now;
}
