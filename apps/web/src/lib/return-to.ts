/** The login page and its sign-up twin `/registrieren` (BER-130). */
const AUTH_PAGES = ['/login', '/registrieren'];

/** Where to land when no (usable) `returnTo` was given. */
export const DEFAULT_RETURN_TO = '/';

/**
 * Only same-origin paths are accepted as `returnTo` – never `//evil.com`, `https://…` or
 * backslash tricks – and never the login page itself (that would loop).
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return DEFAULT_RETURN_TO;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return DEFAULT_RETURN_TO;
  }
  // Control characters (tabs, newlines) and backslashes have no business in a path.
  if ([...value].some((char) => char.charCodeAt(0) < 0x20 || char === '\\'))
    return DEFAULT_RETURN_TO;
  const path = value.split(/[?#]/)[0]!;
  if (AUTH_PAGES.some((page) => path === page || path.startsWith(`${page}/`))) {
    return DEFAULT_RETURN_TO;
  }
  return value;
}

/** `/login?returnTo=…` – the default target is left out, so the URL stays short. */
export function loginPath(returnTo?: string | null): string {
  const target = safeReturnTo(returnTo);
  if (target === DEFAULT_RETURN_TO) return '/login';
  return `/login?${new URLSearchParams({ returnTo: target }).toString()}`;
}

/** The browser goes to `${loginUrl}?returnTo=<path>` (API redirect flow). */
export function providerLoginUrl(loginUrl: string, returnTo?: string | null): string {
  const separator = loginUrl.includes('?') ? '&' : '?';
  return `${loginUrl}${separator}${new URLSearchParams({ returnTo: safeReturnTo(returnTo) }).toString()}`;
}
