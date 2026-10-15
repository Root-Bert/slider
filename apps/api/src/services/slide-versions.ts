import { and, desc, eq } from 'drizzle-orm';
import type { SlideVersionView } from '@slider/shared';
import type { Executor } from '../db/client';
import { revisions, slideVersions, type DeckRow } from '../db/schema';
import { fileUrl } from '../storage/blob-storage';

/**
 * Every ready version of one slide, newest first – what "Alt/Neu" on a comment needs to show
 * the slide as it was when the comment was written (BER-109). Empty for a slide of another deck.
 */
export async function listSlideVersions(
  db: Executor,
  deck: DeckRow,
  slideId: string,
): Promise<SlideVersionView[]> {
  const rows = await db
    .select({
      revisionId: revisions.id,
      revisionNumber: revisions.number,
      revisionCreatedAt: revisions.createdAt,
      imageKey: slideVersions.imageKey,
      thumbnailKey: slideVersions.thumbnailKey,
      aspectRatio: slideVersions.aspectRatio,
      shapes: slideVersions.shapes,
    })
    .from(slideVersions)
    .innerJoin(revisions, eq(revisions.id, slideVersions.revisionId))
    .where(
      and(
        eq(slideVersions.slideId, slideId),
        eq(revisions.deckId, deck.id),
        eq(revisions.status, 'ready'),
      ),
    )
    .orderBy(desc(revisions.number));
  return rows.map((row) => ({
    revisionId: row.revisionId,
    revisionNumber: row.revisionNumber,
    revisionCreatedAt: row.revisionCreatedAt.toISOString(),
    imageUrl: fileUrl(row.imageKey),
    thumbnailUrl: fileUrl(row.thumbnailKey),
    aspectRatio: row.aspectRatio,
    shapes: row.shapes,
  }));
}
