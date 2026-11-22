import { useState } from 'react';
import { pluralize, withCount } from '@/lib/format';
import { ConfirmDialog, ContextMenu, SelectionBar, type MenuAction } from '@/ui';
import type { DocumentComments, Thread } from './comments';
import { useWriter } from './session';

const commentsOf = (count: number) => pluralize(count, 'Kommentar', 'Kommentare');

/**
 * The comments picked with ⌘/⇧-click and what can be done with them, as under the slides
 * (`CommentSelectionBar`, `useBulkCommentActions`): Wieder öffnen, An die KI geben, Erledigt,
 * Löschen – each for the threads it applies to, with the count when that's only some. A right
 * click on one of them opens the same actions there.
 */
export function CommentSelectionBar({
  threads,
  comments,
  onClear,
  menuAt,
  onMenuClose,
}: {
  threads: readonly Thread[];
  comments: DocumentComments;
  onClear: () => void;
  menuAt: { x: number; y: number } | null;
  onMenuClose: () => void;
}) {
  const { me, document, notify } = useWriter();
  const { canComment, canEdit, canManage } = document.permissions;
  const [deleting, setDeleting] = useState<readonly Thread[] | null>(null);
  const count = threads.length;
  const toReopen = canComment ? threads.filter((thread) => thread.root.status === 'done') : [];
  const toResolve = canComment ? threads.filter((thread) => thread.root.status !== 'done') : [];
  // The thread's last message is the one to act on, as ⌘↵ does.
  const toAsk = canEdit
    ? threads
        .map((thread) => thread.replies.at(-1) ?? thread.root)
        .filter(
          (comment) =>
            comment.body.trim() &&
            !comments.proposals.some(
              (proposal) => proposal.commentId === comment.id && proposal.status === 'running',
            ),
        )
    : [];
  const deletable = threads.filter(
    (thread) => (thread.root.author.id === me.id && canComment) || canManage,
  );

  const setStatus = (list: readonly Thread[], status: 'open' | 'done') => {
    for (const thread of list) comments.setStatus(thread.root.id, status);
    notify(`${commentsOf(list.length)} ${status === 'done' ? 'erledigt' : 'wieder geöffnet'}`);
    onClear();
  };
  const confirmDelete = (list: readonly Thread[]) => {
    for (const thread of list) comments.remove(thread.root.id);
    notify(list.length === 1 ? 'Kommentar gelöscht' : `${commentsOf(list.length)} gelöscht`);
    setDeleting(null);
    onClear();
  };

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
        for (const comment of toAsk) comments.askAi(comment.id);
        onClear();
      },
      disabled: toAsk.length === 0,
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
      title:
        deletable.length < count ? 'Löschen kannst du nur deine eigenen Kommentare.' : undefined,
    },
  ];

  return (
    <>
      {count > 0 && (
        <div
          data-chrome
          data-comment-selection
          className="fixed bottom-6 left-1/2 z-(--z-chrome) flex w-[min(680px,calc(100%-2rem))] -translate-x-1/2 justify-center @container"
        >
          <SelectionBar
            label="Ausgewählte Kommentare"
            count={count}
            actions={actions}
            onClear={onClear}
            labelClassName="@max-[660px]:hidden"
            countLabelClassName="@max-[300px]:hidden"
            className="relative min-w-0 animate-pop-in"
          />
        </div>
      )}
      {menuAt && count > 1 && (
        <ContextMenu
          label={`Aktionen für ${count} ausgewählte Kommentare`}
          actions={actions}
          at={menuAt}
          onClose={onMenuClose}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={
          deleting && deleting.length > 1
            ? `${commentsOf(deleting.length)} löschen?`
            : 'Kommentar löschen?'
        }
        description={
          deleting && deleting.length > 1
            ? 'Die Threads werden mit allen Antworten gelöscht.'
            : 'Der ganze Thread mit allen Antworten wird gelöscht.'
        }
        confirmLabel="Löschen"
        confirmIcon="delete"
        onConfirm={() => deleting && confirmDelete(deleting)}
      />
    </>
  );
}
