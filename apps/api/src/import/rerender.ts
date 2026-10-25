import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { decks, revisions, slideVersions, type SlideRenderer } from '../db/schema';
import type { Logger } from '../logger';
import { blobKeys } from '../storage/blob-storage';
import { beginImportAttempt, endImportAttempt, ImportCrashLoop, importsStopping } from './attempts';
import type { ImportDeps } from './import-deck';
import { ConversionAborted } from './libreoffice';
import { hasPdfRenderer, renderSlidePages, type SlidePagesDeps } from './office-pages';

/** The PDF renderers a server has – see {@link SlidePagesDeps}. */
export type SlideRenderers = Pick<SlidePagesDeps, 'officePdf' | 'libreOfficePdf'>;
import { openDeckFile } from './pdf-deck';
import type { ImportJob, JobQueue } from './queue';

export interface RerenderOutcome {
  /**
   * `rendered`: the slides got new images. `unchanged`: every renderer failed, the slides keep
   * their images. `skipped`: nothing to do (no renderer, revision gone, file missing, …).
   */
  status: 'rendered' | 'unchanged' | 'skipped';
  renderer: SlideRenderer | null;
  /** Slides whose image was replaced. */
  replaced: number;
  reason?: string;
}

const skipped = (reason: string): RerenderOutcome => ({
  status: 'skipped',
  renderer: null,
  replaced: 0,
  reason,
});

/** Another import touched the slides while we rendered: our images are thrown away. */
class SlidesChangedError extends Error {}

/**
 * Draws the slide images of a finished revision (default: the current one) again with the best
 * renderer available – Office's PDF of a linked deck while the file is still the revision's,
 * else LibreOffice's PDF of the stored PPTX (BER-94). For decks imported before that existed.
 *
 * Safe to repeat and to interrupt: the new images are stored under new keys first, then one
 * transaction swaps the keys (only where the slide still shows the image we started from), and
 * only then are the old files deleted. If anything fails, the old images stay. `render_hash`
 * (the SVG hash slide matching compares) is never touched.
 */
export async function rerenderRevision(
  deps: ImportDeps,
  deckId: string,
  revisionId?: string,
): Promise<RerenderOutcome> {
  const { db, storage, log } = deps;
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId));
  if (!deck) return skipped('deck gone');
  const id = revisionId ?? deck.currentRevisionId;
  if (!id) return skipped('no revision');
  const [revision] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, id), eq(revisions.deckId, deckId)));
  if (!revision || revision.status !== 'ready') return skipped('revision not ready');
  if (!hasPdfRenderer(deps, deck)) return skipped('no renderer available');
  if (!revision.pptxKey) return skipped('no original file');
  const rows = await db
    .select()
    .from(slideVersions)
    .where(eq(slideVersions.revisionId, id))
    .orderBy(asc(slideVersions.position));
  if (rows.length === 0) return skipped('no slides');
  const bytes = await storage.get(revision.pptxKey);
  if (!bytes) return skipped('original file missing');

  const total = rows.length;
  deps.renderProgress?.running(deckId, 0, total);
  const { presentation } = await openDeckFile(deps.openPptx, bytes);
  const parsed = presentation.slides;
  const sameSlides =
    parsed.length === rows.length &&
    parsed.every((slide, i) => {
      const row = rows[i];
      return row !== undefined && (row.pptxSldId === null || row.pptxSldId === slide.sldId);
    });
  if (!sameSlides) return skipped('slides of the file do not match the revision');

  await deleteUnusedRenders(deps, deckId, id);
  const rendered = await renderSlidePages(deps, deck, revision, bytes, parsed);
  if (rendered.renderer === null) return skipped('no renderer available');
  await db
    .update(revisions)
    .set({ officeFailure: rendered.officeFailure })
    .where(eq(revisions.id, id));
  if (rendered.renderer === 'svg') {
    await markTried(db, id);
    return { status: 'unchanged', renderer: 'svg', replaced: 0 };
  }
  const renderer = rendered.renderer;

  const swaps: {
    id: string;
    from: { imageKey: string; thumbnailKey: string };
    imageKey: string;
    thumbnailKey: string;
  }[] = [];
  // The page images are already stored under new keys (renderSlidePages).
  const written = rendered.pages.flatMap((page) =>
    page ? [page.imageKey, page.thumbnailKey] : [],
  );
  try {
    for (const [i, row] of rows.entries()) {
      const page = rendered.pages[i];
      if (page) swaps.push({ id: row.id, from: row, ...page });
      deps.renderProgress?.running(deckId, i + 1, total);
    }
    await db.transaction(async (tx) => {
      for (const swap of swaps) {
        const updated = await tx
          .update(slideVersions)
          .set({ imageKey: swap.imageKey, thumbnailKey: swap.thumbnailKey, renderer })
          .where(and(eq(slideVersions.id, swap.id), eq(slideVersions.imageKey, swap.from.imageKey)))
          .returning({ id: slideVersions.id });
        if (updated.length === 0) throw new SlidesChangedError();
      }
      // Hidden slides have no page: they keep the SVG preview, as with a fresh import.
      await tx
        .update(slideVersions)
        .set({ renderer: 'svg' })
        .where(and(eq(slideVersions.revisionId, id), isNull(slideVersions.renderer)));
    });
  } catch (error) {
    await Promise.all(written.map((key) => storage.delete(key).catch(() => {})));
    if (error instanceof SlidesChangedError) return skipped('slides changed meanwhile');
    throw error;
  }

  // The old files, unless some other row still points at them.
  const oldKeys = [...new Set(swaps.flatMap(({ from }) => [from.imageKey, from.thumbnailKey]))];
  const stillUsed = new Set<string>();
  if (oldKeys.length > 0) {
    const users = await db
      .select({ imageKey: slideVersions.imageKey, thumbnailKey: slideVersions.thumbnailKey })
      .from(slideVersions)
      .where(
        or(inArray(slideVersions.imageKey, oldKeys), inArray(slideVersions.thumbnailKey, oldKeys)),
      );
    for (const user of users) stillUsed.add(user.imageKey).add(user.thumbnailKey);
  }
  for (const key of oldKeys) {
    if (stillUsed.has(key)) continue;
    await storage.delete(key).catch((error: unknown) => {
      log.warn(`Could not delete old slide image ${key}`, error);
    });
  }
  return { status: 'rendered', renderer, replaced: swaps.length };
}

/**
 * Slide images of the revision that no slide version shows – left by an earlier re-render cut off
 * between storing its pages and the swap (crash, restart). The queue runs one job at a time and
 * a ready revision gets no new pages otherwise, so none of them belongs to a running job.
 */
async function deleteUnusedRenders(
  { db, storage, log }: ImportDeps,
  deckId: string,
  revisionId: string,
): Promise<void> {
  const keys = await storage.list(blobKeys.slideRenderPrefix(deckId, revisionId));
  if (keys.length === 0) return;
  const used = new Set<string>();
  const rows = await db
    .select({ imageKey: slideVersions.imageKey, thumbnailKey: slideVersions.thumbnailKey })
    .from(slideVersions)
    .where(or(inArray(slideVersions.imageKey, keys), inArray(slideVersions.thumbnailKey, keys)));
  for (const row of rows) used.add(row.imageKey).add(row.thumbnailKey);
  const unused = keys.filter((key) => !used.has(key));
  if (unused.length > 0) log.info(`Deck ${deckId}: removing ${unused.length} unused slide images`);
  for (const key of unused) await storage.delete(key);
}

/** Rows that were never tried with a better renderer now have been: `null` → `svg`. */
async function markTried(db: Database, revisionId: string): Promise<void> {
  await db
    .update(slideVersions)
    .set({ renderer: 'svg' })
    .where(and(eq(slideVersions.revisionId, revisionId), isNull(slideVersions.renderer)));
}

/**
 * The queue's `rerender` job: never throws, only logs; reports progress while it runs. Each run
 * is counted on the revision before any rendering (like an import, see `attempts.ts`): a deck
 * whose rendering kills the process is given up after a few starts instead of crash-looping the
 * server from the start-up backfill.
 */
export async function rerenderJob(deps: ImportDeps, job: ImportJob): Promise<void> {
  let changed = false;
  let stopped = false;
  try {
    await beginImportAttempt(deps.db, job.revisionId);
    const outcome = await rerenderRevision(deps, job.deckId, job.revisionId);
    changed = outcome.status === 'rendered';
    if (outcome.status === 'rendered') {
      deps.log.info(
        `Deck ${job.deckId}: ${outcome.replaced} slide images re-rendered by ${outcome.renderer}`,
      );
    } else if (outcome.status === 'unchanged') {
      deps.log.info(`Deck ${job.deckId}: no better slide images available, keeping the preview`);
    } else {
      deps.log.info(`Deck ${job.deckId}: slide images not re-rendered (${outcome.reason})`);
    }
  } catch (error) {
    if (error instanceof ConversionAborted || importsStopping()) {
      // Shutdown: still untried, so the next start's backfill renders it again.
      stopped = true;
      deps.log.info(`Re-rendering deck ${job.deckId} stopped by shutdown`);
      return;
    }
    if (error instanceof ImportCrashLoop) {
      deps.log.warn(`Deck ${job.deckId}: ${error.message}; keeping the preview images`);
    } else {
      deps.log.error(`Re-rendering the slides of deck ${job.deckId} failed`, error);
    }
    // Once per revision: a revision that fails is not retried at every start (the ⋯ menu can).
    await markTried(deps.db, job.revisionId).catch(() => {});
  } finally {
    await endImportAttempt(deps.db, job.revisionId, { stopped }).catch(() => {});
    deps.renderProgress?.finish(job.deckId, changed, deps.clock.now());
  }
}

/**
 * Current revisions that still show the SVG preview and were never tried with a better
 * renderer (`renderer` null, no Office/LibreOffice image), for which one is available now.
 */
export async function findRerenderCandidates(
  db: Database,
  renderers: SlideRenderers,
): Promise<ImportJob[]> {
  // Nothing better to offer: no need to look at a single slide.
  if (!renderers.officePdf && !renderers.libreOfficePdf) return [];
  // One row per deck, aggregated in SQL – not every slide of every deck with its deck row.
  const untried = sql<boolean>`bool_or(${slideVersions.renderer} is null)`;
  const better = sql<boolean>`coalesce(bool_or(${slideVersions.renderer} in ('office', 'libreoffice')), false)`;
  const rows = await db
    .select({
      deckId: decks.id,
      revisionId: revisions.id,
      importState: decks.importState,
      source: decks.source,
      sourceRef: decks.sourceRef,
    })
    .from(decks)
    .innerJoin(revisions, eq(revisions.id, decks.currentRevisionId))
    .innerJoin(slideVersions, eq(slideVersions.revisionId, revisions.id))
    .where(eq(revisions.status, 'ready'))
    .groupBy(decks.id, revisions.id)
    .having(and(untried, sql`not ${better}`));
  return rows
    .filter(
      (row) =>
        row.importState.status === 'ready' &&
        hasPdfRenderer(renderers, { source: row.source, sourceRef: row.sourceRef }),
    )
    .map((row) => ({ deckId: row.deckId, revisionId: row.revisionId, kind: 'rerender' as const }));
}

/**
 * At start-up, in the background: queues a re-render for every deck {@link findRerenderCandidates}
 * finds. Waits `delayMs` first so start-up and resumed imports go first; the queue then runs the
 * jobs one at a time. Errors are only logged.
 */
export function scheduleRerenderBackfill(options: {
  db: Database;
  queue: JobQueue<ImportJob>;
  renderers: SlideRenderers;
  progress?: ImportDeps['renderProgress'];
  log: Logger;
  delayMs?: number;
}): NodeJS.Timeout {
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const jobs = await findRerenderCandidates(options.db, options.renderers);
        if (jobs.length > 0) {
          options.log.info(
            `Re-rendering the slide images of ${jobs.length} deck(s) in the background`,
          );
        }
        for (const job of jobs) {
          if (options.progress?.isActive(job.deckId)) continue;
          options.progress?.queued(job.deckId);
          options.queue.enqueue(job);
        }
      } catch (error) {
        options.log.error('Could not look for decks to re-render', error);
      }
    })();
  }, options.delayMs ?? 5_000);
  timer.unref?.();
  return timer;
}
