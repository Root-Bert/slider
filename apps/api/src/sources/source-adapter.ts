import type { ParsedShareLink, ShareLinkKind } from '@slider/shared';
import type { Config } from '../config';
import type { MicrosoftTokens } from '../auth/microsoft';
import { DirectUrlAdapter } from './direct-url';
import { GraphClient, OneDriveAdapter, SharePointAdapter } from './microsoft-graph';
import { dnsLookup, type FetchLike, type LookupAll, type SafeFetchOptions } from './safe-fetch';

/** A file in a cloud source, as resolved from a share link. */
export interface RemoteFile {
  /** Stable provider reference: Graph `drives/{driveId}/items/{itemId}`, or the final URL of a plain link. */
  ref: string;
  fileName: string;
  sizeBytes: number;
  /** Graph cTag/eTag or HTTP ETag/Last-Modified; `null` when the source offers none. */
  changeToken: string | null;
  /** Pre-authenticated, short-lived download URL (Graph `@microsoft.graph.downloadUrl`). */
  downloadUrl?: string;
  /** Bytes already fetched while resolving, so `download` does not fetch twice. */
  bytes?: Uint8Array;
}

/** A file read for editing: its newest bytes and the eTag a guarded upload must match. */
export interface EditableFile {
  /** Graph drive item path. */
  ref: string;
  eTag: string;
  bytes: Uint8Array;
}

/** Who is importing – Microsoft tokens are stored per user. */
export interface SourceContext {
  userId: string;
}

/**
 * Where decks come from besides direct upload (BER-92). Re-sync (later) compares
 * `getChangeToken` (Graph cTag/eTag) to decide whether a new revision is needed.
 */
export interface SourceAdapter {
  resolve(link: ParsedShareLink, context: SourceContext): Promise<RemoteFile>;
  download(file: RemoteFile, context: SourceContext): Promise<Uint8Array>;
  getChangeToken(file: RemoteFile, context: SourceContext): Promise<string>;
  /** The file rendered to PDF by its provider (Office), for faithful slide images (BER-94). */
  exportPdf?(file: RemoteFile, context: SourceContext): Promise<Uint8Array>;
  /** Writable sources only (OneDrive, SharePoint – BER-128): the file to edit. */
  openForEdit?(file: RemoteFile, context: SourceContext): Promise<EditableFile>;
  /**
   * Replaces the file if nobody saved it since {@link openForEdit} (else `SourceChangedError`).
   * Returns the new change token.
   */
  replace?(file: EditableFile, bytes: Uint8Array, context: SourceContext): Promise<string>;
}

export type SourceAdapters = Record<ShareLinkKind, SourceAdapter>;

export interface SourceAdapterDeps {
  config: Pick<Config, 'maxUploadBytes' | 'microsoft'>;
  tokens: Pick<MicrosoftTokens, 'getAccessToken'>;
  /** Injected for tests; defaults to the global `fetch` and DNS. */
  fetch?: FetchLike;
  lookup?: LookupAll;
}

export function createSourceAdapters({
  config,
  tokens,
  fetch = globalThis.fetch,
  lookup = dnsLookup,
}: SourceAdapterDeps): SourceAdapters {
  const http: SafeFetchOptions = { fetch, lookup, maxBytes: config.maxUploadBytes };
  const graph = new GraphClient({ http, tokens, microsoft: config.microsoft });
  const direct = new DirectUrlAdapter(http);
  return {
    onedrive: new OneDriveAdapter(graph, http),
    sharepoint: new SharePointAdapter(graph, direct, http),
    url: direct,
  };
}
