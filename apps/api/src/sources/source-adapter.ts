import type { ParsedShareLink, ShareLinkKind } from '@slider/shared';
import type { Config } from '../config';
import type { MicrosoftTokens } from '../auth/microsoft';
import type { Logger } from '../logger';
import { DirectUrlAdapter } from './direct-url';
import { GoogleDriveAdapter, type GoogleAccess } from './google-drive';
import {
  GraphClient,
  OneDriveAdapter,
  SharePointAdapter,
  type OneDriveItemId,
} from './microsoft-graph';
import { NextcloudAdapter, type NextcloudAccess } from './nextcloud';
import { OneDriveFilePicker } from './onedrive-picker';
import { dnsLookup, type FetchLike, type LookupAll, type SafeFetchOptions } from './safe-fetch';

/** A file in a cloud source, as resolved from a share link. */
export interface RemoteFile {
  /** Stable provider reference: Graph `drives/{driveId}/items/{itemId}`, or the final URL of a plain link. */
  ref: string;
  fileName: string;
  sizeBytes: number;
  /** Graph cTag/eTag or HTTP ETag/Last-Modified; `null` when the source offers none. */
  changeToken: string | null;
  /** Where the file opens in the browser (Graph `webUrl`), if the source tells. */
  webUrl?: string;
  /** Pre-authenticated, short-lived download URL (Graph `@microsoft.graph.downloadUrl`). */
  downloadUrl?: string;
  /** Bytes already fetched while resolving, so `download` does not fetch twice. */
  bytes?: Uint8Array;
}

/**
 * Who is importing, and through which of their Microsoft connections (`microsoft_connections`).
 * See `sources/connections` for trying several.
 */
export interface SourceContext {
  userId: string;
  /** `null`/absent: no Microsoft account – anything that needs Graph asks to connect one. */
  connectionId?: string | null;
  /** Set by Graph once it asked for the connection's token (the file was not public). */
  connectionUsed?: boolean;
  /**
   * Nextcloud (BER-135): the user's connection to read through. Absent: each of their accounts
   * at the file's server in turn – the adapter sets the one that worked.
   */
  nextcloudConnectionId?: string | null;
  /**
   * Google (BER-119): the user's connection to read through. Absent: each of their Google
   * accounts in turn – the adapter sets the one that worked (`null`: the public link did).
   */
  googleConnectionId?: string | null;
}

/**
 * Where decks come from besides direct upload (BER-92). Re-sync (later) compares
 * `getChangeToken` (Graph cTag/eTag) to decide whether a new revision is needed.
 */
export interface SourceAdapter {
  resolve(link: ParsedShareLink, context: SourceContext): Promise<RemoteFile>;
  /** Graph sources only: a file picked in the OneDrive file picker, by its drive item ids. */
  resolveItem?(item: OneDriveItemId, context: SourceContext): Promise<RemoteFile>;
  download(file: RemoteFile, context: SourceContext): Promise<Uint8Array>;
  getChangeToken(file: RemoteFile, context: SourceContext): Promise<string>;
  /** The file rendered to PDF by its provider (Office), for faithful slide images (BER-94). */
  exportPdf?(file: RemoteFile, context: SourceContext): Promise<Uint8Array>;
  /** Whether {@link exportPdf} applies to this file at all; absent → always. */
  hasPdf?(ref: string): boolean;
  /**
   * Who worked on the file, by display name, most recent first: everyone who saved a version,
   * its owner, whoever shared it and its creator (`decks.source_contributors`). May repeat names;
   * see {@link readContributors}.
   */
  listContributors?(file: RemoteFile, context: SourceContext): Promise<string[]>;
}

/** Service accounts that save files on nobody's behalf (SharePoint's own processes). */
const SYSTEM_ACCOUNTS = new Set(['system account', 'sharepoint app', 'systemkonto']);

/** Names in first-seen order, once each (ignoring case), without blanks and service accounts. */
export function uniqueContributors(names: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of names) {
    const name = raw?.trim();
    const key = name?.toLowerCase();
    if (!name || !key || seen.has(key) || SYSTEM_ACCOUNTS.has(key)) continue;
    seen.add(key);
    list.push(name);
  }
  return list;
}

/**
 * {@link SourceAdapter.listContributors}, cleaned up. Best effort: `null` when the source cannot
 * tell (no such call, no access to the version history, offline) – the deck still imports.
 */
export async function readContributors(
  adapter: SourceAdapter,
  file: RemoteFile,
  context: SourceContext,
  log?: Logger,
): Promise<string[] | null> {
  if (!adapter.listContributors) return null;
  try {
    return uniqueContributors(await adapter.listContributors(file, context));
  } catch (error) {
    log?.warn(`Contributors of a linked file not readable: ${String(error)}`);
    return null;
  }
}

export type SourceAdapters = Record<ShareLinkKind, SourceAdapter> & {
  /** Also browses the connected accounts' files (`routes/nextcloud`). */
  nextcloud: NextcloudAdapter;
  /** Also imports files picked in Google's picker (`POST /decks/google-item`). */
  google: GoogleDriveAdapter;
  /** Microsoft's OneDrive file picker (personal and work accounts alike). */
  picker?: OneDriveFilePicker;
};

export interface SourceAdapterDeps {
  config: Pick<Config, 'maxUploadBytes' | 'microsoft'>;
  tokens: Pick<MicrosoftTokens, 'getAccessToken'> &
    Partial<Pick<MicrosoftTokens, 'getScopedToken'>>;
  log?: Logger;
  /**
   * Connected Nextcloud accounts, and the request options that trust the organisation's
   * Nextcloud; absent → only public shares.
   */
  nextcloud?: NextcloudAccess & { http: SafeFetchOptions };
  /** Connected Google accounts; absent → only files anyone with the link may open. */
  google?: GoogleAccess;
  /** Injected for tests; defaults to the global `fetch` and DNS. */
  fetch?: FetchLike;
  lookup?: LookupAll;
}

export function createSourceAdapters({
  config,
  tokens,
  fetch = globalThis.fetch,
  lookup = dnsLookup,
  log,
  nextcloud,
  google,
}: SourceAdapterDeps): SourceAdapters {
  const http: SafeFetchOptions = { fetch, lookup, maxBytes: config.maxUploadBytes };
  const graph = new GraphClient({ http, tokens, microsoft: config.microsoft });
  const direct = new DirectUrlAdapter(http);
  return {
    onedrive: new OneDriveAdapter(graph, http),
    sharepoint: new SharePointAdapter(graph, direct, http),
    nextcloud: new NextcloudAdapter(nextcloud?.http ?? http, nextcloud ?? noNextcloudAccounts),
    google: new GoogleDriveAdapter(http, google ?? noGoogleAccounts),
    url: direct,
    ...(tokens.getScopedToken
      ? {
          picker: new OneDriveFilePicker(
            graph,
            { getScopedToken: tokens.getScopedToken.bind(tokens) },
            log,
          ),
        }
      : {}),
  };
}

/** Without Google Drive set up only public Google links work. */
const noGoogleAccounts: GoogleAccess = {
  getAccessToken: async () => null,
  connectionIds: async () => [],
  markUsed: async () => {},
};

/** Without connected accounts every file that needs one asks to connect. */
const noNextcloudAccounts: NextcloudAccess = {
  credentials: async () => {
    throw new Error('No Nextcloud accounts');
  },
  connectionsFor: async () => [],
  markUsed: async () => {},
  markRefused: async () => {},
};
