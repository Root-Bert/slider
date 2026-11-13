import type { AiProposal } from '@slider/shared';
import { useAiProposals } from '@/lib/api';
import { proposalsByComment } from '../lib/proposal-index';

/** The AI's proposals by the comment that asked for them, oldest first (BER-183). */
export function useCommentProposals(deckId: string): (commentId: string) => readonly AiProposal[] {
  const { data } = useAiProposals(deckId);
  return proposalsByComment(data);
}
