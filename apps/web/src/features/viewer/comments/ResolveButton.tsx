import type { Comment } from '@slider/shared';
import { useUpdateComment } from '@/lib/api';
import type { MouseEvent } from 'react';
import { cn, Icon, IconButton } from '@/ui';

interface ResolveButtonProps {
  comment: Comment;
  deckId: string;
  /** `chip` shows the text label (thread panel header), `icon` is compact (cards). */
  variant?: 'chip' | 'icon';
  className?: string;
}

/** Toggles a thread between open and done (BER-101). Optimistic via `useUpdateComment`. */
export function ResolveButton({
  comment,
  deckId,
  variant = 'icon',
  className,
}: ResolveButtonProps) {
  const update = useUpdateComment(deckId);
  const done = comment.status === 'done';
  const label = done ? 'Erledigt' : 'Erledigen';

  const onClick = (event: MouseEvent) => {
    event.stopPropagation();
    update.mutate({ commentId: comment.id, status: done ? 'open' : 'done' });
  };
  const name = done ? 'Wieder öffnen' : 'Als erledigt markieren';
  const title = done ? 'Erledigt – klicken zum Wiederöffnen' : 'Als erledigt markieren';

  return (
    <span className={cn('relative z-(--z-raised) inline-flex items-center gap-1.5', className)}>
      {update.isError && (
        <span role="alert" className="text-caption text-danger">
          Nicht gespeichert
        </span>
      )}
      {variant === 'chip' ? (
        // A toggle with a text label and a success state: no kit Button has that look.
        <button
          type="button"
          aria-pressed={done}
          aria-label={name}
          title={title}
          onClick={onClick}
          className={cn(
            'inline-flex h-8 items-center gap-1 rounded-control-sm px-3 text-xs font-medium ring-hairline-strong transition-colors',
            done ? 'bg-success/10 text-success' : 'text-fg-subtle hover:bg-hover hover:text-fg',
          )}
        >
          <Icon name="check" size={16} />
          {label}
        </button>
      ) : (
        <IconButton
          icon="check"
          label={name}
          title={title}
          variant="subtle"
          size="compact"
          iconTone={done ? 'success' : undefined}
          aria-pressed={done}
          onClick={onClick}
        />
      )}
    </span>
  );
}
