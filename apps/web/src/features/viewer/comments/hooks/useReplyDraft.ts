import type { Comment } from '@slider/shared';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useCreateReply } from '@/lib/queries';
import { replyInput } from '../lib/replies';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';

interface ReplyDraftOptions {
  /** Esc in the field. Without it, Esc bubbles up to the viewer. */
  onCancel?: (() => void) | undefined;
  onSent?: (() => void) | undefined;
}

/**
 * Text reply draft shared by all reply fields. Enter sends, Shift+Enter adds a line. The reply
 * shows up right away (optimistic) and the field clears but keeps focus; on failure the text
 * comes back and the error shows as a toast.
 */
export function useReplyDraft(root: Comment, deckId: string, options: ReplyDraftOptions = {}) {
  const { viewer } = useViewerData();
  const showToast = useViewerToast();
  const createReply = useCreateReply(deckId, viewer.author);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState('');
  const canSend = body.trim().length > 0 && !createReply.isPending;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    const sent = body;
    // Clear right away – the reply is already in the thread; restored if the request fails.
    setBody('');
    createReply.mutate(
      { input: replyInput(root, sent), root },
      {
        onSuccess: () => options.onSent?.(),
        onError: (error) => {
          setBody((current) => current || sent);
          showToast(error.message, 'danger');
        },
      },
    );
    textareaRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && options.onCancel) {
      // Handled here, so the viewer doesn't also close the panel.
      event.preventDefault();
      event.stopPropagation();
      options.onCancel();
    }
  };

  return {
    author: viewer.author,
    body,
    setBody,
    canSend,
    submit,
    onKeyDown,
    textareaRef,
    error: createReply.isError ? createReply.error : null,
  };
}
