import { asc, eq, lt } from 'drizzle-orm';
import { decks } from '../db/schema';
import type { AppDeps } from '../deps';
import { blobKeys } from '../storage/blob-storage';
import { DAY_MS, EDIT_IMAGE_KEEP_DAYS } from './retention-rules';
import { remeasureDeck } from './workspace-storage';

/** Decks looked at per run, the longest due first; more wait for the next hour. */
const DECKS_PER_RUN = 500;

/**
 * Pictures of the editor (`edits` → `storeEditImage`) are kept only for `replaceImage`: once put
 * on a slide, the deck's file holds its own copy, and undo and redo go by whole files. So a
 * picture older than {@link EDIT_IMAGE_KEEP_DAYS} – put in or never used – goes, with its credit,
 * and the deck is measured again so the workspace's storage no longer counts it.
 *
 * Only decks whose oldest picture is due are looked at (`decks.edit_images_since`, indexed), not
 * every deck: what the run costs grows with the pictures uploaded, not with the decks there are.
 */
export async function sweepOldEditImages(
  deps: Pick<AppDeps, 'db' | 'storage' | 'clock' | 'log'>,
): Promise<void> {
  const cutoff = new Date(deps.clock.now().getTime() - EDIT_IMAGE_KEEP_DAYS * DAY_MS);
  const due = await deps.db
    .select({ id: decks.id })
    .from(decks)
    .where(lt(decks.editImagesSince, cutoff))
    .orderBy(asc(decks.editImagesSince))
    .limit(DECKS_PER_RUN);
  for (const { id } of due) {
    try {
      if (await sweepDeck(deps, id, cutoff)) await remeasureDeck(deps, id);
    } catch (error) {
      deps.log.error(`Could not remove old editor pictures of deck ${id}`, error);
    }
  }
}

/**
 * Removes the deck's pictures from before `cutoff` and notes when the oldest one left was stored.
 * Under a lock on the deck row: an upload meanwhile notes its picture right after, never before.
 */
async function sweepDeck(
  deps: Pick<AppDeps, 'db' | 'storage'>,
  deckId: string,
  cutoff: Date,
): Promise<boolean> {
  return deps.db.transaction(async (tx) => {
    const [deck] = await tx
      .select({ id: decks.id })
      .from(decks)
      .where(eq(decks.id, deckId))
      .for('update');
    if (!deck) return false;
    let removed = 0;
    let oldestLeft: Date | null = null;
    for (const key of await deps.storage.list(blobKeys.editImages(deckId))) {
      const modified = await deps.storage.modifiedAt(key);
      if (!modified) continue;
      if (modified < cutoff) {
        await deps.storage.delete(key);
        removed += 1;
      } else if (!oldestLeft || modified < oldestLeft) {
        oldestLeft = modified;
      }
    }
    await tx.update(decks).set({ editImagesSince: oldestLeft }).where(eq(decks.id, deckId));
    return removed > 0;
  });
}
