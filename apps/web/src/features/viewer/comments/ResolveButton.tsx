import type { Comment } from '@slider/shared';
import { useUpdateComment } from '@/lib/queries';
import { cn, Icon } from '@/ui';

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

  return (
    <span className={cn('relative z-10 inline-flex items-center gap-1.5', className)}>
      {update.isError && (
        <span role="alert" className="text-[11px] text-danger">
          Nicht gespeichert
        </span>
      )}
      <button
        type="button"
        aria-pressed={done}
        aria-label={done ? 'Wieder öffnen' : 'Als erledigt markieren'}
        title={done ? 'Erledigt – klicken zum Wiederöffnen' : 'Als erledigt markieren'}
        onClick={(event) => {
          event.stopPropagation();
          update.mutate({ commentId: comment.id, status: done ? 'open' : 'done' });
        }}
        className={cn(
          'inline-flex items-center gap-1 rounded-[10px] text-xs font-medium transition-colors',
          variant === 'chip'
            ? 'h-8 px-3 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]'
            : 'size-7 justify-center',
          done ? 'text-success' : 'text-fg-subtle hover:bg-white/10 hover:text-fg',
          done && variant === 'chip' && 'bg-success/10',
        )}
      >
        <Icon name="check" size={variant === 'chip' ? 16 : 18} />
        {variant === 'chip' && label}
      </button>
    </span>
  );
}
