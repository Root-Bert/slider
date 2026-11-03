import type { Comment } from '@slider/shared';
import { useState } from 'react';
import { useDeleteComment, useUpdateComment } from '@/lib/api';
import { isPendingComment } from '@/lib/api/comment-outbox';
import { pluralize, withCount } from '@/lib/format';
import { ConfirmDialog, type MenuAction } from '@/ui';
import { useAskAi } from '../../editing/hooks/useAskAi';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { asksInWords, type Thread } from '../lib/comment-selectors';
import { useCommentProposals } from './useCommentProposals';

const comments = (count: number) => pluralize(count, 'Kommentar', 'Kommentare');

/** The failed part of several requests as a toast, or null when everything went through. */
function failureMessage(results: PromiseSettledResult<unknown>[], verb: string): string | null {
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length === 0) return null;
  const reason = failed[0]!.reason as Error;
  return `${pluralize(failed.length, 'Kommentar konnte', 'Kommentare konnten')} nicht ${verb} werden: ${reason.message}`;
}

/**
 * Actions for the threads selected under the slides, as the single comment's menu has them
 * (`useCommentMenu`): Wieder öffnen, An die KI geben, Erledigt, Löschen – each for the threads it
 * applies to, with the count when that's only some. Mirrors the API's rights: resolving needs
 * comment rights, deleting own threads or managing the deck. `onDone` clears the selection.
 */
export function useBulkCommentActions(
  threads: readonly Thread[],
  { onDone }: { onDone: () => void },
) {
  const { deck, viewer, canComment, canManage } = useViewerData();
  const showToast = useViewerToast();
  const update = useUpdateComment(deck.id);
  const remove = useDeleteComment(deck.id);
  const ai = useAskAi();
  const proposalsOf = useCommentProposals(deck.id);
  const [deleting, setDeleting] = useState<readonly Thread[] | null>(null);
  const [removing, setRemoving] = useState(false);

  const count = threads.length;
  // Not saved yet (written offline) too: queued after it. Only the AI waits until it is saved.
  const toReopen = canComment ? threads.filter((thread) => thread.root.status === 'done') : [];
  const toResolve = canComment ? threads.filter((thread) => thread.root.status !== 'done') : [];
  // The thread's last message is the one to act on, as the card's ✨ does.
  const toAsk = threads
    .map((thread) => thread.replies.at(-1) ?? thread.root)
    .filter(
      (comment: Comment) =>
        !isPendingComment(comment) &&
        asksInWords(comment) &&
        !proposalsOf(comment.id).some((proposal) => proposal.status === 'running'),
    );
  const deletable = threads.filter(
    (thread) => (thread.root.author.id === viewer.author.id && canComment) || canManage,
  );

  const setStatus = (list: readonly Thread[], status: 'open' | 'done') => {
    const verb = status === 'done' ? 'erledigt' : 'wieder geöffnet';
    // Optimistic, like the single toggle: the selection goes right away, a failure flips back.
    onDone();
    void Promise.allSettled(
      list.map((thread) => update.mutateAsync({ commentId: thread.root.id, status })),
    ).then((results) => {
      const failure = failureMessage(results, verb);
      showToast(failure ?? `${comments(list.length)} ${verb}`, failure ? 'danger' : undefined);
    });
  };

  const confirmDelete = async (list: readonly Thread[]) => {
    setRemoving(true);
    const results = await Promise.allSettled(
      list.map((thread) => remove.mutateAsync({ commentId: thread.root.id })),
    );
    setRemoving(false);
    setDeleting(null);
    const failure = failureMessage(results, 'gelöscht');
    showToast(
      failure ?? (list.length === 1 ? 'Kommentar gelöscht' : `${comments(list.length)} gelöscht`),
      failure ? 'danger' : undefined,
    );
    onDone();
  };

  const noRights = (applies: number, all: number, why: string) => (applies < all ? why : undefined);

  const actions: MenuAction[] = [
    {
      label: withCount('Wieder öffnen', toReopen.length, count),
      icon: 'undo',
      onSelect: () => setStatus(toReopen, 'open'),
      disabled: toReopen.length === 0,
    },
    {
      label: withCount('An die KI geben', toAsk.length, count),
      icon: 'autoAwesome',
      onSelect: () => {
        void ai.askAll(toAsk);
        onDone();
      },
      disabled: !ai.available || toAsk.length === 0,
      title: ai.reason ?? undefined,
    },
    {
      label: withCount('Erledigt', toResolve.length, count),
      icon: 'check',
      onSelect: () => setStatus(toResolve, 'done'),
      disabled: toResolve.length === 0,
    },
    {
      label: withCount('Löschen', deletable.length, count),
      icon: 'delete',
      tone: 'danger',
      onSelect: () => setDeleting(deletable),
      disabled: deletable.length === 0,
      title: noRights(
        deletable.length,
        threads.length,
        'Löschen kannst du nur deine eigenen Kommentare.',
      ),
    },
  ];

  const dialog = (
    <ConfirmDialog
      open={deleting !== null}
      onClose={() => !removing && setDeleting(null)}
      title={
        deleting && deleting.length > 1
          ? `${comments(deleting.length)} löschen?`
          : 'Kommentar löschen?'
      }
      description={
        deleting && deleting.length > 1
          ? 'Die Threads werden mit allen Antworten gelöscht.'
          : 'Der ganze Thread mit allen Antworten wird gelöscht.'
      }
      confirmLabel="Löschen"
      confirmIcon="delete"
      onConfirm={() => deleting && void confirmDelete(deleting)}
      pending={removing}
      confirmDisabled={removing}
    />
  );

  return { actions, dialog };
}
