import { and, asc, desc, eq, notInArray } from 'drizzle-orm';
import {
  fingerprintFromShapes,
  matchSlides,
  PptxError,
  relinkDeletedSlides,
  svgForRenderHash,
  type ParsedSlide,
  type SlideFingerprint,
} from '@slider/pptx';
import { toSyncSummary, type Shape, type SyncSummary } from '@slider/shared';
import {
  decks,
  revisions,
  slides,
  slideVersions,
  type RevisionDiffRecord,
  type SlideRenderer,
} from '../db/schema';
import {
  beginImportAttempt,
  endImportAttempt,
  ImportCrashLoop,
  importsStopping,
} from '../import/attempts';
import { deleteOrphanSlides, sha256Hex, toShape } from '../import/common';
import { ConversionAborted } from '../import/libreoffice';
import { renderSlidePages, slideRenderer, storeSlideRender } from '../import/office-pages';
import type { ImportDeps } from '../import/import-deck';
import { upsertPptxComments, type ImportedSlide } from '../import/pptx-comments';
import type { ImportJob } from '../import/queue';
import { blobKeys } from '../storage/blob-storage';
import { parseFailedMessage } from './errors';
import { DEFAULT_SYNC_POLL_INTERVAL_MS } from '../config';
import { mergeSyncState, syncBackoffMs } from './state';

type SlideVersionRow = typeof slideVersions.$inferSelect;

/**
 * The previous revision's fingerprints computed by *this* code from its stored file – not the
 * hashes stored at its import. Those came from the parser and renderer of back then; after an
 * update that changes either (e.g. slide-number fields left out of the text hash), every slide
 * would look "modified" on the next sync, and without exact hashes the renumber guard of slide
 * matching cannot stop comments from moving to a neighbour. `null` (the stored rows are used)
 * when the file is gone, cannot be read any more or does not match the stored slides.
 */
async function currentFingerprints(
  deps: ImportDeps,
  deckId: string,
  revisionId: string,
  rows: SlideVersionRow[],
): Promise<SlideFingerprint[] | null> {
  if (rows.length === 0) return null;
  const [revision] = await deps.db
    .select({ pptxKey: revisions.pptxKey })
    .from(revisions)
    .where(eq(revisions.id, revisionId));
  const bytes = revision?.pptxKey ? await deps.storage.get(revision.pptxKey) : null;
  if (!bytes) return null;
  try {
    const document = await deps.openPptx(bytes);
    const parsed = document.presentation.slides;
    const sameSlides =
      parsed.length === rows.length &&
      parsed.every((slide, i) => {
        const row = rows[i];
        return row !== undefined && (row.pptxSldId === null || row.pptxSldId === slide.sldId);
      });
    if (!sameSlides) return null;
    const fingerprints: SlideFingerprint[] = [];
    for (const [i, slide] of parsed.entries()) {
      const row = rows[i]!;
      const svg = await document.renderSlideSvg(slide);
      fingerprints.push(
        fingerprintFromShapes({
          key: row.slideId,
          sldId: slide.sldId,
          position: row.position,
          title: slide.title,
          layoutName: slide.layoutName,
          textHash: slide.textHash,
          shapes: slide.shapes.map(toShape),
          renderHash: sha256Hex(svgForRenderHash(svg)),
          contentHash: slide.contentHash,
          creationId: slide.creationId,
        }),
      );
    }
    return fingerprints;
  } catch (error) {
    if (error instanceof ConversionAborted) throw error;
    deps.log.warn(
      `Deck ${deckId}: previous file could not be read again, matching with stored hashes`,
      error,
    );
    return null;
  }
}

/**
 * A file whose import fails this often in a row for another reason than a parse error (e.g. a
 * renderer bug on unusual XML) is skipped like an unreadable one until it changes.
 */
export const SYNC_IMPORT_MAX_ATTEMPTS = 3;

/**
 * Imports a pending revision of a deck that is already in use (BER-107/108/114).
 *
 * Unlike the first import it never touches `decks.import_state`: viewers keep the current
 * revision without an overlay until one transaction flips `current_revision_id`. Slides are
 * matched to the previous revision, so matched slides keep their Slider id – and with it their
 * comments. Slides missing from the new file keep their old versions, images and comments.
 * On failure the pending revision is removed and the error is stored on the deck.
 */
export async function importSyncRevision(deps: ImportDeps, job: ImportJob): Promise<void> {
  const { db, storage, clock } = deps;
  const { deckId, revisionId } = job;
  const [revision] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.deckId, deckId)));
  if (!revision || revision.status !== 'pending') return;
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId));
  if (!deck) {
    await storage.deletePrefix(blobKeys.deckPrefix(deckId)).catch(() => {});
    return;
  }

  let stopped = false;
  try {
    await beginImportAttempt(db, revisionId);
    const previousRevisionId = deck.currentRevisionId;
    const previous = previousRevisionId
      ? await db
          .select()
          .from(slideVersions)
          .where(eq(slideVersions.revisionId, previousRevisionId))
          .orderBy(asc(slideVersions.position))
      : [];
    // Before the new file is opened, so the two documents are never in memory at once.
    const rebuilt = previousRevisionId
      ? await currentFingerprints(deps, deckId, previousRevisionId, previous)
      : null;
    const bytes = revision.pptxKey ? await storage.get(revision.pptxKey) : null;
    if (!bytes) throw new Error(`Original file of revision ${revisionId} is missing`);
    const document = await deps.openPptx(bytes);
    const { presentation } = document;
    const aspectRatio = presentation.size.cx / presentation.size.cy;

    const planned: {
      parsed: ParsedSlide;
      position: number;
      imageKey: string;
      thumbnailKey: string;
      shapes: Shape[];
      renderHash: string;
      renderer: SlideRenderer | null;
    }[] = [];
    // Images of an earlier run cut off before publishing (crash, restart): nothing refers to a
    // pending revision's slides yet, so they go before this run stores its own.
    await storage.deletePrefix(blobKeys.slideRenderPrefix(deckId, revisionId));
    const rendered = await renderSlidePages(deps, deck, revision, bytes, presentation.slides);
    for (const [position, parsed] of presentation.slides.entries()) {
      // The SVG is rendered either way: its hash is what slide matching compares (BER-108).
      const svg = await document.renderSlideSvg(parsed);
      const page = rendered.pages[position] ?? null;
      const keys = await storeSlideRender(storage, deckId, revisionId, svg, page);
      planned.push({
        parsed,
        position,
        ...keys,
        shapes: parsed.shapes.map(toShape),
        renderHash: sha256Hex(svgForRenderHash(svg)),
        renderer: slideRenderer(rendered, page),
      });
    }

    const toFingerprint = async (row: typeof slideVersions.$inferSelect) => {
      let renderHash = row.renderHash;
      if (renderHash === null) {
        // Rows from before BER-108: hash the stored image once and remember it.
        const image = await storage.get(row.imageKey);
        if (image) {
          renderHash = sha256Hex(image);
          await db.update(slideVersions).set({ renderHash }).where(eq(slideVersions.id, row.id));
        }
      }
      return fingerprintFromShapes({
        key: row.slideId,
        sldId: row.pptxSldId,
        position: row.position,
        title: row.title,
        layoutName: row.layoutName,
        textHash: row.textHash,
        shapes: row.shapes,
        renderHash,
        contentHash: row.contentHash,
        creationId: row.creationId,
      });
    };
    const prevFingerprints: SlideFingerprint[] = rebuilt ?? [];
    if (!rebuilt) for (const row of previous) prevFingerprints.push(await toFingerprint(row));
    const nextFingerprints = planned.map((slide) =>
      fingerprintFromShapes({
        key: String(slide.position),
        sldId: slide.parsed.sldId,
        position: slide.position,
        title: slide.parsed.title,
        layoutName: slide.parsed.layoutName,
        textHash: slide.parsed.textHash,
        shapes: slide.shapes,
        renderHash: slide.renderHash,
        contentHash: slide.parsed.contentHash,
        creationId: slide.parsed.creationId,
      }),
    );
    const results = matchSlides(prevFingerprints, nextFingerprints);

    // Slides that were deleted in an earlier revision and came back get their identity – and
    // with it their comments – back instead of a fresh id.
    const added = results.filter((result) => result.nextKey !== null && result.prevKey === null);
    const relinked =
      added.length > 0
        ? relinkDeletedSlides(
            await Promise.all(
              (await loadEarlierDeletedVersions(deps, deckId, previousRevisionId)).map(
                toFingerprint,
              ),
            ),
            nextFingerprints.filter((fp) => added.some((result) => result.nextKey === fp.key)),
          )
        : new Map<string, string>();

    const slideIdByPosition = new Map<number, string>();
    const matchedPositions = new Set<number>();
    const newSlideIds: string[] = [];
    for (const result of results) {
      if (result.nextKey === null) continue;
      const restored = result.prevKey === null ? relinked.get(result.nextKey) : undefined;
      const slideId = result.prevKey ?? restored ?? crypto.randomUUID();
      if (result.prevKey === null && !restored) newSlideIds.push(slideId);
      if (result.prevKey !== null) matchedPositions.add(Number(result.nextKey));
      slideIdByPosition.set(Number(result.nextKey), slideId);
    }
    const slideIdAt = (position: number) => {
      const id = slideIdByPosition.get(position);
      if (!id) throw new Error(`Slide ${position} of revision ${revisionId} has no match result`);
      return id;
    };

    const diff: RevisionDiffRecord = {
      previousRevisionId: previousRevisionId ?? '',
      slides: results.flatMap((result) =>
        result.nextKey === null || result.status === 'deleted'
          ? []
          : [
              {
                slideId: slideIdAt(Number(result.nextKey)),
                status: result.status,
                moved: result.moved,
                confidence: result.confidence,
                matchedBy: result.matchedBy,
                position: result.position ?? 0,
                previousPosition: result.previousPosition,
              },
            ],
      ),
      deleted: results.flatMap((result) =>
        result.status === 'deleted' && result.prevKey
          ? [
              {
                slideId: result.prevKey,
                previousPosition: result.previousPosition ?? 0,
                confidence: result.confidence,
              },
            ]
          : [],
      ),
    };

    const now = clock.now();
    // PowerPoint comments follow the sldId. With duplicate sldIds in the new file the matched
    // slide (the original) keeps them, otherwise the first one – never a later copy.
    const slidesBySldId = new Map<number, ImportedSlide>();
    const sldIdOwner = new Map<number, number>();
    for (const slide of planned) {
      const owner = sldIdOwner.get(slide.parsed.sldId);
      const takeOver =
        owner === undefined ||
        (!matchedPositions.has(owner) && matchedPositions.has(slide.position));
      if (!takeOver) continue;
      sldIdOwner.set(slide.parsed.sldId, slide.position);
      slidesBySldId.set(slide.parsed.sldId, {
        slideId: slideIdAt(slide.position),
        shapes: slide.shapes,
      });
    }

    await db.transaction(async (tx) => {
      if (newSlideIds.length > 0) {
        await tx.insert(slides).values(newSlideIds.map((id) => ({ id, deckId, createdAt: now })));
      }
      if (planned.length > 0) {
        await tx.insert(slideVersions).values(
          planned.map((slide) => ({
            id: crypto.randomUUID(),
            slideId: slideIdAt(slide.position),
            revisionId,
            position: slide.position,
            pptxSldId: slide.parsed.sldId,
            hidden: slide.parsed.hidden,
            title: slide.parsed.title,
            layoutName: slide.parsed.layoutName,
            textHash: slide.parsed.textHash,
            contentHash: slide.parsed.contentHash,
            creationId: slide.parsed.creationId,
            imageKey: slide.imageKey,
            thumbnailKey: slide.thumbnailKey,
            aspectRatio,
            shapes: slide.shapes,
            guides: slide.parsed.guides,
            renderHash: slide.renderHash,
            renderer: slide.renderer,
          })),
        );
      }
      const commentCounts = await upsertPptxComments(
        tx,
        deckId,
        presentation.comments,
        slidesBySldId,
        now,
      );
      const summary: SyncSummary = toSyncSummary({
        slidesModified: diff.slides.filter((s) => s.status === 'modified').length,
        slidesNew: diff.slides.filter((s) => s.status === 'new').length,
        slidesDeleted: diff.deleted.length,
        slidesMoved: diff.slides.filter((s) => s.status === 'moved').length,
        commentsNew: commentCounts.inserted + commentCounts.restored,
        commentsUpdated: commentCounts.updated,
        commentsRemoved: commentCounts.removed,
      });
      await tx
        .update(revisions)
        .set({
          status: 'ready',
          diff: previousRevisionId ? diff : null,
          summary,
          slideWidthEmu: presentation.size.cx,
          slideHeightEmu: presentation.size.cy,
          fileAuthor: presentation.author,
          officeFailure: rendered.officeFailure,
        })
        .where(eq(revisions.id, revisionId));
      await tx
        .update(decks)
        .set({ currentRevisionId: revisionId, updatedAt: now })
        .where(eq(decks.id, deckId));
      await mergeSyncState(tx, deckId, {
        lastSyncAt: now.toISOString(),
        lastSyncError: null,
        consecutiveFailures: 0,
        pending: null,
        importingRevisionId: null,
        failedToken: null,
        importFailures: null,
      });
    });
    deps.log.info(`Deck ${deckId}: revision ${revision.number} imported`);
  } catch (error) {
    if (error instanceof ConversionAborted || importsStopping()) {
      // Shutdown: the revision stays pending, and the next start imports it again.
      stopped = true;
      deps.log.info(`Sync import of deck ${deckId} stopped by shutdown; resumes on the next start`);
      return;
    }
    if (!(error instanceof PptxError)) {
      deps.log.error(`Sync import of deck ${deckId} revision ${revisionId} failed`, error);
    }
    await discardRevision(deps, deckId, revisionId).catch((cleanupError: unknown) =>
      deps.log.error(`Cleanup of revision ${revisionId} failed`, cleanupError),
    );
    const now = clock.now();
    const token =
      revision.sourceChangeToken ??
      (revision.contentSha256 ? `sha256:${revision.contentSha256}` : null);
    // A file that cannot be parsed – or whose imports kept killing the process – is skipped
    // until it changes. Anything else may be transient (storage, database): the same file is
    // tried again with a backoff, and after a few failed imports of it in a row it is skipped
    // too – a manual "Neu rendern" still tries. Only import attempts of this very file count,
    // not the failed source checks before it.
    const parseFailed = error instanceof PptxError || error instanceof ImportCrashLoop;
    const previous = deck.syncState.importFailures;
    const failures = parseFailed
      ? null
      : (previous && previous.token === token ? previous.count : 0) + 1;
    await mergeSyncState(db, deckId, {
      lastSyncError: {
        code: parseFailed ? 'parse_failed' : 'internal',
        message: parseFailedMessage(error),
        at: now.toISOString(),
      },
      failedToken: parseFailed || (failures ?? 0) >= SYNC_IMPORT_MAX_ATTEMPTS ? token : null,
      ...(failures === null
        ? {}
        : {
            consecutiveFailures: failures,
            importFailures: { token, count: failures },
            nextCheckAt: new Date(
              now.getTime() +
                syncBackoffMs(deps.syncPollMs || DEFAULT_SYNC_POLL_INTERVAL_MS, failures),
            ).toISOString(),
          }),
      importingRevisionId: null,
      pending: null,
    }).catch(() => {});
  } finally {
    await endImportAttempt(db, revisionId, { stopped }).catch(() => {});
  }
}

/**
 * The last version of every slide that is missing from the previous revision (deleted at some
 * point), for {@link relinkDeletedSlides}. Capped to the most recently seen slides.
 */
async function loadEarlierDeletedVersions(
  deps: ImportDeps,
  deckId: string,
  previousRevisionId: string | null,
) {
  const inPrevious = deps.db
    .select({ slideId: slideVersions.slideId })
    .from(slideVersions)
    .where(eq(slideVersions.revisionId, previousRevisionId ?? ''));
  const rows = await deps.db
    .selectDistinctOn([slideVersions.slideId], {
      version: slideVersions,
      number: revisions.number,
    })
    .from(slideVersions)
    .innerJoin(revisions, eq(revisions.id, slideVersions.revisionId))
    .where(
      and(
        eq(revisions.deckId, deckId),
        eq(revisions.status, 'ready'),
        notInArray(slideVersions.slideId, inPrevious),
      ),
    )
    .orderBy(slideVersions.slideId, desc(revisions.number));
  return rows
    .sort((a, b) => b.number - a.number)
    .slice(0, RELINK_MAX_CANDIDATES)
    .map((row) => row.version);
}

/** Upper bound of earlier deleted slides considered for re-linking. */
const RELINK_MAX_CANDIDATES = 500;

/** Removes a revision that never became current, with its files and the slides only it had. */
async function discardRevision(deps: ImportDeps, deckId: string, revisionId: string) {
  await deps.db.transaction(async (tx) => {
    await tx.delete(revisions).where(eq(revisions.id, revisionId));
    await deleteOrphanSlides(tx, deckId);
  });
  await deps.storage.deletePrefix(blobKeys.revisionPrefix(deckId, revisionId));
}
