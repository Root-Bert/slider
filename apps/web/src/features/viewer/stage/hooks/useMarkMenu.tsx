import { isPathStroke, type Comment, type Point } from '@slider/shared';
import { useState, type MouseEvent } from 'react';
import { useEraseDrawing, useUpdateComment } from '@/lib/api';
import { isPendingComment } from '@/lib/api/comment-outbox';
import { ContextMenu, type MenuAction } from '@/ui';
import { useAskAi } from '../../editing/hooks/useAskAi';
import { useCommentProposals } from '../../comments/hooks/useCommentProposals';
import {
  asksInWords,
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
 * "Kommentar öffnen", „An die KI geben“ (its thread's last message, as on its card) and, on one's
 * own drawing or text, "Zeichnung löschen" / "Text löschen". Only the mark goes: a drawing – or a
 * sticker – without a comment of its own is deleted, one with a comment loses its drawing and keeps
 * a pin where its badge was. Shift + right click keeps the browser's own menu.
 */
export function useMarkMenu({ deckId, isOwn }: MarkMenuOptions) {
  const update = useUpdateComment(deckId);
  const erase = useEraseDrawing(deckId);
  const showToast = useViewerToast();
  const ai = useAskAi();
  const proposalsOf = useCommentProposals(deckId);
  const [menu, setMenu] = useState<{ x: number; y: number; actions: MenuAction[] } | null>(null);

  const removeMark = (thread: Thread) => {
    const { root } = thread;
    const failed = (error: Error) => showToast(error.message, 'danger');
    if (isBareDrawing(thread) || isBareSticker(thread)) {
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
    // As ✨ on its card: the thread's last message goes to the AI – a sticker's text too.
    const asking = thread.replies.at(-1) ?? root;
    if (
      ai.available &&
      !isPendingComment(asking) &&
      asksInWords(asking) &&
      !proposalsOf(asking.id).some((proposal) => proposal.status === 'running')
    )
      actions.push({
        label: 'An die KI geben',
        icon: 'autoAwesome',
        onSelect: () => ai.ask(asking, { justSent: false }),
      });
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

/**
 * A sticker whose comment is only its own text (sent without a comment of its own): taking the
 * text off leaves nothing, so the whole comment goes.
 */
function isBareSticker({ root, replies }: Thread): boolean {
  const text = textAnnotation(root);
  return (
    text !== null &&
    replies.length === 0 &&
    !root.media &&
    !root.images?.length &&
    root.body.trim() === text.text.trim()
  );
}
