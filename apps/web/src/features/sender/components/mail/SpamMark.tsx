import type { MailThreadSummary } from '@slider/shared';
import { Badge, Icon } from '@/ui';
import { spamMarkOf } from '../../lib/mail';

/** The mark in a mail's row and head, its reason on hover. */
export function SpamMark({
  thread,
}: {
  thread: Pick<MailThreadSummary, 'spam' | 'spamBy' | 'spamSymbols'>;
}) {
  const mark = spamMarkOf(thread);
  if (!mark) return null;
  return (
    <Badge tone={mark.tone} title={mark.title}>
      <Icon name={mark.icon} size={12} />
      {mark.label}
    </Badge>
  );
}
