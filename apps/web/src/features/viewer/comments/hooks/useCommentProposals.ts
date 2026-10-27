import type { AiProposal } from '@slider/shared';
import { useAiProposals } from '@/lib/api';

const NONE: readonly AiProposal[] = [];

/** The AI's proposals by the comment that asked for them, oldest first (BER-183). */
export function useCommentProposals(
  deckId: string,
): (commentId: string) => readonly AiProposal[] {
  const { data } = useAiProposals(deckId);
  const byComment = new Map<string, AiProposal[]>();
  for (const proposal of [...(data ?? [])].reverse()) {
    if (!proposal.commentId) continue;
    const list = byComment.get(proposal.commentId) ?? [];
    list.push(proposal);
    byComment.set(proposal.commentId, list);
  }
  return (commentId) => byComment.get(commentId) ?? NONE;
}
