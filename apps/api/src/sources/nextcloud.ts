import { createHash } from 'node:crypto';
import {
  parseNextcloudLink,
  type NextcloudEntry,
  type NextcloudLink,
  type ParsedShareLink,
} from '@slider/shared';
import { ApiError, notAPowerPoint } from '../http/errors';
import { sourceForbidden, sourceNotFound, sourceUnreachable } from './errors';
import {
  fetchHop,
  fileNameFor,
  isHtmlResponse,
  deckFileName,
  isDeckName,
  parseContentDispositionFileName,
  readBodyCapped,
  safeFetch,
  type SafeFetchOptions,
} from './safe-fetch';
import type { RemoteFile, SourceAdapter, SourceContext } from './source-adapter';

/**
 * Nextcloud as a source (BER-135): WebDAV for files and folders, OCS for "Mit mir geteilt",
 * public shares (`/s/<token>`) without any account.
 *
 * App passwords from Login Flow v2 have no scopes – whoever holds one may delete every file of
 * that person. So the client that carries one only knows reading methods; anything else throws
 * before a request leaves the server. Writing back (BER-118) is a deliberate change here.
 */

export const NEXTCLOUD_READ_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'PROPFIND',
  'SEARCH',
  'REPORT',
]);

export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Answers of PROPFIND, SEARCH and OCS – lists, not files. */
const MAX_LISTING_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const SEARCH_LIMIT = 50;
/** Files one scan of the account takes in; beyond that Nextcloud's own search stands in. */
const MAX_FILE_SCAN = 10_000;
/** How long a scan answers searches before Nextcloud is asked again. */
const SCAN_TTL_MS = 60_000;

export const NEXTCLOUD_LOGIN_MESSAGE =
  'Die Präsentation liegt in einer Nextcloud. Verbinde dein Nextcloud-Konto, damit Slider sie lesen kann – oder lade die Datei hoch.';

export const nextcloudLoginRequired = (server: string) =>
  new ApiError(401, 'nextcloud_login_required', NEXTCLOUD_LOGIN_MESSAGE, {
    nextcloudServer: server,
  });

const nextcloudForbidden = () =>
  sourceForbidden('Dein Nextcloud-Konto hat keinen Zugriff auf diese Datei.');

/** The app password was refused: revoked at Nextcloud, or the account is gone. */
export class NextcloudUnauthorized extends Error {
  constructor() {
    super('Nextcloud refused the app password');
    this.name = 'NextcloudUnauthorized';
  }
}

export interface NextcloudCredentials {
  /** Origin plus the path Nextcloud runs under, no trailing slash. */
  server: string;
  loginName: string;
  /** The Nextcloud user id – WebDAV paths are `/remote.php/dav/files/<id>/…`. */
  userId: string;
  appPassword: string;
}

// ── WebDAV answers ──────────────────────────────────────────────────────────

/** One `<d:response>` of a multistatus: its href and the props Nextcloud found (status 200). */
export interface DavResource {
  href: string;
  props: Record<string, string>;
}

// `(?![\w-])` rather than `\b`: a `\b` also holds inside `x-x-…`, so every backtrack into the
// name would rescan the rest of an unclosed tag – quadratic.
const OPEN_TAG = /<(?:[\w.-]+:)?([\w-]+)(?![\w-])[^<>]*?(\/?)>/g;
const CLOSE_TAG = /<\/(?:[\w.-]+:)?([\w-]+)\s*>/g;

/**
 * The elements in `xml` (only those named `only`, if given; any prefix) with their content up to
 * the first closing tag of that name, like a lazy regex would find them – but in linear time: the
 * Nextcloud is whatever server the person connected, and a lazy regex over unclosed tags in an
 * 8 MB answer would stall the whole process for minutes.
 */
function elements(xml: string, only?: string): { name: string; body: string }[] {
  const closes = new Map<string, { at: number; end: number }[]>();
  for (const match of xml.matchAll(CLOSE_TAG)) {
    const name = match[1] ?? '';
    const list = closes.get(name) ?? [];
    list.push({ at: match.index, end: match.index + match[0].length });
    closes.set(name, list);
  }
  // Openings are visited in order, so each name's next closing tag only moves forward.
  const next = new Map<string, number>();
  const found: { name: string; body: string }[] = [];
  const open = new RegExp(OPEN_TAG.source, 'g');
  for (let match = open.exec(xml); match; match = open.exec(xml)) {
    const name = match[1] ?? '';
    if (only !== undefined && name !== only) continue;
    if (match[2] === '/') {
      found.push({ name, body: '' });
      continue;
    }
    const list = closes.get(name) ?? [];
    let index = next.get(name) ?? 0;
    while (index < list.length && list[index]!.at < open.lastIndex) index++;
    next.set(name, index);
    const close = list[index];
    // Never closed: skipped, like a regex that does not match there.
    if (!close) continue;
    found.push({ name, body: xml.slice(open.lastIndex, close.at) });
    open.lastIndex = close.end;
  }
  return found;
}

/** Unwraps `<![CDATA[…]]>` sections, in linear time (see {@link elements}). */
function unwrapCdata(text: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const start = text.indexOf('<![CDATA[', from);
    const end = start === -1 ? -1 : text.indexOf(']]>', start + 9);
    if (end === -1) return out + text.slice(from);
    out += text.slice(from, start) + text.slice(start + 9, end);
    from = end + 3;
  }
}

const decodeXml = (text: string) =>
  unwrapCdata(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * The resources of a WebDAV multistatus. Namespace prefixes differ between servers (`d:`, `D:`),
 * so elements are matched by local name. Only what Slider asks for is read: flat props, and
 * whether `resourcetype` holds a `collection`.
 */
export function parseMultistatus(xml: string): DavResource[] {
  const resources: DavResource[] = [];
  for (const { body } of elements(xml, 'response')) {
    const href = elements(body, 'href')[0]?.body;
    if (!href) continue;
    const props: Record<string, string> = {};
    for (const { body: propstat } of elements(body, 'propstat')) {
      const status = elements(propstat, 'status')[0]?.body ?? '';
      if (!/\s200\s/.test(` ${status} `)) continue;
      const prop = elements(propstat, 'prop')[0]?.body ?? '';
      for (const { name, body: value } of elements(prop)) {
        props[name] =
          name === 'resourcetype'
            ? /<(?:[\w.-]+:)?collection\b/.test(value)
              ? 'collection'
              : ''
            : decodeXml(value.trim());
      }
    }
    resources.push({ href: decodeXml(href.trim()), props });
  }
  return resources;
}

const PROPS = `<d:prop>
    <d:getlastmodified/><d:getetag/><d:getcontenttype/><d:resourcetype/><d:getcontentlength/>
    <oc:fileid/><oc:size/><nc:has-preview/>
  </d:prop>`;
const NAMESPACES =
  'xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"';

const escapeXml = (text: string) => text.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Every file and folder; the scan keeps the files. */
const ANY_WHERE = `<d:like><d:prop><d:displayname/></d:prop><d:literal>%</d:literal></d:like>`;

function searchBody(userId: string, where: string, limit: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:searchrequest ${NAMESPACES}>
  <d:basicsearch>
    <d:select>${PROPS}</d:select>
    <d:from><d:scope><d:href>/files/${escapeXml(userId)}</d:href><d:depth>infinity</d:depth></d:scope></d:from>
    <d:where>${where}</d:where>
    <d:orderby/>
    <d:limit><d:nresults>${limit}</d:nresults></d:limit>
  </d:basicsearch>
</d:searchrequest>`;
}

const encodePath = (path: string) =>
  path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

/** `/remote.php/dav/files/<user>/Decks/Q4.pptx` (as Nextcloud writes it) → `/Decks/Q4.pptx`. */
export function pathFromHref(href: string): string {
  const marker = '/remote.php/dav/files/';
  const at = href.indexOf(marker);
  if (at === -1) return '/';
  const inUser = href.slice(at + marker.length);
  const slash = inUser.indexOf('/');
  const rest = slash === -1 ? '' : inUser.slice(slash);
  let path = rest;
  try {
    path = decodeURIComponent(rest);
  } catch {
    // Keep it encoded; it still opens.
  }
  return normalizePath(path);
}

/** `Decks/` → `/Decks`; `''` → `/`. */
export const normalizePath = (path: string) => `/${path.replace(/^\/+|\/+$/g, '')}`;

const PDF_MIME = 'application/pdf';

const FOLDER_MESSAGE = 'Unter diesem Link liegt ein Ordner – wähle eine Datei darin.';

/** A deck – PowerPoint or PDF – by its name or by the type Nextcloud knows it by. */
const isDeckResource = (resource: DavResource, name: string) =>
  isDeckName(name) ||
  resource.props['getcontenttype'] === PPTX_MIME ||
  resource.props['getcontenttype'] === PDF_MIME;

/** A DAV resource as the browser shows it – every file and folder. */
export function toEntry(resource: DavResource): NextcloudEntry | null {
  const path = pathFromHref(resource.href);
  const name = path.split('/').pop() ?? '';
  const folder = resource.props['resourcetype'] === 'collection';
  const fileId = resource.props['fileid'];
  if (!fileId || !name) return null;
  const size = Number(resource.props[folder ? 'size' : 'getcontentlength'] ?? NaN);
  const modified = Date.parse(resource.props['getlastmodified'] ?? '');
  return {
    fileId,
    name,
    path,
    folder,
    sizeBytes: Number.isFinite(size) ? size : null,
    modifiedAt: Number.isFinite(modified) ? new Date(modified).toISOString() : null,
    preview: !folder && resource.props['has-preview'] === 'true',
  };
}

/** Like Nextcloud's own list: folders first, `2_…` before `10_…`. */
const byFolderThenName = (a: NextcloudEntry, b: NextcloudEntry) =>
  Number(b.folder) - Number(a.folder) ||
  a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });

/** `Strategie_JK v1` → `strategie jk v1`: what a search matches words against. */
const searchable = (text: string) =>
  text
    .normalize('NFC')
    .toLocaleLowerCase('de')
    .replace(/[_\-.]+/g, ' ');

/** Every file of an account. */
interface FileScan {
  files: NextcloudEntry[];
}

/**
 * Scans per account for a minute, so that typing search after search asks Nextcloud once. Keyed
 * by the app password too: a connection only ever sees what it can read itself.
 */
export class FileScans {
  private readonly scans = new Map<string, { until: number; scan: Promise<FileScan | null> }>();

  get(credentials: NextcloudCredentials, load: () => Promise<FileScan | null>) {
    const key = createHash('sha256')
      .update(`${credentials.server}\n${credentials.userId}\n${credentials.appPassword}`)
      .digest('hex');
    const now = Date.now();
    const cached = this.scans.get(key);
    if (cached && cached.until > now) return cached.scan;
    for (const [other, { until }] of this.scans) if (until <= now) this.scans.delete(other);
    // Only a complete scan is kept; a failed or cut-off one is tried again next time.
    const forget = () => {
      if (this.scans.get(key)?.scan === scan) this.scans.delete(key);
    };
    const scan = load().then(
      (result) => {
        if (!result) forget();
        return result;
      },
      (error: unknown) => {
        forget();
        throw error;
      },
    );
    this.scans.set(key, { until: now + SCAN_TTL_MS, scan });
    return scan;
  }
}

// ── The reading client ──────────────────────────────────────────────────────

interface OcsShare {
  item_type?: string;
  file_source?: number | string;
  file_target?: string;
  mimetype?: string;
  item_size?: number;
  item_mtime?: number;
  has_preview?: boolean;
}

/** WebDAV and OCS as one Nextcloud account – reading only. */
export class NextcloudClient {
  constructor(
    private readonly http: SafeFetchOptions,
    readonly credentials: NextcloudCredentials,
    private readonly scans = new FileScans(),
  ) {}

  /**
   * One request with the app password. Redirects are not followed: they could carry the password
   * to another host, and Nextcloud's APIs do not redirect.
   */
  async request(
    method: string,
    path: string,
    init: { body?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    if (!NEXTCLOUD_READ_METHODS.has(method.toUpperCase())) {
      throw new Error(`The Nextcloud client only reads – ${method} is not allowed`);
    }
    const { server, loginName, appPassword } = this.credentials;
    const auth = Buffer.from(`${loginName}:${appPassword}`).toString('base64');
    const response = await fetchHop(new URL(server + path), this.http, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'OCS-APIRequest': 'true',
        ...(init.body ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}),
        ...init.headers,
      },
      body: init.body,
    });
    if (response.ok || response.status === 207) return response;
    await response.body?.cancel();
    throw statusError(response.status);
  }

  private async text(response: Response): Promise<string> {
    return new TextDecoder().decode(await readBodyCapped(response, MAX_LISTING_BYTES));
  }

  private davPath(path: string): string {
    const encoded = encodePath(path);
    return `/remote.php/dav/files/${encodeURIComponent(this.credentials.userId)}/${encoded}`;
  }

  /** A folder's files and folders (`PROPFIND` depth 1). */
  async listFolder(path: string): Promise<NextcloudEntry[]> {
    const self = normalizePath(path);
    const response = await this.request('PROPFIND', this.davPath(path), {
      headers: { Depth: '1' },
      body: `<?xml version="1.0" encoding="UTF-8"?><d:propfind ${NAMESPACES}>${PROPS}</d:propfind>`,
    });
    return parseMultistatus(await this.text(response))
      .map(toEntry)
      .filter((entry): entry is NextcloudEntry => entry !== null && entry.path !== self)
      .sort(byFolderThenName);
  }

  private async search(where: string, limit: number): Promise<DavResource[]> {
    const response = await this.request('SEARCH', '/remote.php/dav/', {
      body: searchBody(this.credentials.userId, where, limit),
    });
    return parseMultistatus(await this.text(response));
  }

  /**
   * Every file of the account – one search over all of it. `null` when that cannot be told – too
   * many files, or the search failed – and then Nextcloud's own search stands in.
   */
  private allFiles(): Promise<FileScan | null> {
    return this.scans.get(this.credentials, async () => {
      let resources: DavResource[];
      try {
        resources = await this.search(ANY_WHERE, MAX_FILE_SCAN + 1);
      } catch (error) {
        // A refused app password still asks to reconnect; anything else only skips the scan.
        if (error instanceof NextcloudUnauthorized) throw error;
        return null;
      }
      if (resources.length > MAX_FILE_SCAN) return null;
      const files = resources
        .map(toEntry)
        .filter((entry): entry is NextcloudEntry => entry !== null && !entry.folder);
      return { files };
    });
  }

  /** Where a file is now – by id, so renaming or moving it does not lose it. */
  async fileById(
    fileId: string,
  ): Promise<{ entry: NextcloudEntry; etag: string; deck: boolean } | null> {
    const [resource] = await this.search(
      `<d:eq><d:prop><oc:fileid/></d:prop><d:literal>${escapeXml(fileId)}</d:literal></d:eq>`,
      1,
    );
    if (!resource) return null;
    const entry = toEntry(resource);
    if (!entry || entry.folder) throw notAPowerPoint(FOLDER_MESSAGE);
    return {
      entry,
      etag: resource.props['getetag'] ?? '',
      deck: isDeckResource(resource, entry.name),
    };
  }

  /**
   * Files whose name holds every word of `query`, in any order and case. Without a scan (too
   * many files), Nextcloud's search for the whole phrase stands in.
   */
  async searchByName(query: string): Promise<NextcloudEntry[]> {
    const words = searchable(query).split(/\s+/).filter(Boolean);
    const scan = await this.allFiles();
    if (scan) {
      // The most recently changed ones when there are more hits than shown.
      return scan.files
        .filter((file) => {
          const name = searchable(file.name);
          return words.every((word) => name.includes(word));
        })
        .sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''))
        .slice(0, SEARCH_LIMIT)
        .sort(byFolderThenName);
    }
    const literal = escapeXml(`%${query.replace(/[%_]/g, '')}%`);
    const resources = await this.search(
      `<d:like><d:prop><d:displayname/></d:prop><d:literal>${literal}</d:literal></d:like>`,
      SEARCH_LIMIT,
    );
    return resources
      .map(toEntry)
      .filter((entry): entry is NextcloudEntry => entry !== null)
      .sort(byFolderThenName);
  }

  /** "Mit mir geteilt": the files and folders others shared with this account. */
  async sharedWithMe(): Promise<NextcloudEntry[]> {
    const response = await this.request(
      'GET',
      '/ocs/v2.php/apps/files_sharing/api/v1/shares?shared_with_me=true&format=json',
    );
    let shares: OcsShare[];
    try {
      shares =
        (JSON.parse(await this.text(response)) as { ocs?: { data?: OcsShare[] } }).ocs?.data ?? [];
    } catch {
      throw sourceUnreachable('Nextcloud hat eine unerwartete Antwort geschickt.');
    }
    const seen = new Set<string>();
    const entries: NextcloudEntry[] = [];
    for (const share of shares) {
      const fileId = share.file_source === undefined ? '' : String(share.file_source);
      const path = share.file_target ?? '';
      const name = path.split('/').pop() ?? '';
      const folder = share.item_type === 'folder';
      if (!fileId || !name || seen.has(fileId)) continue;
      seen.add(fileId);
      entries.push({
        fileId,
        name,
        path,
        folder,
        sizeBytes: typeof share.item_size === 'number' ? share.item_size : null,
        modifiedAt: share.item_mtime ? new Date(share.item_mtime * 1000).toISOString() : null,
        preview: !folder && share.has_preview !== false,
      });
    }
    return entries.sort(byFolderThenName);
  }

  /** The file's bytes, by its current path. */
  async download(path: string): Promise<Uint8Array> {
    const response = await this.request('GET', this.davPath(path));
    return readBodyCapped(response, this.http.maxBytes);
  }

  /** Nextcloud's thumbnail of a file – PNG or JPEG. */
  async preview(fileId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const response = await this.request(
      'GET',
      `/index.php/core/preview?fileId=${encodeURIComponent(fileId)}&x=256&y=256&a=1&mode=cover`,
    );
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^image\/(png|jpeg|webp|gif)\b/i.test(contentType)) {
      await response.body?.cancel();
      throw sourceNotFound();
    }
    return { bytes: await readBodyCapped(response, MAX_PREVIEW_BYTES), contentType };
  }
}

function statusError(status: number): Error {
  if (status === 401) return new NextcloudUnauthorized();
  if (status === 404) return sourceNotFound();
  if (status === 403) return nextcloudForbidden();
  if (status >= 300 && status < 400) {
    return sourceUnreachable('Nextcloud leitet die Anfrage um – stimmt die Adresse?');
  }
  return sourceUnreachable(`Nextcloud antwortet mit einem Fehler (HTTP ${status}).`);
}

// ── The adapter ─────────────────────────────────────────────────────────────

/** The connected accounts, as the adapter needs them (`auth/nextcloud`). */
export interface NextcloudAccess {
  /** A connection's credentials; throws `nextcloud_login_required` when it cannot be used. */
  credentials(userId: string, connectionId: string): Promise<NextcloudCredentials>;
  /** The user's usable connections to `server`, most recently used first. */
  connectionsFor(userId: string, server: string): Promise<string[]>;
  markUsed(connectionId: string): Promise<void>;
  /** Nextcloud refused the app password: the connection needs a new login. */
  markRefused(connectionId: string): Promise<void>;
}

/** `sourceRef` of a file: its internal link, which names the file by id. */
export const nextcloudFileRef = (server: string, fileId: string) => `${server}/f/${fileId}`;

function refLink(ref: string): NextcloudLink {
  let link: NextcloudLink | null = null;
  try {
    link = parseNextcloudLink(new URL(ref));
  } catch {
    // Not a URL.
  }
  if (!link) throw new ApiError(400, 'unsupported_link', 'Kein gültiger Nextcloud-Link.');
  return link;
}

const sameServer = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** "Not with this account" – another of the user's accounts may still read the file. */
const isNextConnectionError = (error: unknown) =>
  error instanceof ApiError &&
  ['source_not_found', 'source_forbidden', 'nextcloud_login_required'].includes(error.code);

async function findById(client: NextcloudClient, fileId: string) {
  const found = await client.fileById(fileId);
  if (!found) throw sourceNotFound();
  return found;
}

export class NextcloudAdapter implements SourceAdapter {
  private readonly scans = new FileScans();

  constructor(
    private readonly http: SafeFetchOptions,
    private readonly access: NextcloudAccess,
  ) {}

  /** A client for one of `userId`'s connections. */
  async client(userId: string, connectionId: string): Promise<NextcloudClient> {
    const credentials = await this.access.credentials(userId, connectionId);
    return new NextcloudClient(this.http, credentials, this.scans);
  }

  /**
   * Runs `run` through the context's connection, else through each of the user's connections to
   * `server` until one can see the file. The one that worked lands in the context. When the
   * context's own connection loses access (refused app password, file no longer shared with it),
   * the user's other accounts at the server are tried and the context switches to the first that
   * can read it; if none can, the own connection's error stands.
   */
  private async withClient<T>(
    server: string,
    context: SourceContext,
    run: (client: NextcloudClient) => Promise<T>,
  ): Promise<T> {
    const own = context.nextcloudConnectionId;
    if (!own) {
      return this.tryEach(
        server,
        context,
        await this.access.connectionsFor(context.userId, server),
        run,
      );
    }
    try {
      return await this.tryEach(server, context, [own], run);
    } catch (error) {
      if (!isNextConnectionError(error)) throw error;
      const others = (await this.access.connectionsFor(context.userId, server)).filter(
        (id) => id !== own,
      );
      if (others.length === 0) throw error;
      try {
        return await this.tryEach(server, context, others, run);
      } catch {
        throw error;
      }
    }
  }

  /**
   * A client for a connection that may be gone meanwhile (disconnected during a sync, or not the
   * user's): then this account needs a login, the file itself may well still be there.
   */
  private async connectedClient(
    server: string,
    userId: string,
    connectionId: string,
  ): Promise<NextcloudClient> {
    try {
      return await this.client(userId, connectionId);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') {
        throw nextcloudLoginRequired(server);
      }
      throw error;
    }
  }

  private async tryEach<T>(
    server: string,
    context: SourceContext,
    ids: string[],
    run: (client: NextcloudClient) => Promise<T>,
  ): Promise<T> {
    if (ids.length === 0) throw nextcloudLoginRequired(server);
    let last: unknown = null;
    for (const id of ids) {
      try {
        const client = await this.connectedClient(server, context.userId, id);
        if (!sameServer(client.credentials.server, server)) throw nextcloudLoginRequired(server);
        const value = await run(client);
        context.nextcloudConnectionId = id;
        return value;
      } catch (error) {
        if (error instanceof NextcloudUnauthorized) {
          await this.access.markRefused(id);
          last = nextcloudLoginRequired(server);
        } else if (isNextConnectionError(error)) {
          last = error;
        } else throw error;
      }
    }
    throw last ?? nextcloudLoginRequired(server);
  }

  /** The file by id, through one of the user's accounts (see `withClient`). */
  private locate(
    server: string,
    fileId: string,
    context: SourceContext,
  ): Promise<{ entry: NextcloudEntry; etag: string; deck: boolean }> {
    return this.withClient(server, context, (client) => findById(client, fileId));
  }

  async resolve(link: ParsedShareLink, context: SourceContext): Promise<RemoteFile> {
    const parsed = parseNextcloudLink(link.url);
    if (!parsed) throw new ApiError(400, 'unsupported_link', 'Kein gültiger Nextcloud-Link.');
    if (parsed.share) return this.downloadShare(parsed.base, parsed.share);
    return this.resolveFile(parsed.base, parsed.fileId!, context);
  }

  /** A file of one of the user's accounts, by id – a link to it, or picked in the browser. */
  async resolveFile(server: string, fileId: string, context: SourceContext): Promise<RemoteFile> {
    const { entry, etag, deck } = await this.locate(server, fileId, context);
    if (context.nextcloudConnectionId) await this.access.markUsed(context.nextcloudConnectionId);
    const ref = nextcloudFileRef(server, fileId);
    return {
      ref,
      // Nextcloud knows a deck by its type too: the file name then gets the matching ending. Any
      // other file keeps its name, which tells the import what it is.
      fileName: deck ? deckFileName(entry.name, /\.pdf$/i.test(entry.name)) : entry.name,
      sizeBytes: entry.sizeBytes ?? 0,
      changeToken: etag || null,
      webUrl: ref,
    };
  }

  async download(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    if (file.bytes) return file.bytes;
    const link = refLink(file.ref);
    if (link.share) return (await this.downloadShare(link.base, link.share)).bytes;
    // Inside the account's turn: a refused app password asks to reconnect, like any other call.
    return this.withClient(link.base, context, async (client) =>
      client.download((await findById(client, link.fileId!)).entry.path),
    );
  }

  /** The file's ETag; public shares: HTTP ETag/Last-Modified, `''` → compare the content. */
  async getChangeToken(file: RemoteFile, context: SourceContext): Promise<string> {
    const link = refLink(file.ref);
    if (link.fileId) return (await this.locate(link.base, link.fileId, context)).etag;
    const { response } = await safeFetch(shareDownloadUrl(link.base, link.share!), this.http, {
      method: 'HEAD',
    });
    await response.body?.cancel();
    if (response.status === 405 || response.status === 501) return '';
    if (!response.ok) throw shareStatusError(response.status);
    return response.headers.get('etag') ?? response.headers.get('last-modified') ?? '';
  }

  /** A public share: no account, the share token is the key. */
  private async downloadShare(
    server: string,
    token: string,
  ): Promise<RemoteFile & { bytes: Uint8Array }> {
    const url = shareDownloadUrl(server, token);
    const { response, url: finalUrl } = await safeFetch(url, this.http);
    if (!response.ok) {
      await response.body?.cancel();
      throw shareStatusError(response.status);
    }
    if (isHtmlResponse(response)) {
      // Nextcloud answers a password-protected share with its password page.
      await response.body?.cancel();
      throw sourceForbidden(
        'Diese Nextcloud-Freigabe ist passwortgeschützt. Teile die Präsentation ohne Passwort, verbinde dein Nextcloud-Konto oder lade die Datei hoch.',
      );
    }
    const named = parseContentDispositionFileName(response.headers.get('content-disposition'));
    // A shared folder downloads as a ZIP – which starts like a PPTX.
    if (named && /\.zip$/i.test(named)) {
      await response.body?.cancel();
      throw notAPowerPoint(FOLDER_MESSAGE);
    }
    const bytes = await readBodyCapped(response, this.http.maxBytes);
    return {
      ref: `${server}/s/${token}`,
      fileName: fileNameFor(response, finalUrl, bytes),
      sizeBytes: bytes.byteLength,
      changeToken: response.headers.get('etag') ?? response.headers.get('last-modified'),
      webUrl: `${server}/s/${token}`,
      bytes,
    };
  }
}

const shareDownloadUrl = (server: string, token: string) =>
  new URL(`${server}/s/${encodeURIComponent(token)}/download`);

function shareStatusError(status: number): Error {
  if (status === 404 || status === 410) return sourceNotFound();
  if (status === 401 || status === 403) {
    return sourceForbidden('Die Nextcloud-Freigabe ist nicht (mehr) öffentlich zugänglich.');
  }
  return sourceUnreachable(`Nextcloud antwortet mit einem Fehler (HTTP ${status}).`);
}
