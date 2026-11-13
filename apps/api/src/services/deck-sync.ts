import type { DeckSync, SyncError, SyncSummary } from '@slider/shared';
import type { DeckRow } from '../db/schema';
import { loginUrlOfDeck } from '../sync/errors';

/**
 * Nextcloud and plain-link imports can pull a newer file from their source by hand; uploads
 * cannot (BER-107), nor decks once linked from OneDrive, SharePoint or Google Drive.
 */
export const isSyncEnabled = (deck: Pick<DeckRow, 'source' | 'sourceRef'>): boolean =>
  (deck.source === 'nextcloud' || deck.source === 'url') && deck.sourceRef !== null;

export interface DeckSyncInput {
  /** Creation time of a revision being imported right now, if any. */
  pendingRevisionAt: Date | null;
  /** Summary of the current revision. */
  summary: SyncSummary | null;
  /** Only people who manage the deck get the owner's login link. */
  hideLoginUrl: boolean;
}

/** The `sync` block of a deck DTO, from `decks.sync_state`. */
export function toDeckSync(row: DeckRow, input: DeckSyncInput): DeckSync {
  const state = row.syncState;
  const stored = state.lastSyncError ?? null;
  const loginUrl =
    stored?.code === 'auth_required' && !input.hideLoginUrl ? loginUrlOfDeck(row) : undefined;
  const lastSyncError: SyncError | null = stored
    ? {
        code: stored.code,
        message: stored.message,
        at: stored.at,
        ...(loginUrl ? { loginUrl } : {}),
      }
    : null;
  const pendingSince = input.pendingRevisionAt?.toISOString() ?? null;
  return {
    enabled: isSyncEnabled(row),
    lastCheckedAt: state.lastCheckedAt ?? null,
    lastSyncAt: state.lastSyncAt ?? null,
    lastSyncError,
    pending: input.pendingRevisionAt !== null,
    pendingSince,
    latestSummary: input.summary,
  };
}
