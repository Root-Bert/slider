import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { NextcloudConnection } from '@slider/shared';
import type { Executor } from '../db/client';
import { decks, nextcloudConnections, type NextcloudConnectionRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { SYNC_MESSAGES } from '../sync/errors';
import { mergeSyncState } from '../sync/state';

/**
 * The Nextcloud accounts connected to a Slider account (`nextcloud_connections`), as `/konto`
 * lists and disconnects them (BER-135). Login flow and credentials: `auth/nextcloud`.
 */

const toDto = (row: NextcloudConnectionRow, deckCount: number): NextcloudConnection => ({
  id: row.id,
  server: row.serverUrl,
  account: row.loginName,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  deckCount,
  needsReconnect: row.appPassword === null,
});

/** `GET /me/nextcloud`: newest first, each with the reviews that sync through it. */
export async function listNextcloudConnections(
  db: Executor,
  userId: string,
): Promise<NextcloudConnection[]> {
  const rows = await db
    .select()
    .from(nextcloudConnections)
    .where(eq(nextcloudConnections.userId, userId))
    .orderBy(desc(nextcloudConnections.createdAt), nextcloudConnections.id);
  const counts = rows.length
    ? await db
        .select({ connectionId: decks.nextcloudConnectionId, n: count() })
        .from(decks)
        .where(
          and(
            inArray(
              decks.nextcloudConnectionId,
              rows.map((row) => row.id),
            ),
            isNull(decks.archivedAt),
          ),
        )
        .groupBy(decks.nextcloudConnectionId)
    : [];
  const deckCount = new Map(counts.map((row) => [row.connectionId, row.n]));
  return rows.map((row) => toDto(row, deckCount.get(row.id) ?? 0));
}

export async function findNextcloudConnection(
  db: Executor,
  userId: string,
  connectionId: string,
): Promise<NextcloudConnection | null> {
  const all = await listNextcloudConnections(db, userId);
  return all.find((connection) => connection.id === connectionId) ?? null;
}

/**
 * "Trennen" on /konto: revokes the app password at Nextcloud, then removes the connection. Decks
 * that synced through it show `auth_required` until the owner connects again. `null` when it is
 * not theirs; `revoked: false` when Nextcloud could not be reached – the person has to remove
 * the device there themselves.
 */
export async function disconnectNextcloud(
  deps: Pick<AppDeps, 'db' | 'nextcloud' | 'clock'>,
  userId: string,
  connectionId: string,
): Promise<{ revoked: boolean } | null> {
  const [row] = await deps.db
    .select()
    .from(nextcloudConnections)
    .where(and(eq(nextcloudConnections.id, connectionId), eq(nextcloudConnections.userId, userId)));
  if (!row) return null;
  const revoked = await deps.nextcloud.revoke(row);
  const at = deps.clock.now().toISOString();
  await deps.db.transaction(async (tx) => {
    const affected = await tx
      .select({ id: decks.id })
      .from(decks)
      .where(eq(decks.nextcloudConnectionId, row.id));
    // `ON DELETE SET NULL` takes the connection off the decks.
    await tx.delete(nextcloudConnections).where(eq(nextcloudConnections.id, row.id));
    for (const deck of affected) {
      await mergeSyncState(tx, deck.id, {
        pending: null,
        lastSyncError: {
          code: 'auth_required',
          message: SYNC_MESSAGES.nextcloud_auth_required,
          at,
        },
      });
    }
  });
  return { revoked };
}
