import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { decks, revisions } from '../db/schema';
import type { Logger } from '../logger';
import type { BlobStorage } from '../storage/blob-storage';
import type { OpenPptx } from './pptx';

/**
 * Reads the file author (see `revisions.fileAuthor`) of current revisions imported before it was
 * stored, once, in the background. `''` marks a file that names nobody, so it is not read again.
 */
export function scheduleFileAuthorBackfill(options: {
  db: Database;
  storage: BlobStorage;
  openPptx: OpenPptx;
  log: Logger;
  delayMs?: number;
}): NodeJS.Timeout {
  const timer = setTimeout(() => {
    void (async () => {
      const { db, storage, openPptx, log } = options;
      try {
        const rows = await db
          .select({ id: revisions.id, pptxKey: revisions.pptxKey })
          .from(revisions)
          .innerJoin(decks, eq(decks.currentRevisionId, revisions.id))
          .where(and(isNull(revisions.fileAuthor), isNotNull(revisions.pptxKey)));
        for (const row of rows) {
          const bytes = row.pptxKey ? await storage.get(row.pptxKey) : null;
          const author = bytes
            ? await openPptx(bytes).then(
                (pptx) => pptx.presentation.author,
                () => null,
              )
            : null;
          await db
            .update(revisions)
            .set({ fileAuthor: author ?? '' })
            .where(eq(revisions.id, row.id));
        }
      } catch (error) {
        log.error('Could not read the authors of older decks', error);
      }
    })();
  }, options.delayMs ?? 5_000);
  timer.unref?.();
  return timer;
}
