import type { ApiError } from '@/lib/api-client';
import { LINK_CREDENTIALS_MESSAGE, linkHasCredentials, parseShareLink } from '@slider/shared';

/** Copy and A3 ("no access") states of the "Link zur Präsentation einfügen" form (BER-92). */

export const INVALID_LINK_MESSAGE = 'Kein gültiger Nextcloud- oder Datei-Link';
export const EMPTY_LINK_MESSAGE = 'Füge einen Nextcloud- oder Datei-Link ein.';
export const NO_ACCESS_MESSAGE = 'Kein Zugriff ohne dein Nextcloud-Konto.';

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

/** Why the A3 card shows: the file is in a Nextcloud, connect an account there (BER-135). */
export type NoAccessKind = 'nextcloud';

/** The link could be parsed, but Slider can't read the file without a Nextcloud account (A3). */
export interface NoAccessInfo {
  host: string;
  kind: NoAccessKind;
  message: string;
  /** The server to connect. */
  nextcloudServer: string;
}

export function noAccessFromError(error: ApiError, host: string): NoAccessInfo | null {
  if (error.code !== 'nextcloud_login_required') return null;
  return {
    host,
    kind: 'nextcloud',
    message: error.message,
    nextcloudServer: error.nextcloudServer ?? `https://${host}`,
  };
}
