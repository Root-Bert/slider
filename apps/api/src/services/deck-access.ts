import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import type { DeckAccess, UpdateDeckAccessInput } from '@slider/shared';
import type { Executor } from '../db/client';
import { deckAccessGrants, decks, workspaceMembers, type DeckRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest } from '../http/errors';

/**
 * "Zugriff einschränken": a review open only to selected members of its workspace – besides its
 * owner and the admins, who are never locked out. Who else is kept out sees the deck nowhere, as
 * if not a member (`auth/access`). The source's own sharing still applies on top.
 */

export const NOT_A_MEMBER_MESSAGE =
  'Zugriff können nur Personen bekommen, die im Workspace sind. Lade die Seite neu und versuch es noch einmal.';

/** The deck's restriction and its list, in the order the accounts were added. */
export async function getDeckAccess(db: Executor, deck: DeckRow): Promise<DeckAccess> {
  const grants = await db
    .select({ userId: deckAccessGrants.userId })
    .from(deckAccessGrants)
    .where(eq(deckAccessGrants.deckId, deck.id))
    .orderBy(asc(deckAccessGrants.createdAt), asc(deckAccessGrants.userId));
  return { restricted: deck.restrictedAt !== null, userIds: grants.map((row) => row.userId) };
}

/**
 * Replaces the restriction and the whole list (kept while unrestricted, so restricting again
 * brings it back). Only current members of the deck's workspace can be on it – anyone else is a
 * 400. Open live connections of those it now keeps out end right away.
 */
export async function updateDeckAccess(
  deps: Pick<AppDeps, 'db' | 'clock' | 'live'>,
  deck: DeckRow,
  input: UpdateDeckAccessInput,
): Promise<DeckAccess> {
  const userIds = [...new Set(input.userIds)];
  const now = deps.clock.now();
  const updated = await deps.db.transaction(async (tx) => {
    // Locked: someone removed (or deleting their account) meanwhile waits for the grant, which
    // then goes with them – or was gone already and makes this the 400, not a failed insert.
    const members = userIds.length
      ? await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, deck.workspaceId),
              inArray(workspaceMembers.userId, userIds),
            ),
          )
          .for('update')
      : [];
    if (members.length !== userIds.length) throw badRequest(NOT_A_MEMBER_MESSAGE);
    await tx
      .delete(deckAccessGrants)
      .where(
        and(
          eq(deckAccessGrants.deckId, deck.id),
          userIds.length ? notInArray(deckAccessGrants.userId, userIds) : undefined,
        ),
      );
    if (userIds.length) {
      await tx
        .insert(deckAccessGrants)
        .values(
          userIds.map((userId) => ({
            deckId: deck.id,
            workspaceId: deck.workspaceId,
            userId,
            createdAt: now,
          })),
        )
        .onConflictDoNothing();
    }
    const [row] = await tx
      .update(decks)
      .set({ restrictedAt: input.restricted ? (deck.restrictedAt ?? now) : null })
      .where(eq(decks.id, deck.id))
      .returning();
    if (!row) throw new Error(`Deck ${deck.id} vanished while restricting it`);
    return row;
  });
  if (updated.restrictedAt) await evictKeptOut(deps, updated, userIds);
  return getDeckAccess(deps.db, updated);
}

/**
 * Ends the live connections of everyone a restriction now keeps out: their browser reconnects
 * and gets the 404. Without this they would go only with the stream's next access check.
 */
async function evictKeptOut(
  deps: Pick<AppDeps, 'db' | 'live'>,
  deck: DeckRow,
  userIds: readonly string[],
): Promise<void> {
  if (!deps.live) return;
  const admins = await deps.db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, deck.workspaceId), eq(workspaceMembers.role, 'admin')),
    );
  const allowed = new Set([deck.ownerId, ...userIds, ...admins.map((row) => row.userId)]);
  deps.live.evict(deck.id, (authorId) => allowed.has(authorId));
}
