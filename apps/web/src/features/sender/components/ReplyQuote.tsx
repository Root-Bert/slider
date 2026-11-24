import type { SenderReplyQuote } from '@slider/shared';
import { DELETED_ACCOUNT_NAME } from '@slider/shared';
import { cn } from '@/ui';

/**
 * „Antworten“: the message one answers, quoted – above the answer in the list (a click shows it,
 * if it is loaded) and above the field while one writes it.
 */
export function ReplyQuote({
  quote,
  onShow,
  className,
}: {
  quote: SenderReplyQuote;
  onShow?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <span className="block truncate font-medium text-fg-muted">
        {quote.name ?? DELETED_ACCOUNT_NAME}
      </span>
      <span className={cn('line-clamp-2 break-words', quote.deleted && 'italic')}>
        {quote.deleted ? 'Nachricht gelöscht' : quote.text || 'Dateien'}
      </span>
    </>
  );
  const look = cn(
    'block min-w-0 border-l-2 border-hairline-strong pl-2 text-left text-xs text-fg-subtle',
    className,
  );
  return onShow ? (
    <button
      type="button"
      className={cn(look, 'hover:text-fg-muted')}
      title="Nachricht zeigen"
      onClick={(event) => {
        event.stopPropagation();
        onShow();
      }}
    >
      {body}
    </button>
  ) : (
    <div className={look}>{body}</div>
  );
}
