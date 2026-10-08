import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { DeckStatus, DeletedSlide, Revision, RevisionDiff } from '@slider/shared';
import type { Executor } from '../db/client';
import { comments, revisions, slideVersions, type DeckRow } from '../db/schema';
import { notFound } from '../http/errors';
import { fileUrl } from '../storage/blob-storage';
import { withMedia } from './comments';
import { toDeckSync } from './deck-sync';

/** Revisions of a deck, newest first (BER-107). Pending ones are being imported right now. */
export async function listRevisions(db: Executor, deck: DeckRow): Promise<Revision[]> {
  const rows = await db
    .select({
      id: revisions.id,
      number: revisions.number,
      createdAt: revisions.createdAt,
      status: revisions.status,
      trigger: revisions.trigger,
      summary: revisions.summary,
    })
    .from(revisions)
    .where(eq(revisions.deckId, deck.id))
    .orderBy(desc(revisions.number));
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    trigger: row.trigger,
    isCurrent: row.id === deck.currentRevisionId,
    summary: row.summary,
  }));
}

const revisionNotFound = () => notFound('Diese Version gibt es nicht (mehr).');

/** What changed in a revision against the one before; `latest` means the current revision. */
export async function getRevisionDiff(
  db: Executor,
  deck: DeckRow,
  revisionIdOrLatest: string,
): Promise<RevisionDiff> {
  const revisionId = revisionIdOrLatest === 'latest' ? deck.currentRevisionId : revisionIdOrLatest;
  if (!revisionId) throw revisionNotFound();
  const [revision] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.deckId, deck.id)));
  if (!revision) throw revisionNotFound();
  const diff = revision.diff;
  const deleted = diff?.deleted ?? [];
  const deletedSlides = await loadDeletedSlides(
    db,
    deck.id,
    new Map(deleted.map((entry) => [entry.slideId, entry])),
  );
  return {
    revisionId: revision.id,
    number: revision.number,
    previousRevisionId: diff?.previousRevisionId || null,
    slides: diff?.slides ?? [],
    deletedSlides,
    summary: revision.summary,
  };
}

/**
 * Every slide that is not in the current revision any more, with its last version and its
 * comments – across all revisions, so no comment is ever out of reach (BER-109).
 */
export async function listDeletedSlides(db: Executor, deck: DeckRow): Promise<DeletedSlide[]> {
  if (!deck.currentRevisionId) return [];
  const current = db
    .select({ slideId: slideVersions.slideId })
    .from(slideVersions)
    .where(eq(slideVersions.revisionId, deck.currentRevisionId));
  const gone = await db
    .selectDistinct({ slideId: slideVersions.slideId })
    .from(slideVersions)
    .innerJoin(revisions, eq(revisions.id, slideVersions.revisionId))
    .where(
      and(
        eq(revisions.deckId, deck.id),
        eq(revisions.status, 'ready'),
        notInArray(slideVersions.slideId, current),
      ),
    );
  // Confidence and position come from the diff of the revision that removed the slide.
  const diffs = await db
    .select({ diff: revisions.diff })
    .from(revisions)
    .where(and(eq(revisions.deckId, deck.id), eq(revisions.status, 'ready')))
    .orderBy(asc(revisions.number));
  const info = new Map<string, { previousPosition: number; confidence: number } | null>(
    gone.map((row) => [row.slideId, null]),
  );
  for (const { diff } of diffs) {
    for (const entry of diff?.deleted ?? []) {
      if (info.has(entry.slideId)) info.set(entry.slideId, entry);
    }
  }
  return loadDeletedSlides(db, deck.id, info);
}

async function loadDeletedSlides(
  db: Executor,
  deckId: string,
  entries: ReadonlyMap<string, { previousPosition: number; confidence: number } | null>,
): Promise<DeletedSlide[]> {
  const slideIds = [...entries.keys()];
  if (slideIds.length === 0) return [];
  const [versions, commentRows] = await Promise.all([
    db
      .select({
        slideId: slideVersions.slideId,
        position: slideVersions.position,
        title: slideVersions.title,
        imageKey: slideVersions.imageKey,
        thumbnailKey: slideVersions.thumbnailKey,
        aspectRatio: slideVersions.aspectRatio,
        revisionNumber: revisions.number,
      })
      .from(slideVersions)
      .innerJoin(revisions, eq(revisions.id, slideVersions.revisionId))
      .where(
        and(
          inArray(slideVersions.slideId, slideIds),
          eq(revisions.deckId, deckId),
          eq(revisions.status, 'ready'),
        ),
      )
      .orderBy(desc(revisions.number)),
    db
      .select()
      .from(comments)
      .where(and(eq(comments.deckId, deckId), inArray(comments.slideId, slideIds)))
      .orderBy(asc(comments.createdAt), asc(comments.id)),
  ]);
  const lastVersion = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    if (!lastVersion.has(version.slideId)) lastVersion.set(version.slideId, version);
  }
  const commentDtos = await withMedia(db, commentRows);
  const result: DeletedSlide[] = [];
  for (const [slideId, entry] of entries) {
    const version = lastVersion.get(slideId);
    if (!version) continue;
    result.push({
      slideId,
      title: version.title,
      previousPosition: entry?.previousPosition ?? version.position,
      imageUrl: fileUrl(version.imageKey),
      thumbnailUrl: fileUrl(version.thumbnailKey),
      aspectRatio: version.aspectRatio,
      lastRevisionNumber: version.revisionNumber,
      confidence: entry?.confidence ?? 1,
      comments: commentDtos.filter((comment) => comment.slideId === slideId),
    });
  }
  return result.sort((a, b) => a.previousPosition - b.previousPosition);
}

/** `GET /decks/:id/status`: two indexed lookups, safe to poll every few seconds. */
export async function getDeckStatus(
  db: Executor,
  deck: DeckRow,
  options: { forGuest: boolean },
): Promise<DeckStatus> {
  const [[current], [pending]] = await Promise.all([
    deck.currentRevisionId
      ? db
          .select({ number: revisions.number, summary: revisions.summary })
          .from(revisions)
          .where(eq(revisions.id, deck.currentRevisionId))
      : [],
    db
      .select({ createdAt: revisions.createdAt })
      .from(revisions)
      .where(and(eq(revisions.deckId, deck.id), eq(revisions.status, 'pending')))
      .orderBy(asc(revisions.createdAt))
      .limit(1),
  ]);
  return {
    deckId: deck.id,
    revisionNumber: current?.number ?? 0,
    currentRevisionId: deck.currentRevisionId,
    updatedAt: deck.updatedAt.toISOString(),
    import: deck.importState,
    sync: toDeckSync(deck, {
      pendingRevisionAt: pending?.createdAt ?? null,
      summary: current?.summary ?? null,
      forGuest: options.forGuest,
    }),
  };
}
