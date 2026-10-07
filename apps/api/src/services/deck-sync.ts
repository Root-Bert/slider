import type { DeckSync, SyncError, SyncSummary } from '@slider/shared';
import type { DeckRow } from '../db/schema';
import { deckLoginUrl } from '../sync/errors';

/** Link imports are kept up to date automatically; uploads are not (BER-107). */
export const isSyncEnabled = (deck: Pick<DeckRow, 'source' | 'sourceRef'>): boolean =>
  deck.source !== 'upload' && deck.sourceRef !== null;

export interface DeckSyncInput {
  /** Creation time of a revision being imported right now, if any. */
  pendingRevisionAt: Date | null;
  /** Summary of the current revision. */
  summary: SyncSummary | null;
  /** Guests never get the owner's login link. */
  forGuest: boolean;
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
        ...(stored.code === 'auth_required' && !input.forGuest
          ? { loginUrl: deckLoginUrl(row.id) }
          : {}),
      }
    : null;
  const pendingSince = input.pendingRevisionAt?.toISOString() ?? state.pending?.firstSeenAt ?? null;
  return {
    enabled: isSyncEnabled(row),
    lastCheckedAt: state.lastCheckedAt ?? null,
    lastSyncAt: state.lastSyncAt ?? null,
    lastSyncError,
    pending: input.pendingRevisionAt !== null || Boolean(state.pending),
    pendingSince,
    latestSummary: input.summary,
  };
}
