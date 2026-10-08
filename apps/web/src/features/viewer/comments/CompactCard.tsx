import { memo, type CSSProperties } from 'react';
import { accentColor } from '@/lib/accent';
import { Avatar, cn, Icon } from '@/ui';
import { isRemovedInPowerPoint, isStrokeOnly, type Thread } from '../lib/comment-selectors';
import { useViewerDispatch } from '../state/viewer-state';
import type { CardEmphasis } from './CommentCard';

/**
 * Compact B1 card for narrow comment columns (small slides): avatar, author and two
 * lines of the comment. Clicking opens the thread panel (B4), where replying works as usual.
 */
export const CompactCard = memo(function CompactCard({
  thread,
  emphasis,
  changedSince = false,
}: {
  thread: Thread;
  emphasis: CardEmphasis;
  /** The slide changed after the thread was started: small warning mark. */
  changedSince?: boolean;
}) {
  const dispatch = useViewerDispatch();
  const { root, replies } = thread;
  const highlighted = emphasis === 'focused' || emphasis === 'hovered';
  const text = isStrokeOnly(root) ? '✏️ Markierung' : root.body;
  const removed = isRemovedInPowerPoint(root);
  const flagged = changedSince && root.status === 'open';
  const notes = [
    removed && 'In PowerPoint entfernt',
    flagged && 'Folie geändert seit Kommentar',
  ].filter(Boolean);

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
        title={[root.body, ...notes].filter(Boolean).join(' · ') || undefined}
        className={cn(
          'glass flex w-full flex-col gap-1 rounded-panel p-2 text-left transition-shadow duration-200',
          highlighted &&
            'shadow-[inset_0_0_0_1px_var(--card-accent),0_0_16px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]!',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Avatar author={root.author} size={20} showPowerPointBadge={root.source === 'pptx'} />
          <span className="truncate text-[11px] font-medium text-fg">{root.author.name}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {flagged && (
              <Icon
                name="history"
                size={12}
                className="text-warning"
                label="Geändert seit Kommentar"
              />
            )}
            {removed && (
              <Icon
                name="unfoldLess"
                size={12}
                className="text-fg-subtle"
                label="In PowerPoint entfernt"
              />
            )}
            {replies.length > 0 && (
              <span className="text-[10px] text-fg-subtle tabular-nums">+{replies.length}</span>
            )}
          </span>
        </span>
        <span
          className={cn(
            'line-clamp-2 text-xs leading-4 break-words text-fg-muted',
            removed && 'text-fg-subtle line-through decoration-white/30',
          )}
        >
          {text}
        </span>
      </button>
    </article>
  );
});
