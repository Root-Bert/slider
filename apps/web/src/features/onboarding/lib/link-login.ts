import { readString, writeString } from '@/lib/storage';
import { parseImportLink } from './link-import-errors';

/**
 * Ties the automatic import after the Microsoft login to a login this tab started itself.
 *
 * `/neu?link=…` imports the link right away only when this tab sent the browser to the
 * Microsoft login for exactly that link and workspace. Anyone else's crafted `/neu?link=…`
 * (or `&workspace=…`) URL only prefills the field – the person still has to press "Importieren".
 */

const STORAGE_KEY = 'slider.linkLogin';

/** The link as the API sees it, so `?link=` from the callback compares equal. */
const normalise = (link: string) => parseImportLink(link)?.url.toString() ?? null;

/** Call right before sending the browser to the Microsoft login for `link`. */
export function rememberLinkLogin(link: string, workspaceId: string): void {
  const normalised = normalise(link);
  if (!normalised) return;
  writeString(STORAGE_KEY, JSON.stringify({ link: normalised, workspaceId }), 'session');
}

/**
 * Whether this tab started the login for `link` in `workspaceId`. One use: the marker is
 * cleared whatever the answer, so a second visit to the same URL never imports again.
 */
export function takeLinkLogin(link: string, workspaceId: string): boolean {
  const raw = readString(STORAGE_KEY, 'session');
  if (raw === null) return false;
  writeString(STORAGE_KEY, null, 'session');
  try {
    const stored = JSON.parse(raw) as { link?: unknown; workspaceId?: unknown };
    const normalised = normalise(link);
    return normalised !== null && stored.link === normalised && stored.workspaceId === workspaceId;
  } catch {
    return false;
  }
}
