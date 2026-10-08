import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import { decks, revisions, slideVersions, type DeckRow, type SlideRenderer } from '../db/schema';
import type { Logger } from '../logger';
import { blobKeys } from '../storage/blob-storage';
import type { ImportDeps } from './import-deck';
import { hasPdfRenderer, renderSlidePages, type SlidePagesDeps } from './office-pages';

/** The PDF renderers a server has – see {@link SlidePagesDeps}. */
export type SlideRenderers = Pick<SlidePagesDeps, 'officePdf' | 'libreOfficePdf'>;
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
  const { presentation } = await deps.openPptx(bytes);
  const parsed = presentation.slides;
  const sameSlides =
    parsed.length === rows.length &&
    parsed.every((slide, i) => {
      const row = rows[i];
      return row !== undefined && (row.pptxSldId === null || row.pptxSldId === slide.sldId);
    });
  if (!sameSlides) return skipped('slides of the file do not match the revision');

  const rendered = await renderSlidePages(deps, deck, revision, bytes, parsed);
  if (rendered.renderer === null) return skipped('no renderer available');
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
  const written: string[] = [];
  try {
    for (const [i, row] of rows.entries()) {
      const page = rendered.pages[i];
      if (page) {
        const imageKey = blobKeys.slideRender(deckId, id, 'webp');
        const thumbnailKey = blobKeys.slideRender(deckId, id, 'webp');
        written.push(imageKey, thumbnailKey);
        await storage.put(imageKey, page.image);
        await storage.put(thumbnailKey, page.thumbnail);
        swaps.push({ id: row.id, from: row, imageKey, thumbnailKey });
      }
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

/** Rows that were never tried with a better renderer now have been: `null` → `svg`. */
async function markTried(db: Database, revisionId: string): Promise<void> {
  await db
    .update(slideVersions)
    .set({ renderer: 'svg' })
    .where(and(eq(slideVersions.revisionId, revisionId), isNull(slideVersions.renderer)));
}

/** The queue's `rerender` job: never throws, only logs; reports progress while it runs. */
export async function rerenderJob(deps: ImportDeps, job: ImportJob): Promise<void> {
  let changed = false;
  try {
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
    deps.log.error(`Re-rendering the slides of deck ${job.deckId} failed`, error);
    // Once per revision: a revision that fails is not retried at every start (the ⋯ menu can).
    await markTried(deps.db, job.revisionId).catch(() => {});
  } finally {
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
  const rows = await db
    .select({ deck: decks, renderer: slideVersions.renderer })
    .from(decks)
    .innerJoin(revisions, eq(revisions.id, decks.currentRevisionId))
    .innerJoin(slideVersions, eq(slideVersions.revisionId, revisions.id))
    .where(eq(revisions.status, 'ready'));
  const byDeck = new Map<string, { deck: DeckRow; renderers: (SlideRenderer | null)[] }>();
  for (const row of rows) {
    const entry = byDeck.get(row.deck.id) ?? { deck: row.deck, renderers: [] };
    entry.renderers.push(row.renderer);
    byDeck.set(row.deck.id, entry);
  }
  const jobs: ImportJob[] = [];
  for (const { deck, renderers: used } of byDeck.values()) {
    if (deck.importState.status !== 'ready' || !deck.currentRevisionId) continue;
    const untried = used.some((renderer) => renderer === null);
    const better = used.some((renderer) => renderer === 'office' || renderer === 'libreoffice');
    if (!untried || better) continue;
    if (!hasPdfRenderer(renderers, deck)) continue;
    jobs.push({ deckId: deck.id, revisionId: deck.currentRevisionId, kind: 'rerender' });
  }
  return jobs;
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
