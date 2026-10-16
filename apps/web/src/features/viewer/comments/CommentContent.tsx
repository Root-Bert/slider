import type { Comment } from '@slider/shared';
import { isStrokeOnly, strokeOnlyLabel } from './lib/comment-selectors';
import { CommentImageView } from '../media/CommentImageView';
import { CommentMediaView } from '../media/MediaPlayer';
import { CommentBody } from './CommentBody';

/**
 * What a comment says: its drawn image, its recording (BER-116), then its text.
 * A drawing on the slide without text stands in with a label – unless an image or recording is
 * the content.
 */
export function CommentContent({
  comment,
  bodyClassName,
}: {
  comment: Comment;
  bodyClassName?: string | undefined;
}) {
  const hasText = comment.body.trim() !== '';
  const hasMedia = !!comment.media || !!comment.image;
  return (
    <>
      {comment.image && <CommentImageView image={comment.image} author={comment.author.name} />}
      <CommentMediaView comment={comment} />
      {hasText || (!hasMedia && !isStrokeOnly(comment)) ? (
        <CommentBody body={comment.body} className={bodyClassName} />
      ) : (
        !hasMedia && <p className="text-[13px] text-fg-muted">{strokeOnlyLabel(comment)}</p>
      )}
    </>
  );
}
