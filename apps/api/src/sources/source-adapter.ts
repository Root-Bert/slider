import type { ParsedShareLink, ShareLinkKind } from '@slider/shared';
import { ApiError } from '../http/errors';

/** A file in a cloud source, as resolved from a share link. */
export interface RemoteFile {
  /** Provider id (Graph `driveId!itemId`), stable across renames. */
  ref: string;
  fileName: string;
  sizeBytes: number;
}

/**
 * Where decks come from besides direct upload (BER-92). Re-sync (later) compares
 * `getChangeToken` (Graph cTag/eTag) to decide whether a new revision is needed.
 */
export interface SourceAdapter {
  resolve(link: ParsedShareLink): Promise<RemoteFile>;
  download(file: RemoteFile): Promise<Uint8Array>;
  getChangeToken(file: RemoteFile): Promise<string>;
}

export type SourceAdapters = Record<ShareLinkKind, SourceAdapter>;

const microsoftLoginRequired = () =>
  new ApiError(
    401,
    'microsoft_login_required',
    'Für diesen Link ist eine Anmeldung mit Microsoft nötig. Die Microsoft-Anmeldung ist in dieser Vorschau noch nicht eingerichtet – lade die Datei stattdessen als PPTX hoch.',
  );

/** Placeholder until Microsoft Graph is wired up: every call asks for a Microsoft login. */
export class UnconfiguredMicrosoftAdapter implements SourceAdapter {
  async resolve(): Promise<RemoteFile> {
    throw microsoftLoginRequired();
  }

  async download(): Promise<Uint8Array> {
    throw microsoftLoginRequired();
  }

  async getChangeToken(): Promise<string> {
    throw microsoftLoginRequired();
  }
}

export function createSourceAdapters(): SourceAdapters {
  const microsoft = new UnconfiguredMicrosoftAdapter();
  return { onedrive: microsoft, sharepoint: microsoft };
}
