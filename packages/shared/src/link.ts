/**
 * Recognises the links Slider can import: Nextcloud shares and file links (BER-135), and plain
 * https URLs that point straight at a `.pptx` or PDF file.
 * Runs in the browser (instant feedback in the input) and on the server (authoritative check).
 */

export type ShareLinkKind = 'nextcloud' | 'url';

export interface ParsedShareLink {
  kind: ShareLinkKind;
  url: URL;
  host: string;
}

/** A Nextcloud link, taken apart: exactly one of `share` and `fileId` is set. */
export interface NextcloudLink {
  /** Where the Nextcloud lives: origin plus the path it is installed under, no trailing slash. */
  base: string;
  /** Public share token (`/s/<token>`) – readable without an account. */
  share?: string;
  /** Internal link to a file by its id (`/f/<id>`) – needs a connected account. */
  fileId?: string;
}

/** `…/s/<token>` (optionally `/download`) and `…/f/<id>`, with or without `index.php`. */
const NEXTCLOUD_LINK =
  /^(.*?)(?:\/index\.php)?\/(?:s\/([A-Za-z0-9_-]+)(?:\/download)?|f\/(\d+))\/?$/;
/** The Files app with a file open: `…/apps/files/files/<id>` or `…/apps/files/?fileid=<id>`. */
const NEXTCLOUD_FILES_APP = /^(.*?)(?:\/index\.php)?\/apps\/files(?:\/files\/(\d+))?\/?$/;

/**
 * Nextcloud runs under any host name, so its links are recognised by their paths alone. A path
 * like that on another server is fetched like a share and fails like any broken link.
 */
export function parseNextcloudLink(url: URL): NextcloudLink | null {
  const share = NEXTCLOUD_LINK.exec(url.pathname);
  if (share) {
    const base = url.origin + (share[1] ?? '');
    return share[2] ? { base, share: share[2] } : { base, fileId: share[3]! };
  }
  const app = NEXTCLOUD_FILES_APP.exec(url.pathname);
  const fileId = app?.[2] ?? (app ? url.searchParams.get('fileid') : null);
  if (app && fileId && /^\d+$/.test(fileId)) return { base: url.origin + (app[1] ?? ''), fileId };
  return null;
}

/** A URL to a deck file: a PowerPoint or a PDF. */
function pointsAtDeckFile(url: URL): boolean {
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: judge the raw path.
  }
  return /\.(pptx|pdf)$/i.test(pathname);
}

export interface ParseShareLinkOptions {
  /**
   * The organisation's Nextcloud (`NEXTCLOUD_URL`): the admin vouched for it, so its links may
   * be plain http (an intranet). Every other link must be https.
   */
  trustedNextcloud?: string | null;
  /**
   * The browser doesn't know `NEXTCLOUD_URL`: it lets every plain http link that looks like a
   * Nextcloud link through and leaves the decision to the server. Other links stay https-only.
   */
  allowHttpNextcloud?: boolean;
}

const sameOrigin = (url: URL, other: string) => {
  try {
    return url.origin === new URL(other).origin;
  } catch {
    return false;
  }
};

/** Why a link with a user name or password in it is refused (`linkHasCredentials`). */
export const LINK_CREDENTIALS_MESSAGE =
  'Links mit Benutzername oder Passwort darin können wir nicht übernehmen – nimm einen Freigabelink ohne Zugangsdaten.';

const parseUrl = (input: string): URL | null => {
  try {
    return new URL(input.trim());
  } catch {
    return null;
  }
};

/**
 * `https://user:pass@host/…`: the link would become the deck's source, stored and shown to every
 * member – password included. Such links are refused (`parseShareLink` returns null); this tells
 * the caller to say why.
 */
export function linkHasCredentials(input: string): boolean {
  const url = parseUrl(input);
  return !!url && (url.username !== '' || url.password !== '');
}

/**
 * The link without a user name or password in it, for showing it: decks linked before such links
 * were refused still store them (sync keeps using the stored one).
 */
export function withoutCredentials(input: string): string {
  const url = parseUrl(input);
  if (!url || (url.username === '' && url.password === '')) return input;
  url.username = '';
  url.password = '';
  return url.toString();
}

export function parseShareLink(
  input: string,
  options: ParseShareLinkOptions = {},
): ParsedShareLink | null {
  const url = parseUrl(input);
  if (!url) return null;
  // Credentials in the link: refused, see `linkHasCredentials`.
  if (url.username !== '' || url.password !== '') return null;
  if (url.protocol === 'http:') {
    const trusted = options.trustedNextcloud;
    const allowed = options.allowHttpNextcloud || (trusted && sameOrigin(url, trusted));
    return allowed && parseNextcloudLink(url)
      ? { kind: 'nextcloud', url, host: url.hostname.toLowerCase() }
      : null;
  }
  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();

  if (parseNextcloudLink(url)) return { kind: 'nextcloud', url, host };

  if (pointsAtDeckFile(url)) return { kind: 'url', url, host };

  return null;
}
