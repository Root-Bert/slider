import type { Comment } from '@slider/shared';
import { isStrokeOnly, strokeOnlyLabel } from './lib/comment-selectors';
import { CommentImagesView } from '../media/CommentImageView';
import { CommentMediaView } from '../media/MediaPlayer';
import { CommentBody } from './CommentBody';

/**
 * What a comment says: its images (drawn, pasted or picked), its recording (BER-116), then its
 * text. A drawing on the slide without text stands in with a label – unless an image or recording
 * is the content.
 */
export function CommentContent({
  comment,
  bodyClassName,
}: {
  comment: Comment;
  bodyClassName?: string | undefined;
}) {
  const hasText = comment.body.trim() !== '';
  const images = comment.images ?? [];
  const hasMedia = !!comment.media || images.length > 0;
  return (
    <>
      <CommentImagesView images={images} author={comment.author.name} />
      <CommentMediaView comment={comment} />
      {hasText || (!hasMedia && !isStrokeOnly(comment)) ? (
        <CommentBody body={comment.body} className={bodyClassName} />
      ) : (
        !hasMedia && <p className="text-body text-fg-muted">{strokeOnlyLabel(comment)}</p>
      )}
    </>
  );
}
