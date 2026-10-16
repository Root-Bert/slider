import type { Comment, CreateCommentInput } from '@slider/shared';

/**
 * Request body for a reply. Replies carry no mark of their own – the API rejects any anchor but
 * `slide` and takes the slide from the root, so point, frame, gap and PowerPoint roots all work.
 */
export const replyInput = (root: Comment, body: string): CreateCommentInput => ({
  slideId: root.slideId,
  parentId: root.id,
  body: body.trim(),
  anchor: { type: 'slide' },
  strokes: [],
});

/** Number of newest replies the thread panel shows before "N frühere Antworten anzeigen" (B4). */
export const VISIBLE_REPLIES = 3;

/** Splits a thread's replies (oldest first) into collapsed older ones and the visible tail. */
export function collapseReplies<T>(
  replies: readonly T[],
  showAll: boolean,
  keep = VISIBLE_REPLIES,
): { hidden: number; visible: readonly T[] } {
  if (showAll || replies.length <= keep) return { hidden: 0, visible: replies };
  return { hidden: replies.length - keep, visible: replies.slice(-keep) };
}
