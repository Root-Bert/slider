import { and, eq } from 'drizzle-orm';
import { blobDeletions } from '../db/schema';
import type { AppDeps } from '../deps';

/**
 * Deleting files for good (BER-143): a deck, an account's recordings, an organisation. Storage can
 * fail after the rows are gone; then the deletion is noted in `blob_deletions` and the hourly sweep
 * ({@link retryBlobDeletions}) tries again until it works – no file stays behind unnoticed.
 */

export interface BlobDeletion {
  store: 'storage' | 'media';
  key: string;
  /** `key` is a prefix (ending in `/`): everything under it goes. */
  prefix: boolean;
}

/** What deleting needs – the media store only for its own files (imports have none). */
export type BlobDeletionDeps = Pick<AppDeps, 'db' | 'storage' | 'log'> &
  Partial<Pick<AppDeps, 'media'>>;

async function run(deps: BlobDeletionDeps, { store, key, prefix }: BlobDeletion) {
  const blobs = store === 'media' ? deps.media : deps.storage;
  if (!blobs) throw new Error('no media store here');
  await (prefix ? blobs.deletePrefix(key) : blobs.delete(key));
}

/** Deletes now; whatever fails is noted for the sweep. Never throws. */
export async function deleteBlobs(
  deps: BlobDeletionDeps,
  items: readonly BlobDeletion[],
): Promise<void> {
  for (const item of items) {
    try {
      await run(deps, item);
    } catch (error) {
      deps.log.warn(`Could not delete ${item.store} ${item.key}, retried later: ${String(error)}`);
      await deps.db
        .insert(blobDeletions)
        .values(item)
        .onConflictDoNothing()
        .catch((noted: unknown) =>
          deps.log.error(`Could not note ${item.store} ${item.key} for deletion`, noted),
        );
    }
  }
}

/** Single files of the deck store. */
export const storageBlobs = (keys: readonly string[]): BlobDeletion[] =>
  keys.map((key) => ({ store: 'storage', key, prefix: false }));

/** Both stores' files of a deck. */
export const deckBlobs = (prefix: string): BlobDeletion[] => [
  { store: 'storage', key: prefix, prefix: true },
  { store: 'media', key: prefix, prefix: true },
];

/** The hourly retry of what {@link deleteBlobs} couldn't delete. */
export async function retryBlobDeletions(deps: AppDeps): Promise<void> {
  const pending = await deps.db.select().from(blobDeletions);
  for (const item of pending) {
    try {
      await run(deps, item);
    } catch (error) {
      deps.log.warn(`Still cannot delete ${item.store} ${item.key}: ${String(error)}`);
      continue;
    }
    await deps.db
      .delete(blobDeletions)
      .where(and(eq(blobDeletions.store, item.store), eq(blobDeletions.key, item.key)));
  }
}
