import type { Comment } from '@slider/shared';
import { isStrokeOnly, strokeOnlyLabel } from '../lib/comment-selectors';
import { CommentMediaView } from '../media/MediaPlayer';
import { CommentBody } from './CommentBody';

/**
 * What a comment says: its recording with transcript (BER-116), then its text. A drawing
 * without text stands in with a label – unless a recording is the content.
 */
export function CommentContent({
  comment,
  bodyClassName,
}: {
  comment: Comment;
  bodyClassName?: string | undefined;
}) {
  const hasText = comment.body.trim() !== '';
  return (
    <>
      <CommentMediaView comment={comment} />
      {hasText || (!comment.media && !isStrokeOnly(comment)) ? (
        <CommentBody body={comment.body} className={bodyClassName} />
      ) : (
        !comment.media && <p className="text-[13px] text-fg-muted">{strokeOnlyLabel(comment)}</p>
      )}
    </>
  );
}
