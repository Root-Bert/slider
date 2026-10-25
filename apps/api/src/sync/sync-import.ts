import { and, asc, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import {
  fingerprintFromShapes,
  matchSlides,
  PptxError,
  relinkDeletedSlides,
  svgForRenderHash,
  trackBoxes,
  type BoxTarget,
  type ParsedSlide,
  type SlideFingerprint,
  type SlideMatchResult,
} from '@slider/pptx';
import { refShape, toSyncSummary, type Anchor, type Shape, type SyncSummary } from '@slider/shared';
import type { Executor } from '../db/client';
import {
  comments,
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
import { deleteOrphanSlides, FINGERPRINT_VERSION, sha256Hex, toShape } from '../import/common';
import { ConversionAborted } from '../import/libreoffice';
import {
  hasPdfRenderer,
  renderSlidePages,
  slideRenderer,
  storeSlideRender,
  type SlidePages,
} from '../import/office-pages';
import type { ImportDeps } from '../import/import-deck';
import { upsertPptxComments, type ImportedSlide } from '../import/pptx-comments';
import { isGoogleSlidesDeck, slideIdsFor, upsertGoogleComments } from '../import/slides-extras';
import type { ImportJob } from '../import/queue';
import { deleteBlobs, storageBlobs } from '../services/blob-deletions';
import { blobKeys } from '../storage/blob-storage';
import { parseFailedMessage } from './errors';
import { DEFAULT_SYNC_POLL_INTERVAL_MS } from '../config';
import { carryShapeIds } from '../import/pdf-boxes';
import { isPdfPage, openDeckFile } from '../import/pdf-deck';
import { PdfTimedOut } from '../import/pdf-jobs';
import { mergeSyncState, syncBackoffMs } from './state';

type SlideVersionRow = typeof slideVersions.$inferSelect;

/**
 * The previous revision's fingerprints computed by *this* code from its stored file – not the
 * hashes stored at its import. Those came from the parser and renderer of back then; after an
 * update that changes either (e.g. slide-number fields left out of the text hash), every slide
 * would look "modified" on the next sync, and without exact hashes the renumber guard of slide
 * matching cannot stop comments from moving to a neighbour. `null` (the stored rows are used)
 * when they already come from this code (`FINGERPRINT_VERSION`) – the usual case, so a sync
 * reads one file, not two – or when the file is gone, cannot be read any more or does not match
 * the stored slides.
 */
async function currentFingerprints(
  deps: ImportDeps,
  deckId: string,
  revisionId: string,
  rows: SlideVersionRow[],
): Promise<SlideFingerprint[] | null> {
  if (rows.length === 0) return null;
  const [revision] = await deps.db
    .select({ pptxKey: revisions.pptxKey, fingerprintVersion: revisions.fingerprintVersion })
    .from(revisions)
    .where(eq(revisions.id, revisionId));
  // Hashed by this code already: parsing and rendering the old file again would change nothing.
  if (revision?.fingerprintVersion === FINGERPRINT_VERSION) return null;
  const bytes = revision?.pptxKey ? await deps.storage.get(revision.pptxKey) : null;
  if (!bytes) return null;
  try {
    const document = await openDeckFile(deps.openPptx, bytes);
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
          sldId: isPdfPage(slide) ? null : slide.sldId,
          position: row.position,
          title: slide.title,
          layoutName: slide.layoutName,
          textHash: slide.textHash,
          shapes: slide.shapes.map(toShape),
          renderHash: sha256Hex(svgForRenderHash(svg)),
          contentHash: slide.contentHash,
          creationId: slide.creationId,
          hidden: slide.hidden,
          sourceSlideId: row.sourceSlideId,
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
    const document = await openDeckFile(deps.openPptx, bytes);
    const { presentation } = document;
    const aspectRatio = presentation.size.cx / presentation.size.cy;
    const extras = (await deps.slidesExtras?.(deck, revision)) ?? null;
    const slideIds = slideIdsFor(extras, presentation.slides);

    const planned: PlannedSlide[] = [];
    // Images of an earlier run cut off before publishing (crash, restart): nothing refers to a
    // pending revision's slides yet, so they go before this run stores its own.
    await storage.deletePrefix(blobKeys.slideRenderPrefix(deckId, revisionId));
    // The SVG is rendered either way: its hash is what slide matching compares (BER-108). The
    // images are stored only after matching, so unchanged slides can keep the ones they have.
    for (const [position, parsed] of presentation.slides.entries()) {
      const svg = await document.renderSlideSvg(parsed);
      const hashed = svgForRenderHash(svg);
      planned.push({
        parsed,
        position,
        sourceSlideId: slideIds?.[position] ?? null,
        imageKey: '',
        thumbnailKey: '',
        shapes: parsed.shapes.map(toShape),
        renderHash: sha256Hex(hashed),
        // Slide numbers and dates are left out of the hash: their old image may show stale ones.
        volatileFields: hashed !== svg,
        renderer: null,
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
        hidden: row.hidden,
        sourceSlideId: row.sourceSlideId,
      });
    };
    const prevFingerprints: SlideFingerprint[] = rebuilt ?? [];
    if (!rebuilt) for (const row of previous) prevFingerprints.push(await toFingerprint(row));
    const fingerprintOf = (slide: PlannedSlide) =>
      fingerprintFromShapes({
        key: String(slide.position),
        // A PDF's pages are matched by what they show: they have no slide id.
        sldId: isPdfPage(slide.parsed) ? null : slide.parsed.sldId,
        position: slide.position,
        title: slide.parsed.title,
        layoutName: slide.parsed.layoutName,
        textHash: slide.parsed.textHash,
        shapes: slide.shapes,
        renderHash: slide.renderHash,
        contentHash: slide.parsed.contentHash,
        creationId: slide.parsed.creationId,
        hidden: slide.parsed.hidden,
        sourceSlideId: slide.sourceSlideId,
      });
    let nextFingerprints = planned.map(fingerprintOf);
    const results = matchSlides(prevFingerprints, nextFingerprints);
    // A PDF's boxes are measured afresh each version: a page matched to one before takes over its
    // boxes' ids, so comments bound to a box stay on it (PowerPoint keeps its shape ids itself).
    if (planned.some((slide) => isPdfPage(slide.parsed))) {
      const previousShapes = new Map(previous.map((row) => [row.slideId, row.shapes]));
      for (const result of results) {
        if (result.prevKey === null || result.nextKey === null) continue;
        const slide = planned[Number(result.nextKey)];
        const before = previousShapes.get(result.prevKey);
        if (slide && before) slide.shapes = carryShapeIds(before, slide.shapes);
      }
      nextFingerprints = planned.map(fingerprintOf);
    }
    // Where every box of the previous revision went: comments bound to one follow it (BER-111).
    const boxes = trackBoxes(prevFingerprints, nextFingerprints, results);
    const rendered = await storeImages(deps, {
      deck,
      revision,
      bytes,
      aspectRatio,
      planned,
      previous,
      results,
      renderSlide: (parsed) => document.renderSlideSvg(parsed),
    });

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
                ...(result.hiddenChanged ? { hiddenChanged: result.hiddenChanged } : {}),
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
            pptxSldId: isPdfPage(slide.parsed) ? null : slide.parsed.sldId,
            hidden: slide.parsed.hidden,
            title: slide.parsed.title,
            layoutName: slide.parsed.layoutName,
            textHash: slide.parsed.textHash,
            contentHash: slide.parsed.contentHash,
            creationId: slide.parsed.creationId,
            sourceSlideId: slide.sourceSlideId,
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
      // A Google Slides export's comments are Google's (BER-157), merged with Drive's.
      const commentCounts = isGoogleSlidesDeck(deck)
        ? await upsertGoogleComments(
            tx,
            deckId,
            extras,
            presentation,
            slideIds,
            slidesBySldId,
            now,
            deps.log,
          )
        : await upsertPptxComments(tx, deckId, presentation.comments, slidesBySldId, now);
      await carryBoxComments(tx, {
        deckId,
        previous: prevFingerprints,
        boxes,
        slideIdAt,
        shapesAt: (position) => planned[position]?.shapes ?? [],
      });
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
          fingerprintVersion: FINGERPRINT_VERSION,
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
    // A PDF cut off after its deadline would be cut off again: skipped until it changes, too.
    const parseFailed =
      error instanceof PptxError ||
      error instanceof ImportCrashLoop ||
      error instanceof PdfTimedOut;
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
  // Retried by the hourly sweep if the store fails now (`blob_deletions`).
  await deleteBlobs(deps, [
    { store: 'storage', key: blobKeys.revisionPrefix(deckId, revisionId), prefix: true },
  ]);
}

type PlannedSlide = {
  parsed: ParsedSlide;
  position: number;
  /** Google Slides' `objectId` (BER-157); `null` elsewhere or when it could not be read. */
  sourceSlideId: string | null;
  imageKey: string;
  thumbnailKey: string;
  shapes: Shape[];
  renderHash: string;
  /** Its SVG has slide-number or date fields, which the render hash leaves out. */
  volatileFields: boolean;
  renderer: SlideRenderer | null;
};

/**
 * Whether a matched slide may keep the previous version's image files instead of new copies:
 * it looks exactly the same (the *stored* hash – the one of the code that drew an SVG preview –
 * equals the new one, nothing the render cannot see changed, same slide size, no slide-number or
 * date field the hash leaves out), and its picture
 * is as good as a new one would be (a PDF renderer drew it, the slide is hidden and gets the
 * preview anyway, or there is nothing better than the preview to try).
 */
function keepsImages(
  row: SlideVersionRow,
  slide: PlannedSlide,
  aspectRatio: number,
  canRenderBetter: boolean,
): boolean {
  if (!row.imageKey || !row.thumbnailKey || row.renderHash !== slide.renderHash) return false;
  // The hash ignores slide numbers and dates; the stored picture shows the old ones (an insert
  // above renumbers every later slide without changing its hash).
  if (slide.volatileFields) return false;
  if (row.contentHash !== slide.parsed.contentHash) return false;
  if (Math.abs(row.aspectRatio - aspectRatio) > 1e-9) return false;
  return (
    row.renderer === 'office' ||
    row.renderer === 'libreoffice' ||
    row.renderer === 'pdf' ||
    slide.parsed.hidden ||
    !canRenderBetter
  );
}

/**
 * Fills in each planned slide's image keys and renderer. Slides matched as unchanged (or only
 * moved) with an identical render keep the previous version's files: the same keys in two
 * versions. Every code path that deletes slide images checks that no other version still uses
 * them (`rerender`) or only touches the pending revision's own prefix (a failed import), so the
 * shared files stay. Only when some slide needs a new picture is the PDF drawn at all. Returns
 * why Office was not used, as the revision stores it.
 */
async function storeImages(
  deps: ImportDeps,
  input: {
    deck: typeof decks.$inferSelect;
    revision: typeof revisions.$inferSelect;
    bytes: Uint8Array;
    aspectRatio: number;
    planned: PlannedSlide[];
    previous: SlideVersionRow[];
    results: readonly SlideMatchResult[];
    renderSlide: (parsed: ParsedSlide) => Promise<string>;
  },
): Promise<Pick<SlidePages, 'officeFailure'>> {
  const { deck, revision, planned } = input;
  const previousById = new Map(input.previous.map((row) => [row.slideId, row]));
  const canRenderBetter = hasPdfRenderer(deps, deck);
  const kept = new Map<number, SlideVersionRow>();
  for (const result of input.results) {
    if (result.prevKey === null || result.nextKey === null) continue;
    if (result.status !== 'unchanged' && result.status !== 'moved') continue;
    const row = previousById.get(result.prevKey);
    const slide = planned[Number(result.nextKey)];
    if (row && slide && keepsImages(row, slide, input.aspectRatio, canRenderBetter))
      kept.set(slide.position, row);
  }

  let rendered: SlidePages;
  if (kept.size === planned.length) {
    // Nothing looks different: no PDF to draw, and Office's earlier verdict still applies.
    const [last] = deck.currentRevisionId
      ? await deps.db
          .select({ officeFailure: revisions.officeFailure })
          .from(revisions)
          .where(eq(revisions.id, deck.currentRevisionId))
      : [];
    rendered = { renderer: null, pages: [], officeFailure: last?.officeFailure ?? null };
  } else {
    rendered = await renderSlidePages(
      deps,
      deck,
      revision,
      input.bytes,
      planned.map(({ parsed }) => parsed),
    );
  }

  for (const slide of planned) {
    const page = rendered.pages[slide.position] ?? null;
    const row = kept.get(slide.position);
    if (row) {
      // The PDF was drawn for other slides; this slide's new page is not needed.
      if (page) await deleteBlobs(deps, storageBlobs([page.imageKey, page.thumbnailKey]));
      slide.imageKey = row.imageKey;
      slide.thumbnailKey = row.thumbnailKey;
      slide.renderer = row.renderer;
      continue;
    }
    const svg = page ? '' : await input.renderSlide(slide.parsed);
    const keys = await storeSlideRender(deps.storage, deck.id, revision.id, svg, page);
    slide.imageKey = keys.imageKey;
    slide.thumbnailKey = keys.thumbnailKey;
    slide.renderer = slideRenderer(rendered, page);
  }
  return { officeFailure: rendered.officeFailure };
}

/**
 * Comments bound to a box follow the box (BER-111): when {@link trackBoxes} found it on another
 * slide (cut and pasted, or its old slide was deleted) or under another id, the thread moves
 * there and its reference points at the shape's new id. A box that is gone leaves its comment
 * where it is – on a deleted slide that is "Gelöschte Folien". Slider comments only: PowerPoint
 * comments follow what the file says (`upsertPptxComments`). The stored point or box stays as it
 * was; the viewer places it on the shape (and shifts drawings along with it).
 */
async function carryBoxComments(
  tx: Executor,
  input: {
    deckId: string;
    previous: readonly SlideFingerprint[];
    boxes: ReadonlyMap<string, ReadonlyMap<string, BoxTarget | null>>;
    slideIdAt: (position: number) => string;
    shapesAt: (position: number) => readonly Shape[];
  },
): Promise<void> {
  const shapesBySlide = new Map(
    input.previous.map((fp) => [fp.key, (fp.shapes ?? []) as readonly Shape[]]),
  );
  const slideIds = [...shapesBySlide.keys()];
  if (slideIds.length === 0) return;
  const roots = await tx
    .select({ id: comments.id, slideId: comments.slideId, anchor: comments.anchor })
    .from(comments)
    .where(
      and(
        eq(comments.deckId, input.deckId),
        eq(comments.source, 'app'),
        isNull(comments.parentId),
        inArray(comments.slideId, slideIds),
      ),
    );
  for (const root of roots) {
    const { anchor, slideId: from } = root;
    if ((anchor.type !== 'point' && anchor.type !== 'rect') || !anchor.shapeRef || !from) continue;
    const shape = refShape(shapesBySlide.get(from) ?? [], anchor.shapeRef);
    if (!shape) continue;
    const target = input.boxes.get(from)?.get(shape.id);
    if (!target) continue;
    const position = Number(target.key);
    const to = input.slideIdAt(position);
    const found = input.shapesAt(position).find((candidate) => candidate.id === target.shapeId);
    if (!found || (to === from && found.id === anchor.shapeRef.shapeId)) continue;
    const moved: Anchor = {
      ...anchor,
      shapeRef: { ...anchor.shapeRef, shapeId: found.id, name: found.name },
    };
    await tx.update(comments).set({ slideId: to, anchor: moved }).where(eq(comments.id, root.id));
    // Replies live on their root's slide.
    if (to !== from)
      await tx.update(comments).set({ slideId: to }).where(eq(comments.parentId, root.id));
  }
}
