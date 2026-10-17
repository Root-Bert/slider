import type { Context } from 'hono';
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import type { Config } from '../config';

/**
 * Every cookie Slider sets goes through here, so they all share one policy:
 *
 * - `Path=/`, `HttpOnly`, no `Domain`; cookies differ by name only.
 * - In production they are `Secure`, and on an https:// address they carry the `__Host-` prefix.
 *   The browser then only accepts them from this exact host over TLS – a sibling subdomain
 *   (`evil.firma.de` next to `slider.firma.de`) can no longer plant a session or OAuth state
 *   cookie with `Domain=.firma.de` (login CSRF / cookie tossing).
 * - Locally (http://localhost) the plain names stay, because `__Host-` needs `Secure`.
 */
type CookieConfig = Pick<Config, 'env' | 'webOrigin'>;

const secure = (config: CookieConfig) => config.env === 'production';
const hostPrefix = (config: CookieConfig) =>
  secure(config) && config.webOrigin.startsWith('https://') ? ('host' as const) : undefined;

type Attributes = { sameSite: 'Lax' | 'Strict'; maxAge: number };

const options = (config: CookieConfig, attributes?: Attributes): CookieOptions => ({
  path: '/',
  httpOnly: true,
  secure: secure(config),
  prefix: hostPrefix(config),
  ...attributes,
});

export function writeCookie(
  c: Context,
  config: CookieConfig,
  name: string,
  value: string,
  attributes: Attributes,
): void {
  setCookie(c, name, value, options(config, attributes));
}

export const readCookie = (c: Context, config: CookieConfig, name: string) =>
  getCookie(c, name, hostPrefix(config));

export function writeSignedCookie(
  c: Context,
  config: CookieConfig & Pick<Config, 'secret'>,
  name: string,
  value: string,
  attributes: Attributes,
): Promise<void> {
  return setSignedCookie(c, name, value, config.secret, options(config, attributes));
}

export async function readSignedCookie(
  c: Context,
  config: CookieConfig & Pick<Config, 'secret'>,
  name: string,
): Promise<string | undefined> {
  const value = await getSignedCookie(c, config.secret, name, hostPrefix(config));
  return value || undefined;
}

export function removeCookie(c: Context, config: CookieConfig, name: string): void {
  deleteCookie(c, name, options(config));
}
