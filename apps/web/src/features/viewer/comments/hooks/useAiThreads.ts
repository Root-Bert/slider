import { useMemo } from 'react';
import { useAiProposals } from '@/lib/api';
import { useViewerData } from '../../state/viewer-data';

export interface AiThreads {
  /** Threads the AI finished a change on (also taken back) – the "KI" filter. */
  edited: ReadonlySet<string>;
  /** Threads the AI is working on right now – card, line and mark show it. */
  working: ReadonlySet<string>;
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
    const edited = new Set<string>();
    const working = new Set<string>();
    for (const proposal of proposals ?? []) {
      const threadId = proposal.commentId && threadOf.get(proposal.commentId);
      if (!threadId) continue;
      if (proposal.status === 'applied' || proposal.status === 'reverted') edited.add(threadId);
      if (proposal.status === 'running') working.add(threadId);
    }
    return { edited, working };
  }, [threads, proposals]);
}
