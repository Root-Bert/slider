import type { Comment } from '@slider/shared';
import { useState, type FormEvent } from 'react';
import { useCreateComment } from '@/lib/queries';
import { cn, Icon } from '@/ui';
import { AutosizeTextarea } from '../components/AutosizeTextarea';
import { MediaTabs } from '../components/MediaTabs';

/** Reply box at the bottom of the thread panel (B4). Enter sends, Shift+Enter adds a line. */
export function ReplyComposer({ root, deckId }: { root: Comment; deckId: string }) {
  const [body, setBody] = useState('');
  const createComment = useCreateComment(deckId);
  const canSend = body.trim().length > 0 && !createComment.isPending;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    createComment.mutate(
      // Replies inherit the root's location; only the root carries the mark.
      {
        slideId: root.slideId,
        parentId: root.id,
        body: body.trim(),
        anchor: root.anchor,
        strokes: [],
      },
      { onSuccess: () => setBody('') },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-hairline p-4">
      <MediaTabs className="self-start" />
      <div className="flex items-end gap-2">
        <div className="glass min-w-0 flex-1 rounded-control px-3 py-2.5 focus-within:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)]">
          <AutosizeTextarea
            aria-label="Antworten"
            placeholder="Antworten…"
            value={body}
            maxHeight={160}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            className="text-[13px] leading-5 text-fg"
          />
        </div>
        <button
          type="submit"
          aria-label="Antwort senden"
          disabled={!canSend}
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition-opacity',
            'disabled:opacity-40',
          )}
        >
          <Icon name="arrowUpward" size={20} />
        </button>
      </div>
      {createComment.isError && (
        <p role="alert" className="text-xs text-danger">
          {createComment.error.message}
        </p>
      )}
    </form>
  );
}
