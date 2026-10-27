import type { Comment } from '@slider/shared';
import { useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useCreateReply } from '@/lib/api';
import { isAbort, useCreateMediaComment } from '../../media/hooks/useMediaComment';
import { asUploads, useImageAttachments } from '../../media/hooks/useImageAttachments';
import { useReplyDraftBody } from '../lib/reply-drafts';
import { replyInput } from '../lib/replies';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { useAskAi } from '../../editing/hooks/useAskAi';
import { isModKey } from '@/lib/keyboard';

interface ReplyDraftOptions {
  /** Esc in the field – discards the draft. Without it, Esc bubbles up to the viewer. */
  onCancel?: (() => void) | undefined;
  onSent?: (() => void) | undefined;
}

/**
 * Text reply draft shared by all reply fields of a thread, kept per thread (`reply-drafts`) so
 * it outlives the field. Enter sends, Shift+Enter adds a line, ⌘↵ sends and asks the AI to
 * change the slide (BER-183). The reply shows up right away
 * (optimistic) and the field clears but keeps focus; on failure the text comes back and the
 * error shows as a toast – also when the field is gone by then (another thread, scrolled away).
 */
export function useReplyDraft(root: Comment, deckId: string, options: ReplyDraftOptions = {}) {
  const { viewer } = useViewerData();
  const showToast = useViewerToast();
  const createReply = useCreateReply(deckId, viewer.author);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useReplyDraftBody(root.id);
  // Pasted or picked images (BER-174) go the way of a drawn one: a reply with pictures.
  const images = useImageAttachments();
  const createPicture = useCreateMediaComment(deckId);
  const ai = useAskAi();
  const canSend =
    (body.trim().length > 0 || images.attachments.length > 0) &&
    // An image still turning into a PNG would be left out.
    !images.busy &&
    !createReply.isPending &&
    !createPicture.isPending;

  const submit = (event?: FormEvent, { askAi = false } = {}) => {
    event?.preventDefault();
    if (!canSend) return;
    const sent = body;
    const sentReply = (reply: Comment) => {
      if (askAi) ai.ask(reply);
    };
    if (images.attachments.length > 0) {
      const blobs = asUploads(images.attachments);
      // Not optimistic: the pictures have to be uploaded first, the field shows the progress.
      createPicture.mutateAsync({ input: replyInput(root, sent), images: blobs }).then(
        (created) => {
          // Typed on during the upload: that stays.
          setBody((current) => (current === sent ? '' : current));
          images.clear();
          options.onSent?.();
          sentReply(created);
          return created;
        },
        // Discarded or left: nothing to report.
        (error: Error) => {
          if (!isAbort(error)) showToast(error.message, 'danger');
        },
      );
      return;
    }
    // Clear right away – the reply is already in the thread; restored if the request fails.
    setBody('');
    // The promise, not `mutate`'s callbacks: those are skipped once the field has unmounted.
    createReply.mutateAsync({ input: replyInput(root, sent), root }).then(
      (reply) => {
        options.onSent?.();
        sentReply(reply);
      },
      (error: Error) => {
        setBody((current) => current || sent);
        showToast(error.message, 'danger');
      },
    );
    textareaRef.current?.focus();
  };

  // Kept per thread, so discarding has to clear it – else it comes back with the next field.
  const cancel = () => {
    createPicture.cancel();
    setBody('');
    images.clear();
    options.onCancel?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(undefined, { askAi: isModKey(event) });
    } else if (event.key === 'Escape' && options.onCancel) {
      // Handled here, so the viewer doesn't also close the panel.
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  return {
    author: viewer.author,
    /** ⌘↵ would ask the AI as well. */
    aiAvailable: ai.available && root.slideId !== null,
    body,
    setBody,
    canSend,
    submit,
    cancel,
    onKeyDown,
    textareaRef,
    /** The pasted or picked images, and the upload of a reply with them. */
    images,
    uploading: createPicture.isPending,
    progress: createPicture.progress,
    error: createReply.isError ? createReply.error : createPicture.error,
  };
}
