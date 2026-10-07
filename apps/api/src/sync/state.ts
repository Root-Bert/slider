import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { decks, type DeckSyncStateRow } from '../db/schema';

/**
 * Merges `patch` into `decks.sync_state` in SQL (`||`), so the checker and the import job can
 * write their keys concurrently without losing each other's. Never touches `updated_at`.
 */
export async function mergeSyncState(
  db: Executor,
  deckId: string,
  patch: Partial<DeckSyncStateRow>,
): Promise<void> {
  await db
    .update(decks)
    .set({ syncState: sql`${decks.syncState} || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(decks.id, deckId));
}

/** Patch that records a healthy check: no error, no failures. */
export const healthyCheck = (now: Date, nextCheckAt: Date): Partial<DeckSyncStateRow> => ({
  lastCheckedAt: now.toISOString(),
  nextCheckAt: nextCheckAt.toISOString(),
  consecutiveFailures: 0,
  lastSyncError: null,
  pending: null,
  failedToken: null,
});
