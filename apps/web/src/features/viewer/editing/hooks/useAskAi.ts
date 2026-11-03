import type { Comment } from '@slider/shared';
import { useCreateProposal } from '@/lib/api';
import { pluralize } from '@/lib/format';
import { OFFLINE_HINT } from '@/lib/offline';
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
  const { state, offline } = useEditing();
  const create = useCreateProposal(deck.id);
  const toast = useViewerToast();

  const reason = !canManage
    ? 'Die KI bitten kann nur, wer die Präsentation verwaltet.'
    : offline
      ? `Die KI ist offline nicht da. ${OFFLINE_HINT}`
      : !state
        ? 'Die KI ist noch nicht bereit.'
        : !state.editable
          ? (state.reason ?? 'Diese Präsentation lässt sich nicht bearbeiten.')
          : !state.aiAvailable
            ? (state.aiReason ??
              'Im Workspace ist keine KI eingerichtet – ein Admin hinterlegt einen API-Key in den Workspace-Einstellungen.')
            : null;

  /**
   * Asks the AI from a sent comment; its thread stays closed – the pin shows it at work.
   * `justSent`: asked while sending it (⌘↵) – without the AI, the toast says it went out anyway.
   */
  const ask = (comment: Comment, { justSent = true }: { justSent?: boolean } = {}) => {
    if (reason) {
      toast(justSent ? `Als Kommentar gesendet. ${reason}` : reason);
      return;
    }
    create.mutate(
      { commentId: comment.id },
      { onError: (error) => toast(error.message, 'danger') },
    );
  };

  /** Several comments given to the AI at once (selected under the slides), one after another. */
  const askAll = async (comments: readonly Comment[]) => {
    if (reason) {
      toast(reason);
      return;
    }
    const failed: Error[] = [];
    for (const comment of comments) {
      await create.mutateAsync({ commentId: comment.id }).catch((error: Error) => {
        failed.push(error);
      });
    }
    if (failed.length > 0)
      toast(
        `${pluralize(failed.length, 'Kommentar ging', 'Kommentare gingen')} nicht an die KI: ${failed[0]!.message}`,
        'danger',
      );
  };

  return {
    available: reason === null,
    reason,
    ask,
    askAll,
    asking: create.isPending,
    offline,
  };
}
