import { and, eq, isNull, not, sql, type SQL } from 'drizzle-orm';
import { comments } from '../db/schema';

/**
 * A drawing made without a comment – no text, recording, image or replies, just strokes. The
 * viewer shows it on the slide without a card (`isBareDrawing` in the web app), so it is no open
 * comment either.
 */
const isBareDrawing = sql`(
  btrim(${comments.body}) = ''
  and jsonb_array_length(${comments.strokes}) > 0
  and not exists (select 1 from comments as reply where reply.parent_id = ${comments.id})
  and not exists (select 1 from media where media.comment_id = ${comments.id})
)`;

/**
 * Open feedback, as every count (deck card, slide list, viewer) counts it: open roots not deleted
 * in the PowerPoint file and not bare drawings.
 */
export const isOpenComment = (): SQL =>
  and(
    isNull(comments.parentId),
    eq(comments.status, 'open'),
    isNull(comments.removedInSourceAt),
    not(isBareDrawing),
  )!;
