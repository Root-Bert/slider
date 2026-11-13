import type { AiProposal } from '@slider/shared';

const NONE: readonly AiProposal[] = [];
const empty = () => NONE;
type Lookup = (commentId: string) => readonly AiProposal[];
// Query results are immutable: share one index across cards, release it with its data array.
const indexes = new WeakMap<readonly AiProposal[], Lookup>();

export function proposalsByComment(data: readonly AiProposal[] | undefined): Lookup {
  if (!data?.length) return empty;
  const cached = indexes.get(data);
  if (cached) return cached;
  const byComment = new Map<string, AiProposal[]>();
  for (let index = data.length - 1; index >= 0; index--) {
    const proposal = data[index]!;
    if (!proposal.commentId) continue;
    const list = byComment.get(proposal.commentId) ?? [];
    list.push(proposal);
    byComment.set(proposal.commentId, list);
  }
  const lookup: Lookup = (commentId) => byComment.get(commentId) ?? NONE;
  indexes.set(data, lookup);
  return lookup;
}
