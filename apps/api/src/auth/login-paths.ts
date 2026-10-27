import type { LoginError } from '@slider/shared';

/** Where the login page sends people after signing in, unless they came from somewhere. */
export const DEFAULT_LOGIN_RETURN_TO = '/';

/** `/login`, with `error` if any and `returnTo` unless it is the default. */
export function loginPath(returnTo?: string, error?: LoginError): string {
  const query = new URLSearchParams(error ? { error } : {});
  if (returnTo && returnTo !== DEFAULT_LOGIN_RETURN_TO) query.set('returnTo', returnTo);
  const search = query.toString();
  return search ? `/login?${search}` : '/login';
}

/** `/login?error=…` (with `returnTo` unless it is the default). */
export const loginErrorPath = (error: LoginError, returnTo?: string) => loginPath(returnTo, error);

/**
 * `/login?confirm=nextcloud`: a new account through the organisation's Nextcloud, its confirmation
 * mailed (`services/nextcloud-signup`) – the page says to look in the mailbox.
 */
export function nextcloudConfirmPath(returnTo?: string): string {
  const query = new URLSearchParams({ confirm: 'nextcloud' });
  if (returnTo && returnTo !== DEFAULT_LOGIN_RETURN_TO) query.set('returnTo', returnTo);
  return `/login?${query.toString()}`;
}
