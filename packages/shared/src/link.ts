/**
 * Recognises the PowerPoint share-link formats from BER-92.
 * Runs in the browser (instant feedback in the input) and on the server (authoritative check).
 */

export type ShareLinkKind = 'onedrive' | 'sharepoint';

export interface ParsedShareLink {
  kind: ShareLinkKind;
  url: URL;
  host: string;
}

const isSharePointHost = (host: string) =>
  host === 'sharepoint.com' || host.endsWith('.sharepoint.com');

export function parseShareLink(input: string): ParsedShareLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();

  if (host === '1drv.ms' || host === 'onedrive.live.com') {
    return { kind: 'onedrive', url, host };
  }

  if (isSharePointHost(host)) {
    const isPowerPointShare = url.pathname.startsWith('/:p:/');
    const isDocViewer = url.pathname.includes('/_layouts/15/Doc.aspx');
    if (isPowerPointShare || isDocViewer) return { kind: 'sharepoint', url, host };
  }

  return null;
}
