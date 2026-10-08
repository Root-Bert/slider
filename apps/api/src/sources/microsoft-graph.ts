import type { ParsedShareLink } from '@slider/shared';
import type { MicrosoftConfig } from '../config';
import { ApiError, notAPowerPoint } from '../http/errors';
import { downloadPptx, type DirectUrlAdapter } from './direct-url';
import type { MicrosoftAccess } from '../auth/microsoft';
import {
  LINK_NOT_A_POWERPOINT_MESSAGE,
  microsoftLoginRequired,
  microsoftNotConfigured,
  sourceForbidden,
  SourceChangedError,
  sourceLocked,
  sourceNotFound,
  sourceUnreachable,
} from './errors';
import {
  fetchHop,
  isPdfBytes,
  MAX_REDIRECTS,
  readBodyCapped,
  redirectTarget,
  safeFetch,
  type SafeFetchOptions,
} from './safe-fetch';
import type { EditableFile, RemoteFile, SourceAdapter, SourceContext } from './source-adapter';

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
/** Office converts the deck before it answers; large decks take a while. */
const PDF_EXPORT_TIMEOUT_MS = 120_000;
const GRAPH_UPLOAD_TIMEOUT_MS = 120_000;
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface GraphRequest {
  method?: 'GET' | 'PUT';
  body?: RequestInit['body'];
  headers?: Record<string, string>;
  access?: MicrosoftAccess;
  redirect?: RequestInit['redirect'];
  timeoutMs?: number;
}

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  eTag?: string;
  cTag?: string;
  webUrl?: string;
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
    getAccessToken(
      userId: string,
      options?: { forceRefresh?: boolean; access?: MicrosoftAccess },
    ): Promise<string | null>;
  };
  microsoft: MicrosoftConfig | null;
}

/** Minimal Graph client: delegated token per user, one retry after a 401, German errors. */
export class GraphClient {
  constructor(private readonly deps: GraphClientDeps) {}

  /** Whether a Microsoft app is set up at all. */
  get configured(): boolean {
    return this.deps.microsoft !== null;
  }

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
    const response = await this.call(path, context, resumeLink);
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

  /** One Graph request; a 401 (revoked or expired early) is retried once with a fresh token. */
  private async call(
    path: string,
    context: SourceContext,
    resumeLink: string,
    { access = 'read', ...init }: GraphRequest = {},
  ): Promise<Response> {
    const token = (forceRefresh: boolean) =>
      access === 'write'
        ? this.requireWriteToken(context, forceRefresh)
        : this.requireToken(context, resumeLink, forceRefresh);
    let response = await this.send(path, await token(false), init);
    if (response.status === 401) {
      await response.body?.cancel();
      response = await this.send(path, await token(true), init);
    }
    return response;
  }

  /**
   * A token with write scopes (BER-128). Without one, a write login is needed: the caller turns
   * `microsoft_login_required` into a login link back to the deck.
   */
  private async requireWriteToken(context: SourceContext, forceRefresh: boolean): Promise<string> {
    if (!this.deps.microsoft) throw microsoftNotConfigured();
    const token = await this.deps.tokens.getAccessToken(context.userId, {
      forceRefresh,
      access: 'write',
    });
    if (!token) throw microsoftLoginRequired('');
    return token;
  }

  private async send(
    path: string,
    token: string,
    { method = 'GET', body, headers, redirect, timeoutMs }: Omit<GraphRequest, 'access'> = {},
  ): Promise<Response> {
    try {
      return await this.deps.http.fetch(`${GRAPH}/${path}`, {
        method,
        body,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers },
        redirect,
        signal: AbortSignal.timeout(
          timeoutMs ?? (method === 'GET' ? GRAPH_TIMEOUT_MS : GRAPH_UPLOAD_TIMEOUT_MS),
        ),
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
      webUrl: item.webUrl,
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

  /**
   * The file as PDF, rendered by Office itself (`/content?format=pdf`, BER-94). Graph answers
   * with a redirect to a pre-authenticated URL, which is fetched without the token.
   */
  async exportPdf(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    const path = `${graphItemPath(file.ref)}/content?format=pdf`;
    const init = { redirect: 'manual' as const, timeoutMs: PDF_EXPORT_TIMEOUT_MS };
    let response = await this.send(path, await this.requireToken(context, ''), init);
    if (response.status === 401) {
      await response.body?.cancel();
      response = await this.send(path, await this.requireToken(context, '', true), init);
    }
    const location = response.headers.get('location');
    if (!response.ok && !(response.status >= 300 && response.status < 400 && location)) {
      throw await OfficePdfError.from(response);
    }
    if (location) {
      await response.body?.cancel();
      response = (await safeFetch(new URL(location), this.deps.http)).response;
      if (!response.ok) throw await OfficePdfError.from(response);
    }
    const bytes = await readBodyCapped(response, this.deps.http.maxBytes);
    if (!isPdfBytes(bytes)) throw sourceUnreachable('Microsoft Graph liefert kein gültiges PDF.');
    return bytes;
  }

  async getChangeToken(file: RemoteFile, context: SourceContext): Promise<string> {
    const item = await this.get<Pick<DriveItem, 'cTag' | 'eTag'>>(
      `${file.ref}?$select=cTag,eTag`,
      context,
      '',
    );
    return item.cTag ?? item.eTag ?? '';
  }

  /**
   * The newest content of a file plus the eTag it belongs to – the base of an edit (BER-128).
   * Sharing links (anonymous SharePoint imports) are resolved to their drive item first.
   */
  async openForEdit(ref: string, context: SourceContext): Promise<EditableFile> {
    const itemRef = isGraphRef(ref)
      ? ref
      : this.toRemoteFile(await this.getShare(ref, context)).ref;
    const item = await this.get<DriveItem>(itemRef, context, '');
    const downloadUrl = item['@microsoft.graph.downloadUrl'];
    if (!item.eTag || !downloadUrl) {
      throw sourceUnreachable('Microsoft Graph liefert diese Datei nicht zum Bearbeiten.');
    }
    // The download may already be newer than this eTag; then the guarded upload fails with 412.
    const { bytes } = await downloadPptx(new URL(downloadUrl), this.deps.http);
    return { ref: itemRef, eTag: item.eTag, bytes };
  }

  /**
   * Replaces the file, but only while it is still at `file.eTag` (`If-Match`): a save by anyone
   * else in between makes Graph answer 412, nothing is overwritten and this throws
   * {@link SourceChangedError}. Returns the new change token (cTag, like `getChangeToken`).
   */
  async replaceContent(
    file: EditableFile,
    bytes: Uint8Array,
    context: SourceContext,
  ): Promise<string> {
    const response = await this.call(`${file.ref}/content`, context, '', {
      method: 'PUT',
      body: new Blob([new Uint8Array(bytes)], { type: PPTX_MIME }),
      headers: { 'If-Match': file.eTag, 'Content-Type': PPTX_MIME },
      access: 'write',
    });
    if (response.ok) {
      const item = (await response.json()) as Pick<DriveItem, 'cTag' | 'eTag'>;
      return item.cTag ?? item.eTag ?? '';
    }
    await response.body?.cancel();
    switch (response.status) {
      case 412:
        throw new SourceChangedError();
      case 401:
        throw microsoftLoginRequired('');
      case 403:
        throw sourceForbidden('Dein Microsoft-Konto darf diese PowerPoint nicht bearbeiten.');
      case 423:
        throw sourceLocked();
      case 404:
      case 410:
        throw sourceNotFound();
      default:
        throw sourceUnreachable(
          `Microsoft Graph antwortet beim Speichern mit einem Fehler (HTTP ${response.status}).`,
        );
    }
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

  async resolveItem(item: OneDriveItemId, context: SourceContext): Promise<RemoteFile> {
    return this.graph.toRemoteFile(await this.graph.getItem(item, context, ''));
  }

  download(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    return this.graph.download(file, context);
  }

  getChangeToken(file: RemoteFile, context: SourceContext): Promise<string> {
    return this.graph.getChangeToken(file, context);
  }

  exportPdf(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    return this.graph.exportPdf(file, context);
  }

  openForEdit(file: RemoteFile, context: SourceContext): Promise<EditableFile> {
    return this.graph.openForEdit(file.ref, context);
  }

  replace(file: EditableFile, bytes: Uint8Array, context: SourceContext): Promise<string> {
    return this.graph.replaceContent(file, bytes, context);
  }
}

/** Errors that mean "this did not work anonymously" rather than "this link is broken". */
const ANONYMOUS_FALLBACK_CODES = new Set([
  'not_a_powerpoint',
  'source_forbidden',
  'source_not_found',
  'source_unreachable',
]);

/** Office's error code when its PDF conversion refuses a file for its size. */
export const OFFICE_FILE_TOO_BIG = 'Service_InvalidInput_FileTooBigToConvert';

const OFFICE_PDF_MESSAGES: Record<string, string> = {
  [OFFICE_FILE_TOO_BIG]: 'Die Datei ist zu groß für die PDF-Umwandlung von Microsoft.',
};

/**
 * Office would not convert the file to PDF (BER-94). `officeCode` is Office's own error code
 * (e.g. {@link OFFICE_FILE_TOO_BIG}) when the answer names one – the bare HTTP status hid why
 * decks silently fell back to LibreOffice.
 */
export class OfficePdfError extends ApiError {
  constructor(
    readonly httpStatus: number,
    readonly officeCode: string | null,
  ) {
    super(
      502,
      'source_unreachable',
      (officeCode ? OFFICE_PDF_MESSAGES[officeCode] : undefined) ??
        `Microsoft liefert kein PDF (${officeCode ?? `HTTP ${httpStatus}`}).`,
    );
    this.name = 'OfficePdfError';
  }

  static async from(response: Response): Promise<OfficePdfError> {
    const body = await response.text().catch(() => '');
    return new OfficePdfError(response.status, officeErrorCode(body));
  }
}

/**
 * The most specific code in an error answer: the conversion service's `ErrorCode=…` (inside a
 * problem+json `detail`), else Graph's `error.code`.
 */
export function officeErrorCode(body: string): string | null {
  const conversion = /ErrorCode=(\w+)/.exec(body)?.[1];
  if (conversion) return conversion;
  try {
    const code = (JSON.parse(body) as { error?: { code?: unknown } }).error?.code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

export const isGraphRef = (ref: string) => ref.startsWith('drives/') || ref.startsWith('items/');

/** Graph path of a deck's file: its drive item, or the item behind a sharing link. */
const graphItemPath = (ref: string) =>
  isGraphRef(ref) ? ref : `shares/${shareIdFor(ref)}/driveItem`;

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

  async resolveItem(item: OneDriveItemId, context: SourceContext): Promise<RemoteFile> {
    return this.graph.toRemoteFile(await this.graph.getItem(item, context, ''));
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

  /**
   * Anonymous imports keep the sharing link as `ref`: download it with `download=1` again, and
   * fall back to Graph `/shares` when the link is no longer public. Graph-resolved imports keep
   * a drive item path.
   */
  async download(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    if (file.bytes || isGraphRef(file.ref)) return this.graph.download(file, context);
    try {
      return (await downloadPptx(anonymousDownloadUrl(file.ref), this.http)).bytes;
    } catch (error) {
      if (!(error instanceof ApiError) || !ANONYMOUS_FALLBACK_CODES.has(error.code)) throw error;
      const remote = this.graph.toRemoteFile(await this.graph.getShare(file.ref, context));
      return this.graph.download(remote, context);
    }
  }

  /** Office's PDF needs Graph, so it works only with a Microsoft login, even for public links. */
  exportPdf(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    return this.graph.exportPdf(file, context);
  }

  async getChangeToken(file: RemoteFile, context: SourceContext): Promise<string> {
    if (isGraphRef(file.ref)) return this.graph.getChangeToken(file, context);
    try {
      return await this.direct.getChangeToken({
        ...file,
        ref: anonymousDownloadUrl(file.ref).href,
      });
    } catch (error) {
      // No longer "Anyone with the link"? Ask Graph, if a Microsoft login can be used.
      if (
        !(error instanceof ApiError) ||
        error.code !== 'source_forbidden' ||
        !this.graph.configured
      ) {
        throw error;
      }
      const item = await this.graph.getShare(file.ref, context);
      return item.cTag ?? item.eTag ?? '';
    }
  }

  /** Edits always go through Graph – anonymous access can read but never write. */
  openForEdit(file: RemoteFile, context: SourceContext): Promise<EditableFile> {
    return this.graph.openForEdit(file.ref, context);
  }

  replace(file: EditableFile, bytes: Uint8Array, context: SourceContext): Promise<string> {
    return this.graph.replaceContent(file, bytes, context);
  }
}
