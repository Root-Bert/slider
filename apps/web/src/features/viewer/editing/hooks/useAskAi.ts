import type { Comment } from '@slider/shared';
import { useCreateProposal } from '@/lib/api';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { useEditing } from '../editing-context';

/**
 * ⌘↵ in a comment or reply (BER-183): the comment is sent, then the AI reads its thread and
 * proposes changes to the slide – shown in the thread to take over or drop. Without the AI
 * (another format, no key, no right to edit) the comment is sent all the same and a toast says why.
 */
export function useAskAi() {
  const { deck, canManage } = useViewerData();
  const { state } = useEditing();
  const create = useCreateProposal(deck.id);
  const toast = useViewerToast();

  const reason = !canManage
    ? 'Die KI bitten kann nur, wer die Präsentation verwaltet.'
    : !state
      ? 'Die KI ist noch nicht bereit.'
      : !state.editable
        ? (state.reason ?? 'Diese Präsentation lässt sich nicht bearbeiten.')
        : !state.aiAvailable
          ? 'Im Workspace ist keine KI eingerichtet – ein Admin hinterlegt einen API-Key in den Workspace-Einstellungen.'
          : null;

  /** Asks the AI from a sent comment; its thread stays closed – the pin shows it at work. */
  const ask = (comment: Comment) => {
    if (reason) {
      toast(`Als Kommentar gesendet. ${reason}`);
      return;
    }
    create.mutate(
      { commentId: comment.id },
      { onError: (error) => toast(error.message, 'danger') },
    );
  };

  return { available: reason === null, ask };
}
