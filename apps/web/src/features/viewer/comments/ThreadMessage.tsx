import type { Comment } from '@slider/shared';
import { useState } from 'react';
import { isPendingComment } from '@/lib/comment-cache';
import { useDeleteComment, useUpdateComment } from '@/lib/queries';
import { Button, cn, Dialog, Menu } from '@/ui';
import { AutosizeTextarea } from '../components/AutosizeTextarea';
import { isStrokeOnly } from '../lib/comment-selectors';
import { AuthorLine } from './AuthorLine';
import { CommentBody } from './CommentBody';

interface ThreadMessageProps {
  comment: Comment;
  deckId: string;
  isRoot: boolean;
  /** Own comments written in Slider can be edited and deleted; PowerPoint comments are read-only. */
  canManage: boolean;
  onDeleted?: () => void;
}

/**
 * One message in the thread panel (B4): the root spans the panel in the thread's accent
 * (`--card-accent`), replies hug their content. Own messages get a ⋯ menu.
 */
export function ThreadMessage({
  comment,
  deckId,
  isRoot,
  canManage,
  onDeleted,
}: ThreadMessageProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const remove = useDeleteComment(deckId);
  // Not saved yet: shown dimmed and without actions until the server confirms it.
  const pending = isPendingComment(comment);

  return (
    <article
      aria-busy={pending || undefined}
      className={cn(
        'flex flex-col gap-2 rounded-2xl px-3.5 py-3 transition-opacity',
        isRoot
          ? 'bg-white/[0.06] shadow-[inset_0_0_0_1px_var(--card-accent),0_0_20px_-4px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]'
          : cn('glass max-w-80', editing ? 'w-full' : 'w-fit min-w-48'),
        pending && 'opacity-60',
      )}
    >
      <AuthorLine
        comment={comment}
        trailing={
          canManage &&
          !pending &&
          !editing && (
            <Menu
              label="Aktionen für diesen Kommentar"
              triggerClassName="size-7"
              actions={[
                { label: 'Bearbeiten', icon: 'edit', onSelect: () => setEditing(true) },
                {
                  label: 'Löschen',
                  icon: 'delete',
                  onSelect: () => setConfirmingDelete(true),
                  tone: 'danger',
                },
              ]}
            />
          )
        }
        className="-my-1"
      />

      {editing ? (
        <EditForm comment={comment} deckId={deckId} onDone={() => setEditing(false)} />
      ) : isStrokeOnly(comment) ? (
        <p className="text-[13px] text-fg-muted">✏️ Markierung</p>
      ) : (
        <CommentBody body={comment.body} className="text-fg" />
      )}

      <Dialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Kommentar löschen?"
        description={
          isRoot
            ? 'Der ganze Thread mit allen Antworten wird gelöscht.'
            : 'Das lässt sich nicht rückgängig machen.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(comment.id, {
                  onSuccess: () => {
                    setConfirmingDelete(false);
                    onDeleted?.();
                  },
                })
              }
            >
              Löschen
            </Button>
          </>
        }
      >
        {remove.isError && (
          <p role="alert" className="text-sm text-danger">
            {remove.error.message}
          </p>
        )}
      </Dialog>
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
      <div className="rounded-[10px] bg-white/5 px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]">
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
