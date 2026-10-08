import { and, asc, desc, eq, notInArray } from 'drizzle-orm';
import {
  fingerprintFromShapes,
  matchSlides,
  PptxError,
  relinkDeletedSlides,
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
import { deleteOrphanSlides, sha256Hex, toShape } from '../import/common';
import { renderSlidePages, slideRenderer, storeSlideRender } from '../import/office-pages';
import type { ImportDeps } from '../import/import-deck';
import { upsertPptxComments, type ImportedSlide } from '../import/pptx-comments';
import type { ImportJob } from '../import/queue';
import { blobKeys } from '../storage/blob-storage';
import { parseFailedMessage } from './errors';
import { mergeSyncState } from './state';

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

  try {
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
        renderHash: sha256Hex(svg),
        renderer: slideRenderer(rendered, page),
      });
    }

    const previousRevisionId = deck.currentRevisionId;
    const previous = previousRevisionId
      ? await db
          .select()
          .from(slideVersions)
          .where(eq(slideVersions.revisionId, previousRevisionId))
          .orderBy(asc(slideVersions.position))
      : [];
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
      });
    };
    const prevFingerprints: SlideFingerprint[] = [];
    for (const row of previous) prevFingerprints.push(await toFingerprint(row));
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
      });
    });
    deps.log.info(`Deck ${deckId}: revision ${revision.number} imported`);
  } catch (error) {
    if (!(error instanceof PptxError)) {
      deps.log.error(`Sync import of deck ${deckId} revision ${revisionId} failed`, error);
    }
    await discardRevision(deps, deckId, revisionId).catch((cleanupError: unknown) =>
      deps.log.error(`Cleanup of revision ${revisionId} failed`, cleanupError),
    );
    const now = clock.now();
    await mergeSyncState(db, deckId, {
      lastSyncError: {
        code: error instanceof PptxError ? 'parse_failed' : 'internal',
        message: parseFailedMessage(error),
        at: now.toISOString(),
      },
      failedToken:
        revision.sourceChangeToken ??
        (revision.contentSha256 ? `sha256:${revision.contentSha256}` : null),
      importingRevisionId: null,
      pending: null,
    }).catch(() => {});
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
