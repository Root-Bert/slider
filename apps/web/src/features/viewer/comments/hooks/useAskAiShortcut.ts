import { useEffect, useEffectEvent } from 'react';
import { isPendingComment } from '@/lib/api/comment-outbox';
import { isTypingTarget } from '@/lib/dom';
import { isModKey } from '@/lib/keyboard';
import { useAskAi } from '../../editing/hooks/useAskAi';
import { useViewerData } from '../../state/viewer-data';
import { useViewerState } from '../../state/viewer-state';
import { useViewerToast } from '../../state/viewer-toast';
import { useCommentProposals } from './useCommentProposals';
import { asksInWords } from '../lib/comment-selectors';

/**
 * ⌘↵ with a thread selected (its card or panel) and no text field focused: its last message goes
 * to the AI, as ✨ on the card would. Typing, ⌘↵ stays the composer's (send, then ask). Needs the
 * editing context, so it lives apart from `useViewerShortcuts`.
 */
export function useAskAiShortcut() {
  const { deck, threadById } = useViewerData();
  const { focusedThreadId, draft, materialOpen } = useViewerState();
  const ai = useAskAi();
  const proposalsOf = useCommentProposals(deck.id);
  const toast = useViewerToast();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== 'Enter' || !isModKey(event)) return;
    // On the material page the presentation (and its selected thread) is asleep.
    if (materialOpen || draft || isTypingTarget(event.target)) return;
    if (event.target instanceof Element && event.target.closest('dialog')) return;
    const thread = focusedThreadId ? threadById.get(focusedThreadId) : undefined;
    if (!thread) return;
    event.preventDefault();

    const comment = thread.replies.at(-1) ?? thread.root;
    if (ai.asking || isPendingComment(comment)) return;
    if (proposalsOf(comment.id).some((proposal) => proposal.status === 'running')) {
      toast('Die KI arbeitet daran …');
      return;
    }
    if (!asksInWords(comment)) {
      toast('Ohne Text weiß die KI nicht, was sie tun soll');
      return;
    }
    ai.ask(comment, { justSent: false });
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
