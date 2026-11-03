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
  return (
    <ResolveToggle
      done={done}
      onToggle={() => update.mutate({ commentId: comment.id, status: done ? 'open' : 'done' })}
      failed={update.isError}
      variant={variant}
      className={className}
    />
  );
}

/**
 * The thread's done toggle for anything done like a thread (the AI's card on a variant): one
 * icon, label and title. `failed`: the last toggle was not saved.
 */
export function ResolveToggle({
  done,
  onToggle,
  failed = false,
  variant = 'icon',
  className,
}: {
  done: boolean;
  onToggle: () => void;
  failed?: boolean;
  variant?: 'chip' | 'icon';
  className?: string;
}) {
  const label = done ? 'Erledigt' : 'Erledigen';

  const onClick = (event: MouseEvent) => {
    event.stopPropagation();
    onToggle();
  };
  // A toggle: the name says what it switches, `aria-pressed` whether it's on ("Erledigt,
  // gedrückt"); what a click does is the tooltip's.
  const title = done ? 'Erledigt – klicken zum Wiederöffnen' : 'Als erledigt markieren';

  return (
    <span className={cn('relative z-(--z-raised) inline-flex items-center gap-1.5', className)}>
      {failed && (
        <span role="alert" className="text-caption text-danger">
          Nicht gespeichert
        </span>
      )}
      {variant === 'chip' ? (
        // A toggle with a text label and a success state: no kit Button has that look.
        // Named by its visible text ("Erledigen" / "Erledigt"), so voice control finds it.
        <button
          type="button"
          aria-pressed={done}
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
          label="Erledigt"
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
