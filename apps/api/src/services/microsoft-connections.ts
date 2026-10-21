import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { MicrosoftConnection } from '@slider/shared';
import type { Executor } from '../db/client';
import { decks, microsoftConnections } from '../db/schema';
import type { AppDeps } from '../deps';
import { SYNC_MESSAGES } from '../sync/errors';
import { mergeSyncState } from '../sync/state';

/**
 * The Microsoft accounts connected to a Slider account for OneDrive/SharePoint access
 * (`microsoft_connections`), as `/konto` lists and disconnects them. Tokens: `auth/microsoft`.
 */

/** `GET /me/microsoft`: newest first, each with the reviews that sync through it. */
export async function listMicrosoftConnections(
  db: Executor,
  userId: string,
): Promise<MicrosoftConnection[]> {
  const rows = await db
    .select({
      id: microsoftConnections.id,
      account: microsoftConnections.account,
      createdAt: microsoftConnections.createdAt,
      lastUsedAt: microsoftConnections.lastUsedAt,
      hasToken: sql<boolean>`${microsoftConnections.refreshToken} is not null`,
    })
    .from(microsoftConnections)
    .where(eq(microsoftConnections.userId, userId))
    .orderBy(desc(microsoftConnections.createdAt), microsoftConnections.id);
  const counts = rows.length
    ? await db
        .select({ connectionId: decks.microsoftConnectionId, n: count() })
        .from(decks)
        .where(
          and(
            inArray(
              decks.microsoftConnectionId,
              rows.map((row) => row.id),
            ),
            isNull(decks.archivedAt),
          ),
        )
        .groupBy(decks.microsoftConnectionId)
    : [];
  const deckCount = new Map(counts.map((row) => [row.connectionId, row.n]));
  return rows.map((row) => ({
    id: row.id,
    account: row.account,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    deckCount: deckCount.get(row.id) ?? 0,
    needsReconnect: !row.hasToken,
  }));
}

/** For `GET /me`: how many accounts are connected, and whether one of them can be used. */
export async function microsoftConnectionSummary(
  db: Executor,
  userId: string,
): Promise<{ total: number; usable: number }> {
  const [row] = await db
    .select({
      total: count(),
      usable: sql<number>`count(${microsoftConnections.refreshToken})::int`,
    })
    .from(microsoftConnections)
    .where(eq(microsoftConnections.userId, userId));
  return { total: row?.total ?? 0, usable: Number(row?.usable ?? 0) };
}

/**
 * Removes connections of `userId` ("Trennen" on /konto). Decks that synced through them lose the
 * connection and show `auth_required` – their next check tries the owner's other accounts.
 * Returns how many were removed.
 */
export async function disconnectMicrosoft(
  deps: Pick<AppDeps, 'db' | 'microsoft' | 'clock'>,
  userId: string,
  connectionIds: readonly string[],
): Promise<number> {
  if (connectionIds.length === 0) return 0;
  const at = deps.clock.now().toISOString();
  const removed = await deps.db.transaction(async (tx) => {
    const own = await tx
      .select({ id: microsoftConnections.id })
      .from(microsoftConnections)
      .where(
        and(
          eq(microsoftConnections.userId, userId),
          inArray(microsoftConnections.id, [...connectionIds]),
        ),
      );
    if (own.length === 0) return [];
    const ids = own.map((row) => row.id);
    const affected = await tx
      .select({ id: decks.id })
      .from(decks)
      .where(inArray(decks.microsoftConnectionId, ids));
    // `ON DELETE SET NULL` takes the connection off the decks.
    await tx.delete(microsoftConnections).where(inArray(microsoftConnections.id, ids));
    for (const deck of affected) {
      await mergeSyncState(tx, deck.id, {
        pending: null,
        lastSyncError: { code: 'auth_required', message: SYNC_MESSAGES.auth_required, at },
      });
    }
    return ids;
  });
  for (const id of removed) deps.microsoft.dropCache(id);
  return removed.length;
}
