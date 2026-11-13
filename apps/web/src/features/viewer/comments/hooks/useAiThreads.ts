import { useMemo } from 'react';
import { useAiProposals } from '@/lib/api';
import { useViewerData } from '../../state/viewer-data';

export interface AiThreads {
  /** Threads whose latest answer asks back: they wait for the people – the "KI" filter. */
  asking: ReadonlySet<string>;
  /** Threads the AI is working on right now – card, line and mark show it. */
  working: ReadonlySet<string>;
  /** Threads the AI answered in at all (a dropped answer aside) – its avatar's filter. */
  answered: ReadonlySet<string>;
}

/**
 * The deck's threads by what the AI did in them (BER-183). A proposal hangs on the comment that
 * asked (root or reply); this maps it to its thread.
 */
export function useAiThreads(): AiThreads {
  const { deck, threads } = useViewerData();
  const { data: proposals } = useAiProposals(deck.id);
  return useMemo(() => {
    const threadOf = new Map<string, string>();
    for (const thread of threads) {
      threadOf.set(thread.root.id, thread.id);
      for (const reply of thread.replies) threadOf.set(reply.id, thread.id);
    }
    const working = new Set<string>();
    const answered = new Set<string>();
    const asking = new Set<string>();
    /** Each thread's latest finished answer. */
    const last = new Map<string, NonNullable<typeof proposals>[number]>();
    for (const proposal of proposals ?? []) {
      const threadId = proposal.commentId && threadOf.get(proposal.commentId);
      if (!threadId) continue;
      if (proposal.status !== 'discarded') answered.add(threadId);
      if (proposal.status === 'running') working.add(threadId);
      else if ((last.get(threadId)?.createdAt ?? '') <= proposal.createdAt)
        last.set(threadId, proposal);
    }
    for (const [threadId, proposal] of last) {
      // A dropped question is none.
      if (proposal.asks && proposal.status !== 'discarded') asking.add(threadId);
    }
    return { asking, working, answered };
  }, [threads, proposals]);
}
