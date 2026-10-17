import type { Comment } from '@slider/shared';
import type { ReactNode } from 'react';
import { formatDateTime, formatRelativeTime, formatShortDate } from '@/lib/format';
import { Avatar, cn } from '@/ui';

interface AuthorLineProps {
  comment: Comment;
  trailing?: ReactNode;
  className?: string;
}

/**
 * Avatar (with P badge for PowerPoint), name and "aus PowerPoint · 3. Okt." or "vor 5 Min.".
 * The name comes first: in a narrow line (a 280px card, a phone's panel) the "aus PowerPoint"
 * goes – the P badge says it too – and the date gives way before the name does.
 */
export function AuthorLine({ comment, trailing, className }: AuthorLineProps) {
  const fromPowerPoint = comment.source === 'pptx';
  return (
    <header className={cn('@container flex min-w-0 items-center gap-2', className)}>
      <Avatar author={comment.author} size={24} showPowerPointBadge={fromPowerPoint} />
      <span title={comment.author.name} className="min-w-0 truncate text-xs font-medium text-fg">
        {comment.author.name}
      </span>
      <time
        dateTime={comment.createdAt}
        title={formatDateTime(comment.createdAt)}
        className="min-w-0 shrink-[4] truncate text-caption text-fg-subtle"
      >
        {fromPowerPoint && <span className="hidden @min-[20rem]:inline">aus PowerPoint · </span>}
        {fromPowerPoint
          ? formatShortDate(comment.createdAt)
          : formatRelativeTime(comment.createdAt)}
      </time>
      {trailing && <span className="ml-auto flex shrink-0 items-center">{trailing}</span>}
    </header>
  );
}
