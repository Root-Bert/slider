import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { revisions } from '../db/schema';

/**
 * Import runs of one revision that may die with the process (OOM kill, native crash) before the
 * import gives up. Interrupted imports resume on every start (`findInterruptedImports`),
 * so without a limit one such file would crash-loop the whole server.
 */
export const MAX_IMPORT_ATTEMPTS = 3;

/** The previous runs of this import all died with the process; it is not tried again. */
export class ImportCrashLoop extends Error {
  constructor(revisionId: string, attempts: number) {
    super(`Import of revision ${revisionId} was interrupted ${attempts} times; giving up`);
    this.name = 'ImportCrashLoop';
  }
}

/**
 * Records that a run of the revision's import starts – persisted before any heavy work, so a
 * run the process does not survive still counts. Throws {@link ImportCrashLoop} once
 * {@link MAX_IMPORT_ATTEMPTS} earlier runs never finished.
 */
export async function beginImportAttempt(db: Executor, revisionId: string): Promise<void> {
  const [row] = await db
    .update(revisions)
    .set({ importAttempts: sql`${revisions.importAttempts} + 1` })
    .where(eq(revisions.id, revisionId))
    .returning({ attempts: revisions.importAttempts });
  if (row && row.attempts > MAX_IMPORT_ATTEMPTS) {
    throw new ImportCrashLoop(revisionId, row.attempts - 1);
  }
}

/**
 * A run ended without the process dying. A finished run (ready or failed) clears the count; a
 * shutdown in the middle (`stopped`) only takes its own run back, as it was no crash.
 */
export async function endImportAttempt(
  db: Executor,
  revisionId: string,
  { stopped = false } = {},
): Promise<void> {
  await db
    .update(revisions)
    .set({
      importAttempts: stopped ? sql`greatest(${revisions.importAttempts} - 1, 0)` : 0,
    })
    .where(eq(revisions.id, revisionId));
}
