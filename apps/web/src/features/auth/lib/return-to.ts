import { LOGIN_ERRORS, type LoginError } from '@slider/shared';

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
  if (path === '/login' || path.startsWith('/login/')) return DEFAULT_RETURN_TO;
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

export const isLoginError = (value: string | null): value is LoginError =>
  value !== null && (LOGIN_ERRORS as readonly string[]).includes(value);

/** Friendly explanations for `/login?error=<code>`. */
const LOGIN_ERROR_COPY: Record<LoginError, { title: string; message: string }> = {
  signup_closed: {
    title: 'Kein Konto gefunden',
    message:
      'Für diese Adresse gibt es noch kein Slider-Konto. Neue Konten entstehen nur über eine Einladung – bitte jemanden aus deinem Team, dich einzuladen.',
  },
  account_exists: {
    title: 'Konto meldet sich anders an',
    message:
      'Zu dieser E-Mail-Adresse gibt es schon ein Konto, das eine andere Anmeldung nutzt. Melde dich so an wie beim ersten Mal.',
  },
  no_email: {
    title: 'Keine E-Mail-Adresse erhalten',
    message:
      'Dein Anmeldedienst hat uns keine E-Mail-Adresse geschickt. Ohne sie können wir dich nicht anmelden – frag deinen Admin.',
  },
  email_unverified: {
    title: 'E-Mail-Adresse nicht bestätigt',
    message:
      'Dein Anmeldedienst meldet die E-Mail-Adresse als nicht bestätigt. Bestätige sie dort und versuche es erneut.',
  },
  link_invalid: {
    title: 'Link ungültig',
    message:
      'Dieser Anmeldelink funktioniert nicht (mehr). Jeder Link gilt nur einmal – fordere einfach einen neuen an.',
  },
  link_expired: {
    title: 'Link abgelaufen',
    message: 'Der Anmeldelink ist abgelaufen. Fordere einen neuen an.',
  },
  admin_consent: {
    title: 'Freigabe durch Admin nötig',
    message:
      'Deine Organisation erlaubt die Anmeldung bei Slider noch nicht. Ein Microsoft-365-Admin muss die App einmal freigeben.',
  },
  denied: {
    title: 'Anmeldung abgebrochen',
    message: 'Die Anmeldung wurde abgebrochen oder nicht erlaubt. Versuche es erneut.',
  },
  failed: {
    title: 'Anmeldung fehlgeschlagen',
    message: 'Bei der Anmeldung ist etwas schiefgelaufen. Bitte versuche es erneut.',
  },
};

export const loginErrorCopy = (code: LoginError) => LOGIN_ERROR_COPY[code];
