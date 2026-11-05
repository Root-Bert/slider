import type { Comment } from '@slider/shared';
import { formatRelativeTime } from '@/lib/format';
import { Avatar, cn, Icon } from '@/ui';
import { useViewerData } from '../state/viewer-data';

type Summary = NonNullable<Comment['aiSummary']>;

/**
 * Where a thread that asked the AI more than three times stands – the AI's own short summary,
 * written anew after each further request (`aiSummary` of its root). At the top of the thread in
 * the AI's look (its avatar, a sage tint); `compact` on a card: one or two lines.
 */
export function ThreadSummary({
  summary,
  compact = false,
  className,
}: {
  summary: Summary;
  compact?: boolean;
  className?: string;
}) {
  const { aiAuthor } = useViewerData();
  if (compact) {
    return (
      <p
        data-thread-summary
        title={summary.text}
        className={cn(
          'flex items-start gap-1.5 rounded-chip bg-[color-mix(in_srgb,var(--color-sage)_14%,transparent)] px-2 py-1 text-caption text-fg-muted',
          className,
        )}
      >
        <Icon name="autoAwesome" size={14} className="mt-px shrink-0 text-fg-subtle" />
        <span className="line-clamp-2 min-w-0">
          <span className="font-medium text-fg">Stand </span>
          {summary.text}
        </span>
      </p>
    );
  }
  return (
    <section
      data-thread-summary
      aria-label="Stand"
      className={cn(
        'flex flex-col gap-1.5 rounded-panel border border-[color-mix(in_srgb,var(--color-sage)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-sage)_12%,transparent)] px-3.5 py-2.5',
        className,
      )}
    >
      <header className="flex items-center gap-2">
        <Avatar author={aiAuthor} size={18} nativeTitle={false} />
        <span className="text-xs font-medium text-fg">Stand</span>
        <span className="ml-auto text-caption text-fg-subtle">
          {formatRelativeTime(summary.at)}
        </span>
      </header>
      <p className="text-body leading-5 text-fg">{summary.text}</p>
    </section>
  );
}
