import type { Comment } from '@slider/shared';
import { useState } from 'react';
import { isPendingComment } from '@/lib/api/comment-cache';
import { useUpdateComment } from '@/lib/api';
import { AutosizeTextarea, Button, cn, Menu } from '@/ui';
import { isRemovedInPowerPoint } from './lib/comment-selectors';
import { AuthorLine } from './AuthorLine';
import { CommentContent } from './CommentContent';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { RemovedInPowerPointNote } from './RevisionNotes';
import { useCommentMenu } from './hooks/useCommentMenu';

interface ThreadMessageProps {
  comment: Comment;
  deckId: string;
  isRoot: boolean;
  onDeleted?: () => void;
}

/**
 * One message in the thread panel (B4): the root spans the panel in the thread's accent
 * (`--card-accent`), replies hug their content. Actions sit in a ⋯ menu and on right click.
 */
export function ThreadMessage({ comment, deckId, isRoot, onDeleted }: ThreadMessageProps) {
  const [editingHere, setEditingHere] = useState(false);
  const { editingCommentId } = useViewerState();
  const dispatch = useViewerDispatch();
  // "Bearbeiten" from a card's context menu opens the panel with this comment's editor.
  const requested = editingCommentId === comment.id;
  const editing = editingHere || requested;
  const stopEditing = () => {
    setEditingHere(false);
    if (requested) dispatch({ type: 'commentEditEnded' });
  };
  const menu = useCommentMenu({
    comment,
    deckId,
    isRoot,
    onEdit: () => setEditingHere(true),
    onDeleted,
  });
  // Not saved yet: shown dimmed and without actions until the server confirms it.
  const pending = isPendingComment(comment);
  const removed = isRemovedInPowerPoint(comment);

  return (
    <article
      aria-busy={pending || undefined}
      onContextMenu={editing ? undefined : menu.onContextMenu}
      className={cn(
        'flex flex-col gap-2 rounded-panel px-3.5 py-3 transition-opacity',
        isRoot
          ? 'bg-white/[0.06] shadow-[inset_0_0_0_1px_var(--card-accent),0_0_20px_-4px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]'
          : cn('glass max-w-80', editing ? 'w-full' : 'w-fit min-w-48'),
        pending && 'opacity-60',
      )}
    >
      <AuthorLine
        comment={comment}
        trailing={
          menu.actions.length > 0 &&
          !editing && (
            <Menu
              label="Aktionen für diesen Kommentar"
              triggerClassName="size-7"
              actions={menu.actions}
            />
          )
        }
        className="-my-1"
      />

      {removed && <RemovedInPowerPointNote />}
      {editing ? (
        <EditForm comment={comment} deckId={deckId} onDone={stopEditing} />
      ) : (
        <CommentContent
          comment={comment}
          bodyClassName={cn(
            'text-fg',
            removed && 'text-fg-subtle line-through decoration-white/30',
          )}
        />
      )}

      {menu.menus}
    </article>
  );
}

function EditForm({
  comment,
  deckId,
  onDone,
}: {
  comment: Comment;
  deckId: string;
  onDone: () => void;
}) {
  const [body, setBody] = useState(comment.body);
  const update = useUpdateComment(deckId);
  const save = () => {
    if (!body.trim()) return;
    update.mutate({ commentId: comment.id, body: body.trim() }, { onSuccess: onDone });
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="rounded-control-sm bg-white/5 px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]">
        <AutosizeTextarea
          autoFocus
          aria-label="Kommentar bearbeiten"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save();
            if (event.key === 'Escape') {
              event.stopPropagation();
              onDone();
            }
          }}
          className="text-[13px] leading-5 text-fg"
        />
      </div>
      {update.isError && (
        <p role="alert" className="text-xs text-danger">
          {update.error.message}
        </p>
      )}
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" size="sm" disabled={!body.trim()} loading={update.isPending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}
