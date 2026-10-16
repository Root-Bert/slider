import type { Comment } from '@slider/shared';
import { useState } from 'react';
import { isPendingComment } from '@/lib/api/comment-cache';
import { useUpdateComment } from '@/lib/api';
import { AutosizeTextarea, Button, cn, ErrorText, Menu } from '@/ui';
import { isRemovedInPowerPoint } from './lib/comment-selectors';
import { AuthorLine } from './AuthorLine';
import { CommentContent } from './CommentContent';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { RemovedInPowerPointNote } from './RevisionNotes';
import { useCommentMenu } from './hooks/useCommentMenu';
import { isModEnter } from '@/lib/keyboard';

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
          ? 'bg-surface-1 shadow-[inset_0_0_0_1px_var(--card-accent),0_0_20px_-4px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]'
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
              triggerSize="compact"
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
            removed && 'text-fg-subtle line-through decoration-fg-faint',
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
      <div className="field-well rounded-control-sm px-3 py-2">
        <AutosizeTextarea
          autoFocus
          aria-label="Kommentar bearbeiten"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (isModEnter(event)) save();
            if (event.key === 'Escape') {
              event.stopPropagation();
              onDone();
            }
          }}
          className="text-body leading-5 text-fg"
        />
      </div>
      {update.isError && (
        <ErrorText role="alert" size="xs">
          {update.error.message}
        </ErrorText>
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
