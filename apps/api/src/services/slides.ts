import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { Slide } from '@slider/shared';
import type { Executor } from '../db/client';
import { comments, slideVersions, type DeckRow } from '../db/schema';
import { fileUrl } from '../storage/blob-storage';

/** Slides of the deck's current revision, in presentation order. */
export async function listSlides(db: Executor, deck: DeckRow): Promise<Slide[]> {
  if (!deck.currentRevisionId) return [];
  const [versions, openCounts] = await Promise.all([
    db
      .select()
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, deck.currentRevisionId))
      .orderBy(asc(slideVersions.position)),
    db
      .select({ slideId: comments.slideId, count: count() })
      .from(comments)
      .where(
        and(eq(comments.deckId, deck.id), isNull(comments.parentId), eq(comments.status, 'open')),
      )
      .groupBy(comments.slideId),
  ]);
  const openCountBySlide = new Map(openCounts.map((row) => [row.slideId, row.count]));

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
