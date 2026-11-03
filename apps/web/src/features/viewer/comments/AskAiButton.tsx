import type { Comment } from '@slider/shared';
import type { MouseEvent } from 'react';
import { isPendingComment } from '@/lib/api/comment-outbox';
import { OFFLINE_HINT } from '@/lib/offline';
import { cn, IconButton } from '@/ui';
import { useAskAi } from '../editing/hooks/useAskAi';
import { useCommentProposals } from './hooks/useCommentProposals';
import { asksInWords } from './lib/comment-selectors';

interface AskAiButtonProps {
  /** The message the AI acts on – it reads the thread up to it. */
  comment: Comment;
  deckId: string;
  className?: string;
}

/**
 * ✨ beside ✓ and on every message: gives a comment already sent to the AI, as ⌘↵ would have –
 * anyone's, the AI's own remarks included. Always there; without the AI a click says why. Dimmed
 * while the AI works on it.
 */
export function AskAiButton({ comment, deckId, className }: AskAiButtonProps) {
  const ai = useAskAi();
  const proposalsOf = useCommentProposals(deckId);
  const working = proposalsOf(comment.id).some((proposal) => proposal.status === 'running');
  // A sticker's text and a voice memo (once transcribed) ask too.
  const blank = !asksInWords(comment);

  const onClick = (event: MouseEvent) => {
    event.stopPropagation();
    ai.ask(comment, { justSent: false });
  };

  return (
    <IconButton
      icon="autoAwesome"
      label="An die KI geben"
      title={
        working
          ? 'Die KI arbeitet daran …'
          : ai.offline
            ? `Die KI ist offline nicht da. ${OFFLINE_HINT}`
            : blank
              ? 'Ohne Text weiß die KI nicht, was sie tun soll'
              : 'An die KI geben – sie liest den Thread und ändert die Folie'
      }
      variant="subtle"
      size="compact"
      disabledStyle="dim"
      disabled={working || blank || ai.asking || ai.offline || isPendingComment(comment)}
      onClick={onClick}
      className={cn('relative z-(--z-raised)', className)}
    />
  );
}
