import type { Comment } from '@slider/shared';
import { Icon, type IconSize } from '@/ui';
import { commentPreview, previewIcon } from './lib/comment-selectors';

/**
 * A comment in one line of running text (compact cards, lists): a recording or bare drawing gets
 * its icon in front – the recorder's and the pen's, never an emoji – then `commentPreview`.
 */
export function CommentPreview({
  comment,
  iconSize = 'sm',
}: {
  comment: Comment;
  iconSize?: IconSize;
}) {
  const icon = previewIcon(comment);
  return (
    <>
      {icon && <Icon name={icon} size={iconSize} className="mr-1 inline-block align-[-0.125em]" />}
      {commentPreview(comment)}
    </>
  );
}
