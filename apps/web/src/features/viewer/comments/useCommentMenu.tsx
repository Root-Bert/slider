import type { Comment } from '@slider/shared';
import { useCallback, useState, type MouseEvent } from 'react';
import { isPendingComment } from '@/lib/comment-cache';
import { useDeleteComment, useUpdateComment } from '@/lib/queries';
import { Button, ContextMenu, Dialog, type MenuAction } from '@/ui';
import { useViewerData } from '../state/viewer-data';

interface CommentMenuOptions {
  comment: Comment;
  deckId: string;
  /** Roots carry the thread's status, so only they can be resolved. */
  isRoot: boolean;
  /** Opens the comment's editor (in place, or in the thread panel). */
  onEdit: () => void;
  onDeleted?: () => void;
}

/**
 * Actions of one comment – Erledigen / Wieder öffnen (roots), Bearbeiten and Löschen – for the
 * ⋯ menu and a right click at the pointer, with the delete confirmation. Mirrors the API: own
 * Slider comments can be edited, own comments and, for deck managers, any can be deleted.
 * Shift + right click keeps the browser's own menu.
 */
export function useCommentMenu({ comment, deckId, isRoot, onEdit, onDeleted }: CommentMenuOptions) {
  const { viewer, canComment, canManage } = useViewerData();
  const update = useUpdateComment(deckId);
  const remove = useDeleteComment(deckId);
  const [contextAt, setContextAt] = useState<{ x: number; y: number } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const closeContext = useCallback(() => setContextAt(null), []);

  const own = comment.author.id === viewer.author.id;
  const done = comment.status === 'done';
  const actions: MenuAction[] = [];
  // Not saved yet: no actions until the server confirms it.
  if (!isPendingComment(comment)) {
    if (isRoot && canComment)
      actions.push({
        label: done ? 'Wieder öffnen' : 'Erledigt',
        icon: done ? 'undo' : 'check',
        onSelect: () => update.mutate({ commentId: comment.id, status: done ? 'open' : 'done' }),
      });
    if (own && canComment && comment.source === 'app')
      actions.push({ label: 'Bearbeiten', icon: 'edit', onSelect: onEdit });
    if ((own && canComment) || canManage)
      actions.push({
        label: 'Löschen',
        icon: 'delete',
        tone: 'danger',
        onSelect: () => setConfirmingDelete(true),
      });
  }

  // A root with a drawing or text on the slide can lose just the comment: the marks stay.
  const canKeepDrawing = isRoot && comment.strokes.length > 0;
  const confirmDelete = (keepDrawing: boolean) =>
    remove.mutate(
      { commentId: comment.id, keepDrawing },
      {
        onSuccess: () => {
          setConfirmingDelete(false);
          onDeleted?.();
        },
      },
    );

  const onContextMenu = (event: MouseEvent) => {
    if (event.shiftKey || actions.length === 0) return;
    event.preventDefault();
    // A reply inside an expanded card: the innermost comment's menu wins.
    event.stopPropagation();
    setContextAt({ x: event.clientX, y: event.clientY });
  };

  const menus = (
    <>
      {contextAt && (
        <ContextMenu
          label={`Aktionen für den Kommentar von ${comment.author.name}`}
          actions={actions}
          at={contextAt}
          onClose={closeContext}
        />
      )}
      <Dialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Kommentar löschen?"
        description={
          canKeepDrawing
            ? 'Der ganze Thread mit allen Antworten wird gelöscht. „Nur Kommentar löschen“ lässt Zeichnung und Text auf der Folie stehen.'
            : isRoot
              ? 'Der ganze Thread mit allen Antworten wird gelöscht.'
              : 'Das lässt sich nicht rückgängig machen.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Abbrechen
            </Button>
            {canKeepDrawing && (
              <Button
                variant="secondary"
                loading={remove.isPending && remove.variables?.keepDrawing}
                disabled={remove.isPending}
                onClick={() => confirmDelete(true)}
              >
                Nur Kommentar löschen
              </Button>
            )}
            <Button
              variant="danger"
              loading={remove.isPending && !remove.variables?.keepDrawing}
              disabled={remove.isPending}
              onClick={() => confirmDelete(false)}
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
    </>
  );

  return { actions, onContextMenu, menus };
}
