import { useEffect, useRef, useState } from 'react';
import type { Deck } from '@slider/shared';
import { useUpdateDeck } from '@/lib/api';
import { cn, type ShowToast } from '@/ui';

const MAX_TITLE_LENGTH = 200;

/**
 * "Umbenennen" in place: the title itself turns into an input. Enter or leaving the field saves,
 * Escape cancels; an empty or unchanged name just ends the edit. Only renames in Slider – the
 * PowerPoint file stays as it is.
 */
export function DeckTitleInput({
  deck,
  onDone,
  onNotify,
  className,
}: {
  deck: Deck;
  onDone: () => void;
  onNotify: ShowToast;
  className?: string;
}) {
  const [title, setTitle] = useState(deck.title);
  const update = useUpdateDeck(deck.id);
  const ref = useRef<HTMLInputElement>(null);
  // Enter and the blur that follows must not save twice.
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = () => {
    settled.current = true;
    onDone();
  };

  const save = () => {
    if (settled.current || update.isPending) return;
    const trimmed = title.trim();
    if (trimmed === '' || trimmed === deck.title) return finish();
    update.mutate(
      { title: trimmed },
      {
        onSuccess: () => {
          finish();
        },
        onError: (error) => {
          onNotify(error.message, 'danger');
          ref.current?.focus();
        },
      },
    );
  };

  return (
    <input
      ref={ref}
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
      // The browser's own menu (paste …) instead of the deck actions.
      onContextMenu={(event) => event.stopPropagation()}
      readOnly={update.isPending}
      maxLength={MAX_TITLE_LENGTH}
      aria-label="Name der Review"
      className={cn(
        '-mx-1 w-full min-w-0 rounded-badge bg-surface-1 px-1 text-fg',
        'ring-2 ring-mention outline-none',
        className,
      )}
    />
  );
}
