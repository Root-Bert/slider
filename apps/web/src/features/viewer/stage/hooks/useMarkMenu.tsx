import { isPathStroke, type Comment, type Point } from '@slider/shared';
import { useState, type MouseEvent } from 'react';
import { useEraseDrawing, useUpdateComment } from '@/lib/api';
import { ContextMenu, type MenuAction } from '@/ui';
import {
  isBareDrawing,
  isImplicitFrame,
  textAnnotation,
  type Thread,
} from '../../comments/lib/comment-selectors';
import { useViewerToast } from '../../state/viewer-toast';

interface MarkMenuOptions {
  deckId: string;
  /** The viewer may change this comment (own Slider comment, may comment). */
  isOwn: (comment: Comment) => boolean;
}

/**
 * Right click on a mark on the slide – drawing, text, pin or box (BER-136): "Kommentar schreiben" /
 * "Kommentar öffnen" and, on one's own drawing or text, "Zeichnung löschen" / "Text löschen". Only the mark goes: a drawing
 * without a comment is deleted, one with a comment loses its drawing and keeps a pin where its
 * badge was. Shift + right click keeps the browser's own menu.
 */
export function useMarkMenu({ deckId, isOwn }: MarkMenuOptions) {
  const update = useUpdateComment(deckId);
  const erase = useEraseDrawing(deckId);
  const showToast = useViewerToast();
  const [menu, setMenu] = useState<{ x: number; y: number; actions: MenuAction[] } | null>(null);

  const removeMark = (thread: Thread) => {
    const { root } = thread;
    const failed = (error: Error) => showToast(error.message, 'danger');
    if (isBareDrawing(thread)) {
      erase.mutate(root.id, { onError: failed });
      return;
    }
    void update
      .mutateAsync({ commentId: root.id, removeMarks: { pin: pinOf(root) } })
      .catch(failed);
  };

  const onContextMenu = (event: MouseEvent, thread: Thread, onActivate: () => void) => {
    if (event.shiftKey) return;
    event.preventDefault();
    // The slide's own menu stays closed.
    event.stopPropagation();
    const { root } = thread;
    const bare = isBareDrawing(thread);
    const actions: MenuAction[] = [
      {
        label: bare ? 'Kommentar schreiben' : 'Kommentar öffnen',
        icon: 'chatBubble',
        onSelect: onActivate,
      },
    ];
    if (isOwn(root) && root.strokes.length > 0)
      actions.push({
        label: textAnnotation(root) ? 'Text löschen' : 'Zeichnung löschen',
        icon: 'delete',
        tone: 'danger',
        onSelect: () => removeMark(thread),
      });
    setMenu({ x: event.clientX, y: event.clientY, actions });
  };

  const contextMenu = menu && (
    <ContextMenu
      label="Aktionen für die Markierung"
      actions={menu.actions}
      at={{ x: menu.x, y: menu.y }}
      onClose={() => setMenu(null)}
    />
  );
  return { onContextMenu, contextMenu };
}

/**
 * Where the comment's pin goes once its drawing or text is gone: where its badge was, if its box
 * was that drawing or text – a box of its own stays.
 */
export function pinOf(comment: Comment): Point | null {
  if (!isImplicitFrame(comment)) return null;
  const text = textAnnotation(comment);
  if (text) return { x: text.x, y: text.y };
  const start = comment.strokes.find(isPathStroke)?.points[0];
  if (start) return start;
  return comment.anchor.type === 'rect'
    ? { x: comment.anchor.rect.x, y: comment.anchor.rect.y }
    : null;
}
