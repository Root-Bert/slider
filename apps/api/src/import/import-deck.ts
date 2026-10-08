import { and, eq, inArray } from 'drizzle-orm';
import type { ImportState } from '@slider/shared';
import { PptxError } from '@slider/pptx';
import type { Clock } from '../clock';
import type { Database, Executor } from '../db/client';
import { decks, revisions, slides, slideVersions } from '../db/schema';
import type { Logger } from '../logger';
import { blobKeys, type BlobStorage } from '../storage/blob-storage';
import { importSyncRevision } from '../sync/sync-import';
import { deleteOrphanSlides, sha256Hex, toShape } from './common';
import type { PptxToPdf } from './libreoffice';
import { renderSlidePages, slideRenderer, storeSlideRender, type OfficePdf } from './office-pages';
import type { OpenPptx } from './pptx';
import { upsertPptxComments, type ImportedSlide } from './pptx-comments';
import type { ImportJob } from './queue';
import type { RenderProgress } from './render-progress';
import { rerenderJob } from './rerender';

export interface ImportDeps {
  db: Database;
  storage: BlobStorage;
  openPptx: OpenPptx;
  clock: Clock;
  log: Logger;
  /** Office's rendering of cloud decks (BER-94); without it every slide uses the SVG preview. */
  officePdf?: OfficePdf;
  /** LibreOffice's rendering of any deck (BER-94); `null`/absent when it is not installed. */
  libreOfficePdf?: PptxToPdf | null;
  /** Progress of background re-renders, shown by `GET /decks/:id/status`. */
  renderProgress?: RenderProgress;
}

const PPTX_ERROR_MESSAGES: Record<PptxError['code'], string> = {
  encrypted: 'Die Datei ist passwortgeschützt. Bitte ohne Passwort speichern und erneut hochladen.',
  not_pptx: 'Die Datei ist keine PowerPoint (.pptx).',
  corrupt: 'Die Datei ist beschädigt und konnte nicht gelesen werden.',
};
const GENERIC_FAILURE = 'Import fehlgeschlagen. Bitte erneut versuchen.';

/** Thrown when the deck was deleted while its import was running. */
class DeckGoneError extends Error {}

/**
 * Turns an uploaded PPTX into slides, renders and comments (BER-94, BER-97).
 * Never throws: every outcome ends in `ready` or `failed` on the deck.
 */
export async function importDeck(deps: ImportDeps, job: ImportJob): Promise<void> {
  if (job.kind === 'sync') {
    await importSyncRevision(deps, job);
    return;
  }
  if (job.kind === 'rerender') {
    await rerenderJob(deps, job);
    return;
  }
  try {
    await runImport(deps, job);
  } catch (error) {
    if (error instanceof DeckGoneError) {
      await deps.storage.deletePrefix(blobKeys.deckPrefix(job.deckId));
      return;
    }
    if (!(error instanceof PptxError)) deps.log.error(`Import of deck ${job.deckId} failed`, error);
    const message = error instanceof PptxError ? PPTX_ERROR_MESSAGES[error.code] : GENERIC_FAILURE;
    await setImportState(
      deps,
      job.deckId,
      { status: 'failed', error: message },
      { touch: true },
    ).catch(() => {});
  }
}

async function runImport(deps: ImportDeps, { deckId, revisionId }: ImportJob): Promise<void> {
  const { db, storage } = deps;
  const running = (step: ImportState & { status: 'running' }) => setImportState(deps, deckId, step);

  await running({ status: 'running', step: 'received', progress: null });
  const [revision] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.deckId, deckId)));
  if (!revision) throw new DeckGoneError();
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId));
  if (!deck) throw new DeckGoneError();
  const bytes = revision.pptxKey ? await storage.get(revision.pptxKey) : null;
  if (!bytes) throw new Error(`Original file of revision ${revisionId} is missing`);

  await running({ status: 'running', step: 'parsing', progress: null });
  const document = await deps.openPptx(bytes);
  const { presentation } = document;
  const aspectRatio = presentation.size.cx / presentation.size.cy;

  const planned = presentation.slides.map((parsed) => ({
    parsed,
    slideId: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
    // Placeholder until the slide is rendered below.
    imageKey: blobKeys.slideRender(deckId, revisionId, 'svg'),
    shapes: parsed.shapes.map(toShape),
  }));

  await db.transaction(async (tx) => {
    await clearRevisionSlides(tx, deckId, revisionId);
    await tx
      .update(revisions)
      .set({ slideWidthEmu: presentation.size.cx, slideHeightEmu: presentation.size.cy })
      .where(eq(revisions.id, revisionId));
    if (planned.length === 0) return;
    await tx.insert(slides).values(planned.map(({ slideId }) => ({ id: slideId, deckId })));
    await tx.insert(slideVersions).values(
      planned.map(({ parsed, slideId, versionId, imageKey, shapes }, position) => ({
        id: versionId,
        slideId,
        revisionId,
        position,
        pptxSldId: parsed.sldId,
        hidden: parsed.hidden,
        title: parsed.title,
        layoutName: parsed.layoutName,
        textHash: parsed.textHash,
        imageKey,
        thumbnailKey: imageKey,
        aspectRatio,
        shapes,
      })),
    );
  });
  await storage.deletePrefix(blobKeys.slideRenderPrefix(deckId, revisionId)).catch(() => {});

  const total = planned.length;
  await running({ status: 'running', step: 'rendering', progress: { done: 0, total } });
  const rendered = await renderSlidePages(
    deps,
    deck,
    revision,
    bytes,
    planned.map(({ parsed }) => parsed),
  );
  await db
    .update(revisions)
    .set({ officeFailure: rendered.officeFailure })
    .where(eq(revisions.id, revisionId));
  for (const [done, slide] of planned.entries()) {
    await running({ status: 'running', step: 'rendering', progress: { done, total } });
    // The SVG is rendered either way: its hash is what slide matching compares (BER-108).
    const svg = await document.renderSlideSvg(slide.parsed);
    const page = rendered.pages[done] ?? null;
    const keys = await storeSlideRender(storage, deckId, revisionId, svg, page);
    await db
      .update(slideVersions)
      .set({ ...keys, renderHash: sha256Hex(svg), renderer: slideRenderer(rendered, page) })
      .where(eq(slideVersions.id, slide.versionId));
  }

  await running({ status: 'running', step: 'comments', progress: null });
  const slidesBySldId = new Map<number, ImportedSlide>(
    planned.map(({ parsed, slideId, shapes }) => [parsed.sldId, { slideId, shapes }]),
  );
  await db.transaction((tx) =>
    upsertPptxComments(tx, deckId, presentation.comments, slidesBySldId, deps.clock.now()),
  );

  await setImportState(deps, deckId, { status: 'ready' }, { touch: true });
}

/**
 * Makes a retried import start from scratch instead of duplicating slides. Slides with comments
 * are kept (deleting them would cascade to the comments).
 */
async function clearRevisionSlides(
  db: Executor,
  deckId: string,
  revisionId: string,
): Promise<void> {
  await db.delete(slideVersions).where(eq(slideVersions.revisionId, revisionId));
  await deleteOrphanSlides(db, deckId);
}

async function setImportState(
  deps: ImportDeps,
  deckId: string,
  state: ImportState,
  options: { touch?: boolean } = {},
): Promise<void> {
  const updated = await deps.db
    .update(decks)
    .set({ importState: state, ...(options.touch ? { updatedAt: deps.clock.now() } : {}) })
    .where(eq(decks.id, deckId))
    .returning({ id: decks.id });
  if (updated.length === 0) throw new DeckGoneError();
}

/**
 * Finds imports interrupted by a restart and queues them again, so no deck hangs in
 * "Import läuft" forever. Revisions without an original file (demo data) are skipped.
 */
export async function findInterruptedImports(db: Database): Promise<ImportJob[]> {
  const rows = await db
    .select({
      deckId: decks.id,
      revisionId: revisions.id,
      importState: decks.importState,
      pptxKey: revisions.pptxKey,
    })
    .from(decks)
    .innerJoin(revisions, eq(revisions.id, decks.currentRevisionId));
  const jobs = rows.filter(
    (row) =>
      row.pptxKey !== null &&
      (row.importState.status === 'queued' || row.importState.status === 'running'),
  );
  if (jobs.length > 0) {
    await db
      .update(decks)
      .set({ importState: { status: 'queued' } })
      .where(
        inArray(
          decks.id,
          jobs.map((job) => job.deckId),
        ),
      );
  }
  // Sync imports (BER-107) run beside a usable deck; they only need to be queued again.
  const pending = await db
    .select({ deckId: revisions.deckId, revisionId: revisions.id })
    .from(revisions)
    .where(eq(revisions.status, 'pending'));
  return [
    ...jobs.map(({ deckId, revisionId }) => ({ deckId, revisionId, kind: 'initial' as const })),
    ...pending.map(({ deckId, revisionId }) => ({ deckId, revisionId, kind: 'sync' as const })),
  ];
}
