import { memo, type CSSProperties } from 'react';
import { accentColor } from '@/lib/accent';
import { Avatar, cn, Icon } from '@/ui';
import { commentPreview, isRemovedInSource, type Thread } from './lib/comment-selectors';
import { LiveThreadMarker } from '../live/LiveThreadMarker';
import { useViewerDispatch } from '../state/viewer-state';
import type { CardEmphasis } from './CommentCard';
import { useCommentMenu } from './hooks/useCommentMenu';
import { removedInSourceLabel } from './lib/labels';

/**
 * Compact B1 card for narrow comment columns (small slides): avatar, author and two
 * lines of the comment. Clicking opens the thread panel (B4), where replying works as usual.
 */
export const CompactCard = memo(function CompactCard({
  thread,
  deckId,
  emphasis,
}: {
  thread: Thread;
  deckId: string;
  emphasis: CardEmphasis;
}) {
  const dispatch = useViewerDispatch();
  const { root, replies } = thread;
  const highlighted = emphasis === 'focused' || emphasis === 'hovered';
  const text = commentPreview(root);
  const removed = isRemovedInSource(root);
  const menu = useCommentMenu({
    comment: root,
    deckId,
    isRoot: true,
    onEdit: () =>
      dispatch({ type: 'commentEditRequested', threadId: thread.id, commentId: root.id }),
  });

  return (
    <article
      data-comment-card={thread.id}
      data-hover-thread={thread.id}
      className={cn(
        'relative transition-opacity duration-200',
        (emphasis === 'dimmed' || root.status === 'done') && 'opacity-45',
        emphasis === 'dimmed' && root.status === 'done' && 'opacity-30',
      )}
      style={{ '--card-accent': accentColor(root.author.color) } as CSSProperties}
      onContextMenu={menu.onContextMenu}
    >
      {menu.menus}
      <LiveThreadMarker threadId={thread.id} />
      <button
        type="button"
        onClick={() => dispatch({ type: 'threadFocused', threadId: thread.id, openPanel: true })}
        aria-label={`Thread von ${root.author.name} öffnen`}
        title={
          [text, removed && removedInSourceLabel(root.source)].filter(Boolean).join(' | ') ||
          undefined
        }
        className={cn(
          'glass flex w-full flex-col gap-1 rounded-panel p-2 text-left transition-[background-color,box-shadow] duration-200 hover:bg-glass-hover',
          highlighted &&
            'shadow-[inset_0_0_0_1px_var(--card-accent),0_0_16px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]!',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Avatar author={root.author} size={20} source={root.source} />
          <span className="truncate text-caption font-medium text-fg">{root.author.name}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {removed && (
              <Icon
                name="unfoldLess"
                size={12}
                className="text-fg-subtle"
                label={removedInSourceLabel(root.source)}
              />
            )}
            {replies.length > 0 && (
              <span className="text-tiny text-fg-subtle tabular-nums">+{replies.length}</span>
            )}
          </span>
        </span>
        <span
          className={cn(
            'line-clamp-2 text-xs leading-4 break-words text-fg-muted',
            removed && 'text-fg-subtle line-through decoration-fg-faint',
          )}
        >
          {text}
        </span>
      </button>
    </article>
  );
});
