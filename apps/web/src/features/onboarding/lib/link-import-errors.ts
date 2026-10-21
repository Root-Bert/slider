import type { ApiError } from '@/lib/api-client';
import {
  LINK_CREDENTIALS_MESSAGE,
  linkHasCredentials,
  parseShareLink,
  type LoginError,
} from '@slider/shared';
import { ACCOUNT_LIMIT_MESSAGE, isLoginError } from '@/features/auth';

/** Copy and A3 ("no access") states of the "PowerPoint-Link einfügen" form (BER-92). */

export const INVALID_LINK_MESSAGE =
  'Kein gültiger OneDrive-, SharePoint-, Nextcloud-, Google- oder PPTX-Link';
export const EMPTY_LINK_MESSAGE =
  'Füge einen OneDrive-, SharePoint-, Nextcloud-, Google- oder PPTX-Link ein.';
export const NO_ACCESS_MESSAGE = 'Kein Zugriff – der Link ist nur intern freigegeben.';

/**
 * `parseShareLink` as the form uses it. The browser doesn't know the instance's Nextcloud
 * (`NEXTCLOUD_URL`, maybe a plain http intranet): Nextcloud-looking http links get through
 * and the API decides. Every other link must be https.
 */
export const parseImportLink = (link: string) => parseShareLink(link, { allowHttpNextcloud: true });

/** Why the form refuses a link `parseImportLink` doesn't take. */
export const invalidLinkMessage = (link: string) =>
  link.trim() === ''
    ? EMPTY_LINK_MESSAGE
    : linkHasCredentials(link)
      ? LINK_CREDENTIALS_MESSAGE
      : INVALID_LINK_MESSAGE;

export const LOGIN_DENIED_MESSAGE = 'Die Anmeldung wurde abgebrochen.';
export const CONSENT_MESSAGE =
  'Deine Organisation erlaubt Slider noch keinen Zugriff auf Dateien. Eine Administratorin oder ein Administrator muss Slider einmalig freigeben (Admin-Zustimmung). Bis dahin kannst du die Datei als PPTX hochladen.';
export const LOGIN_FAILED_MESSAGE =
  'Die Anmeldung bei Microsoft hat nicht geklappt. Bitte versuche es erneut oder lade die Datei hoch.';

/**
 * Why the A3 card shows:
 * - `login`: Slider needs a Microsoft login to read the file.
 * - `not_configured`: … but this server has no Microsoft app registration.
 * - `consent`: the organisation has to approve Slider first.
 * - `denied`: the person cancelled the Microsoft login (or it failed).
 * - `forbidden`: none of the person's Microsoft accounts may open the file – another one may.
 * - `nextcloud`: the file is in a Nextcloud – connect an account there (BER-135).
 * - `google`: the file is in Google Drive – pick it once in Google's picker (BER-119).
 */
export type NoAccessKind =
  'login' | 'not_configured' | 'consent' | 'denied' | 'forbidden' | 'nextcloud' | 'google';

/** The link could be parsed, but Slider can't read the file without a Microsoft login (A3). */
export interface NoAccessInfo {
  host: string;
  kind: NoAccessKind;
  message: string;
  /** Where "Mit Microsoft anmelden" goes; missing when the login is not set up. */
  loginUrl?: string;
  /** `nextcloud`: the server to connect. */
  nextcloudServer?: string;
  /** `google`: the file to pick in Google's picker. */
  googleFileId?: string;
}

/** The API's login URL for a link, for states that did not come from an API error. */
export const loginUrlFor = (link: string) =>
  `/api/auth/microsoft/login?returnTo=${encodeURIComponent(`/neu?link=${encodeURIComponent(link)}`)}`;

export function noAccessFromError(
  error: ApiError,
  host: string,
  link: string,
): NoAccessInfo | null {
  switch (error.code) {
    case 'microsoft_login_required':
      return {
        host,
        kind: 'login',
        message: error.message,
        loginUrl: error.loginUrl ?? loginUrlFor(link),
      };
    case 'nextcloud_login_required':
      return {
        host,
        kind: 'nextcloud',
        message: error.message,
        nextcloudServer: error.nextcloudServer ?? `https://${host}`,
      };
    case 'google_login_required':
      return { host, kind: 'google', message: error.message, googleFileId: error.googleFileId };
    case 'microsoft_not_configured':
    case 'google_not_configured':
      return { host, kind: 'not_configured', message: error.message };
    case 'microsoft_consent_required':
      return { host, kind: 'consent', message: error.message, loginUrl: loginUrlFor(link) };
    case 'source_forbidden':
      // OneDrive/SharePoint read through the person's Microsoft accounts: one more may do.
      // A plain web link that refuses has nothing to sign in to; a Nextcloud link that refuses
      // went through the account at its server already (or is a protected share).
      if (['url', 'nextcloud'].includes(parseImportLink(link)?.kind ?? '')) return null;
      return { host, kind: 'forbidden', message: error.message, loginUrl: loginUrlFor(link) };
    default:
      return null;
  }
}

/** `?msError=` from the login callback → A3 variant. */
export function noAccessFromLoginError(kind: string, host: string, link: string): NoAccessInfo {
  const loginUrl = loginUrlFor(link);
  if (kind === 'admin_consent')
    return { host, kind: 'consent', message: CONSENT_MESSAGE, loginUrl };
  if (kind === 'denied') return { host, kind: 'denied', message: LOGIN_DENIED_MESSAGE, loginUrl };
  if (kind === 'account_limit')
    return { host, kind: 'denied', message: ACCOUNT_LIMIT_MESSAGE, loginUrl };
  return { host, kind: 'denied', message: LOGIN_FAILED_MESSAGE, loginUrl };
}

/** `?googleError=` after connecting Google Drive (BER-119), as the source button says it. */
export function googleConnectErrorMessage(kind: string | null): string | null {
  if (!kind) return null;
  if (kind === 'denied') return 'Die Verbindung mit Google wurde abgebrochen.';
  if (kind === 'scope') {
    return 'Setze bei Google den Haken für Google Drive – sonst darf Slider die ausgewählten Präsentationen nicht lesen.';
  }
  if (kind === 'account') {
    return 'Dieses Google-Konto ist nicht mit Slider verbunden. Wähle mit dem verbundenen Konto aus – oder verbinde das andere unter „Konto“.';
  }
  return 'Die Verbindung mit Google hat nicht geklappt. Bitte versuche es erneut.';
}

/**
 * `/neu?msError=<kind>` without `?link=`: a Microsoft connect started on /neu (the account menu,
 * the OneDrive picker) failed – started on another page, the API sends it to /konto?linkError=.
 * Every kind gets the login banner, not only `account_limit`.
 */
export function connectErrorFrom(params: URLSearchParams): LoginError | null {
  if (params.get('link')) return null;
  const kind = params.get('msError');
  return isLoginError(kind) ? kind : null;
}
