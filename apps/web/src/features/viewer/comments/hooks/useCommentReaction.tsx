import { COMMENT_REACTIONS, type Comment, type CommentReactionKind } from '@slider/shared';
import { isPendingComment } from '@/lib/api/comment-cache';
import { useReactToComment } from '@/lib/api';
import type { MenuAction } from '@/ui';
import { ReactionGlyph } from '../ReactionGlyph';
import { REACTION_LABELS } from '../lib/reactions';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';

/**
 * The viewer's reaction to a comment (👍 / 👎 / egal) and how to toggle it: the same kind again
 * takes it back, another one replaces it. Anyone who may comment may react; not on comments that
 * aren't saved yet.
 */
export function useCommentReaction(comment: Comment) {
  const { deck, viewer, canComment } = useViewerData();
  const showToast = useViewerToast();
  const react = useReactToComment(deck.id, viewer.author);
  const reactions = comment.reactions ?? [];
  const mine = reactions.find((reaction) => reaction.author.id === viewer.author.id)?.kind ?? null;
  const canReact = canComment && !isPendingComment(comment);
  const toggle = (kind: CommentReactionKind) =>
    react.mutate(
      { commentId: comment.id, kind: mine === kind ? null : kind },
      // Optimistic: if it fails it flips back, so say why.
      { onError: (error) => showToast(error.message, 'danger') },
    );
  const byKind = (kind: CommentReactionKind) =>
    reactions.filter((reaction) => reaction.kind === kind).map((reaction) => reaction.author);
  return { mine, canReact, toggle, byKind };
}

/** The reactions as entries of the comment's ⋯ / context menu. */
export function reactionMenuActions({
  mine,
  canReact,
  toggle,
}: ReturnType<typeof useCommentReaction>): MenuAction[] {
  if (!canReact) return [];
  return COMMENT_REACTIONS.map((kind) => ({
    label: mine === kind ? `${REACTION_LABELS[kind]} zurücknehmen` : REACTION_LABELS[kind],
    icon: <ReactionGlyph kind={kind} active={mine === kind} size={18} className="text-fg-subtle" />,
    onSelect: () => toggle(kind),
  }));
}
