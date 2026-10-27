import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { StorageBreakdown } from '@slider/shared';
import type { Executor } from '../db/client';
import { decks, media, revisions, workspaceFonts, type DeckFilesBytes } from '../db/schema';
import type { AppDeps } from '../deps';
import { measureDeckFiles } from './deck-storage';

/**
 * Storage per workspace (BER-151): every file of its reviews counts – originals, slide images
 * and recordings – whoever uploaded them, and its own fonts. Blob files are measured per deck
 * after each import and prune (`decks.files_bytes`), recordings come from `media.size_bytes`;
 * both add up through `decks.workspace_id`, so the sums need no `stat` per file. Fonts count
 * by `workspace_fonts.size_bytes`.
 *
 * A deck is measured only once its import ended, so the original of an import still under way
 * counts through its reservation (`revisions.reserved_bytes`) instead – as an original, the
 * same bytes the measurement finds there later, so the numbers shown don't jump. Checks and the
 * usage shown both see it: two uploads at once can't both take the last free bytes.
 */

export const emptyBreakdown = (): StorageBreakdown => ({
  images: 0,
  videos: 0,
  audio: 0,
  originals: 0,
  slideImages: 0,
  other: 0,
});

export const totalBytes = (breakdown: StorageBreakdown) =>
  breakdown.images +
  breakdown.videos +
  breakdown.audio +
  breakdown.originals +
  breakdown.slideImages +
  breakdown.other;

/** Bytes by kind of each workspace; workspaces without files get zeros. */
export async function workspaceStorage(
  db: Executor,
  workspaceIds: readonly string[],
): Promise<Map<string, StorageBreakdown>> {
  const result = new Map(workspaceIds.map((id) => [id, emptyBreakdown()]));
  if (workspaceIds.length === 0) return result;
  const ids = [...workspaceIds];
  const [fileRows, reservedRows, mediaRows, fontRows] = await Promise.all([
    db
      .select({
        id: decks.workspaceId,
        originals: sql<string | number | null>`sum((${decks.filesBytes}->>'originals')::bigint)`,
        slideImages: sql<
          string | number | null
        >`sum((${decks.filesBytes}->>'slideImages')::bigint)`,
        other: sql<string | number | null>`sum((${decks.filesBytes}->>'other')::bigint)`,
      })
      .from(decks)
      .where(inArray(decks.workspaceId, ids))
      .groupBy(decks.workspaceId),
    db
      .select({
        id: decks.workspaceId,
        bytes: sql<string | number | null>`sum(${revisions.reservedBytes})`,
      })
      .from(revisions)
      .innerJoin(decks, eq(decks.id, revisions.deckId))
      .where(and(inArray(decks.workspaceId, ids), isNotNull(revisions.reservedBytes)))
      .groupBy(decks.workspaceId),
    db
      .select({
        id: decks.workspaceId,
        kind: media.kind,
        bytes: sql<string | number | null>`sum(${media.sizeBytes})`,
      })
      .from(media)
      .innerJoin(decks, eq(decks.id, media.deckId))
      .where(inArray(decks.workspaceId, ids))
      .groupBy(decks.workspaceId, media.kind),
    db
      .select({
        id: workspaceFonts.workspaceId,
        bytes: sql<string | number | null>`sum(${workspaceFonts.sizeBytes})`,
      })
      .from(workspaceFonts)
      .where(inArray(workspaceFonts.workspaceId, ids))
      .groupBy(workspaceFonts.workspaceId),
  ]);
  for (const row of fileRows) {
    const entry = result.get(row.id);
    if (!entry) continue;
    entry.originals += Number(row.originals ?? 0);
    entry.slideImages += Number(row.slideImages ?? 0);
    entry.other += Number(row.other ?? 0);
  }
  for (const row of reservedRows) {
    const entry = result.get(row.id);
    if (entry) entry.originals += Number(row.bytes ?? 0);
  }
  // The workspace's own fonts count as other files.
  for (const row of fontRows) {
    const entry = result.get(row.id);
    if (entry) entry.other += Number(row.bytes ?? 0);
  }
  for (const row of mediaRows) {
    const entry = result.get(row.id);
    if (!entry) continue;
    const bytes = Number(row.bytes ?? 0);
    if (row.kind === 'image') entry.images += bytes;
    else if (row.kind === 'video') entry.videos += bytes;
    else entry.audio += bytes;
  }
  return result;
}

/** `workspaceStorageUsage` of the ticket: one workspace's bytes by kind. */
export async function workspaceStorageUsage(
  db: Executor,
  workspaceId: string,
): Promise<StorageBreakdown> {
  return (await workspaceStorage(db, [workspaceId])).get(workspaceId) ?? emptyBreakdown();
}

/** Stores what a deck's files take up (`decks.files_bytes`). Best effort: a failure is logged. */
export async function remeasureDeck(
  deps: Pick<AppDeps, 'db' | 'storage' | 'log'>,
  deckId: string,
): Promise<DeckFilesBytes | null> {
  try {
    return await measureDeckFiles(deps, deckId);
  } catch (error) {
    deps.log.error(`Could not measure the files of deck ${deckId}`, error);
    return null;
  }
}

/**
 * At start, one after the other, in the background: decks never measured (from before BER-151),
 * and decks holding a reservation – a measurement that failed after an import left it behind.
 * Imports still under way keep theirs (`measureDeckFiles`).
 */
export async function backfillDeckFilesBytes(
  deps: Pick<AppDeps, 'db' | 'storage' | 'log'>,
): Promise<number> {
  const rows = await deps.db
    .select({ id: decks.id })
    .from(decks)
    .where(
      or(
        isNull(decks.filesBytes),
        sql`exists (select 1 from ${revisions} where ${revisions.deckId} = ${decks.id} and ${revisions.reservedBytes} is not null)`,
      ),
    );
  for (const row of rows) await remeasureDeck(deps, row.id);
  return rows.length;
}
