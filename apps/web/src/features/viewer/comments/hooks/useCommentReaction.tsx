import {
  COMMENT_REACTIONS,
  type AiProposal,
  type Comment,
  type CommentReactionKind,
} from '@slider/shared';
import { useReactToComment, useReactToProposal } from '@/lib/api';
import type { MenuAction } from '@/ui';
import { ReactionGlyph } from '../ReactionGlyph';
import { REACTION_LABELS } from '../lib/reactions';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';

/** What takes reactions: a comment, or an answer of the AI in its thread. */
export type ReactionTarget =
  { comment: Comment; proposal?: undefined } | { proposal: AiProposal; comment?: undefined };

/**
 * The viewer's reaction to a comment or to an answer of the AI (👍 / 👎 / egal) and how to toggle
 * it: the same kind again takes it back, another one replaces it. Anyone who may comment may
 * react; also on a comment that isn't saved yet (sent after it).
 */
export function useReaction({ comment, proposal }: ReactionTarget) {
  const { deck, viewer, canComment } = useViewerData();
  const showToast = useViewerToast();
  const reactToComment = useReactToComment(deck.id, viewer.author);
  const reactToProposal = useReactToProposal(deck.id, viewer.author);
  const reactions = (comment ?? proposal).reactions ?? [];
  const mine = reactions.find((reaction) => reaction.author.id === viewer.author.id)?.kind ?? null;
  const canReact = canComment;
  const toggle = (picked: CommentReactionKind) => {
    const kind = mine === picked ? null : picked;
    // Optimistic: if it fails it flips back, so say why.
    const options = { onError: (error: Error) => showToast(error.message, 'danger') };
    if (comment) reactToComment.mutate({ commentId: comment.id, kind }, options);
    else reactToProposal.mutate({ proposalId: proposal.id, kind }, options);
  };
  const byKind = (kind: CommentReactionKind) =>
    reactions.filter((reaction) => reaction.kind === kind).map((reaction) => reaction.author);
  return { mine, canReact, toggle, byKind };
}

export const useCommentReaction = (comment: Comment) => useReaction({ comment });

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
