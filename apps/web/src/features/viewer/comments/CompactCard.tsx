import { memo, type CSSProperties } from 'react';
import { accentColor } from '@/lib/accent';
import { Avatar, cn } from '@/ui';
import { isStrokeOnly, type Thread } from '../lib/comment-selectors';
import { useViewerDispatch } from '../state/viewer-state';
import type { CardEmphasis } from './CommentCard';

/**
 * Compact B1 card for narrow comment columns (zoomed-out timeline): avatar, author and two
 * lines of the comment. Clicking opens the thread panel (B4), where replying works as usual.
 */
export const CompactCard = memo(function CompactCard({
  thread,
  emphasis,
}: {
  thread: Thread;
  emphasis: CardEmphasis;
}) {
  const dispatch = useViewerDispatch();
  const { root, replies } = thread;
  const highlighted = emphasis === 'focused' || emphasis === 'hovered';
  const text = isStrokeOnly(root) ? '✏️ Markierung' : root.body;

  return (
    <article
      data-comment-card={thread.id}
      onPointerEnter={() => dispatch({ type: 'threadHovered', threadId: thread.id })}
      onPointerLeave={() => dispatch({ type: 'threadHovered', threadId: null })}
      className={cn(
        'relative transition-opacity duration-200',
        (emphasis === 'dimmed' || root.status === 'done') && 'opacity-45',
        emphasis === 'dimmed' && root.status === 'done' && 'opacity-30',
      )}
      style={{ '--card-accent': accentColor(root.author.color) } as CSSProperties}
    >
      <button
        type="button"
        onClick={() => dispatch({ type: 'threadFocused', threadId: thread.id, openPanel: true })}
        aria-label={`Thread von ${root.author.name} öffnen`}
        title={root.body || undefined}
        className={cn(
          'glass flex w-full flex-col gap-1 rounded-xl p-2 text-left transition-shadow duration-200',
          highlighted &&
            'shadow-[inset_0_0_0_1px_var(--card-accent),0_0_16px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]!',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Avatar author={root.author} size={20} showPowerPointBadge={root.source === 'pptx'} />
          <span className="truncate text-[11px] font-medium text-fg">{root.author.name}</span>
          {replies.length > 0 && (
            <span className="ml-auto shrink-0 text-[10px] text-fg-subtle tabular-nums">
              +{replies.length}
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-xs leading-4 break-words text-fg-muted">{text}</span>
      </button>
    </article>
  );
});
