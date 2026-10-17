import { MAX_COMMENT_BODY_LENGTH, type Comment } from '@slider/shared';
import { AutosizeTextarea, Avatar, cn, ErrorText, IconButton } from '@/ui';
import { MediaReplyButtons } from './MediaTabs';
import { useMentions } from './hooks/useMentions';
import { useReplyDraft } from './hooks/useReplyDraft';
import { MentionMenu } from './MentionMenu';

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
  const mentions = useMentions(body, setBody, textareaRef);

  const textarea = (
    <AutosizeTextarea
      {...mentions.fieldProps}
      ref={textareaRef}
      aria-label={`Antwort an ${root.author.name}`}
      maxLength={MAX_COMMENT_BODY_LENGTH}
      placeholder="Antworten …"
      value={body}
      autoFocus={autoFocus}
      maxHeight={variant === 'inline' ? 120 : 160}
      onKeyDown={(event) => {
        if (!mentions.onKeyDown(event)) onKeyDown(event);
      }}
      className="text-body leading-4.5 text-fg placeholder:text-fg-subtle"
    />
  );
  const field = (
    <div className="relative min-w-0 flex-1">
      <MentionMenu mentions={mentions} />
      {textarea}
    </div>
  );

  const error = draft.error && (
    <ErrorText role="alert" size="xs">
      {draft.error.message}
    </ErrorText>
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
          <span className="shrink-0 text-caption text-fg-subtle">jetzt</span>
        </header>
        <div className="flex items-end gap-2 rounded-control bg-well-dark py-1.5 pr-2 pl-3">
          <div className="min-w-0 flex-1 py-[3px]">{field}</div>
          <IconButton
            icon="close"
            label="Antwort verwerfen"
            title="Verwerfen (Esc)"
            variant="subtle"
            size="xs"
            onClick={draft.cancel}
          />
          <IconButton
            type="submit"
            icon="arrowUpward"
            label="Antwort senden"
            title="Senden (Enter)"
            size="xs"
            iconTone="success"
            disabledStyle="dim"
            disabled={!canSend}
          />
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
        <div className="field-well focus-field flex min-h-10 min-w-0 flex-1 items-end gap-0.5 rounded-control py-1.5 pr-1 pl-3.5">
          <div className="min-w-0 flex-1 py-[5px]">{field}</div>
          <MediaReplyButtons root={root} />
        </div>
        <IconButton
          type="submit"
          icon="arrowUpward"
          label="Antwort senden"
          title="Senden (Enter)"
          variant="primary"
          size="md"
          iconSize={20}
          disabled={!canSend}
        />
      </div>
      {error}
    </form>
  );
}
