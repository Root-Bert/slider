import type { Comment } from '@slider/shared';
import type { ReactNode } from 'react';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { Avatar, cn } from '@/ui';
import { formatShortDate } from '../lib/labels';

interface AuthorLineProps {
  comment: Comment;
  trailing?: ReactNode;
  className?: string;
}

/** Avatar (with P badge for PowerPoint), name and "aus PowerPoint · 3. Okt." or "vor 5 Min.". */
export function AuthorLine({ comment, trailing, className }: AuthorLineProps) {
  const fromPowerPoint = comment.source === 'pptx';
  return (
    <header className={cn('flex min-w-0 items-center gap-2', className)}>
      <Avatar author={comment.author} size={24} showPowerPointBadge={fromPowerPoint} />
      <span className="truncate text-xs font-medium text-fg">{comment.author.name}</span>
      <time
        dateTime={comment.createdAt}
        title={formatDateTime(comment.createdAt)}
        className="shrink-0 text-[11px] text-fg-subtle"
      >
        {fromPowerPoint
          ? `aus PowerPoint · ${formatShortDate(comment.createdAt)}`
          : formatRelativeTime(comment.createdAt)}
      </time>
      {trailing && <span className="ml-auto flex shrink-0 items-center">{trailing}</span>}
    </header>
  );
}
