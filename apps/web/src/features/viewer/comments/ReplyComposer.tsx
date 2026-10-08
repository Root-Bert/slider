import type { Comment } from '@slider/shared';
import { Avatar, cn, Icon } from '@/ui';
import { AutosizeTextarea } from '../components/AutosizeTextarea';
import { MediaSoonButtons } from '../components/MediaTabs';
import { useReplyDraft } from '../hooks/useReplyDraft';

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
  const draft = useReplyDraft(root, deckId, { onCancel, onSent });
  const { body, setBody, canSend, submit, onKeyDown, textareaRef } = draft;

  const textarea = (
    <AutosizeTextarea
      ref={textareaRef}
      aria-label={`Antwort an ${root.author.name}`}
      placeholder="Antworten …"
      value={body}
      autoFocus={autoFocus}
      maxHeight={variant === 'inline' ? 120 : 160}
      onChange={(event) => setBody(event.target.value)}
      onKeyDown={onKeyDown}
      className="text-[13px] leading-[18px] text-fg placeholder:text-white/40"
    />
  );

  const error = draft.error && (
    <p role="alert" className="text-xs text-danger">
      {draft.error.message}
    </p>
  );

  if (variant === 'inline') {
    return (
      <form
        onSubmit={submit}
        className={cn(
          'glass flex flex-col gap-2 rounded-panel px-3.5 py-3',
          'focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--card-accent)_45%,transparent)]!',
        )}
      >
        <header className="flex min-w-0 items-center gap-2">
          <Avatar author={draft.author} size={24} />
          <span className="truncate text-xs font-medium text-fg">{draft.author.name}</span>
          <span className="shrink-0 text-[11px] text-fg-subtle">jetzt</span>
        </header>
        <div className="flex items-end gap-2 rounded-control bg-black/25 py-1.5 pr-2 pl-3">
          <div className="min-w-0 flex-1 py-[3px]">{textarea}</div>
          <button
            type="button"
            aria-label="Antwort verwerfen"
            title="Verwerfen (Esc)"
            onClick={onCancel}
            className="flex size-6 shrink-0 items-center justify-center rounded-badge text-fg-subtle hover:bg-white/10 hover:text-fg"
          >
            <Icon name="close" size={18} />
          </button>
          <button
            type="submit"
            aria-label="Antwort senden"
            title="Senden (Enter)"
            disabled={!canSend}
            className="flex size-6 shrink-0 items-center justify-center rounded-badge text-success hover:bg-white/10 disabled:text-fg-faint disabled:hover:bg-transparent"
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
      className="flex flex-col gap-2 border-t border-hairline px-5 pt-3.5 pb-[18px]"
    >
      <div className="flex items-end gap-2">
        <div className="flex min-h-10 min-w-0 flex-1 items-end gap-0.5 rounded-control border border-white/10 bg-white/[0.06] py-[5px] pr-1 pl-3.5 transition-colors focus-within:border-white/35">
          <div className="min-w-0 flex-1 py-[5px]">{textarea}</div>
          <MediaSoonButtons />
        </div>
        <button
          type="submit"
          aria-label="Antwort senden"
          title="Senden (Enter)"
          disabled={!canSend}
          className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary transition-opacity disabled:opacity-40"
        >
          <Icon name="arrowUpward" size={20} />
        </button>
      </div>
      {error}
    </form>
  );
}
