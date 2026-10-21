import {
  GOOGLE_SLIDES_MIME,
  parseGoogleLink,
  type GoogleLink,
  type ParsedShareLink,
} from '@slider/shared';
import type { CommentAuthor, ParsedReply } from '@slider/pptx';
import { googleLoginRequired } from '../auth/google';
import { ApiError, notAPowerPoint } from '../http/errors';
import {
  LINK_NOT_A_POWERPOINT_MESSAGE,
  sourceForbidden,
  sourceNotFound,
  sourceUnreachable,
} from './errors';
import {
  fetchHop,
  isHtmlResponse,
  isPdfBytes,
  isPptxBytes,
  readBodyCapped,
  redirectTarget,
  safeFetch,
  type SafeFetchOptions,
} from './safe-fetch';
import type { RemoteFile, SourceAdapter, SourceContext } from './source-adapter';

/**
 * Google Slides and Google Drive as a source (BER-119). With a connected account Slider reads
 * through the Drive API – `drive.file` only, so just the files the person picked in Google's
 * picker. Files anyone with the link may open import without an account, through Google's
 * export URLs.
 *
 * Google Slides files are exported as PowerPoint (and as PDF for the slide images); `.pptx`
 * files kept in Drive are downloaded as they are.
 */

export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SLIDES_API = 'https://slides.googleapis.com/v1/presentations';
const COMMENT_FIELDS =
  'nextPageToken,comments(id,author(displayName,emailAddress),content,createdTime,resolved,deleted,anchor,' +
  'replies(id,author(displayName,emailAddress),content,createdTime,deleted))';
/** More comment pages than this: the rest is left out rather than looping on a broken token. */
const MAX_COMMENT_PAGES = 50;
const FILE_FIELDS =
  'id,name,mimeType,size,md5Checksum,modifiedTime,webViewLink,trashed,exportLinks';
/** Hosts a Drive download may hop to; the token goes along only within Google. */
const isGoogleHost = (host: string) =>
  host === 'docs.google.com' ||
  host === 'www.googleapis.com' ||
  host === 'slides.googleapis.com' ||
  host.endsWith('.googleusercontent.com');

/** The connected accounts, as the adapter needs them (`auth/google`). */
export interface GoogleAccess {
  /** `null`: the connection has no usable token (revoked, expired) – it needs a new connect. */
  getAccessToken(
    connectionId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<string | null>;
  /** The user's usable connections, most recently used first. */
  connectionIds(userId: string): Promise<string[]>;
  markUsed(connectionId: string): Promise<void>;
}

/** What Drive tells about a file (`files.get`). */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  webViewLink?: string;
  trashed?: boolean;
  exportLinks?: Record<string, string>;
}

/** A Drive `User` – the name, and for comments the address when Google shows it. */
interface Person {
  displayName?: string;
  emailAddress?: string;
}

/** A Drive comment or reply (`comments.list`), as far as Slider reads it. */
interface DriveComment {
  id?: string;
  author?: Person;
  content?: string;
  createdTime?: string;
  resolved?: boolean;
  deleted?: boolean;
  /** JSON of Google's own making; for Google Slides undocumented (BER-157). */
  anchor?: string;
  replies?: DriveComment[];
}

/** A comment of a Google Slides file, as Drive's comment API tells it. */
export interface GoogleSlideComment {
  externalId: string;
  /** The slide's `objectId`, when the anchor names one; else the export's comment places it. */
  slideObjectId: string | null;
  author: CommentAuthor;
  createdAt: string | null;
  text: string;
  status: 'open' | 'done';
  replies: ParsedReply[];
}

/**
 * What Google's PowerPoint export leaves out or garbles (BER-157): each slide's `objectId`, in
 * slide order (`null`: the Slides API is not enabled), and the comments with their stable ids,
 * replies and status – the export has them only as loose legacy comments with a position.
 */
export interface GoogleSlidesExtras {
  slideIds: string[] | null;
  comments: GoogleSlideComment[];
}

/** `sourceRef` of a file: the link that opens it, which names it by its Drive id. */
export const googleFileRef = (fileId: string, slides: boolean) =>
  slides
    ? `https://docs.google.com/presentation/d/${fileId}`
    : `https://drive.google.com/file/d/${fileId}`;

function refLink(ref: string): GoogleLink {
  let link: GoogleLink | null = null;
  try {
    link = parseGoogleLink(new URL(ref));
  } catch {
    // Not a URL.
  }
  if (!link) throw new ApiError(400, 'unsupported_link', 'Kein gültiger Google-Link.');
  return link;
}

const isPptxName = (name: string) => /\.pptx$/i.test(name);
/** Google Slides files carry no extension; the deck's file name always says `.pptx`. */
const pptxFileName = (name: string) => (isPptxName(name) ? name : `${name}.pptx`);

/**
 * The file's change token: the content checksum of a stored `.pptx`, the last change of a Google
 * Slides file. Renaming or sharing a `.pptx` leaves its checksum alone.
 */
const changeTokenOf = (file: DriveFile) => file.md5Checksum ?? file.modifiedTime ?? '';

function checkPresentation(file: DriveFile): void {
  if (file.trashed) throw sourceNotFound();
  const slides = file.mimeType === GOOGLE_SLIDES_MIME;
  if (!slides && file.mimeType !== PPTX_MIME && !isPptxName(file.name)) {
    throw notAPowerPoint(
      'Diese Google-Datei ist keine Präsentation. Slider liest Google Präsentationen und PowerPoint-Dateien (.pptx).',
    );
  }
}

/** Not with this account – another of the user's accounts, or the public link, may still work. */
class NoGoogleAccess extends Error {
  constructor(readonly refusal: ApiError | null) {
    super('No Google account could read the file');
    this.name = 'NoGoogleAccess';
  }
}

/** One account's view of Drive: reading only, the access token never leaves Google's hosts. */
class DriveClient {
  constructor(
    private readonly http: SafeFetchOptions,
    private readonly token: string,
  ) {}

  /** A request to Google with the token; redirects are followed only within Google. */
  async request(url: URL): Promise<Response> {
    let current = url;
    for (let hop = 0; hop <= 5; hop++) {
      if (!isGoogleHost(current.hostname)) {
        throw sourceUnreachable('Google leitet die Anfrage an eine unbekannte Adresse um.');
      }
      const response = await fetchHop(current, this.http, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const next = redirectTarget(response, current);
      if (!next) {
        if (response.ok) return response;
        throw await driveError(response);
      }
      await response.body?.cancel();
      current = next;
    }
    throw sourceUnreachable('Google leitet zu oft weiter.');
  }

  async file(fileId: string): Promise<DriveFile> {
    const url = new URL(`${DRIVE_API}/${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', FILE_FIELDS);
    url.searchParams.set('supportsAllDrives', 'true');
    return this.json<DriveFile>(url);
  }

  /**
   * Who worked on the file, newest first: everyone who saved a revision, then its owners. Without
   * the right to see the revisions (a viewer) only the last editor and the owners count.
   */
  async contributors(fileId: string): Promise<string[]> {
    const fileUrl = new URL(`${DRIVE_API}/${encodeURIComponent(fileId)}`);
    fileUrl.searchParams.set('fields', 'owners(displayName),lastModifyingUser(displayName)');
    fileUrl.searchParams.set('supportsAllDrives', 'true');
    const file = await this.json<{
      owners?: Person[];
      lastModifyingUser?: Person;
    }>(fileUrl);
    const revisionsUrl = new URL(`${DRIVE_API}/${encodeURIComponent(fileId)}/revisions`);
    revisionsUrl.searchParams.set('fields', 'revisions(lastModifyingUser(displayName))');
    revisionsUrl.searchParams.set('pageSize', '1000');
    const { revisions } = await this.json<{ revisions?: { lastModifyingUser?: Person }[] }>(
      revisionsUrl,
    ).catch(() => ({ revisions: [] }));
    return [
      file.lastModifyingUser?.displayName,
      // Oldest first in Google's answer.
      ...(Array.isArray(revisions) ? revisions : [])
        .map((revision) => revision.lastModifyingUser?.displayName)
        .reverse(),
      ...(Array.isArray(file.owners) ? file.owners : []).map((owner) => owner.displayName),
    ].filter((name): name is string => typeof name === 'string');
  }

  /** Google Slides' `objectId` of each slide, in slide order (Slides API, `drive.file` will do). */
  async slideIds(fileId: string): Promise<string[]> {
    const url = new URL(`${SLIDES_API}/${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', 'slides(objectId)');
    const { slides } = await this.json<{ slides?: { objectId?: string }[] }>(url);
    return (Array.isArray(slides) ? slides : []).map((slide) => slide.objectId ?? '');
  }

  /** The file's comments that are not deleted, every page of them. */
  async comments(fileId: string): Promise<DriveComment[]> {
    const all: DriveComment[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
      const url = new URL(`${DRIVE_API}/${encodeURIComponent(fileId)}/comments`);
      url.searchParams.set('fields', COMMENT_FIELDS);
      url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const body = await this.json<{ comments?: DriveComment[]; nextPageToken?: string }>(url);
      if (Array.isArray(body.comments)) all.push(...body.comments);
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return all;
  }

  private async json<T>(url: URL): Promise<T> {
    const response = await this.request(url);
    try {
      return (await response.json()) as T;
    } catch {
      throw sourceUnreachable('Google hat eine unerwartete Antwort geschickt.');
    }
  }

  /** The file as PowerPoint: exported from Google Slides, else the stored bytes. */
  async pptx(file: DriveFile): Promise<Uint8Array> {
    const bytes =
      file.mimeType === GOOGLE_SLIDES_MIME
        ? await this.export(file, PPTX_MIME)
        : await this.read(this.mediaUrl(file.id));
    if (!isPptxBytes(bytes)) throw notAPowerPoint(LINK_NOT_A_POWERPOINT_MESSAGE);
    return bytes;
  }

  /** Google's own PDF of a Google Slides file. */
  async pdf(file: DriveFile): Promise<Uint8Array> {
    const bytes = await this.export(file, 'application/pdf');
    if (!isPdfBytes(bytes)) throw sourceUnreachable('Google hat kein PDF geliefert.');
    return bytes;
  }

  /**
   * `files.export` stops at 10 MB; bigger decks go through the file's export link, which has no
   * such limit.
   */
  private async export(file: DriveFile, mimeType: string): Promise<Uint8Array> {
    const url = new URL(`${DRIVE_API}/${encodeURIComponent(file.id)}/export`);
    url.searchParams.set('mimeType', mimeType);
    try {
      return await this.read(url);
    } catch (error) {
      const link = file.exportLinks?.[mimeType];
      if (!(error instanceof ExportTooLarge) || !link) throw error;
      return this.read(new URL(link));
    }
  }

  private mediaUrl(fileId: string): URL {
    const url = new URL(`${DRIVE_API}/${encodeURIComponent(fileId)}`);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('supportsAllDrives', 'true');
    return url;
  }

  private async read(url: URL): Promise<Uint8Array> {
    return readBodyCapped(await this.request(url), this.http.maxBytes);
  }
}

class ExportTooLarge extends Error {}

/** A 401 – the access token expired early or was revoked. */
class GoogleUnauthorized extends Error {}

async function driveError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { errors?: { reason?: string }[]; status?: string };
  };
  const reason = body.error?.errors?.[0]?.reason ?? '';
  if (response.status === 401) return new GoogleUnauthorized();
  if (reason === 'exportSizeLimitExceeded') return new ExportTooLarge();
  if (response.status === 404) return sourceNotFound();
  if (response.status === 429 || /rateLimitExceeded/.test(reason)) {
    return sourceUnreachable(
      'Google bremst gerade die Anfragen. Slider versucht es gleich wieder.',
    );
  }
  if (response.status === 403) {
    return sourceForbidden('Dein Google-Konto hat keinen Zugriff auf diese Datei.');
  }
  return sourceUnreachable(`Google antwortet mit einem Fehler (HTTP ${response.status}).`);
}

export class GoogleDriveAdapter implements SourceAdapter {
  constructor(
    private readonly http: SafeFetchOptions,
    private readonly access: GoogleAccess,
  ) {}

  /** Only Google Slides files have Google's own PDF; `.pptx` in Drive render like uploads. */
  hasPdf(ref: string): boolean {
    try {
      return refLink(ref).slides;
    } catch {
      return false;
    }
  }

  async resolve(link: ParsedShareLink, context: SourceContext): Promise<RemoteFile> {
    const parsed = parseGoogleLink(link.url);
    if (!parsed) throw new ApiError(400, 'unsupported_link', 'Kein gültiger Google-Link.');
    const returnTo = `/neu?link=${encodeURIComponent(link.url.href)}`;
    try {
      return await this.resolveFile(parsed.fileId, context);
    } catch (error) {
      if (!(error instanceof NoGoogleAccess)) throw error;
      // None of the person's accounts picked it: maybe anyone with the link may open it.
      const file = await this.downloadPublic(parsed, returnTo);
      context.googleConnectionId = null;
      return file;
    }
  }

  /**
   * A file through the person's accounts – picked in Google's picker, or linked. Throws
   * {@link NoGoogleAccess} when none of them may read it.
   */
  async resolveFile(fileId: string, context: SourceContext): Promise<RemoteFile> {
    const file = await this.withClient(context, (client) => client.file(fileId));
    checkPresentation(file);
    if (context.googleConnectionId) await this.access.markUsed(context.googleConnectionId);
    const slides = file.mimeType === GOOGLE_SLIDES_MIME;
    return {
      ref: googleFileRef(file.id, slides),
      fileName: pptxFileName(file.name),
      // Google Slides files have no size before the export.
      sizeBytes: Number(file.size ?? 0) || 0,
      changeToken: changeTokenOf(file) || null,
      webUrl: file.webViewLink ?? googleFileRef(file.id, slides),
    };
  }

  /** {@link resolveFile} for a file picked in the picker: no access is a plain refusal. */
  async resolvePicked(fileId: string, context: SourceContext): Promise<RemoteFile> {
    try {
      return await this.resolveFile(fileId, context);
    } catch (error) {
      if (error instanceof NoGoogleAccess) throw error.refusal ?? googleLoginRequired('/neu');
      throw error;
    }
  }

  async download(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    if (file.bytes) return file.bytes;
    const link = refLink(file.ref);
    try {
      return await this.withClient(context, async (client) =>
        client.pptx(await client.file(link.fileId)),
      );
    } catch (error) {
      if (!(error instanceof NoGoogleAccess)) throw error;
      return (await this.downloadPublic(link, '/neu')).bytes;
    }
  }

  /** The Drive change token; a public file without account: `''` → compare the content. */
  async getChangeToken(file: RemoteFile, context: SourceContext): Promise<string> {
    const link = refLink(file.ref);
    try {
      const found = await this.withClient(context, (client) => client.file(link.fileId));
      checkPresentation(found);
      return changeTokenOf(found);
    } catch (error) {
      if (!(error instanceof NoGoogleAccess)) throw error;
      await this.assertPublic(link, error);
      return '';
    }
  }

  /** Through the person's accounts only: a public link tells nobody's name. */
  async listContributors(file: RemoteFile, context: SourceContext): Promise<string[]> {
    const link = refLink(file.ref);
    try {
      return await this.withClient(context, (client) => client.contributors(link.fileId));
    } catch (error) {
      if (error instanceof NoGoogleAccess) return [];
      throw error;
    }
  }

  /** Google's PDF of a Google Slides file, for faithful slide images. */
  async exportPdf(file: RemoteFile, context: SourceContext): Promise<Uint8Array> {
    const link = refLink(file.ref);
    if (!link.slides) throw notAPowerPoint('Nur Google Präsentationen haben ein PDF von Google.');
    try {
      return await this.withClient(context, async (client) =>
        client.pdf(await client.file(link.fileId)),
      );
    } catch (error) {
      if (!(error instanceof NoGoogleAccess)) throw error;
      const { response } = await safeFetch(publicExportUrl(link, 'pdf'), this.http);
      if (!response.ok || isHtmlResponse(response)) {
        await response.body?.cancel();
        throw googleLoginRequired('/neu', link.fileId);
      }
      const bytes = await readBodyCapped(response, this.http.maxBytes);
      if (!isPdfBytes(bytes)) throw sourceUnreachable('Google hat kein PDF geliefert.');
      return bytes;
    }
  }

  /**
   * The slide ids and comments of a Google Slides file (BER-157), through the person's accounts;
   * `null` for `.pptx` files in Drive (their own sldIds and comments are in the file) and for
   * files only the public link opens – the Slides and comment APIs need an account.
   */
  async readSlidesExtras(
    file: Pick<RemoteFile, 'ref'>,
    context: SourceContext,
  ): Promise<GoogleSlidesExtras | null> {
    const link = refLink(file.ref);
    if (!link.slides) return null;
    try {
      return await this.withClient(context, async (client) => {
        // The Slides API may not be enabled in the server's Google project: comments still work.
        const slideIds = await client.slideIds(link.fileId).catch(() => null);
        const comments = await client.comments(link.fileId);
        return toSlidesExtras(slideIds, comments);
      });
    } catch (error) {
      if (error instanceof NoGoogleAccess) return null;
      throw error;
    }
  }

  /**
   * Runs `run` through the context's connection, else through each of the user's connections
   * until one may read the file; the one that worked lands in the context. Throws
   * {@link NoGoogleAccess} when none may (or there are none).
   */
  private async withClient<T>(
    context: SourceContext,
    run: (client: DriveClient) => Promise<T>,
  ): Promise<T> {
    const own = context.googleConnectionId;
    const all = await this.access.connectionIds(context.userId);
    const ids = own ? [own, ...all.filter((id) => id !== own)] : all;
    let best: ApiError | null = null;
    for (const id of ids) {
      try {
        const value = await this.withToken(id, run);
        context.googleConnectionId = id;
        return value;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        // Not found / forbidden / login: this account cannot – another one may.
        if (!['source_not_found', 'source_forbidden', 'google_login_required'].includes(error.code))
          throw error;
        if (!best || error.code === 'source_forbidden') best = error;
      }
    }
    throw new NoGoogleAccess(best);
  }

  /** One connection's token, refreshed once when Google answers 401. */
  private async withToken<T>(
    connectionId: string,
    run: (client: DriveClient) => Promise<T>,
  ): Promise<T> {
    for (const forceRefresh of [false, true]) {
      const token = await this.access.getAccessToken(connectionId, { forceRefresh });
      if (!token) throw googleLoginRequired('/neu');
      try {
        return await run(new DriveClient(this.http, token));
      } catch (error) {
        if (!(error instanceof GoogleUnauthorized)) throw error;
      }
    }
    throw googleLoginRequired('/neu');
  }

  /** A file anyone with the link may open – no account, Google's export or download URL. */
  private async downloadPublic(
    link: GoogleLink,
    returnTo: string,
  ): Promise<RemoteFile & { bytes: Uint8Array }> {
    const { response, url } = await safeFetch(publicDownloadUrl(link), this.http);
    // Not public: Google sends its sign-in page (or a 401/403 on the way there).
    if (!response.ok || isHtmlResponse(response) || url.hostname === 'accounts.google.com') {
      await response.body?.cancel();
      if (response.status === 404) throw sourceNotFound();
      throw googleLoginRequired(returnTo, link.fileId);
    }
    const bytes = await readBodyCapped(response, this.http.maxBytes);
    if (!isPptxBytes(bytes)) throw notAPowerPoint(LINK_NOT_A_POWERPOINT_MESSAGE);
    const named = /filename\*=UTF-8''([^;]+)/i.exec(
      response.headers.get('content-disposition') ?? '',
    )?.[1];
    let fileName = 'Google Präsentation.pptx';
    if (named) {
      try {
        fileName = pptxFileName(decodeURIComponent(named));
      } catch {
        // Keep the default name.
      }
    }
    const ref = googleFileRef(link.fileId, link.slides);
    return {
      ref,
      fileName,
      sizeBytes: bytes.byteLength,
      changeToken: null,
      webUrl: ref,
      bytes,
    };
  }

  /** The public file is still there (a HEAD-like check): else the access error stands. */
  private async assertPublic(link: GoogleLink, cause: NoGoogleAccess): Promise<void> {
    const { response, url } = await safeFetch(publicDownloadUrl(link), this.http);
    await response.body?.cancel();
    if (response.ok && !isHtmlResponse(response) && url.hostname !== 'accounts.google.com') return;
    if (response.status === 404) throw sourceNotFound();
    throw cause.refusal ?? googleLoginRequired('/neu', link.fileId);
  }
}

const publicExportUrl = (link: GoogleLink, format: 'pptx' | 'pdf') =>
  new URL(
    `https://docs.google.com/presentation/d/${encodeURIComponent(link.fileId)}/export/${format}`,
  );

const publicDownloadUrl = (link: GoogleLink) =>
  link.slides
    ? publicExportUrl(link, 'pptx')
    : new URL(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(link.fileId)}`);

/** A Drive person as a comment author: the address (when shown) recognises workspace members. */
const commentAuthor = (person: Person | undefined): CommentAuthor => ({
  name: person?.displayName?.trim() || 'Unbekannt',
  initials: null,
  ...(person?.emailAddress ? { googleAccount: person.emailAddress } : {}),
});

/**
 * The slide a comment's anchor names: Google Slides keeps the slide's `objectId` somewhere in its
 * (undocumented) anchor JSON. Only string values count – never keys – and only when exactly one
 * slide is named; anything else is unplaced (`null`).
 */
export function slideOfAnchor(
  anchor: string | undefined,
  slideIds: readonly string[],
): string | null {
  if (!anchor) return null;
  const known = new Set(slideIds.filter(Boolean));
  const named = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (known.has(value)) named.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  try {
    visit(JSON.parse(anchor));
  } catch {
    // Not JSON: the words of it.
    for (const word of anchor.split(/[^\w-]+/)) if (known.has(word)) named.add(word);
  }
  return named.size === 1 ? ([...named][0] ?? null) : null;
}

/** Drive's comments, with the slide their anchor names; deleted ones and empty replies go. */
export function toSlidesExtras(
  slideIds: string[] | null,
  comments: readonly DriveComment[],
): GoogleSlidesExtras {
  return {
    slideIds,
    comments: comments
      .filter((comment) => !comment.deleted && comment.id)
      .map((comment) => ({
        externalId: comment.id ?? '',
        slideObjectId: slideIds ? slideOfAnchor(comment.anchor, slideIds) : null,
        author: commentAuthor(comment.author),
        createdAt: comment.createdTime ?? null,
        text: comment.content ?? '',
        status: comment.resolved ? ('done' as const) : ('open' as const),
        replies: (comment.replies ?? [])
          .filter((reply) => !reply.deleted && reply.id && reply.content?.trim())
          .map((reply) => ({
            externalId: reply.id ?? '',
            author: commentAuthor(reply.author),
            createdAt: reply.createdTime ?? null,
            text: reply.content ?? '',
          })),
      })),
  };
}
