import { and, eq, exists, isNull } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { decks, microsoftConnections, type DeckRow } from '../db/schema';
import { ApiError } from '../http/errors';
import { sourceForbidden } from './errors';
import type { SourceContext } from './source-adapter';

/**
 * Several Microsoft accounts per Slider account: which one reads a file. A link import tries the
 * person's connections in turn (most recently used first) until one has access, and the deck
 * remembers the winner (`decks.microsoft_connection_id`). Syncs and Office PDFs use that one;
 * decks without one (older ones, after a disconnect or a hand-over) try again the same way.
 */

export interface ConnectionLookup {
  /** The user's usable connections, most recently used first. */
  connectionIds(userId: string): Promise<string[]>;
  markUsed(connectionId: string): Promise<void>;
}

/**
 * Errors that mean "not with this account" – another connection may still have access. Higher
 * rank wins when every connection failed: "no access" says more than "not found" (Graph answers
 * 404 for files an account cannot see), and both more than an expired sign-in.
 */
const NEXT_CONNECTION_RANK: Record<string, number> = {
  microsoft_login_required: 1,
  unsupported_link: 2,
  source_not_found: 2,
  microsoft_consent_required: 3,
  source_forbidden: 4,
};

export const NO_CONNECTION_ACCESS_MESSAGE =
  'Keins deiner verbundenen Microsoft-Konten hat Zugriff auf diese Datei. Verbinde das Konto, für das sie freigegeben ist, oder lade die Datei hoch.';

export interface ConnectionResult<T> {
  value: T;
  /** The context that worked – reuse it for further calls on the same file. */
  context: SourceContext;
  /** The connection that was actually needed; `null` when the file was public. */
  connectionId: string | null;
}

/**
 * Runs `run` with each of the user's connections until one succeeds. Without any connection it
 * runs once without one (public files still work; Graph asks to connect an account).
 */
export async function withConnections<T>(
  lookup: ConnectionLookup | undefined,
  userId: string,
  run: (context: SourceContext) => Promise<T>,
  options: { exclude?: string } = {},
): Promise<ConnectionResult<T>> {
  const ids = (lookup ? await lookup.connectionIds(userId) : []).filter(
    (id) => id !== options.exclude,
  );
  const candidates: (string | null)[] = ids.length > 0 ? ids : [null];
  let best: ApiError | null = null;
  for (const connectionId of candidates) {
    const context: SourceContext = { userId, connectionId };
    try {
      const value = await run(context);
      const used = context.connectionUsed && connectionId ? connectionId : null;
      if (used) await lookup?.markUsed(used);
      return { value, context, connectionId: used };
    } catch (error) {
      const rank = error instanceof ApiError ? NEXT_CONNECTION_RANK[error.code] : undefined;
      // Failed before the account mattered (a broken link, an outage): no other one helps.
      if (!context.connectionUsed || rank === undefined) throw error;
      if (!best || rank > (NEXT_CONNECTION_RANK[best.code] ?? 0)) best = error as ApiError;
    }
  }
  if (best?.code === 'source_forbidden' && ids.length > 1) {
    throw sourceForbidden(NO_CONNECTION_ACCESS_MESSAGE);
  }
  throw best ?? new Error('No connection tried');
}

/**
 * Runs `run` for a linked deck: through its own connection, else through the owner's
 * connections in turn – remembering the one that worked, so the next call goes straight there.
 * When its own connection loses access (expired sign-in, file no longer shared with it), the
 * owner's other connections are tried and the deck switches to the first that can read it; if
 * none can, the own connection's error stands (its banner asks to reconnect that account).
 */
export async function withDeckConnection<T>(
  deps: { db?: Executor; connections?: ConnectionLookup },
  deck: Pick<DeckRow, 'id' | 'ownerId' | 'microsoftConnectionId'>,
  run: (context: SourceContext) => Promise<T>,
): Promise<ConnectionResult<T>> {
  if (deck.microsoftConnectionId) {
    const context: SourceContext = {
      userId: deck.ownerId,
      connectionId: deck.microsoftConnectionId,
    };
    try {
      const value = await run(context);
      return {
        value,
        context,
        connectionId: context.connectionUsed ? context.connectionId! : null,
      };
    } catch (error) {
      const switchable =
        context.connectionUsed &&
        error instanceof ApiError &&
        NEXT_CONNECTION_RANK[error.code] !== undefined;
      if (!switchable || !deps.connections) throw error;
      const own = deck.microsoftConnectionId;
      const others = (await deps.connections.connectionIds(deck.ownerId)).filter(
        (id) => id !== own,
      );
      if (others.length === 0) throw error;
      let result: ConnectionResult<T>;
      try {
        result = await withConnections(deps.connections, deck.ownerId, run, { exclude: own });
      } catch {
        throw error;
      }
      if (result.connectionId && deps.db) {
        await deps.db
          .update(decks)
          .set({ microsoftConnectionId: result.connectionId })
          .where(
            and(
              eq(decks.id, deck.id),
              eq(decks.microsoftConnectionId, own),
              connectionExists(deps.db, result.connectionId),
            ),
          );
      }
      return result;
    }
  }
  const result = await withConnections(deps.connections, deck.ownerId, run);
  if (result.connectionId && deps.db) {
    await deps.db
      .update(decks)
      .set({ microsoftConnectionId: result.connectionId })
      .where(
        and(
          eq(decks.id, deck.id),
          isNull(decks.microsoftConnectionId),
          connectionExists(deps.db, result.connectionId),
        ),
      );
  }
  return result;
}

/**
 * Remembering a connection must not fail when the owner disconnected it during the check (the
 * foreign key would): the deck then just stays without one and tries again next time.
 */
const connectionExists = (db: Executor, connectionId: string) =>
  exists(
    db
      .select({ id: microsoftConnections.id })
      .from(microsoftConnections)
      .where(eq(microsoftConnections.id, connectionId)),
  );
