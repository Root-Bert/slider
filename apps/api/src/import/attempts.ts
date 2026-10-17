import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { revisions } from '../db/schema';

/**
 * Import runs of one revision that may die with the process (OOM kill, native crash) before the
 * import gives up. Interrupted imports resume on every start (`findInterruptedImports`),
 * so without a limit one such file would crash-loop the whole server.
 */
export const MAX_IMPORT_ATTEMPTS = 3;

/** Revisions whose run is in progress in this process (begun, not yet ended). */
const running = new Set<string>();
/** Runs that {@link releaseRunningImportAttempts} already took back at shutdown. */
const released = new Set<string>();
let stopping = false;

/**
 * The process is shutting down (SIGTERM, restart after `/einrichtung`): whatever fails in a
 * running import from now on – the database closing under it, a cut-off download – is the
 * shutdown, not the file. Imports then end as "stopped" and resume on the next start.
 */
export const importsStopping = (): boolean => stopping;

/**
 * At shutdown, before the database closes: takes back the run of every import still in progress,
 * as it is no crash. Without this a shutdown in any phase but LibreOffice (parsing, Office's PDF,
 * rasterising, storing) would count like an OOM kill, and three restarts during one import
 * would fail a healthy file as "zu groß oder beschädigt".
 */
export async function releaseRunningImportAttempts(db: Executor): Promise<void> {
  stopping = true;
  const ids = [...running];
  running.clear();
  for (const id of ids) {
    released.add(id);
    await takeBack(db, id);
  }
}

/** Undoes {@link releaseRunningImportAttempts} – for tests; a real server never comes back. */
export function resumeImports(): void {
  stopping = false;
  running.clear();
  released.clear();
}

const takeBack = (db: Executor, revisionId: string) =>
  db
    .update(revisions)
    .set({ importAttempts: sql`greatest(${revisions.importAttempts} - 1, 0)` })
    .where(eq(revisions.id, revisionId));

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
  if (row) running.add(revisionId);
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
  running.delete(revisionId);
  // Already taken back at shutdown: only a run that still finished clears the count.
  if (released.delete(revisionId) && stopped) return;
  if (stopped) {
    await takeBack(db, revisionId);
    return;
  }
  await db.update(revisions).set({ importAttempts: 0 }).where(eq(revisions.id, revisionId));
}
