import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { Slide, SlideChange } from '@slider/shared';
import type { Executor } from '../db/client';
import { comments, revisions, slideVersions, type DeckRow } from '../db/schema';
import { fileUrl } from '../storage/blob-storage';

/** Slides of the deck's current revision, in presentation order. */
export async function listSlides(db: Executor, deck: DeckRow): Promise<Slide[]> {
  if (!deck.currentRevisionId) return [];
  const [versions, openCounts, [revision]] = await Promise.all([
    db
      .select()
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, deck.currentRevisionId))
      .orderBy(asc(slideVersions.position)),
    db
      .select({ slideId: comments.slideId, count: count() })
      .from(comments)
      .where(
        and(
          eq(comments.deckId, deck.id),
          isNull(comments.parentId),
          eq(comments.status, 'open'),
          isNull(comments.removedInSourceAt),
        ),
      )
      .groupBy(comments.slideId),
    db
      .select({ diff: revisions.diff })
      .from(revisions)
      .where(eq(revisions.id, deck.currentRevisionId)),
  ]);
  const openCountBySlide = new Map(openCounts.map((row) => [row.slideId, row.count]));
  // How each slide changed against the previous revision (BER-108); none in revision 1.
  const diff = revision?.diff ?? null;
  const changeBySlide = new Map<string, SlideChange>(
    (diff?.slides ?? []).map((entry) => [
      entry.slideId,
      { status: entry.status, moved: entry.moved, confidence: entry.confidence },
    ]),
  );

  return versions.map((version) => ({
    id: version.slideId,
    deckId: deck.id,
    position: version.position,
    title: version.title,
    hidden: version.hidden,
    aspectRatio: version.aspectRatio,
    imageUrl: fileUrl(version.imageKey),
    thumbnailUrl: fileUrl(version.thumbnailKey),
    shapes: version.shapes,
    openCommentCount: openCountBySlide.get(version.slideId) ?? 0,
    change: diff ? (changeBySlide.get(version.slideId) ?? null) : null,
  }));
}

/** Whether `slideId` is part of the deck's current revision. */
export async function isSlideInCurrentRevision(
  db: Executor,
  deck: DeckRow,
  slideId: string,
): Promise<boolean> {
  if (!deck.currentRevisionId) return false;
  const [row] = await db
    .select({ id: slideVersions.id })
    .from(slideVersions)
    .where(
      and(eq(slideVersions.revisionId, deck.currentRevisionId), eq(slideVersions.slideId, slideId)),
    );
  return Boolean(row);
}
