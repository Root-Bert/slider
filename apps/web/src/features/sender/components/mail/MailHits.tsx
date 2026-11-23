import { useNavigate } from 'react-router';
import { mailThreadKind, type MailThreadSummary } from '@slider/shared';
import { useMailAccounts, useMailSearch } from '@/lib/api';
import { Icon } from '@/ui';
import { useSender } from '../../hooks/useSender';
import { mailGroupName, mailName } from '../../lib/mail';
import { HIT, hitClass } from '../ConversationSearch';
import { MailAvatar } from './MailAvatar';

/** How many mails a side bar's hits list – the newest; the search's page has them all. */
const BAR_MAILS = 20;

/**
 * The mail conversations a search finds, every mailbox and folder (none asked without a mailbox):
 * subject, names, addresses – the bar's, short; `inText` what they say too (the search's page) –
 * the newest `max`. `settling` while the server looks.
 */
export function useMailHits(
  workspaceId: string,
  query: string,
  { max = BAR_MAILS, inText = false } = {},
) {
  const accounts = useMailAccounts(workspaceId).data;
  const found = useMailSearch(workspaceId, query, {
    inText,
    enabled: (accounts?.length ?? 0) > 0,
  });
  return {
    threads: query ? (found.data ?? []).slice(0, max) : [],
    settling: found.isFetching,
  };
}

/** Mail conversations found, as rows of a bar's hits: one opens in Post, as a click in its list. */
export function MailHitRows({
  threads,
  onPicked,
}: {
  threads: MailThreadSummary[];
  onPicked: () => void;
}) {
  const ui = useSender();
  const navigate = useNavigate();
  return threads.map((thread) => {
    const group = mailThreadKind(thread.people) === 'group';
    const on = thread.people.find((each) => each.address === thread.person.address);
    const subject = group ? mailGroupName(thread) : thread.subject || mailName(thread.person);
    return (
      <button
        key={thread.id}
        type="button"
        role="listitem"
        {...{ [HIT]: '' }}
        title={subject}
        className={hitClass}
        onClick={() => {
          onPicked();
          void navigate(ui.mailThreadPath(thread.id));
        }}
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center">
          {group ? (
            <Icon name="groups" size={18} />
          ) : (
            <MailAvatar
              person={{ ...thread.person, userId: on?.userId }}
              vouched={!!on?.vouched}
              size={18}
            />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">{subject}</span>
        {!group && (
          <span className="max-w-[40%] shrink-0 truncate text-xs text-fg-subtle">
            {mailName(thread.person)}
          </span>
        )}
      </button>
    );
  });
}
