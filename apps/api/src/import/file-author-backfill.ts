import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { decks, revisions } from '../db/schema';
import type { Logger } from '../logger';
import type { BlobStorage } from '../storage/blob-storage';
import type { OpenPptx } from './pptx';

export interface FileAuthorBackfillOptions {
  db: Database;
  storage: BlobStorage;
  openPptx: OpenPptx;
  log: Logger;
}

/**
 * Reads the file author (see `revisions.fileAuthor`) of current revisions imported before it was
 * stored, once. `''` marks a file that names nobody, so it is not read again.
 *
 * Only decks whose import finished: a running or interrupted import sets the author itself, and
 * a failed one may be a file that kills the process when parsed (the crash-loop guard of
 * `attempts.ts` gave up on it). Each row is marked `''` *before* its file is opened, so a file
 * that takes the process down is never opened again on the next start.
 */
export async function backfillFileAuthors({
  db,
  storage,
  openPptx,
}: FileAuthorBackfillOptions): Promise<void> {
  const rows = await db
    .select({ id: revisions.id, pptxKey: revisions.pptxKey })
    .from(revisions)
    .innerJoin(decks, eq(decks.currentRevisionId, revisions.id))
    .where(
      and(
        isNull(revisions.fileAuthor),
        isNotNull(revisions.pptxKey),
        sql`${decks.importState}->>'status' = 'ready'`,
      ),
    );
  for (const row of rows) {
    await db.update(revisions).set({ fileAuthor: '' }).where(eq(revisions.id, row.id));
    const bytes = row.pptxKey ? await storage.get(row.pptxKey) : null;
    const author = bytes
      ? await openPptx(bytes).then(
          (pptx) => pptx.presentation.author,
          () => null,
        )
      : null;
    if (author) {
      await db.update(revisions).set({ fileAuthor: author }).where(eq(revisions.id, row.id));
    }
  }
}

/** {@link backfillFileAuthors} in the background, shortly after start. */
export function scheduleFileAuthorBackfill(
  options: FileAuthorBackfillOptions & { delayMs?: number },
): NodeJS.Timeout {
  const timer = setTimeout(() => {
    backfillFileAuthors(options).catch((error: unknown) => {
      options.log.error('Could not read the authors of older decks', error);
    });
  }, options.delayMs ?? 5_000);
  timer.unref?.();
  return timer;
}
