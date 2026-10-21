import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { GoogleConnection } from '@slider/shared';
import type { Executor } from '../db/client';
import { decks, googleConnections, type GoogleConnectionRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { SYNC_MESSAGES } from '../sync/errors';
import { mergeSyncState } from '../sync/state';

/**
 * The Google accounts connected to a Slider account for Google Drive (`google_connections`), as
 * `/konto` lists and disconnects them (BER-119). Connect flow and tokens: `auth/google`.
 */

const toDto = (row: GoogleConnectionRow, deckCount: number): GoogleConnection => ({
  id: row.id,
  account: row.account,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  deckCount,
  needsReconnect: row.refreshToken === null,
});

/** `GET /me/google`: newest first, each with the reviews that sync through it. */
export async function listGoogleConnections(
  db: Executor,
  userId: string,
): Promise<GoogleConnection[]> {
  const rows = await db
    .select()
    .from(googleConnections)
    .where(eq(googleConnections.userId, userId))
    .orderBy(desc(googleConnections.createdAt), googleConnections.id);
  const counts = rows.length
    ? await db
        .select({ connectionId: decks.googleConnectionId, n: count() })
        .from(decks)
        .where(
          and(
            inArray(
              decks.googleConnectionId,
              rows.map((row) => row.id),
            ),
            isNull(decks.archivedAt),
          ),
        )
        .groupBy(decks.googleConnectionId)
    : [];
  const deckCount = new Map(counts.map((row) => [row.connectionId, row.n]));
  return rows.map((row) => toDto(row, deckCount.get(row.id) ?? 0));
}

/**
 * "Trennen" on /konto: revokes the grant at Google, then removes the connection. Decks that
 * synced through it show `auth_required` until the owner connects again – unless anyone with the
 * link may open the file. `false` when it is not theirs.
 */
export async function disconnectGoogle(
  deps: Pick<AppDeps, 'db' | 'googleDrive' | 'clock'>,
  userId: string,
  connectionId: string,
): Promise<boolean> {
  const [row] = await deps.db
    .select()
    .from(googleConnections)
    .where(and(eq(googleConnections.id, connectionId), eq(googleConnections.userId, userId)));
  if (!row) return false;
  await deps.googleDrive.revoke(row);
  const at = deps.clock.now().toISOString();
  await deps.db.transaction(async (tx) => {
    const affected = await tx
      .select({ id: decks.id })
      .from(decks)
      .where(eq(decks.googleConnectionId, row.id));
    // `ON DELETE SET NULL` takes the connection off the decks.
    await tx.delete(googleConnections).where(eq(googleConnections.id, row.id));
    for (const deck of affected) {
      await mergeSyncState(tx, deck.id, {
        pending: null,
        lastSyncError: { code: 'auth_required', message: SYNC_MESSAGES.google_auth_required, at },
      });
    }
  });
  return true;
}
