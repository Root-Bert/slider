import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { DeckStorage, DeckStorageBreakdown, PruneDeckStorageResult } from '@slider/shared';
import { advisoryXactLock, type Database, type Executor } from '../db/client';
import {
  decks,
  media,
  revisions,
  slideVersions,
  type DeckFilesBytes,
  type DeckRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { blobKeys, type BlobStorage } from '../storage/blob-storage';
import { deleteBlobs, storageBlobs } from './blob-deletions';

/**
 * Storage of one review (owner decision 3b): what its files take up, and "Alles außer der
 * neuesten Version löschen" – the originals and slide images of every older version go, comments,
 * threads and their media stay. A file a kept version still refers to (blob reuse across
 * versions) is never deleted: what goes is decided by references, not by folder.
 *
 * Sizes come from the blob store itself (a `stat` per file), so they also cover files the
 * database does not know of (left-overs of interrupted imports) and need no size column.
 * Media sizes are in `media.size_bytes` already.
 */

type StorageDeps = Pick<AppDeps, 'db' | 'storage' | 'rendering' | 'clock' | 'log'>;

/** Parallel `stat`s while sizing a deck's files – enough to hide latency, not a flood of fds. */
const SIZE_CONCURRENCY = 32;

export const storageBusy = () =>
  new ApiError(
    409,
    'storage_busy',
    'Gerade wird eine Version verarbeitet – versuch es gleich noch einmal.',
  );

interface StoredFile {
  key: string;
  bytes: number;
  /** The revision folder it lives in (`decks/<deck>/<revision>/…`), `null` outside one. */
  revisionId: string | null;
}

interface StoragePlan {
  files: StoredFile[];
  mediaBytes: number;
  /** Older revisions (not current, not pending) and whether their files were deleted before. */
  older: { id: string; filesDeletedAt: Date | null }[];
  /** Keys a kept revision (current or pending) refers to. */
  kept: Set<string>;
  busy: boolean;
}

async function sizeAll(storage: BlobStorage, keys: string[]): Promise<number[]> {
  const sizes = new Array<number>(keys.length).fill(0);
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const index = next++;
      sizes[index] = (await storage.size(keys[index] ?? '').catch(() => null)) ?? 0;
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIZE_CONCURRENCY, keys.length) }, worker));
  return sizes;
}

async function listFiles(storage: BlobStorage, deckId: string): Promise<StoredFile[]> {
  const prefix = blobKeys.deckPrefix(deckId);
  // Recordings live in the media store (sized from `media.size_bytes`); should `MEDIA_DIR` be the
  // blob folder itself, they must neither count twice nor ever be taken for a revision's files.
  const mediaPrefix = `${prefix}media/`;
  const keys = (await storage.list(prefix)).filter((key) => !key.startsWith(mediaPrefix));
  const sizes = await sizeAll(storage, keys);
  return keys.map((key, index) => {
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf('/');
    return {
      key,
      bytes: sizes[index] ?? 0,
      revisionId: slash > 0 ? rest.slice(0, slash) : null,
    };
  });
}

/** What kept revisions refer to, and which revisions count as older. */
async function loadReferences(db: Executor, deck: DeckRow) {
  const rows = await db
    .select({
      id: revisions.id,
      status: revisions.status,
      pptxKey: revisions.pptxKey,
      filesDeletedAt: revisions.filesDeletedAt,
    })
    .from(revisions)
    .where(eq(revisions.deckId, deck.id));
  const isKept = (row: (typeof rows)[number]) =>
    row.id === deck.currentRevisionId || row.status === 'pending';
  const keptIds = rows.filter(isKept).map((row) => row.id);
  const kept = new Set<string>();
  for (const row of rows) if (isKept(row) && row.pptxKey) kept.add(row.pptxKey);
  if (keptIds.length > 0) {
    const versions = await db
      .select({ imageKey: slideVersions.imageKey, thumbnailKey: slideVersions.thumbnailKey })
      .from(slideVersions)
      .where(inArray(slideVersions.revisionId, keptIds));
    for (const version of versions) {
      kept.add(version.imageKey);
      kept.add(version.thumbnailKey);
    }
  }
  const older = rows
    .filter((row) => !isKept(row))
    .map((row) => ({ id: row.id, filesDeletedAt: row.filesDeletedAt }));
  return { older, kept, pending: rows.some((row) => row.status === 'pending') };
}

function isBusy(deps: StorageDeps, deck: DeckRow, pending: boolean): boolean {
  return (
    pending ||
    deck.importState.status === 'queued' ||
    deck.importState.status === 'running' ||
    deck.currentRevisionId === null ||
    (deps.rendering?.progress.isActive(deck.id) ?? false)
  );
}

/** Files of older revisions no kept revision refers to – what pruning deletes. */
function reclaimable(plan: Pick<StoragePlan, 'files' | 'older' | 'kept'>): StoredFile[] {
  const older = new Set(plan.older.map((row) => row.id));
  return plan.files.filter(
    (file) => file.revisionId !== null && older.has(file.revisionId) && !plan.kept.has(file.key),
  );
}

function isOriginal(file: StoredFile): boolean {
  const name = file.key.slice(file.key.lastIndexOf('/') + 1);
  return file.revisionId !== null && name.startsWith('source-') && name.endsWith('.pptx');
}

function breakdownOf(files: StoredFile[], mediaBytes: number): DeckStorageBreakdown {
  const breakdown: DeckStorageBreakdown = {
    originals: 0,
    slideImages: 0,
    media: mediaBytes,
    other: 0,
  };
  for (const file of files) {
    if (file.revisionId && /\/slides\/[^/]+$/.test(file.key)) breakdown.slideImages += file.bytes;
    else if (isOriginal(file)) breakdown.originals += file.bytes;
    else breakdown.other += file.bytes;
  }
  return breakdown;
}

async function mediaBytesOf(db: Executor, deckId: string): Promise<number> {
  const [row] = await db
    .select({ bytes: sql<string | number | null>`sum(${media.sizeBytes})` })
    .from(media)
    .where(eq(media.deckId, deckId));
  return Number(row?.bytes ?? 0);
}

function toDto(deps: StorageDeps, deck: DeckRow, plan: StoragePlan): DeckStorage {
  const breakdown = breakdownOf(plan.files, plan.mediaBytes);
  const freeable = reclaimable(plan);
  const olderWithFiles = new Set(freeable.map((file) => file.revisionId));
  return {
    totalBytes: breakdown.originals + breakdown.slideImages + breakdown.media + breakdown.other,
    breakdown,
    originalCount: plan.files.filter(isOriginal).length,
    reclaimableBytes: freeable.reduce((sum, file) => sum + file.bytes, 0),
    olderVersionCount: olderWithFiles.size,
    busy: plan.busy,
  };
}

/** What a deck's blob files take up, without recordings (`decks.files_bytes`, BER-151). */
function filesBytesOf(files: StoredFile[]): DeckFilesBytes {
  const { originals, slideImages, other } = breakdownOf(files, 0);
  return { originals, slideImages, other };
}

/** The revision's import is still under way: a pending new version, or the deck's first import. */
function importUnderWay(
  deck: Pick<DeckRow, 'currentRevisionId' | 'importState'>,
  revision: { id: string; status: string },
): boolean {
  return (
    revision.status === 'pending' ||
    (revision.id === deck.currentRevisionId &&
      (deck.importState.status === 'queued' || deck.importState.status === 'running'))
  );
}

/**
 * Stores what `files` take up in `decks.files_bytes` and hands over from reservations
 * (`revisions.reserved_bytes`): an import that is over – ready, failed, given up – loses its
 * reservation in the same transaction that counts its real files, so the organisation's storage
 * never counts them twice nor not at all. Files of an import still under way are left out: its
 * reservation stands in for them until the measurement after it. Under a lock on the deck row,
 * so two measurements can't each decide with the other's half.
 */
async function storeFilesBytes(
  db: Database,
  deckId: string,
  files: StoredFile[],
): Promise<DeckFilesBytes> {
  return db.transaction(async (tx) => {
    const [deck] = await tx
      .select({ currentRevisionId: decks.currentRevisionId, importState: decks.importState })
      .from(decks)
      .where(eq(decks.id, deckId))
      .for('update');
    if (!deck) return filesBytesOf(files);
    const reserved = await tx
      .select({ id: revisions.id, status: revisions.status })
      .from(revisions)
      .where(and(eq(revisions.deckId, deckId), isNotNull(revisions.reservedBytes)));
    const held = new Set(reserved.filter((row) => importUnderWay(deck, row)).map((row) => row.id));
    const over = reserved.filter((row) => !held.has(row.id)).map((row) => row.id);
    const filesBytes = filesBytesOf(
      files.filter((file) => file.revisionId === null || !held.has(file.revisionId)),
    );
    await tx.update(decks).set({ filesBytes }).where(eq(decks.id, deckId));
    if (over.length > 0) {
      await tx.update(revisions).set({ reservedBytes: null }).where(inArray(revisions.id, over));
    }
    return filesBytes;
  });
}

/**
 * Measures the deck's files and stores the result in `decks.files_bytes`, which the
 * organisation's storage adds up (`workspace-storage`). After every import and prune; ends the
 * reservations of imports that are over ({@link storeFilesBytes}).
 */
export async function measureDeckFiles(
  deps: Pick<AppDeps, 'db' | 'storage'>,
  deckId: string,
): Promise<DeckFilesBytes> {
  return storeFilesBytes(deps.db, deckId, await listFiles(deps.storage, deckId));
}

/** `GET /decks/:deckId/storage`. */
export async function getDeckStorage(deps: StorageDeps, deck: DeckRow): Promise<DeckStorage> {
  const [files, mediaBytes, references] = await Promise.all([
    listFiles(deps.storage, deck.id),
    mediaBytesOf(deps.db, deck.id),
    loadReferences(deps.db, deck),
  ]);
  // Measured anyway: keep the organisation's sum current.
  await storeFilesBytes(deps.db, deck.id, files);
  return toDto(deps, deck, {
    files,
    mediaBytes,
    older: references.older,
    kept: references.kept,
    busy: isBusy(deps, deck, references.pending),
  });
}

/**
 * `POST /decks/:deckId/storage/prune`: deletes the stored files of every revision but the current
 * one (and one being imported), unless a kept revision still uses them. Revisions, slides,
 * comments and media rows stay; slide versions whose images went are flagged `files_deleted`, so
 * the viewer shows "Ältere Version gelöscht" instead of a broken image.
 *
 * The database is updated first, in one transaction under a per-deck lock: if deleting a file
 * fails halfway, the next call finds it again (sizes come from the store, not the rows).
 */
export async function pruneOlderVersions(
  deps: StorageDeps,
  deckId: string,
): Promise<PruneDeckStorageResult> {
  const files = await listFiles(deps.storage, deckId);
  const plan = await deps.db.transaction(async (tx) => {
    await advisoryXactLock(tx, `deck-storage:${deckId}`);
    // Read again under the lock: a version may have arrived since the route loaded the deck.
    const [deck] = await tx.select().from(decks).where(eq(decks.id, deckId));
    if (!deck) throw new ApiError(404, 'not_found', 'Diese Präsentation gibt es nicht (mehr).');
    const references = await loadReferences(tx, deck);
    if (isBusy(deps, deck, references.pending)) throw storageBusy();
    const doomed = reclaimable({ files, older: references.older, kept: references.kept });
    const doomedKeys = [...new Set(doomed.map((file) => file.key))];
    const olderIds = references.older.map((row) => row.id);
    const prunedIds = [...new Set(doomed.map((file) => file.revisionId ?? ''))].filter(Boolean);
    if (olderIds.length > 0) {
      await tx
        .update(revisions)
        .set({ filesDeletedAt: deps.clock.now() })
        .where(and(inArray(revisions.id, olderIds), isNull(revisions.filesDeletedAt)));
      // Flagged by key, not by folder: a version whose images a kept one reuses keeps them.
      if (doomedKeys.length > 0) {
        await tx
          .update(slideVersions)
          .set({ filesDeleted: true })
          .where(
            and(
              inArray(slideVersions.revisionId, olderIds),
              or(
                inArray(slideVersions.imageKey, doomedKeys),
                inArray(slideVersions.thumbnailKey, doomedKeys),
              ),
              ne(slideVersions.filesDeleted, true),
            ),
          );
      }
    }
    return { deck, doomed, prunedIds, references };
  });

  // Files that can't go now are retried by the hourly sweep (`blob_deletions`).
  await deleteBlobs(deps, storageBlobs(plan.doomed.map((file) => file.key)));
  // Empty revision folders go as well – only where no kept file is left in them.
  const remaining = new Set(
    files.filter((file) => !plan.doomed.includes(file)).map((file) => file.revisionId),
  );
  await deleteBlobs(
    deps,
    plan.prunedIds
      .filter((revisionId) => !remaining.has(revisionId))
      .map((revisionId) => ({
        store: 'storage',
        key: blobKeys.revisionPrefix(deckId, revisionId),
        prefix: true,
      })),
  );

  return {
    freedBytes: plan.doomed.reduce((sum, file) => sum + file.bytes, 0),
    prunedVersionCount: plan.prunedIds.length,
    storage: await getDeckStorage(deps, plan.deck),
  };
}
