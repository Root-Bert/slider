import type { ParsedShareLink } from '@slider/shared';
import type { MicrosoftConfig } from '../config';
import { ApiError, notAPowerPoint } from '../http/errors';
import { downloadPptx, type DirectUrlAdapter } from './direct-url';
import {
  LINK_NOT_A_POWERPOINT_MESSAGE,
  microsoftLoginRequired,
  microsoftNotConfigured,
  sourceForbidden,
  sourceNotFound,
  sourceUnreachable,
} from './errors';
import { fetchHop, MAX_REDIRECTS, redirectTarget, type SafeFetchOptions } from './safe-fetch';
import type { RemoteFile, SourceAdapter, SourceContext } from './source-adapter';

/**
 * OneDrive and SharePoint links through Microsoft Graph (BER-88 spike, BER-92).
 *
 * Findings from the spike that shape this code:
 * - `/shares/u!{url}` fails (401) for new private OneDrive links. Those links redirect to a URL
 *   with `resid=<driveId>!s<guid>`; `/drives/{driveId}/items/{resid}` then works.
 * - Anonymous download of private OneDrive files is 403, so OneDrive always needs a login.
 * - SharePoint "Anyone with the link" files download anonymously with `download=1`.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const GRAPH_TIMEOUT_MS = 30_000;

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  eTag?: string;
  cTag?: string;
  file?: { mimeType?: string };
  parentReference?: { driveId?: string };
  '@microsoft.graph.downloadUrl'?: string;
}

/** Graph share id: `u!` + unpadded base64url of the sharing URL. */
export const shareIdFor = (url: string) => `u!${Buffer.from(url).toString('base64url')}`;

export interface OneDriveItemId {
  driveId: string;
  itemId: string;
}

/** Nested URLs some redirect hops carry their target in. */
const NESTED_URL_PARAMS = ['redir', 'url', 'ru'];

/** Reads `resid` (or `cid` + `id`) from a OneDrive URL, also inside nested redirect parameters. */
export function parseOneDriveItem(url: URL, depth = 0): OneDriveItemId | null {
  const params = url.searchParams;
  const resid = params.get('resid');
  if (resid?.includes('!')) {
    return { driveId: resid.split('!')[0] ?? '', itemId: resid };
  }
  const id = params.get('id');
  if (id?.includes('!')) {
    return { driveId: params.get('cid') ?? id.split('!')[0] ?? '', itemId: id };
  }
  if (depth >= 3) return null;
  for (const name of NESTED_URL_PARAMS) {
    const nested = params.get(name);
    if (!nested) continue;
    try {
      const found = parseOneDriveItem(new URL(nested, url), depth + 1);
      if (found) return found;
    } catch {
      // Not a URL – keep looking.
    }
  }
  return null;
}

/**
 * Finds the drive item behind a OneDrive link: from the URL itself, else by following its
 * redirects by hand (≤ {@link MAX_REDIRECTS} hops) until a hop's target carries the ids.
 */
export async function extractOneDriveItem(
  url: URL,
  http: SafeFetchOptions,
): Promise<OneDriveItemId | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const found = parseOneDriveItem(current);
    if (found?.driveId) return found;
    if (hop === MAX_REDIRECTS) break;
    const response = await fetchHop(current, http);
    await response.body?.cancel();
    const next = redirectTarget(response, current);
    if (!next) return null;
    current = next;
  }
  return null;
}

export interface GraphClientDeps {
  http: SafeFetchOptions;
  tokens: {
    getAccessToken(userId: string, options?: { forceRefresh?: boolean }): Promise<string | null>;
  };
  microsoft: MicrosoftConfig | null;
}

/** Minimal Graph client: delegated token per user, one retry after a 401, German errors. */
export class GraphClient {
  constructor(private readonly deps: GraphClientDeps) {}

  /**
   * The person's access token, or the right "please sign in" error. `resumeLink` is the pasted
   * link the web app retries after the login.
   */
  async requireToken(
    context: SourceContext,
    resumeLink: string,
    forceRefresh = false,
  ): Promise<string> {
    if (!this.deps.microsoft) throw microsoftNotConfigured();
    const token = await this.deps.tokens.getAccessToken(context.userId, { forceRefresh });
    if (!token) throw microsoftLoginRequired(resumeLink);
    return token;
  }

  /** GET `{GRAPH}/{path}` as JSON. 403 → `source_forbidden`, 404/410 → `source_not_found`. */
  async get<T>(path: string, context: SourceContext, resumeLink: string): Promise<T> {
    let response = await this.send(path, await this.requireToken(context, resumeLink));
    if (response.status === 401) {
      // Revoked or expired early: refresh once, then give up and ask for a new login.
      await response.body?.cancel();
      response = await this.send(path, await this.requireToken(context, resumeLink, true));
    }
    if (response.ok) return (await response.json()) as T;
    await response.body?.cancel();
    switch (response.status) {
      case 401:
        throw microsoftLoginRequired(resumeLink);
      case 403:
        throw sourceForbidden();
      case 400:
      case 404:
      case 410:
        throw sourceNotFound();
      default:
        throw sourceUnreachable(
          `Microsoft Graph antwortet mit einem Fehler (HTTP ${response.status}).`,
        );
    }
  }

  private async send(path: string, token: string): Promise<Response> {
    try {
      return await this.deps.http.fetch(`${GRAPH}/${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
    } catch {
      throw sourceUnreachable('Microsoft Graph ist gerade nicht erreichbar.');
    }
  }

  getItem(item: OneDriveItemId, context: SourceContext, resumeLink: string) {
    const path = `drives/${encodeURIComponent(item.driveId)}/items/${encodeURIComponent(item.itemId)}`;
    return this.get<DriveItem>(path, context, resumeLink);
  }

  getShare(sharingUrl: string, context: SourceContext) {
    return this.get<DriveItem>(`shares/${shareIdFor(sharingUrl)}/driveItem`, context, sharingUrl);
  }

  /** Graph item → {@link RemoteFile}; folders and non-PPTX files are rejected. */
  toRemoteFile(item: DriveItem): RemoteFile {
    if (!item.file || !item.name.toLowerCase().endsWith('.pptx')) {
      throw notAPowerPoint(LINK_NOT_A_POWERPOINT_MESSAGE);
    }
    const driveId = item.parentReference?.driveId;
    return {
      ref: driveId ? `drives/${driveId}/items/${item.id}` : `items/${item.id}`,
      fileName: item.name,
      sizeBytes: item.size ?? 0,
      changeToken: item.cTag ?? item.eTag ?? null,
      downloadUrl: item['@microsoft.graph.downloadUrl'],
    };
  }

  /** Downloads a Graph file through its pre-authenticated URL (no Authorization header). */
  async download(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    if (file.bytes) return file.bytes;
    let downloadUrl = file.downloadUrl;
    if (!downloadUrl) {
      // The URL from `resolve` expires after about an hour; ask Graph for a fresh one.
      const item = await this.get<DriveItem>(file.ref, context, '');
      downloadUrl = item['@microsoft.graph.downloadUrl'];
    }
    if (!downloadUrl)
      throw sourceUnreachable('Microsoft Graph liefert keinen Download für diese Datei.');
    return (await downloadPptx(new URL(downloadUrl), this.deps.http)).bytes;
  }

  async getChangeToken(file: RemoteFile, context: SourceContext): Promise<string> {
    const item = await this.get<Pick<DriveItem, 'cTag' | 'eTag'>>(
      `${file.ref}?$select=cTag,eTag`,
      context,
      '',
    );
    return item.cTag ?? item.eTag ?? '';
  }
}

/** OneDrive (personal) links. Always need a Microsoft login. */
export class OneDriveAdapter implements SourceAdapter {
  constructor(
    private readonly graph: GraphClient,
    private readonly http: SafeFetchOptions,
  ) {}

  async resolve(link: ParsedShareLink, context: SourceContext): Promise<RemoteFile> {
    // Ask for the login before touching the network: without a token nothing below works.
    await this.graph.requireToken(context, link.url.href);
    const item = await extractOneDriveItem(link.url, this.http);
    if (item)
      return this.graph.toRemoteFile(await this.graph.getItem(item, context, link.url.href));
    try {
      return this.graph.toRemoteFile(await this.graph.getShare(link.url.href, context));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'source_not_found') {
        throw new ApiError(
          400,
          'unsupported_link',
          'Der OneDrive-Link konnte nicht aufgelöst werden.',
        );
      }
      throw error;
    }
  }

  download(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    return this.graph.download(file, context);
  }

  getChangeToken(file: RemoteFile, context: SourceContext): Promise<string> {
    return this.graph.getChangeToken(file, context);
  }
}

/** Errors that mean "this did not work anonymously" rather than "this link is broken". */
const ANONYMOUS_FALLBACK_CODES = new Set([
  'not_a_powerpoint',
  'source_forbidden',
  'source_not_found',
  'source_unreachable',
]);

const anonymousDownloadUrl = (sharingUrl: string) => {
  const url = new URL(sharingUrl);
  url.searchParams.set('download', '1');
  return url;
};

/** SharePoint / OneDrive for Business links: anonymous download first, then Graph. */
export class SharePointAdapter implements SourceAdapter {
  constructor(
    private readonly graph: GraphClient,
    private readonly direct: DirectUrlAdapter,
    private readonly http: SafeFetchOptions,
  ) {}

  async resolve(link: ParsedShareLink, context: SourceContext): Promise<RemoteFile> {
    const anonymous = await this.tryAnonymous(link);
    if (anonymous) return anonymous;
    return this.graph.toRemoteFile(await this.graph.getShare(link.url.href, context));
  }

  /**
   * "Anyone with the link" files download with `download=1`. Org-only links redirect to the
   * Microsoft login page (HTML) or answer 401/403 – then `null`, and Graph takes over.
   */
  private async tryAnonymous(link: ParsedShareLink): Promise<RemoteFile | null> {
    try {
      const file = await downloadPptx(anonymousDownloadUrl(link.url.href), this.http);
      // The sharing link (not the one-off download URL) is what Graph understands later.
      return { ...file, ref: link.url.href };
    } catch (error) {
      if (error instanceof ApiError && ANONYMOUS_FALLBACK_CODES.has(error.code)) return null;
      throw error;
    }
  }

  download(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    return this.graph.download(file, context);
  }

  getChangeToken(file: RemoteFile, context: SourceContext): Promise<string> {
    // Anonymous imports keep the sharing link as ref; Graph-resolved ones a drive item path.
    if (file.ref.startsWith('drives/')) return this.graph.getChangeToken(file, context);
    return this.direct.getChangeToken({ ...file, ref: anonymousDownloadUrl(file.ref).href });
  }
}
