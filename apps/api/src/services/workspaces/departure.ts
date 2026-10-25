import { and, eq, inArray } from 'drizzle-orm';
import type { MemberDeparture } from '@slider/shared';
import type { Executor } from '../../db/client';
import { decks, media, users, workspaces } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { forbidden, notFound } from '../../http/errors';
import { blobKeys } from '../../storage/blob-storage';
import { successorOf } from '../billing-owner';
import { deckBlobs, deleteBlobs } from '../blob-deletions';
import { getRole, requireRole } from './roles';

/**
 * What happens to someone's decks when they leave a workspace, are removed from it or delete
 * their account (BER-165). Everyone in a workspace sees its decks, and Slider reads a linked
 * deck's file with its owner's accounts – without them nobody can sync or re-render it. So:
 *
 * - Their linked decks (OneDrive, SharePoint, Nextcloud, Google Drive, web links) are deleted,
 *   comments included. The dialogs list them before (`departurePreview`).
 * - Their uploads pass to the workspace owner ({@link workspaceOwnerOf}), recordings with them;
 *   with nobody left in the workspace they are deleted too.
 *
 * Call it once the billing role has passed on (`reassignBillingOwner`): the new billing owner is
 * the heir. Returns the deleted decks – their files go after the commit ({@link deleteDeckFiles}).
 */
export async function departDecks(
  db: Executor,
  { workspaceId, leaverId }: { workspaceId: string; leaverId: string },
): Promise<{ deleted: string[]; transferred: string[] }> {
  const owned = await db
    .select({ id: decks.id, source: decks.source })
    .from(decks)
    .where(and(eq(decks.workspaceId, workspaceId), eq(decks.ownerId, leaverId)));
  if (owned.length === 0) return { deleted: [], transferred: [] };
  const heirId = await workspaceOwnerOf(db, workspaceId, leaverId);
  const deleted: string[] = [];
  const transferred: string[] = [];
  for (const deck of owned) (heirId && isUpload(deck) ? transferred : deleted).push(deck.id);
  if (deleted.length > 0) await db.delete(decks).where(inArray(decks.id, deleted));
  if (heirId && transferred.length > 0) {
    await db.update(decks).set({ ownerId: heirId }).where(inArray(decks.id, transferred));
    // Recordings record their deck's owner: they follow it.
    await db
      .update(media)
      .set({ ownerId: heirId })
      .where(and(inArray(media.deckId, transferred), eq(media.ownerId, leaverId)));
  }
  return { deleted, transferred };
}

/** The files of decks {@link departDecks} deleted; what fails is retried by the hourly sweep. */
export async function deleteDeckFiles(deps: AppDeps, deckIds: readonly string[]): Promise<void> {
  for (const deckId of deckIds) await deleteBlobs(deps, deckBlobs(blobKeys.deckPrefix(deckId)));
}

/**
 * What {@link departDecks} would do if `targetId` went now – for the warning before leaving or
 * removing someone. `successorId`: whom a leaving last admin names (they become admin first).
 * The person themselves and the admins may ask.
 */
export async function departurePreview(
  db: Executor,
  actorId: string,
  workspaceId: string,
  targetId: string,
  successorId?: string,
): Promise<MemberDeparture> {
  // Leaving works in a blocked workspace too (BER-167).
  const role = await requireRole(db, workspaceId, actorId, 'viewer', undefined, {
    allowBlocked: actorId === targetId,
  });
  if (actorId !== targetId && role !== 'admin') {
    throw forbidden('Nur Admins sehen, was mit den Präsentationen anderer passiert.');
  }
  if (!(await getRole(db, workspaceId, targetId))) {
    throw notFound('Diese Person ist nicht Mitglied des Workspace.');
  }
  const owned = await db
    .select({ id: decks.id, title: decks.title, source: decks.source })
    .from(decks)
    .where(and(eq(decks.workspaceId, workspaceId), eq(decks.ownerId, targetId)));
  // Titles are encrypted at rest: sorted here, not in SQL.
  owned.sort((a, b) => a.title.localeCompare(b.title, 'de') || a.id.localeCompare(b.id));
  // A successor counts only where the `DELETE` takes one: an admin leaving themselves.
  const promoted = actorId === targetId && role === 'admin' ? successorId : undefined;
  const heirId = await workspaceOwnerOf(db, workspaceId, targetId, promoted);
  const [heir] = heirId
    ? await db
        .select({ userId: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, heirId))
    : [];
  const ref = ({ id, title }: { id: string; title: string }) => ({ id, title });
  return {
    heir: heir ?? null,
    deleted: owned.filter((deck) => !heir || !isUpload(deck)).map(ref),
    transferred: heir ? owned.filter(isUpload).map(ref) : [],
  };
}

/**
 * Who owns the workspace once `leaverId` is gone: the admin who pays for it (the billing owner);
 * if that is the one leaving, whom the role passes to (`reassignBillingOwner`). `promoted` as in
 * `successorOf`. `null` with nobody else left.
 */
async function workspaceOwnerOf(
  db: Executor,
  workspaceId: string,
  leaverId: string,
  promoted?: string,
): Promise<string | null> {
  const [row] = await db
    .select({ billingOwnerId: workspaces.billingOwnerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  const owner = row?.billingOwnerId;
  if (owner && owner !== leaverId && (await getRole(db, workspaceId, owner))) return owner;
  return (await successorOf(db, workspaceId, leaverId, promoted))?.userId ?? null;
}

const isUpload = (deck: { source: string }) => deck.source === 'upload';
