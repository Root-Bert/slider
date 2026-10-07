import type { Comment } from '@slider/shared';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useCreateReply } from '@/lib/queries';
import { Avatar, cn, Icon } from '@/ui';
import { AutosizeTextarea } from '../components/AutosizeTextarea';
import { MediaTabs } from '../components/MediaTabs';
import { replyInput } from '../lib/replies';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';

interface ReplyComposerProps {
  root: Comment;
  deckId: string;
  /** `panel`: bottom of the thread panel (B4). `inline`: last card of an expanded thread (B3). */
  variant?: 'panel' | 'inline';
  autoFocus?: boolean;
  /** Inline only: Esc or ✕ closes the composer. */
  onCancel?: () => void;
  onSent?: () => void;
}

/**
 * Text reply to a thread. Enter sends, Shift+Enter adds a line. The reply shows up right away
 * (optimistic); on failure the text stays and the error shows inline and as a toast.
 */
export function ReplyComposer({
  root,
  deckId,
  variant = 'panel',
  autoFocus = false,
  onCancel,
  onSent,
}: ReplyComposerProps) {
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
        onSuccess: () => onSent?.(),
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
    } else if (event.key === 'Escape' && onCancel) {
      // Handled here, so the viewer doesn't also close the panel.
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  const textarea = (
    <AutosizeTextarea
      ref={textareaRef}
      aria-label="Antwort schreiben"
      placeholder="Antworten…"
      value={body}
      autoFocus={autoFocus}
      maxHeight={variant === 'inline' ? 120 : 160}
      onChange={(event) => setBody(event.target.value)}
      onKeyDown={onKeyDown}
      className="text-[13px] leading-[18px] text-fg placeholder:text-white/40"
    />
  );

  const error = createReply.isError && (
    <p role="alert" className="text-xs text-danger">
      {createReply.error.message}
    </p>
  );

  if (variant === 'inline') {
    return (
      <form
        onSubmit={submit}
        className={cn(
          'glass flex flex-col gap-2 rounded-2xl px-3.5 py-3',
          'focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--card-accent)_45%,transparent)]!',
        )}
      >
        <header className="flex min-w-0 items-center gap-2">
          <Avatar author={viewer.author} size={24} />
          <span className="truncate text-xs font-medium text-fg">{viewer.author.name}</span>
          <span className="shrink-0 text-[11px] text-fg-subtle">jetzt</span>
        </header>
        <div className="flex items-end gap-2 rounded-[12px] bg-black/25 py-1.5 pr-2 pl-3">
          <div className="min-w-0 flex-1 py-[3px]">{textarea}</div>
          <button
            type="button"
            aria-label="Antwort verwerfen"
            title="Verwerfen (Esc)"
            onClick={onCancel}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-white/10 hover:text-fg"
          >
            <Icon name="close" size={18} />
          </button>
          <button
            type="submit"
            aria-label="Antwort senden"
            title="Senden (Enter)"
            disabled={!canSend}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-success hover:bg-white/10 disabled:text-fg-faint disabled:hover:bg-transparent"
          >
            <Icon name="arrowUpward" size={18} />
          </button>
        </div>
        {error}
      </form>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2.5 border-t border-hairline px-5 pt-3.5 pb-[18px]"
    >
      <MediaTabs />
      <div className="flex items-end gap-2">
        <div className="flex min-h-10 min-w-0 flex-1 items-center rounded-[12px] border border-white/10 bg-white/[0.06] py-[10px] pr-3 pl-3.5 transition-colors focus-within:border-white/35">
          {textarea}
        </div>
        <button
          type="submit"
          aria-label="Antwort senden"
          title="Senden (Enter)"
          disabled={!canSend}
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-primary text-on-primary transition-opacity disabled:opacity-40"
        >
          <Icon name="arrowUpward" size={20} />
        </button>
      </div>
      {error}
    </form>
  );
}
