/**
 * Recognises the PowerPoint links Slider can import (BER-92): OneDrive and SharePoint share links,
 * and plain https URLs that point straight at a `.pptx` file.
 * Runs in the browser (instant feedback in the input) and on the server (authoritative check).
 */

export type ShareLinkKind = 'onedrive' | 'sharepoint' | 'url';

export interface ParsedShareLink {
  kind: ShareLinkKind;
  url: URL;
  host: string;
}

const isSharePointHost = (host: string) =>
  host === 'sharepoint.com' || host.endsWith('.sharepoint.com');

const isOneDriveHost = (host: string) => host === '1drv.ms' || host === 'onedrive.live.com';

function pointsAtPptx(url: URL): boolean {
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: judge the raw path.
  }
  return pathname.toLowerCase().endsWith('.pptx');
}

export function parseShareLink(input: string): ParsedShareLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();

  if (isOneDriveHost(host)) return { kind: 'onedrive', url, host };

  if (isSharePointHost(host)) {
    const isPowerPointShare = url.pathname.startsWith('/:p:/');
    const isDocViewer = url.pathname.includes('/_layouts/15/Doc.aspx');
    // A file URL copied from the library (…/Shared Documents/deck.pptx) resolves like a share link.
    if (isPowerPointShare || isDocViewer || pointsAtPptx(url))
      return { kind: 'sharepoint', url, host };
    // Other SharePoint URLs (Word, folders) are not PowerPoint files.
    return null;
  }

  if (pointsAtPptx(url)) return { kind: 'url', url, host };

  return null;
}
