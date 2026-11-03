import type { DeckSync, SyncError, SyncSummary } from '@slider/shared';
import type { DeckRow } from '../db/schema';
import { loginUrlOfDeck } from '../sync/errors';

/** Link imports can pull a newer file from their source by hand; uploads cannot (BER-107). */
export const isSyncEnabled = (deck: Pick<DeckRow, 'source' | 'sourceRef'>): boolean =>
  deck.source !== 'upload' && deck.sourceRef !== null;

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
  const lastSyncError: SyncError | null = stored
    ? {
        code: stored.code,
        message: stored.message,
        at: stored.at,
        ...(stored.code === 'auth_required' && !input.hideLoginUrl
          ? { loginUrl: loginUrlOfDeck(row) }
          : {}),
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
