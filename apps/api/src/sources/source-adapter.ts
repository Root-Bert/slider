import type { ParsedShareLink, ShareLinkKind } from '@slider/shared';
import type { Config } from '../config';
import type { Logger } from '../logger';
import { DirectUrlAdapter } from './direct-url';
import { NextcloudAdapter, type NextcloudAccess } from './nextcloud';
import { dnsLookup, type FetchLike, type LookupAll, type SafeFetchOptions } from './safe-fetch';

/** A file in a cloud source, as resolved from a share link. */
export interface RemoteFile {
  /** Stable provider reference: Nextcloud's file, or the final URL of a plain link. */
  ref: string;
  fileName: string;
  sizeBytes: number;
  /** WebDAV or HTTP ETag/Last-Modified; `null` when the source offers none. */
  changeToken: string | null;
  /** Where the file opens in the browser, if the source tells. */
  webUrl?: string;
  /** Bytes already fetched while resolving, so `download` does not fetch twice. */
  bytes?: Uint8Array;
}

/** Who is importing. */
export interface SourceContext {
  userId: string;
  /**
   * Nextcloud (BER-135): the user's connection to read through. Absent: each of their accounts
   * at the file's server in turn – the adapter sets the one that worked.
   */
  nextcloudConnectionId?: string | null;
}

/**
 * Where decks come from besides direct upload (BER-92): Nextcloud and plain links. A pull
 * compares `getChangeToken` to decide whether a new revision is needed.
 */
export interface SourceAdapter {
  resolve(link: ParsedShareLink, context: SourceContext): Promise<RemoteFile>;
  download(file: RemoteFile, context: SourceContext): Promise<Uint8Array>;
  getChangeToken(file: RemoteFile, context: SourceContext): Promise<string>;
  /**
   * Who worked on the file, by display name, most recent first (`decks.source_contributors`).
   * May repeat names; see {@link readContributors}.
   */
  listContributors?(file: RemoteFile, context: SourceContext): Promise<string[]>;
}

/** Service accounts that save files on nobody's behalf. */
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
};

export interface SourceAdapterDeps {
  config: Pick<Config, 'maxUploadBytes'>;
  log?: Logger;
  /**
   * Connected Nextcloud accounts, and the request options that trust the organisation's
   * Nextcloud; absent → only public shares.
   */
  nextcloud?: NextcloudAccess & { http: SafeFetchOptions };
  /** Injected for tests; defaults to the global `fetch` and DNS. */
  fetch?: FetchLike;
  lookup?: LookupAll;
}

export function createSourceAdapters({
  config,
  fetch = globalThis.fetch,
  lookup = dnsLookup,
  nextcloud,
}: SourceAdapterDeps): SourceAdapters {
  const http: SafeFetchOptions = { fetch, lookup, maxBytes: config.maxUploadBytes };
  return {
    nextcloud: new NextcloudAdapter(nextcloud?.http ?? http, nextcloud ?? noNextcloudAccounts),
    url: new DirectUrlAdapter(http),
  };
}

/** Without connected accounts every file that needs one asks to connect. */
const noNextcloudAccounts: NextcloudAccess = {
  credentials: async () => {
    throw new Error('No Nextcloud accounts');
  },
  connectionsFor: async () => [],
  markUsed: async () => {},
  markRefused: async () => {},
};
